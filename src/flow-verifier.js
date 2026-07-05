import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';
import { collectGitContext } from './git-fingerprint.js';

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
  const gitContext = await collectGitContext(root);
  const warnings = normalizeWarnings([options.managedWorktreeWarning]);

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
    const runtimeContractFailures = commandResult.runtime_contract_failures ?? [];
    const commandStatus = commandResult.exit_code === 0 && runtimeContractFailures.length === 0 ? 'pass' : setupIssue ? 'needs_setup' : 'fail';
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
  } else if (probeResults.length === 0) {
    status = 'needs_evidence';
    reason = 'No runtime probes were configured for Flow Verification.';
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
    setup: buildSetupGuidance({ playwright, commandResult, probeResults, story }),
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
    runtime_contract_failures: commandResult?.runtime_contract_failures ?? [],
    warnings,
    git_context: gitContext,
    generated_spec: generatedSpecPath ? toWorkspaceRelative(root, generatedSpecPath) : null,
    generated_config: generatedConfigPath ? toWorkspaceRelative(root, generatedConfigPath) : null,
    auto_visual_evidence: null
  };

  const jsonPath = path.join(runDir, 'flow-verification.json');
  const markdownPath = path.join(runDir, 'flow-verification.md');
  const logPath = path.join(runDir, 'playwright-output.log');
  await writeFile(jsonPath, `${JSON.stringify(verification, null, 2)}\n`);
  await writeFile(markdownPath, renderFlowVerificationReport(verification));
  if (!commandResult) await writeFile(logPath, `${reason ?? 'Playwright was not executed.'}\n`);
  const autoVisualEvidence = await recordVisualEvidenceFromFlowRun(root, {
    verification,
    jsonPath,
    command: commandResult?.command
  });
  if (autoVisualEvidence) {
    verification.auto_visual_evidence = autoVisualEvidence;
    await writeFile(jsonPath, `${JSON.stringify(verification, null, 2)}\n`);
    await writeFile(markdownPath, renderFlowVerificationReport(verification));
  }

  manifest.latest_flow_verification_run = runId;
  manifest.flow_verification_runs = [
    {
      run_id: runId,
      story_id: verification.story_id,
      created_at: verification.created_at,
      status: verification.status,
      base_url: verification.base_url,
      git_context: gitContext,
      warnings,
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

function normalizeWarnings(warnings) {
  return warnings.filter((warning) => warning && typeof warning === 'object');
}

async function gitOptional(repoRoot, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return '';
  }
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
    `- runtime_contract_failures: ${result.verification.runtime_contract_failures?.length ?? 0}`,
    `- auto_visual_evidence: ${formatAutoVisualEvidenceSummary(result.verification.auto_visual_evidence)}`,
    ...setupLines
  ];
  return `${lines.join('\n')}\n`;
}

function formatAutoVisualEvidenceSummary(autoVisualEvidence) {
  if (autoVisualEvidence?.status === 'recorded') return `recorded (${autoVisualEvidence.screenshot_paths?.length ?? 0} screenshot(s))`;
  if (autoVisualEvidence?.status === 'not_recorded') return `not_recorded (${autoVisualEvidence.reason})`;
  return 'unknown';
}

async function readConfig(root) {
  try {
    return JSON.parse(await readFile(path.join(getWorkspaceDir(root), 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

export function resolveStory(config, storyId = null) {
  const stories = config.brainbase?.stories ?? [];
  const id = storyId ?? config.brainbase?.current_story_id ?? null;
  return stories.find((story) => story.story_id === id) ?? stories[0] ?? null;
}

export function resolveFlowProbes({ config, manifest, story, journeyId }) {
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
  return [];
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

async function recordVisualEvidenceFromFlowRun(root, { verification, jsonPath, command }) {
  if (!verification?.story_id) return buildAutoVisualEvidenceNotRecorded('story_not_bound', 'verify flow did not resolve a story id');
  if (verification.status !== 'pass') return buildAutoVisualEvidenceNotRecorded('flow_status_not_pass', `flow status was ${verification.status}`);
  if ((verification.runtime_contract_failures?.length ?? 0) > 0) {
    return buildAutoVisualEvidenceNotRecorded(
      'runtime_contract_failures',
      `${verification.runtime_contract_failures.length} runtime contract failure(s) were recorded`
    );
  }
  const declaredScreenshotTargets = verification.probes
    .filter((probe) => probe.status === 'pass')
    .flatMap((probe) => probe.artifacts?.screenshot_paths ?? [])
    .map((screenshotPath) => path.posix.join('.vibepro', 'verification', verification.run_id, normalizeRelativePath(screenshotPath)))
    .filter(Boolean);
  const screenshotTargets = [];
  for (const screenshotPath of declaredScreenshotTargets) {
    if (await fileExists(path.join(root, screenshotPath))) screenshotTargets.push(screenshotPath);
  }
  if (screenshotTargets.length === 0) {
    return buildAutoVisualEvidenceNotRecorded('screenshots_missing', 'no screenshot files were saved for this flow run');
  }
  const artifact = toWorkspaceRelative(root, jsonPath);
  return buildAutoVisualEvidenceNotRecorded(
    'visual_residual_required',
    `flow saved ${screenshotTargets.length} screenshot(s); run vibepro verify visual to produce residual artifacts before Visual QA Gate can pass`,
    {
      source: artifact,
      screenshot_paths: screenshotTargets,
      command: command ?? `vibepro verify flow . --base-url ${verification.base_url} --id ${verification.story_id}`
    }
  );
}

function buildAutoVisualEvidenceNotRecorded(reason, detail, extra = {}) {
  return {
    status: 'not_recorded',
    reason,
    detail,
    ...extra
  };
}

function normalizeRelativePath(value) {
  return String(value ?? '').split(path.sep).join('/').replace(/^\/+/, '');
}

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
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
  const secrets = [
    httpAuth?.credentials?.username,
    httpAuth?.credentials?.password,
    ...(env ? Object.values(env) : [])
  ].filter((value) => typeof value === 'string' && value.length > 0);
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
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const redactedOutput = redactSecrets(output, secrets);
    await writeFile(logPath, redactedOutput);
    return {
      command,
      status: 'pass',
      exit_code: 0,
      stdout: truncate(redactSecrets(result.stdout, secrets)),
      stderr: truncate(redactSecrets(result.stderr, secrets)),
      runtime_contract_failures: extractRuntimeContractFailures(redactedOutput)
    };
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`;
    const redactedOutput = redactSecrets(output, secrets);
    await writeFile(logPath, redactedOutput);
    return {
      command,
      status: 'fail',
      exit_code: error.code ?? 1,
      stdout: truncate(redactSecrets(error.stdout, secrets)),
      stderr: truncate(redactSecrets(error.stderr ?? error.message, secrets)),
      runtime_contract_failures: extractRuntimeContractFailures(redactedOutput)
    };
  }
}

function redactSecrets(value, secrets = []) {
  let output = String(value ?? '');
  for (const secret of secrets) {
    if (!secret) continue;
    output = output.split(secret).join('[REDACTED]');
  }
  return output;
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
    username_redacted: Boolean(username),
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

function buildSetupGuidance({ playwright, commandResult, probeResults = [], story = null }) {
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
  if (probeResults.length === 0) {
    const storySuffix = story?.story_id ? ` --id ${story.story_id}` : ' --id <story-id>';
    return {
      kind: 'flow_runtime_probes_missing',
      reason: 'No runtime probes were configured for Flow Verification.',
      next_commands: [
        'Add `flow_design.runtime_probes[]` to `.vibepro/config.json` with at least one non-mutating probe for the changed workflow.',
        `vibepro verify flow . --base-url <url>${storySuffix}`
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

function installRuntimeContractWatch(page) {
  const events = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/')) return;
    const status = response.status();
    const contentType = response.headers()['content-type'] || '';
    if (status >= 400) {
      events.push({ kind: 'api_response_error', url, status, contentType });
      return;
    }
    if (/text\\/html/i.test(contentType)) {
      events.push({ kind: 'api_html_response', url, status, contentType });
    }
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/')) {
      events.push({ kind: 'api_request_failed', url: request.url(), failure: request.failure()?.errorText || null });
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') events.push({ kind: 'console_error', text: message.text() });
  });
  page.on('pageerror', (error) => {
    events.push({ kind: 'page_error', text: error.message });
  });
  return events;
}

async function assertNoRuntimeContractFailures(page, events) {
  await page.waitForTimeout(250);
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const visibleErrorPatterns = [
    '情報を取得できませんでした',
    '読み込みに失敗しました',
    'Failed to fetch',
    "Unexpected token '<'",
    'Server Action'
  ];
  for (const pattern of visibleErrorPatterns) {
    if (bodyText.includes(pattern)) events.push({ kind: 'visible_error_text', text: pattern });
  }
  const relevant = events.filter((event) => {
    const text = [event.text, event.failure, event.url].filter(Boolean).join(' ');
    return event.kind.startsWith('api_')
      || /Failed to fetch|Unexpected token '<'|Server Action .*not found|情報を取得できませんでした|読み込みに失敗しました|NEXT_RUNTIME|Unhandled/i.test(text);
  });
  expect(relevant, 'VibePro runtime contract failure: ' + JSON.stringify(relevant, null, 2)).toEqual([]);
}

${probes.map((probe) => `test(${JSON.stringify(probe.title)}, async ({ page }) => {
  const runtimeContractEvents = installRuntimeContractWatch(page);
  await page.goto(new URL(${JSON.stringify(probe.path)}, BASE_URL).toString());
  const vibeproProbeState = { urls: { initial: page.url() }, scrollLeft: {} };
${probe.steps.map((step, index) => renderStep(step, probe, screenshotDir, index)).filter(Boolean).join('\n')}
  await assertNoRuntimeContractFailures(page, runtimeContractEvents);
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

function renderStep(step, probe, screenshotDir, index = 0) {
  if (step.action === 'expectVisible') {
    return `  await expect(page.getByText(${JSON.stringify(step.text)}, { exact: false }).first()).toBeVisible();`;
  }
  if (step.action === 'expectNotVisible') {
    return `  await expect(page.getByText(${JSON.stringify(step.text)}, { exact: false }).first()).toBeHidden();`;
  }
  if (step.action === 'click') {
    return `  await page.getByText(${JSON.stringify(step.text)}, { exact: false }).first().click();`;
  }
  if (step.action === 'physicalClick') {
    return renderPhysicalClickStep(step);
  }
  if (step.action === 'expectElementFromPoint') {
    return renderElementFromPointStep(step);
  }
  if (step.action === 'captureUrl') {
    const key = safeStateKey(step.name ?? step.key ?? 'checkpoint');
    return `  vibeproProbeState.urls[${JSON.stringify(key)}] = page.url();`;
  }
  if (step.action === 'expectUrlUnchanged') {
    const key = safeStateKey(step.name ?? step.key ?? 'initial');
    return [
      `  const expectedUrl${index} = vibeproProbeState.urls[${JSON.stringify(key)}] ?? vibeproProbeState.urls.initial;`,
      `  expect(page.url(), ${JSON.stringify(`Expected URL to remain unchanged from ${key}`)}).toBe(expectedUrl${index});`
    ].join('\n');
  }
  if (step.action === 'drag' || step.action === 'touchDrag') {
    return renderGestureDragStep(step, index);
  }
  if (step.action === 'expectScrollLeftChanged') {
    const key = safeStateKey(step.name ?? step.key ?? step.selector ?? `gesture-${index}`);
    return [
      `  const scrollState${index} = vibeproProbeState.scrollLeft[${JSON.stringify(key)}];`,
      `  expect(scrollState${index}, ${JSON.stringify(`Expected recorded scrollLeft state for ${key}`)}).toBeTruthy();`,
      `  expect(scrollState${index}.after, ${JSON.stringify(`Expected scrollLeft to change for ${key}`)}).not.toBe(scrollState${index}.before);`
    ].join('\n');
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

function renderElementFromPointStep(step) {
  const locatorExpression = step.selector
    ? `page.locator(${JSON.stringify(step.selector)}).first()`
    : `page.getByText(${JSON.stringify(step.text ?? step.label)}, { exact: ${step.exact === true ? 'true' : 'false'} }).first()`;
  const targetLabel = step.selector ?? step.text ?? step.label ?? 'elementFromPoint target';
  return [
    `  const hitTarget = ${locatorExpression};`,
    '  await expect(hitTarget).toBeVisible();',
    '  await hitTarget.scrollIntoViewIfNeeded();',
    '  const hit = await hitTarget.evaluate((element) => {',
    '    const rect = element.getBoundingClientRect();',
    '    const x = rect.left + rect.width / 2;',
    '    const y = rect.top + rect.height / 2;',
    '    const target = document.elementFromPoint(x, y);',
    '    return {',
    '      isSelf: target === element,',
    '      isInside: Boolean(target && element.contains(target)),',
    '      tagName: target?.tagName ?? null,',
    '      className: String(target?.className ?? \'\'),',
    '      html: target?.outerHTML?.slice(0, 240) ?? null',
    '    };',
    '  });',
    `  expect(hit.isSelf || hit.isInside, \`Hit target for ${escapeTemplate(targetLabel)} is intercepted by \${hit.tagName}.\${hit.className}: \${hit.html}\`).toBe(true);`
  ].join('\n');
}

function renderGestureDragStep(step, index) {
  const selector = step.selector ?? step.text ?? step.label;
  if (!selector) return null;
  const locatorExpression = step.selector
    ? `page.locator(${JSON.stringify(step.selector)}).first()`
    : `page.getByText(${JSON.stringify(step.text ?? step.label)}, { exact: ${step.exact === true ? 'true' : 'false'} }).first()`;
  const key = safeStateKey(step.name ?? step.key ?? step.selector ?? `gesture-${index}`);
  const deltaX = Number.isFinite(step.deltaX) ? step.deltaX : -160;
  const deltaY = Number.isFinite(step.deltaY) ? step.deltaY : 0;
  const steps = Number.isInteger(step.steps) && step.steps > 0 ? step.steps : 8;
  const expectsScroll = step.expectScrollLeftChanged === true || step.expectScrollChange === true;
  const expectsActiveChange = step.expectActiveChanged === true || step.expectActiveCardChanged === true;
  const lines = [
    `  const gestureTarget${index} = ${locatorExpression};`,
    `  await expect(gestureTarget${index}).toBeVisible();`,
    `  await gestureTarget${index}.scrollIntoViewIfNeeded();`,
    `  const gestureScrollBefore${index} = await gestureTarget${index}.evaluate((element) => element.scrollLeft);`
  ];
  if (step.activeSelector) {
    lines.push(`  const gestureActiveBefore${index} = await page.locator(${JSON.stringify(step.activeSelector)}).first().evaluate((element) => ({ text: element.textContent, className: String(element.className), ariaSelected: element.getAttribute('aria-selected') })).catch(() => null);`);
  }
  lines.push(
    `  const gestureBox${index} = await gestureTarget${index}.boundingBox();`,
    `  expect(gestureBox${index}, ${JSON.stringify(`Expected a bounding box for ${selector}`)}).not.toBeNull();`,
    `  await page.mouse.move(gestureBox${index}.x + gestureBox${index}.width / 2, gestureBox${index}.y + gestureBox${index}.height / 2);`,
    '  await page.mouse.down();',
    `  await page.mouse.move(gestureBox${index}.x + gestureBox${index}.width / 2 + ${deltaX}, gestureBox${index}.y + gestureBox${index}.height / 2 + ${deltaY}, { steps: ${steps} });`,
    '  await page.mouse.up();',
    '  await page.waitForTimeout(100);',
    `  const gestureScrollAfter${index} = await gestureTarget${index}.evaluate((element) => element.scrollLeft);`,
    `  vibeproProbeState.scrollLeft[${JSON.stringify(key)}] = { before: gestureScrollBefore${index}, after: gestureScrollAfter${index} };`
  );
  if (step.activeSelector) {
    lines.push(`  const gestureActiveAfter${index} = await page.locator(${JSON.stringify(step.activeSelector)}).first().evaluate((element) => ({ text: element.textContent, className: String(element.className), ariaSelected: element.getAttribute('aria-selected') })).catch(() => null);`);
  }
  if (expectsScroll) {
    lines.push(`  expect(gestureScrollAfter${index}, ${JSON.stringify(`Expected scrollLeft to change for ${selector}`)}).not.toBe(gestureScrollBefore${index});`);
  }
  if (expectsActiveChange && step.activeSelector) {
    lines.push(`  expect(JSON.stringify(gestureActiveAfter${index}), ${JSON.stringify(`Expected active item state to change for ${step.activeSelector}`)}).not.toBe(JSON.stringify(gestureActiveBefore${index}));`);
  }
  if (step.expectUrlUnchanged === true) {
    lines.push(`  expect(page.url(), ${JSON.stringify(`Expected drag not to navigate for ${selector}`)}).toBe(vibeproProbeState.urls.initial);`);
  }
  return lines.join('\n');
}

function renderPhysicalClickStep(step) {
  const locatorExpression = step.selector
    ? `page.locator(${JSON.stringify(step.selector)}).first()`
    : `page.getByText(${JSON.stringify(step.text ?? step.label)}, { exact: ${step.exact === true ? 'true' : 'false'} }).first()`;
  const targetLabel = step.selector ?? step.text ?? step.label ?? 'physicalClick target';
  const assertSelfTarget = step.targetPolicy !== 'closest';
  const hitAssertion = assertSelfTarget
    ? `  expect(hit.isSelf, \`Physical click target for ${escapeTemplate(targetLabel)} is intercepted by \${hit.tagName}.\${hit.className}: \${hit.html}\`).toBe(true);`
    : `  expect(hit.isSelf || hit.isInside, \`Physical click target for ${escapeTemplate(targetLabel)} is outside the locator: \${hit.tagName}.\${hit.className}: \${hit.html}\`).toBe(true);`;
  return [
    `  const physicalTarget = ${locatorExpression};`,
    '  await expect(physicalTarget).toBeVisible();',
    '  await physicalTarget.scrollIntoViewIfNeeded();',
    '  const hit = await physicalTarget.evaluate((element) => {',
    '    const rect = element.getBoundingClientRect();',
    '    const x = rect.left + rect.width / 2;',
    '    const y = rect.top + rect.height / 2;',
    '    const target = document.elementFromPoint(x, y);',
    '    return {',
    '      isSelf: target === element,',
    '      isInside: Boolean(target && element.contains(target)),',
    '      tagName: target?.tagName ?? null,',
    '      className: String(target?.className ?? \'\'),',
    '      html: target?.outerHTML?.slice(0, 240) ?? null',
    '    };',
    '  });',
    hitAssertion,
    '  const box = await physicalTarget.boundingBox();',
    `  expect(box, ${JSON.stringify(`Expected a bounding box for ${targetLabel}`)}).not.toBeNull();`,
    '  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);'
  ].join('\n');
}

function safeStateKey(value) {
  return String(value ?? 'default').replace(/[^a-zA-Z0-9_.:-]+/g, '-').slice(0, 80) || 'default';
}

function renderFlowVerificationReport(verification) {
  return `# Flow Verification

| 項目 | 内容 |
|------|------|
| Run ID | ${verification.run_id} |
| Story ID | ${verification.story_id ?? '-'} |
| Status | ${verification.status} |
| Base URL | ${verification.base_url} |
| HTTP Auth | ${verification.http_auth?.enabled ? `enabled (${verification.http_auth.source}, credentials redacted)` : 'disabled'} |
| Reason | ${verification.reason ?? '-'} |

## Summary

- pass: ${verification.summary.pass}
- fail: ${verification.summary.fail}
- skipped: ${verification.summary.skipped}
- needs_setup: ${verification.summary.needs_setup}
- runtime_contract_failures: ${verification.runtime_contract_failures?.length ?? 0}
- auto_visual_evidence: ${formatAutoVisualEvidenceSummary(verification.auto_visual_evidence)}

## Probes

${verification.probes.length === 0 ? '- なし' : verification.probes.map((probe) => `- ${probe.id}: ${probe.status} ${probe.reason ? `(${probe.reason})` : ''}`).join('\n')}

## Setup

${verification.setup?.next_commands?.length > 0 ? verification.setup.next_commands.map((command) => `- \`${command}\``).join('\n') : '- なし'}

## Runtime Contract Failures

${verification.runtime_contract_failures?.length > 0 ? verification.runtime_contract_failures.map((item) => `- ${item.kind}: ${item.detail}`).join('\n') : '- なし'}

## Auto Visual Evidence

${verification.auto_visual_evidence?.status === 'recorded'
    ? [
        `- status: recorded`,
        `- source: ${verification.auto_visual_evidence.source}`,
        `- flow_run_id: ${verification.run_id}`,
        ...verification.auto_visual_evidence.screenshot_paths.map((screenshotPath) => `- screenshot: ${screenshotPath}`)
      ].join('\n')
    : verification.auto_visual_evidence?.status === 'not_recorded'
      ? [
          `- status: not_recorded`,
          `- reason: ${verification.auto_visual_evidence.reason}`,
          `- detail: ${verification.auto_visual_evidence.detail}`
        ].join('\n')
      : '- なし'}

## Warnings

${verification.warnings?.length > 0 ? verification.warnings.map((warning) => `- ${warning.id}: ${warning.reason ?? warning.status ?? 'warning'}`).join('\n') : '- なし'}
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

function extractRuntimeContractFailures(output) {
  const text = String(output ?? '');
  const failures = [];
  const runtimeFailure = /VibePro runtime contract failure:\s*([\s\S]*?)(?:\n\s*at |\n\s*Error:|$)/m.exec(text);
  if (runtimeFailure) {
    failures.push({
      kind: 'runtime_contract_failure',
      detail: truncate(runtimeFailure[1].trim(), 2000)
    });
  }
  for (const pattern of [
    /\/api\/[^\s"'`]+[\s\S]{0,120}\b(404|500|502|503)\b/g,
    /Unexpected token '<'/g,
    /Failed to fetch/g,
    /Server Action [^\n]+ was not found/g,
    /情報を取得できませんでした/g,
    /読み込みに失敗しました/g
  ]) {
    for (const match of text.matchAll(pattern)) {
      failures.push({
        kind: 'runtime_contract_signal',
        detail: truncate(match[0], 500)
      });
    }
  }
  return failures.slice(0, 20);
}

function safeFileName(value) {
  return String(value ?? 'screenshot')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'screenshot';
}

function escapeTemplate(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function toPosix(value) {
  return String(value).split(path.sep).join('/');
}

function truncate(value, maxLength = 6000) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
