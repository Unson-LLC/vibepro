import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

const execFileAsync = promisify(execFile);

export async function runFlowVerification(repoRoot, options = {}) {
  if (!options.baseUrl) throw new Error('verify flow requires --base-url <url>');
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const runId = options.runId ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '');
  const runDir = path.join(getWorkspaceDir(root), 'verification', runId);
  const screenshotDir = path.join(runDir, 'screenshots');
  await mkdir(screenshotDir, { recursive: true });

  const config = await readConfig(root);
  const manifest = await readManifest(root);
  const story = resolveStory(config, options.storyId);
  const probes = resolveFlowProbes({ config, manifest, story, journeyId: options.journeyId });
  const connection = resolveConnectionOptions(options, options.env ?? process.env);
  const playwright = await detectPlaywright(root);
  const startedAt = new Date().toISOString();

  let commandResult = null;
  let generatedSpecPath = null;
  let generatedConfigPath = null;
  const probeResults = probes.map((probe) => buildPendingProbeResult(probe, options));
  const runnableProbes = probeResults.filter((probe) => probe.status === 'pending');
  let status = 'pass';
  let reason = null;

  if (!playwright.detected) {
    status = 'needs_setup';
    reason = playwright.reason;
    for (const probe of probeResults) {
      if (probe.status === 'pending') {
        probe.status = 'needs_setup';
        probe.reason = playwright.reason;
      }
    }
  } else if (runnableProbes.length > 0) {
    generatedSpecPath = path.join(runDir, 'flow-verification.spec.js');
    generatedConfigPath = path.join(runDir, 'playwright.config.mjs');
    await writeFile(generatedSpecPath, renderPlaywrightSpec({
      probes: runnableProbes,
      baseUrl: connection.baseUrl,
      screenshotDir
    }));
    await writeFile(generatedConfigPath, renderPlaywrightConfig());
    commandResult = await runPlaywright(root, {
      specPath: generatedSpecPath,
      configPath: generatedConfigPath,
      baseUrl: connection.baseUrl,
      httpAuth: connection.httpAuth,
      headed: options.headed === true,
      env: options.env
    });
    const setupIssue = commandResult.exit_code === 0 ? null : detectPlaywrightSetupIssue(commandResult);
    const commandStatus = commandResult.exit_code === 0 ? 'pass' : setupIssue ? 'needs_setup' : 'fail';
    for (const probe of runnableProbes) {
      probe.status = commandStatus;
      probe.exit_code = commandResult.exit_code;
      probe.artifacts.log = 'playwright-output.log';
      if (setupIssue) probe.reason = setupIssue.reason;
    }
    status = commandStatus;
    if (setupIssue) reason = setupIssue.reason;
    else if (commandStatus === 'fail') reason = `Playwright exited with code ${commandResult.exit_code}`;
    if (setupIssue) commandResult.setup = setupIssue;
  } else if (probeResults.some((probe) => probe.status === 'skipped')) {
    status = 'skipped';
    reason = 'No runnable probes after mutation guard filtering.';
  }

  const verification = {
    schema_version: '0.1.0',
    run_id: runId,
    story_id: story?.story_id ?? null,
    created_at: startedAt,
    status,
    reason,
    base_url: connection.baseUrl,
    http_auth: connection.httpAuth?.summary ?? { enabled: false },
    playwright,
    setup: buildSetupGuidance({ playwright, commandResult }),
    options: {
      journey_id: options.journeyId ?? null,
      allow_mutation: options.allowMutation === true,
      headed: options.headed === true,
      basic_auth_env: options.basicAuthEnv ?? null,
      basic_auth_inline: Boolean(options.basicAuth)
    },
    summary: summarizeProbeResults(probeResults),
    probes: probeResults,
    command: commandResult,
    generated_spec: generatedSpecPath ? toWorkspaceRelative(root, generatedSpecPath) : null,
    generated_config: generatedConfigPath ? toWorkspaceRelative(root, generatedConfigPath) : null
  };

  const jsonPath = path.join(runDir, 'flow-verification.json');
  const markdownPath = path.join(runDir, 'flow-verification.md');
  const logPath = path.join(runDir, 'playwright-output.log');
  await writeFile(jsonPath, `${JSON.stringify(verification, null, 2)}\n`);
  await writeFile(markdownPath, renderFlowVerificationReport(verification));
  if (!commandResult) await writeFile(logPath, `${reason ?? 'Playwright was not executed.'}\n`);

  manifest.latest_flow_verification_run = runId;
  manifest.flow_verification_runs = [
    {
      run_id: runId,
      story_id: verification.story_id,
      created_at: verification.created_at,
      status: verification.status,
      base_url: verification.base_url,
      artifacts: {
        flow_verification_json: toWorkspaceRelative(root, jsonPath),
        flow_verification_report: toWorkspaceRelative(root, markdownPath),
        playwright_log: toWorkspaceRelative(root, logPath),
        generated_spec: verification.generated_spec,
        generated_config: verification.generated_config
      },
      summary: verification.summary
    },
    ...(manifest.flow_verification_runs ?? []).filter((run) => run.run_id !== runId)
  ];
  await writeManifest(root, manifest);

  return {
    runDir,
    artifacts: {
      json: toWorkspaceRelative(root, jsonPath),
      markdown: toWorkspaceRelative(root, markdownPath),
      log: toWorkspaceRelative(root, logPath),
      spec: verification.generated_spec,
      config: verification.generated_config
    },
    verification
  };
}

export function renderFlowVerificationSummary(result) {
  const setupLines = result.verification.setup?.next_commands?.length > 0
    ? [
      '',
      '## Setup',
      ...result.verification.setup.next_commands.map((command) => `- ${command}`)
    ]
    : [];
  const lines = [
    '# VibePro Flow Verification',
    '',
    `Run ID: ${result.verification.run_id}`,
    `Status: ${result.verification.status}`,
    `Report: ${result.artifacts.markdown}`,
    `HTTP Auth: ${result.verification.http_auth?.enabled ? `enabled (${result.verification.http_auth.source})` : 'disabled'}`,
    '',
    '## Summary',
    `- pass: ${result.verification.summary.pass}`,
    `- fail: ${result.verification.summary.fail}`,
    `- skipped: ${result.verification.summary.skipped}`,
    `- needs_setup: ${result.verification.summary.needs_setup}`,
    ...setupLines
  ];
  return `${lines.join('\n')}\n`;
}

async function readConfig(root) {
  try {
    return JSON.parse(await readFile(path.join(getWorkspaceDir(root), 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function resolveStory(config, storyId = null) {
  const stories = config.brainbase?.stories ?? [];
  const id = storyId ?? config.brainbase?.current_story_id ?? null;
  return stories.find((story) => story.story_id === id) ?? stories[0] ?? null;
}

function resolveFlowProbes({ config, manifest, story, journeyId }) {
  const configured = config.flow_design?.runtime_probes;
  const evidenceProbes = latestFlowDesignProbes(config, manifest);
  const defaults = defaultProbesForProfile(config.flow_design?.profile, story);
  const probes = Array.isArray(configured) && configured.length > 0
    ? configured
    : evidenceProbes.length > 0
      ? evidenceProbes
      : defaults;
  return probes
    .filter((probe) => !journeyId || probe.id === journeyId)
    .map(normalizeProbe)
    .filter(Boolean);
}

function latestFlowDesignProbes(config, manifest) {
  const latestRunId = config.brainbase?.current_story_id
    ? manifest.latest_run_by_story?.[config.brainbase.current_story_id]
    : manifest.latest_run;
  const run = (manifest.runs ?? []).find((item) => item.run_id === latestRunId) ?? null;
  const probes = run?.flow_design?.runtime_probe_plan?.commands ?? [];
  return Array.isArray(probes) ? probes.filter((probe) => probe.path && Array.isArray(probe.steps)) : [];
}

function defaultProbesForProfile(profile, story) {
  const text = [profile, story?.story_id, story?.title].filter(Boolean).join(' ');
  if (!/senpainurse|U-0|センパイ|退院支援|患者/.test(text)) return [];
  return [{
    id: 'senpainurse-new-registration-readonly',
    title: 'センパイナース新規登録の非破壊導線',
    path: '/new',
    mutates: false,
    steps: [
      { action: 'expectVisible', text: '病名' },
      { action: 'expectVisible', text: '仮登録' },
      { action: 'expectNotVisible', text: '退院予定日' },
      { action: 'expectNotVisible', text: '退院先を選択' },
      { action: 'expectNotVisible', text: 'タスクを追加' },
      { action: 'screenshot', name: 'senpainurse-new-registration' }
    ]
  }];
}

function normalizeProbe(probe) {
  if (!probe?.id || !probe.path || !Array.isArray(probe.steps)) return null;
  return {
    id: String(probe.id),
    title: probe.title ?? probe.intent ?? probe.id,
    path: probe.path,
    mutates: probe.mutates === true,
    steps: probe.steps
  };
}

function buildPendingProbeResult(probe, options) {
  const screenshotPaths = probe.steps
    .filter((step) => step.action === 'screenshot')
    .map((step) => `screenshots/${safeFileName(step.name ?? probe.id)}.png`);
  if (probe.mutates && options.allowMutation !== true) {
    return {
      ...probe,
      status: 'skipped',
      reason: 'mutates=true requires --allow-mutation',
      artifacts: { screenshot_paths: screenshotPaths }
    };
  }
  return {
    ...probe,
    status: 'pending',
    reason: null,
    artifacts: { screenshot_paths: screenshotPaths }
  };
}

async function detectPlaywright(root) {
  const packageJson = await readPackageJson(root);
  if (!packageJson) {
    return {
      detected: false,
      command: 'npx playwright test',
      reason: 'Playwright setup is not detectable because package.json is missing.'
    };
  }
  const deps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {})
  };
  const scripts = packageJson.scripts ?? {};
  const hasDependency = Boolean(deps['@playwright/test'] || deps.playwright);
  const script = Object.entries(scripts).find(([, command]) => /\bplaywright\b/.test(String(command)));
  if (hasDependency || script) {
    return {
      detected: true,
      command: script ? `npm run ${script[0]}` : 'npx playwright test',
      reason: hasDependency ? 'Playwright dependency detected.' : `Playwright script detected: ${script[0]}`
    };
  }
  return {
    detected: false,
    command: 'npx playwright test',
    reason: 'Playwright dependency or script was not found.'
  };
}

async function readPackageJson(root) {
  try {
    return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function runPlaywright(root, { specPath, configPath, baseUrl, httpAuth, headed, env }) {
  const logPath = path.join(path.dirname(specPath), 'playwright-output.log');
  const args = ['playwright', 'test', '--config', configPath];
  if (headed) args.push('--headed');
  const command = `npx ${args.map(toPosix).join(' ')}`;
  try {
    const result = await execFileAsync('npx', args, {
      cwd: root,
      env: {
        ...process.env,
        ...(env ?? {}),
        VIBEPRO_BASE_URL: baseUrl,
        ...(httpAuth?.credentials
          ? {
            VIBEPRO_BASIC_AUTH_USER: httpAuth.credentials.username,
            VIBEPRO_BASIC_AUTH_PASSWORD: httpAuth.credentials.password
          }
          : {})
      },
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });
    await writeFile(logPath, `${result.stdout ?? ''}${result.stderr ?? ''}`);
    return {
      command,
      status: 'pass',
      exit_code: 0,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr)
    };
  } catch (error) {
    await writeFile(logPath, `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`);
    return {
      command,
      status: 'fail',
      exit_code: error.code ?? 1,
      stdout: truncate(error.stdout),
      stderr: truncate(error.stderr ?? error.message)
    };
  }
}

function resolveConnectionOptions(options, env) {
  const parsed = parseBaseUrl(options.baseUrl);
  const inlineAuth = options.basicAuth ? parseBasicAuthValue(options.basicAuth, '--basic-auth') : null;
  const envAuth = options.basicAuthEnv ? parseBasicAuthValue(env?.[options.basicAuthEnv], `env:${options.basicAuthEnv}`) : null;
  const urlAuth = parsed.credentials
    ? {
      source: 'base-url',
      credentials: parsed.credentials,
      summary: buildHttpAuthSummary('base-url', parsed.credentials.username)
    }
    : null;
  const httpAuth = inlineAuth ?? envAuth ?? urlAuth ?? null;
  return {
    baseUrl: parsed.sanitizedUrl,
    httpAuth
  };
}

function parseBaseUrl(value) {
  try {
    const url = new URL(value);
    const hasCredentials = Boolean(url.username || url.password);
    const credentials = hasCredentials
      ? {
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password)
      }
      : null;
    if (hasCredentials) {
      url.username = '';
      url.password = '';
    }
    return {
      sanitizedUrl: url.toString().replace(/\/$/, ''),
      credentials
    };
  } catch {
    return {
      sanitizedUrl: value,
      credentials: null
    };
  }
}

function parseBasicAuthValue(value, source) {
  if (!value) throw new Error(`${source} must be set to <username>:<password>`);
  const separator = String(value).indexOf(':');
  if (separator <= 0) throw new Error(`${source} must be formatted as <username>:<password>`);
  const credentials = {
    username: String(value).slice(0, separator),
    password: String(value).slice(separator + 1)
  };
  if (!credentials.password) throw new Error(`${source} must include a non-empty password`);
  return {
    source,
    credentials,
    summary: buildHttpAuthSummary(source, credentials.username)
  };
}

function buildHttpAuthSummary(source, username) {
  return {
    enabled: true,
    source,
    username,
    password_redacted: true
  };
}

function detectPlaywrightSetupIssue(commandResult) {
  const output = [commandResult?.stdout, commandResult?.stderr].filter(Boolean).join('\n');
  if (/Executable (doesn't|does not) exist|Looks like Playwright was just installed|npx playwright install/i.test(output)) {
    return {
      kind: 'playwright_browser_missing',
      reason: 'Playwright browser binaries are missing. Run `npx playwright install chromium` in the target repository.',
      next_commands: ['npx playwright install chromium']
    };
  }
  return null;
}

function buildSetupGuidance({ playwright, commandResult }) {
  if (!playwright.detected) {
    return {
      kind: 'playwright_dependency_missing',
      reason: playwright.reason,
      next_commands: [
        'npm install -D @playwright/test',
        'npx playwright install chromium'
      ]
    };
  }
  return commandResult?.setup ?? null;
}

function renderPlaywrightSpec({ probes, screenshotDir }) {
  return `import { test, expect } from '@playwright/test';

const BASE_URL = process.env.VIBEPRO_BASE_URL;
const BASIC_AUTH_USER = process.env.VIBEPRO_BASIC_AUTH_USER;
const BASIC_AUTH_PASSWORD = process.env.VIBEPRO_BASIC_AUTH_PASSWORD;

if (BASIC_AUTH_USER && BASIC_AUTH_PASSWORD) {
  test.use({
    httpCredentials: {
      username: BASIC_AUTH_USER,
      password: BASIC_AUTH_PASSWORD
    }
  });
}

${probes.map((probe) => `test(${JSON.stringify(probe.title)}, async ({ page }) => {
  await page.goto(new URL(${JSON.stringify(probe.path)}, BASE_URL).toString());
${probe.steps.map((step) => renderStep(step, probe, screenshotDir)).filter(Boolean).join('\n')}
});`).join('\n\n')}
`;
}

function renderPlaywrightConfig() {
  return `export default {
  testDir: '.',
  testMatch: /flow-verification\\.spec\\.js$/,
  timeout: 30000,
  use: {
    trace: 'retain-on-failure'
  }
};
`;
}

function renderStep(step, probe, screenshotDir) {
  if (step.action === 'expectVisible') {
    return `  await expect(page.getByText(${JSON.stringify(step.text)}, { exact: false }).first()).toBeVisible();`;
  }
  if (step.action === 'expectNotVisible') {
    return `  await expect(page.getByText(${JSON.stringify(step.text)}, { exact: false }).first()).toBeHidden();`;
  }
  if (step.action === 'click') {
    return `  await page.getByText(${JSON.stringify(step.text)}, { exact: false }).first().click();`;
  }
  if (step.action === 'fill') {
    if (step.selector) return `  await page.locator(${JSON.stringify(step.selector)}).fill(${JSON.stringify(step.value ?? '')});`;
    return `  await page.getByLabel(${JSON.stringify(step.label ?? step.text)}, { exact: false }).fill(${JSON.stringify(step.value ?? '')});`;
  }
  if (step.action === 'fillFromText') {
    const matcher = step.textRegex ?? step.regex ?? null;
    if (!matcher) return null;
    const group = Number.isInteger(step.group) ? step.group : 1;
    const capture = [
      '  const bodyText = await page.locator(\'body\').innerText();',
      `  const textMatch = bodyText.match(new RegExp(${JSON.stringify(matcher)}));`,
      `  expect(textMatch, ${JSON.stringify(`Expected page text to match ${matcher}`)}).not.toBeNull();`,
      `  const capturedValue = textMatch[${group}];`,
      `  expect(capturedValue, ${JSON.stringify(`Expected capture group ${group} from ${matcher}`)}).toBeTruthy();`
    ].join('\n');
    const fill = step.selector
      ? `  await page.locator(${JSON.stringify(step.selector)}).fill(capturedValue);`
      : `  await page.getByLabel(${JSON.stringify(step.label ?? step.text)}, { exact: ${step.exact === true ? 'true' : 'false'} }).fill(capturedValue);`;
    return `${capture}\n${fill}`;
  }
  if (step.action === 'screenshot') {
    const fileName = `${safeFileName(step.name ?? probe.id)}.png`;
    return `  await page.screenshot({ path: ${JSON.stringify(path.join(screenshotDir, fileName))}, fullPage: true });`;
  }
  return null;
}

function renderFlowVerificationReport(verification) {
  return `# Flow Verification

| 項目 | 内容 |
|------|------|
| Run ID | ${verification.run_id} |
| Story ID | ${verification.story_id ?? '-'} |
| Status | ${verification.status} |
| Base URL | ${verification.base_url} |
| HTTP Auth | ${verification.http_auth?.enabled ? `enabled (${verification.http_auth.source}, user=${verification.http_auth.username})` : 'disabled'} |
| Reason | ${verification.reason ?? '-'} |

## Summary

- pass: ${verification.summary.pass}
- fail: ${verification.summary.fail}
- skipped: ${verification.summary.skipped}
- needs_setup: ${verification.summary.needs_setup}

## Probes

${verification.probes.length === 0 ? '- なし' : verification.probes.map((probe) => `- ${probe.id}: ${probe.status} ${probe.reason ? `(${probe.reason})` : ''}`).join('\n')}

## Setup

${verification.setup?.next_commands?.length > 0 ? verification.setup.next_commands.map((command) => `- \`${command}\``).join('\n') : '- なし'}
`;
}

function summarizeProbeResults(probes) {
  return {
    total: probes.length,
    pass: probes.filter((probe) => probe.status === 'pass').length,
    fail: probes.filter((probe) => probe.status === 'fail').length,
    skipped: probes.filter((probe) => probe.status === 'skipped').length,
    needs_setup: probes.filter((probe) => probe.status === 'needs_setup').length
  };
}

function safeFileName(value) {
  return String(value ?? 'screenshot')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'screenshot';
}

function toPosix(value) {
  return String(value).split(path.sep).join('/');
}

function truncate(value, maxLength = 6000) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
