import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { scanApiBoundary } from '../src/api-boundary-scanner.js';
import { scanComponentStyle } from '../src/component-style-scanner.js';
import { scanFlowDesign } from '../src/flow-design-scanner.js';
import { scanGestureInteraction } from '../src/gesture-interaction-scanner.js';
import { runCli } from '../src/cli.js';
import { scanLocalDev } from '../src/local-dev-scanner.js';
import { scanNetworkContracts } from '../src/network-contract-scanner.js';
import { scanPublicDiscovery } from '../src/public-discovery-scanner.js';
import { writeInferredSpec } from '../src/spec-store.js';
import { scanTerminalLinkContracts } from '../src/terminal-link-scanner.js';
import { buildStoryTaskState } from '../src/story-task-generator.js';

const execFileAsync = promisify(execFile);

async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-test-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  return root;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function makeGitRepoWithStory(options = {}) {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--title',
    'PR準備',
    '--view',
    'dev',
    '--period',
    '2026-W18',
    ...(options.language ? ['--language', options.language] : [])
  ]);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init test repo']);
  await git(repo, ['switch', '-c', 'feature/test-story']);
  return repo;
}

async function recordRequiredAgentReviews(repo, storyId = 'story-pr-prepare') {
  const stageRoles = {
    planning_spec: ['product_requirement', 'architecture_boundary', 'spec_consistency'],
    test_plan: ['unit_integration', 'e2e_ux', 'gate_coverage'],
    implementation: ['code_spec_alignment', 'runtime_contract', 'ux_completion']
  };
  for (const [stage, roles] of Object.entries(stageRoles)) {
    await runCli(['review', 'prepare', repo, '--id', storyId, '--stage', stage]);
    for (const role of roles) {
      const result = await runCli([
        'review',
        'record',
        repo,
        '--id',
        storyId,
        '--stage',
        stage,
        '--role',
        role,
        '--status',
        'pass',
        '--summary',
        `${stage}:${role} passed`,
        '--agent-system',
        'codex',
        '--execution-mode',
        'parallel_subagent',
        '--agent-id',
        `codex-${stage}-${role}`,
        '--agent-thread-id',
        `thread-${stage}-${role}`,
        '--agent-model',
        'gpt-5.5'
      ]);
      assert.equal(result.exitCode, 0);
    }
  }
}

test('init creates a repo-local VibePro workspace and updates gitignore only', async () => {
  const repo = await makeRepo();

  const result = await runCli(['init', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'init');
  assert.equal((await readJson(path.join(repo, '.vibepro', 'config.json'))).schema_version, '0.1.0');
  assert.equal((await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'))).latest_run, null);
  await assert.rejects(stat(path.join(repo, '.vibeproignore')), { code: 'ENOENT' });
  const gitignore = await readFile(path.join(repo, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.vibepro\/$/m);
  assert.doesNotMatch(gitignore, /\.vibepro\/raw\//);
});

test('init fails explicitly instead of masking corrupt VibePro config', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'config.json'), '{ "schema_version": "0.1.0",');
  let stderrOutput = '';

  const result = await runCli(['init', repo], {
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderrOutput, /VibePro config is invalid JSON/);
});

test('status reports corrupt VibePro config as needs_repair', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await writeFile(path.join(repo, '.vibepro', 'config.json'), '{ "schema_version": "0.1.0",');

  const result = await runCli(['status', repo, '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.status.workspace_status, 'needs_repair');
  assert.equal(result.status.gate_status, 'blocked');
  assert.equal(result.status.issues[0].file, '.vibepro/config.json');
  assert.match(result.status.issues[0].detail, /invalid/);
});

test('init ignores all VibePro workspace artifacts from git status', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);

  const result = await runCli(['init', repo]);
  await mkdir(path.join(repo, '.vibepro', 'pr', 'story-ignore-check'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'pr', 'story-ignore-check', 'pr-prepare.html'), '<!doctype html>');

  assert.equal(result.exitCode, 0);
  const ignored = await git(repo, [
    'check-ignore',
    '.vibepro/config.json',
    '.vibepro/pr/story-ignore-check/pr-prepare.html'
  ]);
  assert.match(ignored.stdout, /^\.vibepro\/config\.json$/m);
  assert.match(ignored.stdout, /^\.vibepro\/pr\/story-ignore-check\/pr-prepare\.html$/m);
});

test('help command prints discoverable usage', async () => {
  let output = '';

  const result = await runCli(['help'], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'help');
  assert.match(output, /vibepro help \[command\]/);
  assert.match(output, /まず人間が使う基本コマンド/);
  assert.match(output, /\.vibepro\/ の意味/);
  assert.match(output, /vibepro measure \[repo\].*--base-url <url>/);
  assert.match(output, /vibepro harness status \[repo\]/);
  assert.match(output, /vibepro harness map \[repo\]/);
  assert.match(output, /vibepro harness learn \[repo\]/);
  assert.match(output, /vibepro check <ui\|security\|performance\|architecture\|pr-readiness\|launch-readiness\|agent-harness\|public-discovery\|all>/);
  assert.match(output, /vibepro measure compare \[repo\].*--before <performance\.json>/);
  assert.match(output, /vibepro performance define \[repo\].*--metric-id <id>/);
  assert.match(output, /vibepro performance record \[repo\].*--label <before\|after>/);
  assert.match(output, /vibepro performance compare \[repo\].*--id <story-id>/);
  assert.match(output, /vibepro verify record \[repo\].*--kind <unit\|integration\|e2e\|typecheck\|build>/);
  assert.match(output, /vibepro review prepare \[repo\].*--stage <stage>/);
  assert.match(output, /vibepro review record \[repo\].*--role <role>/);
  assert.match(output, /vibepro story derive \[repo\].*--run-graphify/);
  assert.match(output, /vibepro story derive \[repo\].*--preset <id>/);
  assert.match(output, /vibepro config language \[repo\].*--language ja\|en/);
  assert.match(output, /vibepro skills install \[repo\].*--dry-run/);
  assert.match(output, /vibepro codex install \[repo\].*--dry-run/);

  let englishOutput = '';
  const englishResult = await runCli(['help', '--language', 'en'], {
    stdout: { write: (text) => { englishOutput += text; } }
  });
  assert.equal(englishResult.exitCode, 0);
  assert.match(englishOutput, /VibePro is a Story \/ Architecture \/ Spec/);
  assert.match(englishOutput, /vibepro pr prepare <repo> --base <base-branch>/);
});

test('check list prints available diagnosis packs', async () => {
  let output = '';

  const result = await runCli(['check', 'list'], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.match(output, /ui: UI experience check/);
  assert.match(output, /security: Security boundary check/);
  assert.match(output, /performance: Performance readiness check/);
  assert.match(output, /agent-harness: AI agent harness readiness check/);
  assert.match(output, /public-discovery: Public discovery \/ AI search readiness check/);
  assert.equal(result.packs.some((pack) => pack.id === 'launch-readiness'), true);
});

test('check all leaves optional agent harness and public discovery checks out unless explicitly included', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'harness-optional-fixture' }, null, 2));
  await runCli(['init', repo, '--story-id', 'story-harness-optional', '--title', 'Harness optional']);

  const defaultResult = await runCli(['check', 'all', repo, '--run-id', 'all-no-harness', '--json']);

  assert.equal(defaultResult.exitCode, 0);
  assert.equal(defaultResult.result.check.pack_id, 'all');
  assert.equal(defaultResult.result.check.evidence.agent_harness, undefined);
  assert.equal(defaultResult.result.check.evidence.public_discovery, undefined);
  assert.equal(defaultResult.result.check.checks.some((check) => check.id === 'agent_harness'), false);
  assert.equal(defaultResult.result.check.checks.some((check) => check.id.startsWith('public_discovery.')), false);
  const defaultMarkdown = await readFile(path.join(repo, '.vibepro', 'checks', 'all', 'all-no-harness', 'check.md'), 'utf8');
  assert.match(defaultMarkdown, /vibepro check agent-harness <repo>/);
  assert.match(defaultMarkdown, /vibepro check public-discovery <repo>/);

  const includedResult = await runCli(['check', 'all', repo, '--include-harness', '--run-id', 'all-with-harness', '--json']);

  assert.equal(includedResult.exitCode, 0);
  assert.equal(includedResult.result.check.evidence.agent_harness.summary.codex_status, 'missing');
  assert.equal(includedResult.result.check.checks.some((check) => check.id === 'agent_harness' && check.status === 'needs_review'), true);

  const publicDiscoveryResult = await runCli(['check', 'all', repo, '--include-public-discovery', '--run-id', 'all-with-public-discovery', '--json']);

  assert.equal(publicDiscoveryResult.exitCode, 0);
  assert.equal(publicDiscoveryResult.result.check.evidence.public_discovery.summary.scanned_files, 1);
  assert.equal(publicDiscoveryResult.result.check.checks.some((check) => check.id === 'public_discovery.metadata_findings'), true);
});

test('check public-discovery reports LLMO and public page readiness findings', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-public-discovery-'));
  await writeFile(path.join(repo, 'index.html'), '<!doctype html><main><img src="/hero.png"><p>Short</p></main>');
  await mkdir(path.join(repo, 'public'), { recursive: true });
  await writeFile(path.join(repo, 'public', 'robots.txt'), 'User-agent: *\nAllow: /\n');

  const scan = await scanPublicDiscovery(repo);

  assert.equal(scan.status, 'needs_review');
  assert.equal(scan.summary.scanned_files, 1);
  assert.equal(scan.metadata_findings.some((finding) => finding.kind === 'missing_title'), true);
  assert.equal(scan.structured_data_findings.some((finding) => finding.kind === 'missing_structured_data_hint'), true);
  assert.equal(scan.image_findings.some((finding) => finding.kind === 'image_missing_alt'), true);
  assert.equal(scan.ai_bot_findings.some((finding) => finding.kind === 'ai_bot_policy_missing'), true);

  const result = await runCli(['check', 'public-discovery', repo, '--run-id', 'public-discovery-test', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'needs_review');
  assert.equal(result.result.check.evidence.public_discovery.summary.finding_count > 0, true);
  assert.equal(result.result.check.checks.some((check) => check.label === 'Public discovery: AI bot access'), true);
});

test('check agent-harness diagnoses codex claude skills hooks and ignore noise', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await mkdir(path.join(repo, '.claude'), { recursive: true });
  await writeFile(path.join(repo, '.claude', 'settings.json'), JSON.stringify({
    hooks: {
      UserPromptSubmit: [
        { command: 'npx tsx scripts/missing-hook.ts' }
      ]
    }
  }, null, 2));
  await writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
  await runCli(['init', repo, '--story-id', 'story-agent-harness', '--title', 'Agent harness']);

  const result = await runCli(['check', 'agent-harness', repo, '--run-id', 'agent-harness-test', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'needs_review');
  assert.equal(result.result.check.evidence.agent_harness.codex.status, 'missing');
  assert.equal(result.result.check.evidence.agent_harness.claude.has_claude_file, false);
  assert.equal(result.result.check.evidence.agent_harness.findings.some((finding) => finding.kind === 'hook_command_target_missing'), true);
  assert.equal(result.result.check.evidence.agent_harness.findings.some((finding) => finding.kind === 'ai_exploration_noise_ignores_incomplete'), true);
  assert.equal(result.result.check.checks.some((check) => check.id === 'agent_harness' && check.status === 'needs_review'), true);
});

test('harness status summarizes installed missing outdated and invalid areas', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, '.claude'), { recursive: true });
  await writeFile(path.join(repo, '.claude', 'settings.json'), '{');
  await writeFile(path.join(repo, '.gitignore'), '.vibepro/\nnode_modules/\n');

  let output = '';
  const textResult = await runCli(['harness', 'status', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(textResult.exitCode, 0);
  assert.equal(textResult.result.status, 'needs_review');
  assert.match(output, /VibePro Agent Harness Status/);
  assert.match(output, /Codex instructions/);
  assert.match(output, /invalid_hook_settings_json/);

  const jsonResult = await runCli(['harness', 'status', repo, '--json']);

  assert.equal(jsonResult.exitCode, 0);
  assert.equal(jsonResult.result.hooks.findings.some((finding) => finding.kind === 'invalid_hook_settings_json'), true);
  assert.equal(jsonResult.result.ignore_noise.status, 'pass');
});

test('harness map writes codebase entrypoints and test command map', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'README.md'), '# Harness fixture\n');
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    name: 'harness-map-fixture',
    scripts: {
      typecheck: 'tsc --noEmit',
      test: 'node --test',
      'test:e2e': 'playwright test',
      build: 'next build'
    }
  }, null, 2));
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await mkdir(path.join(repo, 'tests', 'e2e'), { recursive: true });

  const result = await runCli(['harness', 'map', repo, '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.status, 'created');
  assert.equal(result.result.artifacts.codebase_map, '.vibepro/harness/codebase-map.md');
  assert.equal(result.result.test_command_map.by_category.typecheck.includes('typecheck'), true);
  assert.equal(result.result.test_command_map.by_category.e2e.includes('test:e2e'), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'harness', 'codebase-map.md')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'harness', 'agent-entrypoints.md')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'harness', 'test-command-map.json')), true);
  const entrypoints = await readFile(path.join(repo, '.vibepro', 'harness', 'agent-entrypoints.md'), 'utf8');
  assert.match(entrypoints, /Avoid By Default/);
});

test('harness learn records session learning candidates for human skill review', async () => {
  const repo = await makeRepo();

  const record = await runCli([
    'harness',
    'learn',
    repo,
    '--summary',
    'Repeatedly used stale checkout before running VibePro',
    '--source',
    'codex-log',
    '--evidence',
    'sessions/example.jsonl',
    '--pattern',
    'runtime path was not checked',
    '--skill-candidate',
    'Always verify the active VibePro executable and checkout before diagnosing results.',
    '--target',
    'AGENTS.md',
    '--target',
    'CLAUDE.md',
    '--json'
  ]);

  assert.equal(record.exitCode, 0);
  assert.equal(record.result.learning.status, 'candidate');
  assert.equal(record.result.learning.target_surfaces.includes('AGENTS.md'), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'harness', 'session-learnings.json')), true);

  const review = await runCli(['harness', 'review-learnings', repo, '--json']);

  assert.equal(review.exitCode, 0);
  assert.equal(review.result.store.candidate, 1);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'harness', 'session-learnings-review.md')), true);
  const markdown = await readFile(path.join(repo, '.vibepro', 'harness', 'session-learnings-review.md'), 'utf8');
  assert.match(markdown, /Session Learnings Review/);
  assert.match(markdown, /does not modify those files automatically/);
  assert.match(markdown, /Always verify the active VibePro executable/);
});

test('check security runs a purpose-level diagnosis pack and writes evidence', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    name: 'security-pack-fixture',
    dependencies: {
      next: '^15.0.0'
    }
  }, null, 2));
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'users'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'users', 'route.ts'), 'export async function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'page.tsx'), 'export default function Page() { return <div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />; }\n');
  await runCli(['init', repo, '--story-id', 'story-security-pack', '--title', 'Security pack']);

  const result = await runCli(['check', 'security', repo, '--run-id', 'security-pack-test']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.pack_id, 'security');
  assert.equal(result.result.check.status, 'needs_review');
  assert.equal(result.result.check.artifacts.check_report, '.vibepro/checks/security/security-pack-test/check.md');
  assert.equal(result.result.check.artifacts.check_json, '.vibepro/checks/security/security-pack-test/check.json');
  assert.equal(result.result.check.checks.some((check) => check.id === 'api_boundary' && check.status === 'needs_review'), true);
  assert.equal(result.result.check.checks.some((check) => check.id === 'static_site.xss_risk_hits'), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'checks', 'security', 'security-pack-test', 'check.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'checks', 'security', 'security-pack-test', 'check.md')), true);
  const checkMarkdown = await readFile(path.join(repo, '.vibepro', 'checks', 'security', 'security-pack-test', 'check.md'), 'utf8');
  assert.match(checkMarkdown, /## Next Steps \/ 次に見る場所/);
  assert.match(checkMarkdown, /## Share Template \/ 共有テンプレート/);
  assert.match(checkMarkdown, /Report: \.vibepro\/checks\/security\/security-pack-test\/check\.md/);
  assert.match(checkMarkdown, /Needs review \/ fail:/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_check_run_by_pack.security, 'security-pack-test');
});

test('init can bootstrap and select a local story', async () => {
  const repo = await makeRepo();

  const result = await runCli([
    'init',
    repo,
    '--story-id',
    'story-hardening',
    '--title',
    '公開前診断',
    '--view',
    'dev',
    '--period',
    '2026-W18'
  ]);

  assert.equal(result.exitCode, 0);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.current_story_id, 'story-hardening');
  const story = config.brainbase.stories.find((item) => item.story_id === 'story-hardening');
  assert.equal(story.title, '公開前診断');
  assert.equal(story.ssot, 'local');
  assert.equal(story.status, 'active');
  assert.equal(story.view, 'dev');
  assert.equal(story.period, '2026-W18');
});

test('init and config language manage human output language', async () => {
  const repo = await makeRepo();

  let initOutput = '';
  const initResult = await runCli([
    'init',
    repo,
    '--story-id',
    'story-hardening',
    '--title',
    '公開前診断',
    '--language',
    'en'
  ], {
    stdout: { write: (text) => { initOutput += text; } }
  });

  assert.equal(initResult.exitCode, 0);
  assert.match(initOutput, /VibePro workspace initialized/);
  assert.match(initOutput, /Human output language: en/);
  assert.match(initOutput, /coding agent/);
  let config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.output.language, 'en');

  const languageResult = await runCli(['config', 'language', repo, '--language', 'ja']);
  assert.equal(languageResult.exitCode, 0);
  config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.output.language, 'ja');
  const jaInitRepo = await makeRepo();
  let jaInitOutput = '';
  const jaInitResult = await runCli(['init', jaInitRepo, '--language', 'ja'], {
    stdout: { write: (text) => { jaInitOutput += text; } }
  });
  assert.equal(jaInitResult.exitCode, 0);
  assert.match(jaInitOutput, /VibePro workspaceを初期化しました/);
  assert.match(jaInitOutput, /次にやること/);

  const invalidResult = await runCli(['config', 'language', repo, '--language', 'fr']);
  assert.equal(invalidResult.exitCode, 1);
});

test('skills commands list install and verify bundled VibePro skills', async () => {
  const repo = await makeRepo();

  const listResult = await runCli(['skills', 'list']);
  assert.equal(listResult.exitCode, 0);
  assert.equal(listResult.result.skills.length, 4);
  assert.equal(listResult.result.skills.some((skill) => skill.name === 'vibepro-workflow'), true);
  assert.equal(listResult.result.skills.some((skill) => skill.name === 'vibepro-diagnosis-packages'), true);

  const dryRun = await runCli(['skills', 'install', repo, '--dry-run', '--json']);
  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.dry_run, true);
  assert.equal(dryRun.result.skills.every((skill) => skill.status === 'would_install'), true);
  assert.equal(await pathExists(path.join(repo, '.claude', 'skills', 'vibepro-workflow', 'SKILL.md')), false);

  const install = await runCli(['skills', 'install', repo]);
  assert.equal(install.exitCode, 0);
  assert.equal(install.result.skills.every((skill) => skill.status === 'installed'), true);
  const workflowSkillPath = path.join(repo, '.claude', 'skills', 'vibepro-workflow', 'SKILL.md');
  const reviewSkillPath = path.join(repo, '.claude', 'skills', 'vibepro-human-review', 'SKILL.md');
  const diagnosisSkillPath = path.join(repo, '.claude', 'skills', 'vibepro-diagnosis-packages', 'SKILL.md');
  assert.match(await readFile(workflowSkillPath, 'utf8'), /name: vibepro-workflow/);
  assert.match(await readFile(workflowSkillPath, 'utf8'), /vibepro check performance/);
  assert.match(await readFile(reviewSkillPath, 'utf8'), /review-cockpit\.html/);
  assert.match(await readFile(diagnosisSkillPath, 'utf8'), /vibepro performance compare/);

  const verify = await runCli(['skills', 'verify', repo]);
  assert.equal(verify.exitCode, 0);
  assert.equal(verify.result.overall_status, 'ok');
  assert.equal(verify.result.skills.every((skill) => skill.status === 'ok'), true);

  await writeFile(workflowSkillPath, 'local edit\n');
  const skipped = await runCli(['skills', 'install', repo]);
  assert.equal(skipped.result.skills.find((skill) => skill.name === 'vibepro-workflow').status, 'skipped');
  const outdated = await runCli(['skills', 'verify', repo]);
  assert.equal(outdated.result.overall_status, 'needs_install');
  assert.equal(outdated.result.skills.find((skill) => skill.name === 'vibepro-workflow').status, 'outdated');

  const forced = await runCli(['skills', 'install', repo, '--force']);
  assert.equal(forced.result.skills.find((skill) => skill.name === 'vibepro-workflow').status, 'overwritten');
  assert.match(await readFile(workflowSkillPath, 'utf8'), /name: vibepro-workflow/);
});

test('codex commands install and verify VibePro AGENTS instructions', async () => {
  const repo = await makeRepo();
  const agentsPath = path.join(repo, 'AGENTS.md');

  const missing = await runCli(['codex', 'verify', repo]);
  assert.equal(missing.exitCode, 0);
  assert.equal(missing.result.overall_status, 'needs_install');
  assert.equal(missing.result.status, 'missing');

  const dryRun = await runCli(['codex', 'install', repo, '--dry-run', '--json']);
  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.status, 'would_install');
  assert.equal(await pathExists(agentsPath), false);

  const install = await runCli(['codex', 'install', repo]);
  assert.equal(install.exitCode, 0);
  assert.equal(install.result.status, 'installed');
  const installedContent = await readFile(agentsPath, 'utf8');
  assert.match(installedContent, /VIBEPRO_CODEX_START/);
  assert.match(installedContent, /review-cockpit\.html/);
  assert.match(installedContent, /vibepro pr create/);
  assert.match(installedContent, /vibepro check performance/);
  assert.match(installedContent, /vibepro performance compare/);
  assert.match(installedContent, /server logs alone/);

  const ok = await runCli(['codex', 'verify', repo]);
  assert.equal(ok.result.overall_status, 'ok');
  assert.equal(ok.result.status, 'ok');

  const repoWithExistingAgents = await makeRepo();
  const existingAgentsPath = path.join(repoWithExistingAgents, 'AGENTS.md');
  await writeFile(existingAgentsPath, '# Existing repository rules\n');
  const append = await runCli(['codex', 'install', repoWithExistingAgents]);
  assert.equal(append.result.status, 'appended');
  const appendedContent = await readFile(existingAgentsPath, 'utf8');
  assert.match(appendedContent, /# Existing repository rules/);
  assert.match(appendedContent, /VIBEPRO_CODEX_START/);

  await writeFile(agentsPath, '# Existing\n\n<!-- VIBEPRO_CODEX_START -->\nSTALE_VIBEPRO_BLOCK\n<!-- VIBEPRO_CODEX_END -->\n');
  const outdated = await runCli(['codex', 'verify', repo]);
  assert.equal(outdated.result.overall_status, 'needs_install');
  assert.equal(outdated.result.status, 'outdated');

  const skipped = await runCli(['codex', 'install', repo]);
  assert.equal(skipped.result.status, 'skipped');
  assert.match(await readFile(agentsPath, 'utf8'), /STALE_VIBEPRO_BLOCK/);

  const forced = await runCli(['codex', 'install', repo, '--force']);
  assert.equal(forced.result.status, 'overwritten');
  const forcedContent = await readFile(agentsPath, 'utf8');
  assert.match(forcedContent, /# Existing/);
  assert.doesNotMatch(forcedContent, /STALE_VIBEPRO_BLOCK/);
  assert.match(forcedContent, /Story \/ Architecture \/ Spec/);
});

test('init fails when bootstrapped story already exists', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-hardening', '--title', '公開前診断']);

  const result = await runCli(['init', repo, '--story-id', 'story-hardening', '--title', '公開前診断']);

  assert.equal(result.exitCode, 1);
});

test('doctor reports uninitialized repositories without creating a workspace', async () => {
  const repo = await makeRepo();

  const result = await runCli(['doctor', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.overall_status, 'uninitialized');
  assert.equal(result.result.checks.some((check) => check.id === 'VP-DOCTOR-CLI-RUNTIME'), true);
  assert.equal(result.result.toolchain.package.name, 'vibepro');
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
});

test('verify record requires an initialized workspace', async () => {
  const repo = await makeRepo();
  let stderrOutput = '';

  const result = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-x',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'npm test'
  ], {
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderrOutput, /requires an initialized VibePro workspace/);
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
});

test('doctor detects and fixes missing diagnosis evidence references', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, '.vibepro', 'diagnostics', 'ok-run'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'diagnostics', 'ok-run', 'evidence.json'), JSON.stringify({ run_id: 'ok-run' }));
  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_run = 'missing-run';
  manifest.latest_run_by_story = {
    'story-alpha': 'missing-run',
    'story-beta': 'ok-run'
  };
  manifest.runs = [
    {
      run_id: 'missing-run',
      story_id: 'story-alpha',
      artifacts: { evidence: '.vibepro/diagnostics/missing-run/evidence.json' }
    },
    {
      run_id: 'ok-run',
      story_id: 'story-beta',
      artifacts: { evidence: '.vibepro/diagnostics/ok-run/evidence.json' }
    }
  ];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const dryRun = await runCli(['doctor', repo]);

  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.overall_status, 'needs_maintenance');
  assert.equal(dryRun.result.checks[0].id, 'VP-DOCTOR-MISSING-EVIDENCE');
  assert.equal(dryRun.result.next_commands.includes(`vibepro doctor ${repo} --fix`), true);
  assert.deepEqual(dryRun.result.next_actions[0], {
    command: `vibepro doctor ${repo} --fix`,
    reason: '存在しない evidence を参照する診断runを管理目録から整理する。',
    expected_after: 'VP-DOCTOR-MISSING-EVIDENCE が消える。',
    safe_to_run: true
  });
  assert.equal((await readJson(manifestPath)).runs.length, 2);

  const fixed = await runCli(['doctor', repo, '--fix', '--json']);

  assert.equal(fixed.exitCode, 0);
  assert.equal(fixed.result.overall_status, 'fixed');
  assert.equal(fixed.result.repairs[0].removed_run_ids.includes('missing-run'), true);
  const after = await readJson(manifestPath);
  assert.equal(after.runs.length, 1);
  assert.equal(after.latest_run, 'ok-run');
  assert.equal(after.latest_run_by_story['story-alpha'], undefined);
  assert.equal(after.latest_run_by_story['story-beta'], 'ok-run');
  await stat(path.join(repo, '.vibepro', 'doctor', 'doctor-result.json'));
});

test('doctor fixes stale story, run, catalog, and graphify references', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-live', '--title', 'Live Story']);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const config = await readJson(configPath);
  config.brainbase.current_story_id = 'story-missing';
  config.brainbase.stories.push({
    story_id: 'story-stale-derived',
    title: 'Stale derived story',
    ssot: 'local',
    status: 'active',
    derived_by: 'vibepro-story-derive'
  });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const manifest = await readJson(manifestPath);
  manifest.latest_run = 'missing-run';
  manifest.latest_run_by_story = { 'story-live': 'missing-run' };
  manifest.runs = [];
  manifest.artifacts = {
    graphify_json: '.vibepro/graphify/missing-graph.json',
    graphify_report: '.vibepro/graphify/missing-report.md'
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(path.join(repo, '.vibepro', 'stories'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'), JSON.stringify({
    story_count: 1,
    stories: [{
      story_id: 'story-derived-new',
      title: 'Derived New Story',
      ssot: 'local',
      status: 'active',
      horizon: 'quarter',
      view: 'business',
      period: null,
      category: 'product'
    }]
  }, null, 2));

  const dryRun = await runCli(['doctor', repo, '--json']);

  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.overall_status, 'needs_maintenance');
  const checkIds = dryRun.result.checks.map((check) => check.id);
  assert.equal(checkIds.includes('VP-DOCTOR-CURRENT-STORY-MISSING'), true);
  assert.equal(checkIds.includes('VP-DOCTOR-STALE-LATEST-RUN-REFS'), true);
  assert.equal(checkIds.includes('VP-DOCTOR-MISSING-GRAPHIFY-ARTIFACTS'), true);
  assert.equal(checkIds.includes('VP-DOCTOR-STORY-CATALOG-DRIFT'), true);
  assert.equal(dryRun.result.next_commands.includes(`vibepro story derive ${repo} --run-graphify`), true);
  assert.equal(dryRun.result.next_actions.some((action) => action.command === `vibepro story derive ${repo} --run-graphify` && action.expected_after.includes('story-catalog.json')), true);

  const fixed = await runCli(['doctor', repo, '--fix']);

  assert.equal(fixed.exitCode, 0);
  assert.equal(fixed.result.overall_status, 'fixed');
  const fixedConfig = await readJson(configPath);
  const fixedManifest = await readJson(manifestPath);
  assert.equal(fixedConfig.brainbase.current_story_id, null);
  assert.equal(fixedConfig.brainbase.stories.some((story) => story.story_id === 'story-derived-new'), true);
  assert.equal(fixedConfig.brainbase.stories.find((story) => story.story_id === 'story-stale-derived').status, 'archived');
  assert.equal(fixedManifest.latest_run, null);
  assert.deepEqual(fixedManifest.latest_run_by_story, {});
  assert.equal(fixedManifest.artifacts.graphify_json, undefined);
  assert.equal(fixedManifest.artifacts.graphify_report, undefined);
});

test('doctor reports missing task workflow references without modifying them', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-live', '--title', 'Live Story']);
  const tasksDir = path.join(repo, '.vibepro', 'stories', 'story-live', 'tasks');
  await mkdir(path.join(tasksDir, 'TASK-001'), { recursive: true });
  await writeFile(path.join(tasksDir, 'tasks.json'), JSON.stringify({
    schema_version: '0.1.0',
    story: { story_id: 'story-live', title: 'Live Story' },
    source_run: { run_id: 'story-plan' },
    tasks: [{ id: 'TASK-001', title: 'Task 001', target_groups: [] }]
  }, null, 2));
  await writeFile(path.join(tasksDir, 'TASK-001', 'handoff.json'), JSON.stringify({
    references: {
      briefing_json: '.vibepro/stories/story-live/tasks/TASK-001/briefing.json',
      plan_json: '.vibepro/stories/story-live/tasks/TASK-001/plan.json'
    }
  }, null, 2));

  const result = await runCli(['doctor', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.overall_status, 'needs_maintenance');
  const taskCheck = result.result.checks.find((check) => check.id === 'VP-DOCTOR-MISSING-TASK-WORKFLOW-REFS');
  assert.equal(taskCheck.status, 'manual');
  assert.equal(taskCheck.items.length, 2);
  assert.equal(taskCheck.items[0].repair_command, `vibepro task handoff ${repo} --task TASK-001 --id story-live`);
  assert.equal(result.result.next_commands.includes(`vibepro task handoff ${repo} --task TASK-001 --id story-live`), true);
  assert.equal(result.result.next_actions[0].reason.includes('task workflow成果物'), true);
  assert.equal(result.result.next_actions[0].expected_after, 'VP-DOCTOR-MISSING-TASK-WORKFLOW-REFS が消える。');
});

test('graph imports existing graphify artifacts into the workspace', async () => {
  const repo = await makeRepo();
  const graphSource = path.join(repo, 'graphify-out');
  await runCli(['init', repo]);
  await mkdir(graphSource, { recursive: true });
  await writeFile(path.join(graphSource, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app', label: 'App' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'INFERRED' }]
  }));
  await writeFile(path.join(graphSource, 'GRAPH_REPORT.md'), '# Graph Report\n\n## Important Nodes\n\n- App');

  const result = await runCli(['graph', repo, '--from', graphSource]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'graph');
  assert.equal((await readJson(path.join(repo, '.vibepro', 'graphify', 'graph.json'))).nodes.length, 1);
  assert.match(await readFile(path.join(repo, '.vibepro', 'graphify', 'GRAPH_REPORT.md'), 'utf8'), /Important Nodes/);
  assert.equal((await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'))).artifacts.graphify_json, '.vibepro/graphify/graph.json');
});

test('graph uses graphify-out by default', async () => {
  const repo = await makeRepo();
  const graphSource = path.join(repo, 'graphify-out');
  await mkdir(graphSource, { recursive: true });
  await writeFile(path.join(graphSource, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }));
  await writeFile(path.join(graphSource, 'GRAPH_REPORT.md'), '# Graph Report');

  const result = await runCli(['graph', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal((await readJson(path.join(repo, '.vibepro', 'graphify', 'graph.json'))).nodes.length, 0);
});

test('graph can run graphify before importing artifacts', async () => {
  const repo = await makeRepo();
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bin-'));
  const graphifyBin = path.join(binDir, 'graphify');
await writeFile(graphifyBin, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.argv[2] !== 'update' || process.argv[3] !== '.') {
  console.error('unexpected graphify args: ' + process.argv.slice(2).join(' '));
  process.exit(1);
}
const outDir = 'graphify-out';
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify({
  nodes: [{ id: 'from-graphify' }],
  edges: []
}));
writeFileSync(path.join(outDir, 'GRAPH_REPORT.md'), '# Generated Graph Report\\n');
`);
  await chmod(graphifyBin, 0o755);

  const result = await runCli(['graph', repo, '--run-graphify'], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.graphifyExecuted, true);
  assert.equal((await readJson(path.join(repo, '.vibepro', 'graphify', 'graph.json'))).nodes[0].id, 'from-graphify');
  assert.equal(await pathExists(path.join(repo, 'graphify-out')), false);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.graphify.last_execution.command, 'graphify update .');
});

test('graph reports install guidance when graphify is missing', async () => {
  const repo = await makeRepo();
  let stderrOutput = '';

  const result = await runCli(['graph', repo, '--run-graphify'], {
    env: { ...process.env, PATH: '' },
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.command, 'graph');
  assert.match(stderrOutput, /optional but recommended/);
  assert.match(stderrOutput, /uv tool install graphifyy/);
});

test('component style scanner inventories UI components and flags legacy tokens', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'public'), { recursive: true });
  await writeFile(path.join(repo, 'public', 'style.css'), `
:root { --bb-surface-main: #101113; }
.primary-button {
  background: #1e293b;
  border-radius: 16px;
}
.task-action-btn {
  width: 24px;
  height: 24px;
  transition: all 0.15s ease;
}
.task-action-btn svg {
  width: 12px;
  height: 12px;
}
.task-action-btn:hover { transform: translateY(-1px); }
.task-card { box-shadow: 0 24px 80px rgba(0, 0, 0, 0.3); }
`);
  await writeFile(path.join(repo, 'public', 'index.html'), '<button class="primary-button" data-component="button">Save</button>');

  const result = await scanComponentStyle(repo);

  assert.equal(result.component_kinds.includes('button'), true);
  assert.equal(result.component_kinds.includes('card'), true);
  assert.equal(result.design_system_markers.length > 0, true);
  assert.equal(result.coverage.replacement_observable, true);
  assert.equal(result.legacy_style_hits.some((hit) => hit.token === '#1e293b'), true);
  assert.equal(result.legacy_style_hits.some((hit) => hit.kind === 'large_rounded_card'), true);
  assert.equal(result.risk_summary.legacy_style_hits.review >= 2, true);
  assert.equal(result.interaction_reliability_hits.some((hit) => hit.kind === 'interactive_target_moves_on_state'), true);
  assert.equal(result.interaction_reliability_hits.some((hit) => hit.kind === 'transition_all_on_interactive_target'), true);
  assert.equal(result.interaction_reliability_hits.some((hit) => hit.kind === 'small_interactive_target'), true);
  assert.equal(result.interaction_reliability_hits.some((hit) => hit.kind === 'icon_child_captures_click_target'), true);
  assert.equal(result.risk_summary.interaction_reliability_hits.review, 4);
});

test('flow design scanner flags unsafe UI journey contracts', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'new'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'patients', '[id]'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'cases', '[id]', 'notes'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'cases', '[id]', 'notes'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: { next: '16.2.1', react: '19.0.0' }
  }, null, 2));
  await writeFile(path.join(repo, 'docs', 'specs', 'u-020.md'), `---
story_id: U-020
---
# SPEC-U-020

- DPC未入力登録後、患者詳細でDPC確認質問が表示される。
- DPCを回答すると退院目標日が更新される。
- 新規登録画面に退院先選択カードが表示されない。
- 退院予定日という語は未確定値に使わない。
`);
  await writeFile(path.join(repo, 'src', 'app', 'new', 'page.tsx'), `
"use client";
export default function NewPage() {
  const handleVoiceInput = () => {
    console.log('voice input placeholder');
  };
  const searchByName = async () => {
    if (!searchQuery.trim()) return;
    await fetch('/api/dpc-lookup?q=' + searchQuery);
  };
  const lookup = async (code) => {
    if (!code || !admissionDate) return;
    const data = await res.json();
    setLookupResult(data);
    await saveCase(code, data);
    router.push('/patients/' + data.id);
  };
  const selectDpc = (result) => {
    setDpcCode(result.dpc_code);
    router.push('/patients/' + result.id);
  };
  return <>
    {lookupResult && <div>退院目標日 preview</div>}
    <button onClick={selectDpc}>DPC候補を選択</button>
    <button onClick={handleVoiceInput}>音声入力</button>
    <button>詳細を見る</button>
    <button disabled>AI要約 準備中</button>
  </>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'patients', '[id]', 'page.tsx'), `
"use client";
export default function PatientPage() {
  const saveQuestionAnswer = async (question, value) => {
    if (question.key === 'dpc_target_date') {
      await fetch('/api/cases/1/notes', { method: 'POST' });
      setDpcTargetDateStatus(value);
    }
  };
  return <div>退院予定日</div>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'cases', '[id]', 'notes', 'route.ts'), `
export async function POST() {
  return Response.json({ ok: true });
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-020', title: '新規登録でタスクを量産せず不足情報を質問化する', view: 'user' },
    config: {
      flow_design: {
        profile: 'senpainurse',
        value_contract: {
          forbidden_labels: ['退院予定日'],
          required_labels: ['退院目標日']
        }
      }
    }
  });

  assert.equal(result.summary.scanned_ui_files, 2);
  assert.equal(result.silent_noop_hits.some((hit) => hit.file === 'src/app/new/page.tsx'), true);
  assert.equal(result.selection_side_effect_hits.some((hit) => hit.kind === 'selection_triggers_navigation'), true);
  assert.equal(result.question_dead_end_hits.some((hit) => hit.question_key === 'dpc_target_date'), true);
  assert.equal(result.dead_ui_state_hits.some((hit) => hit.state === 'lookupResult'), true);
  assert.equal(result.interactive_contract_hits.some((hit) => hit.kind === 'interactive_handler_without_user_visible_effect' && hit.handler === 'handleVoiceInput'), true);
  assert.equal(result.interactive_contract_hits.some((hit) => hit.kind === 'interactive_element_without_contract' && hit.label === '詳細を見る'), true);
  assert.equal(result.interactive_contract_hits.some((hit) => /AI要約/.test(hit.label ?? '')), false);
  assert.equal(result.value_alignment_hits.some((hit) => hit.kind === 'forbidden_label' && hit.label === '退院予定日'), true);
  assert.equal(result.status, 'needs_review');
});

test('check ui gates interactive element contract violations', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), `
"use client";
export default function Page() {
  const [open, setOpen] = useState(false);
  const summarize = () => {
    console.log('placeholder');
  };
  return <main>
    <button onClick={summarize}>AI要約</button>
    <button>詳細を見る</button>
    <button onClick={() => setOpen(!open)}>開く</button>
    <Link href="/patients"><Button>患者一覧</Button></Link>
    <LikeButton itemId="p1" />
    <DialogTrigger asChild><Button>検索条件を開く</Button></DialogTrigger>
    <DialogClose asChild><Button>閉じる</Button></DialogClose>
    <AlertDialogAction>削除</AlertDialogAction>
    <AccordionTrigger>詳細条件</AccordionTrigger>
    <details><summary className="cursor-pointer">詳細設定を開く</summary><p>設定</p></details>
    <span className="text-success">保存しました</span>
    <label htmlFor="file" className="btn">ファイルを選択</label><input id="file" type="file" />
  </main>;
}
`);

  const result = await runCli(['check', 'ui', repo, '--story-id', 'U-031', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'needs_review');
  assert.equal(result.result.check.evidence.flow_design.interactive_contract_hits.length, 2);
  assert.equal(result.result.check.checks.some((check) => check.id === 'flow_design' && check.status === 'needs_review'), true);
});

test('gesture interaction scanner flags touch, overlay, drag, carousel, and map marker risks', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'page.css'), `
.map-carousel {
  touch-action: pan-x pan-y pinch-zoom;
  overflow-x: auto;
}
.map-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
}
.hotel-card {
  width: 36px;
  height: 40px;
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), `
"use client";
export default function Page({ router }) {
  const [isDragging, setIsDragging] = useState(false);
  return <div className="carousel" onPointerDown={() => setIsDragging(true)}>
    <button onClick={() => router.push('/detail')}>宿を見る</button>
    <AdvancedMarkerElement position={{ lat: 35, lng: 139 }} />
  </div>;
}
`);

  const result = await scanGestureInteraction(repo);

  assert.equal(result.status, 'needs_review');
  assert.equal(result.touch_action_hits.some((hit) => hit.kind === 'ambiguous_touch_action_on_gesture_surface'), true);
  assert.equal(result.overlay_pointer_hits.some((hit) => hit.kind === 'map_overlay_may_capture_touch'), true);
  assert.equal(result.drag_tap_hits.some((hit) => hit.kind === 'drag_state_not_connected_to_click_suppression'), true);
  assert.equal(result.carousel_hits.some((hit) => hit.kind === 'carousel_missing_scroll_snap_contract'), true);
  assert.equal(result.carousel_hits.some((hit) => hit.kind === 'small_gesture_hit_area'), true);
  assert.equal(result.map_marker_hits.some((hit) => hit.kind === 'map_marker_layering_contract_missing'), true);
});

test('check ui includes gesture interaction as a review gate', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'page.css'), `
.map-carousel {
  touch-action: pan-x pan-y pinch-zoom;
  overflow-x: auto;
}
`);

  const result = await runCli(['check', 'ui', repo, '--story-id', 'U-gesture', '--run-id', 'gesture-check', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'needs_review');
  assert.equal(result.result.check.evidence.gesture_interaction.status, 'needs_review');
  assert.equal(result.result.check.checks.some((check) => check.id === 'gesture_interaction.touch_action_hits' && check.status === 'needs_review'), true);
});

test('terminal link scanner flags dot directory HTML preview gaps', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'public', 'modules'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'ttyd'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'controllers', 'session'), { recursive: true });
  await writeFile(path.join(repo, 'public', 'modules', 'xterm-file-links.js'), `
const XTERM_FILE_TOKEN_REGEX = new RegExp(
  '((?:~\\\\/|\\\\.{1,2}\\\\/|\\\\/)?[a-zA-Z0-9_][a-zA-Z0-9_/.\\\\-]*\\\\.(?:html|js))',
  'g'
);
const XTERM_CONTINUATION_SUFFIX_REGEX = new RegExp('^(\\\\s+)([a-zA-Z0-9_/.\\\\-]+\\\\.(?:html))');
`);
  await writeFile(path.join(repo, 'public', 'ttyd', 'custom_ttyd_index.html'), `
<script>
const filePathRegex = new RegExp('((?:~\\\\/|\\\\.{1,2}\\\\/|\\\\/)?[a-zA-Z0-9_][a-zA-Z0-9_/.\\\\-]*\\\\.(?:html))', 'g');
term.registerLinkProvider({ provideLinks() {} });
</script>
`);
  await writeFile(path.join(repo, 'server', 'controllers', 'session', 'shared-methods.js'), `
controller._readTree = async () => entries.filter((entry) => {
  if (entry.name.startsWith('.')) return false;
  return true;
});
`);
  await writeFile(path.join(repo, 'public', 'modules', 'file-preview-config.js'), `
export const BROWSER_PREVIEWABLE_EXTENSIONS = new Set([
  '.md',
  '.html',
  '.svg',
  '.js'
]);
`);

  const result = await scanTerminalLinkContracts(repo);

  assert.equal(result.status, 'needs_review');
  assert.equal(result.dot_directory_link_hits.some((hit) => hit.kind === 'dot_directory_file_link_not_supported'), true);
  assert.equal(result.wrapped_terminal_link_hits.some((hit) => hit.kind === 'wrapped_terminal_continuation_requires_indent'), true);
  assert.equal(result.dot_directory_tree_hits.some((hit) => hit.kind === 'dot_directory_tree_hidden_without_allowlist'), true);
  assert.equal(result.image_preview_extension_hits.some((hit) => hit.kind === 'browser_preview_image_extensions_missing'), true);
  assert.deepEqual(
    result.image_preview_extension_hits[0].missing_extensions,
    ['.png', '.jpg', '.jpeg', '.gif', '.webp']
  );
});

test('terminal link scanner accepts image preview extensions via IMAGE_EXTENSIONS spread', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'public', 'modules'), { recursive: true });
  await writeFile(path.join(repo, 'public', 'modules', 'file-preview-config.js'), `
export const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp'
]);
export const BROWSER_PREVIEWABLE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  '.md',
  '.html',
  '.svg'
]);
`);

  const result = await scanTerminalLinkContracts(repo);

  assert.equal(result.status, 'ok');
  assert.equal(result.image_preview_extension_hits.length, 0);
});

test('diagnose writes flow design evidence, report, findings, and story tasks', async () => {
  const repo = await makeRepo();
  await runCli([
    'init',
    repo,
    '--story-id',
    'U-020',
    '--title',
    '新規登録でタスクを量産せず不足情報を質問化する',
    '--view',
    'user',
    '--period',
    '2026-05'
  ]);
  await mkdir(path.join(repo, 'src', 'app', 'new'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'patients', '[id]'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'cases', '[id]', 'notes'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: { next: '16.2.1', react: '19.0.0' }
  }, null, 2));
  await writeFile(path.join(repo, 'src', 'app', 'new', 'page.tsx'), `
"use client";
export default function NewPage() {
  const selectDpc = (result) => {
    setDpcCode(result.dpc_code);
    router.push('/patients/' + result.id);
  };
  return <button onClick={() => selectDpc(result)}>DPC候補を選択</button>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'patients', '[id]', 'page.tsx'), `
"use client";
export default function PatientPage() {
  const saveQuestionAnswer = async (question, value) => {
    if (question.key === 'dpc_target_date') {
      await fetch('/api/cases/1/notes', { method: 'POST' });
      setDpcTargetDateStatus(value);
    }
  };
  return <div>退院予定日</div>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'cases', '[id]', 'notes', 'route.ts'), `
export async function POST() {
  return Response.json({ ok: true });
}
`);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.flow_design = { profile: 'senpainurse' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'new-page' }, { id: 'patient-page' }],
    edges: []
  }));

  const result = await runCli(['diagnose', repo, '--run-id', '2026-05-10T000000Z']);

  assert.equal(result.exitCode, 0);
  const runDir = path.join(repo, '.vibepro', 'diagnostics', '2026-05-10T000000Z');
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  assert.equal(evidence.flow_design.profile, 'senpainurse');
  assert.equal(evidence.flow_design.summary.scanned_ui_files, 2);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-FLOW-003'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-FLOW-004'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-FLOW-007'), true);
  assert.equal(evidence.gates[0].status, 'needs_review');
  const report = await readFile(path.join(runDir, 'flow-design-check-result.md'), 'utf8');
  assert.match(report, /Flow Design Check/);
  assert.match(report, /Selection side effect/);
  const summary = await readFile(path.join(runDir, 'summary.md'), 'utf8');
  assert.match(summary, /Flow Design Gate/);
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'U-020', 'tasks', 'tasks.json'));
  assert.equal(tasks.tasks.some((task) => task.finding_id === 'VP-FLOW-003'), true);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(
    manifest.runs[0].artifacts.flow_design_check,
    '.vibepro/diagnostics/2026-05-10T000000Z/flow-design-check-result.md'
  );
});

test('diagnose emits critical network contract finding for missing Next.js API route', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-network-contract', '--title', 'Network contract']);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: { next: '16.2.1', react: '19.0.0' }
  }, null, 2));
  await mkdir(path.join(repo, 'src', 'app', 'detail', '_components'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'detail', '_components', 'searchExecutor.ts'), `
export async function execute(actionParams) {
  const response = await fetch('/api/detail-search', { method: 'POST', body: JSON.stringify(actionParams) });
  return response.json();
}
`);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'detail-search' }],
    edges: []
  }));

  const result = await runCli(['diagnose', repo, '--run-id', 'network-contract-run']);

  assert.equal(result.exitCode, 0);
  const evidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', 'network-contract-run', 'evidence.json'));
  assert.equal(evidence.network_contracts.missing_routes.some((item) => item.api_path === '/api/detail-search'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-NET-001' && finding.severity === 'Critical'), true);
  assert.equal(evidence.gates[0].status, 'block');
  const summary = await readFile(path.join(repo, '.vibepro', 'diagnostics', 'network-contract-run', 'summary.md'), 'utf8');
  assert.match(summary, /Network Contract/);
  assert.match(summary, /\/api\/detail-search/);
});

test('network contract scanner resolves query strings and Next.js dynamic route segments', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'companies', 'search'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'companies', '[companyId]'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'companies'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', 'search', 'route.ts'), 'export async function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', '[companyId]', 'route.ts'), 'export async function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'app', 'companies', 'page.tsx'), `
export async function loadCompanies(query, companyId) {
  await fetch(\`/api/companies/search?q=\${query}\`);
  await fetch(\`/api/companies/\${companyId}?include=details\`);
}
`);

  const result = await scanNetworkContracts(repo);

  assert.equal(result.status, 'pass');
  assert.equal(result.missing_routes.length, 0);
  assert.equal(result.dynamic_calls.length, 0);
  assert.equal(result.api_client_calls.every((call) => call.route_status === 'present'), true);
});

test('verify flow writes Playwright evidence and skips mutating probes by default', async () => {
  const repo = await makeRepo();
  await runCli([
    'init',
    repo,
    '--story-id',
    'U-020',
    '--title',
    '新規登録でタスクを量産せず不足情報を質問化する',
    '--view',
    'user',
    '--period',
    '2026-05'
  ]);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: { '@playwright/test': '^1.50.0' }
  }, null, 2));
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.flow_design = {
    profile: 'senpainurse',
    runtime_probes: [
      {
        id: 'new-registration-readonly',
        title: '新規登録の非破壊導線',
        path: '/new',
        mutates: false,
        steps: [
          { action: 'expectVisible', text: '病名' },
          { action: 'expectNotVisible', text: '退院予定日' },
          { action: 'physicalClick', selector: '.icon-action-button', targetPolicy: 'self' },
          { action: 'drag', selector: '.card-carousel', deltaX: -120, expectScrollLeftChanged: true, expectUrlUnchanged: true, activeSelector: '.card[aria-selected="true"]', expectActiveChanged: true },
          { action: 'expectElementFromPoint', selector: '.map-marker' },
          { action: 'screenshot', name: 'new-registration' }
        ]
      },
      {
        id: 'new-registration-create',
        title: '新規登録の保存導線',
        path: '/new',
        mutates: true,
        steps: [{ action: 'click', text: '仮登録してあとで確認' }]
      }
    ]
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const binDir = path.join(repo, 'fake-bin');
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(binDir, 'npx'), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(process.env.FAKE_NPX_LOG, process.argv.slice(2).join(' ') + '\\n');
console.log('fake playwright ok');
`);
  await chmod(path.join(binDir, 'npx'), 0o755);

  const result = await runCli([
    'verify',
    'flow',
    repo,
    '--base-url',
    'http://127.0.0.1:3000',
    '--run-id',
    'flow-run-1',
    '--json'
  ], {
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      FAKE_NPX_LOG: path.join(repo, 'fake-npx.log')
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.verification.status, 'pass');
  assert.equal(result.result.verification.summary.pass, 1);
  assert.equal(result.result.verification.summary.skipped, 1);
  assert.equal(result.result.verification.probes.find((probe) => probe.id === 'new-registration-create').status, 'skipped');
  const runDir = path.join(repo, '.vibepro', 'verification', 'flow-run-1');
  const verification = await readJson(path.join(runDir, 'flow-verification.json'));
  assert.equal(verification.base_url, 'http://127.0.0.1:3000');
  assert.equal(verification.probes[0].artifacts.screenshot_paths.includes('screenshots/new-registration.png'), true);
  const generatedSpec = await readFile(path.join(runDir, 'flow-verification.spec.js'), 'utf8');
  assert.match(generatedSpec, /document\.elementFromPoint\(x, y\)/);
  assert.equal(generatedSpec.includes('Physical click target for .icon-action-button is intercepted'), true);
  assert.match(generatedSpec, /page\.mouse\.click\(box\.x \+ box\.width \/ 2, box\.y \+ box\.height \/ 2\)/);
  assert.match(generatedSpec, /gestureScrollBefore/);
  assert.match(generatedSpec, /Expected drag not to navigate for \.card-carousel/);
  assert.match(generatedSpec, /Expected active item state to change for \.card/);
  assert.match(generatedSpec, /Hit target for \.map-marker is intercepted/);
  assert.match(await readFile(path.join(runDir, 'flow-verification.md'), 'utf8'), /new-registration-readonly/);
  assert.match(await readFile(path.join(repo, 'fake-npx.log'), 'utf8'), /playwright test/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_flow_verification_run, 'flow-run-1');
  assert.equal(manifest.flow_verification_runs[0].artifacts.flow_verification_json, '.vibepro/verification/flow-run-1/flow-verification.json');
});

test('verify flow fails on runtime network contract errors from Playwright output', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-network-flow', '--title', 'Network flow']);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: { '@playwright/test': '^1.50.0' }
  }, null, 2));
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.flow_design = {
    runtime_probes: [{
      id: 'detail-search-preview',
      title: 'detail search preview',
      path: '/detail?lat=35.75611899231195&lon=139.69929720610875',
      mutates: false,
      steps: [{ action: 'expectVisible', text: '検索' }]
    }]
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const binDir = path.join(repo, 'fake-bin');
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(binDir, 'npx'), `#!/usr/bin/env node
console.error('VibePro runtime contract failure: [{"kind":"api_response_error","url":"https://preview.example/api/detail-search","status":404}]');
process.exit(1);
`);
  await chmod(path.join(binDir, 'npx'), 0o755);

  const result = await runCli([
    'verify',
    'flow',
    repo,
    '--base-url',
    'https://preview.example',
    '--run-id',
    'flow-network-fail',
    '--json'
  ], {
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.verification.status, 'fail');
  assert.equal(result.result.verification.runtime_contract_failures.length > 0, true);
  const generatedSpec = await readFile(path.join(repo, '.vibepro', 'verification', 'flow-network-fail', 'flow-verification.spec.js'), 'utf8');
  assert.match(generatedSpec, /page\.on\('response'/);
  assert.match(generatedSpec, /api_response_error/);
  const report = await readFile(path.join(repo, '.vibepro', 'verification', 'flow-network-fail', 'flow-verification.md'), 'utf8');
  assert.match(report, /Runtime Contract Failures/);
  assert.match(report, /api_response_error/);
});

test('verify flow records needs_setup when Playwright is unavailable', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'U-018', '--title', '質問駆動退院支援UI', '--view', 'user']);

  const result = await runCli([
    'verify',
    'flow',
    repo,
    '--base-url',
    'http://127.0.0.1:3000',
    '--run-id',
    'flow-run-needs-setup'
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.verification.status, 'needs_setup');
  const verification = await readJson(path.join(repo, '.vibepro', 'verification', 'flow-run-needs-setup', 'flow-verification.json'));
  assert.equal(verification.status, 'needs_setup');
  assert.match(verification.reason, /Playwright/);
  assert.equal(verification.setup.next_commands.includes('npm install -D @playwright/test'), true);
});

test('verify flow records browser install guidance when Playwright browser is missing', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'U-020', '--title', '新規登録導線', '--view', 'user']);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    devDependencies: { '@playwright/test': '^1.59.1' }
  }, null, 2));
  const binDir = path.join(repo, 'fake-bin');
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(binDir, 'npx'), `#!/usr/bin/env node
console.log('Error: browserType.launch: Executable does not exist at /tmp/chromium');
console.log('Please run the following command to download new browsers:');
console.log('    npx playwright install');
process.exit(1);
`);
  await chmod(path.join(binDir, 'npx'), 0o755);

  const result = await runCli([
    'verify',
    'flow',
    repo,
    '--base-url',
    'http://127.0.0.1:3000',
    '--run-id',
    'flow-browser-missing',
    '--json'
  ], {
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.verification.status, 'needs_setup');
  assert.match(result.result.verification.reason, /Playwright browser binaries/);
  assert.equal(result.result.verification.setup.next_commands.includes('npx playwright install chromium'), true);
  const verification = await readJson(path.join(repo, '.vibepro', 'verification', 'flow-browser-missing', 'flow-verification.json'));
  assert.equal(verification.probes[0].status, 'needs_setup');
});

test('verify flow supports basic auth from env without persisting the password', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'U-020', '--title', '新規登録導線', '--view', 'user']);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    devDependencies: { '@playwright/test': '^1.59.1' }
  }, null, 2));
  const binDir = path.join(repo, 'fake-bin');
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(binDir, 'npx'), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(process.env.FAKE_NPX_LOG, [
  process.argv.slice(2).join(' '),
  'auth=' + process.env.VIBEPRO_BASIC_AUTH_USER + ':' + process.env.VIBEPRO_BASIC_AUTH_PASSWORD
].join('\\n') + '\\n');
console.log('fake playwright ok');
`);
  await chmod(path.join(binDir, 'npx'), 0o755);

  const result = await runCli([
    'verify',
    'flow',
    repo,
    '--base-url',
    'http://54.221.232.92',
    '--basic-auth-env',
    'SENPAI_BASIC_AUTH',
    '--run-id',
    'flow-basic-auth',
    '--json'
  ], {
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      FAKE_NPX_LOG: path.join(repo, 'fake-npx-basic-auth.log'),
      SENPAI_BASIC_AUTH: 'nurse:super-secret'
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.verification.status, 'pass');
  assert.deepEqual(result.result.verification.http_auth, {
    enabled: true,
    source: 'env:SENPAI_BASIC_AUTH',
    username: 'nurse',
    password_redacted: true
  });
  assert.match(await readFile(path.join(repo, 'fake-npx-basic-auth.log'), 'utf8'), /auth=nurse:super-secret/);
  const verificationText = await readFile(path.join(repo, '.vibepro', 'verification', 'flow-basic-auth', 'flow-verification.json'), 'utf8');
  assert.doesNotMatch(verificationText, /super-secret/);
  const specText = await readFile(path.join(repo, '.vibepro', 'verification', 'flow-basic-auth', 'flow-verification.spec.js'), 'utf8');
  assert.doesNotMatch(specText, /super-secret/);
});

test('verify flow can fill a value captured from visible page text', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'U-020', '--title', '新規登録導線', '--view', 'user']);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    devDependencies: { '@playwright/test': '^1.59.1' }
  }, null, 2));
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.flow_design = {
    profile: 'senpainurse',
    runtime_probes: [{
      id: 'login-to-new',
      title: 'ログインして新規登録を見る',
      path: '/login?next=%2Fnew',
      mutates: false,
      steps: [
        { action: 'click', text: '認証キーを送信' },
        { action: 'expectVisible', text: '開発用認証キー' },
        { action: 'fillFromText', label: '認証キー', textRegex: '開発用認証キー: ([0-9]+)' },
        { action: 'click', text: 'ログイン' }
      ]
    }]
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const binDir = path.join(repo, 'fake-bin');
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(binDir, 'npx'), `#!/usr/bin/env node
console.log('fake playwright ok');
`);
  await chmod(path.join(binDir, 'npx'), 0o755);

  const result = await runCli([
    'verify',
    'flow',
    repo,
    '--base-url',
    'http://127.0.0.1:3000',
    '--run-id',
    'flow-fill-from-text',
    '--json'
  ], {
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`
    }
  });

  assert.equal(result.exitCode, 0);
  const specText = await readFile(path.join(repo, '.vibepro', 'verification', 'flow-fill-from-text', 'flow-verification.spec.js'), 'utf8');
  assert.match(specText, /bodyText\.match/);
  assert.match(specText, /開発用認証キー: \(\[0-9\]\+\)/);
  assert.match(specText, /getByLabel\("認証キー"/);
});

test('pr prepare attaches latest flow verification evidence to the E2E gate', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'feature'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'feature', 'flow.js'), 'export const flow = true;\n');
  await mkdir(path.join(repo, '.vibepro', 'verification', 'flow-pass'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'verification', 'flow-pass', 'flow-verification.json'), JSON.stringify({
    schema_version: '0.1.0',
    run_id: 'flow-pass',
    story_id: 'story-pr-prepare',
    created_at: '2026-05-10T00:00:00.000Z',
    status: 'pass',
    base_url: 'http://127.0.0.1:3000',
    summary: {
      total: 1,
      pass: 1,
      fail: 0,
      skipped: 0,
      needs_setup: 0
    },
    probes: [{
      id: 'new-registration-readonly',
      status: 'pass',
      artifacts: {
        screenshot_paths: ['screenshots/new-registration.png']
      }
    }]
  }, null, 2));
  await writeFile(path.join(repo, '.vibepro', 'verification', 'flow-pass', 'flow-verification.md'), '# Flow Verification\n');
  await writeFile(path.join(repo, '.vibepro', 'verification', 'flow-pass', 'playwright-output.log'), 'ok\n');
  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_flow_verification_run = 'flow-pass';
  manifest.flow_verification_runs = [{
    run_id: 'flow-pass',
    story_id: 'story-pr-prepare',
    created_at: '2026-05-10T00:00:00.000Z',
    status: 'pass',
    base_url: 'http://127.0.0.1:3000',
    artifacts: {
      flow_verification_json: '.vibepro/verification/flow-pass/flow-verification.json',
      flow_verification_report: '.vibepro/verification/flow-pass/flow-verification.md',
      playwright_log: '.vibepro/verification/flow-pass/playwright-output.log'
    },
    summary: {
      total: 1,
      pass: 1,
      fail: 0,
      skipped: 0,
      needs_setup: 0
    }
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);

  assert.equal(result.exitCode, 0);
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
  const e2eGate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(e2eGate.status, 'passed');
  assert.equal(e2eGate.flow_verification.run_id, 'flow-pass');
  assert.equal(e2eGate.flow_verification.artifact, '.vibepro/verification/flow-pass/flow-verification.json');
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /## Flow Verification Evidence/);
  assert.match(prBody, /status: pass/);
  assert.match(prBody, /\.vibepro\/verification\/flow-pass\/flow-verification\.json/);
});

test('measure records command, HTTP, startup, and Prisma log metrics', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    name: 'measured-app',
    scripts: {
      typecheck: 'node -e "console.log(\\"typecheck ok\\")"',
      'dev:web': 'node dev-server.mjs'
    }
  }, null, 2));
  await writeFile(path.join(repo, 'dev-server.mjs'), `
setTimeout(() => {
  console.log('ready');
}, 20);
setInterval(() => {}, 1000);
`);
  await writeFile(path.join(repo, 'prisma.log'), [
    'prisma:query SELECT * FROM "Project" WHERE "id" = $1',
    'prisma:query SELECT * FROM "Project" WHERE "id" = $2',
    'not a query'
  ].join('\n'));
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', request.url.startsWith('/api/') ? 'application/json' : 'text/html');
    response.end(request.url.startsWith('/api/') ? '{"ok":true}' : '<!doctype html><title>ok</title>');
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const result = await runCli([
      'measure',
      repo,
      '--run-id',
      'perf-test',
      '--base-url',
      `http://127.0.0.1:${port}`,
      '--pages',
      '/dashboard',
      '--apis',
      '/api/projects',
      '--samples',
      '2',
      '--startup-script',
      'dev:web',
      '--ready-pattern',
      'ready',
      '--startup-timeout',
      '3000',
      '--prisma-log',
      'prisma.log'
    ]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.result.measurement.commands.find((item) => item.id === 'typecheck').status, 'pass');
    assert.equal(result.result.measurement.http.length, 2);
    assert.equal(result.result.measurement.http.find((item) => item.id === 'page:/dashboard').summary.count, 2);
    assert.equal(result.result.measurement.startup[0].status, 'pass');
    assert.equal(result.result.measurement.prisma_log.query_count, 2);
    assert.equal(result.result.measurement.prisma_log.repeated_query_shapes.length, 1);
    await stat(path.join(repo, '.vibepro', 'performance', 'perf-test', 'performance.json'));
    const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
    assert.equal(manifest.latest_performance_run, 'perf-test');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('measure compare reports before and after deltas', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const beforeDir = path.join(repo, '.vibepro', 'performance', 'before');
  const afterDir = path.join(repo, '.vibepro', 'performance', 'after');
  await mkdir(beforeDir, { recursive: true });
  await mkdir(afterDir, { recursive: true });
  await writeFile(path.join(beforeDir, 'performance.json'), JSON.stringify({
    run_id: 'before',
    created_at: '2026-05-01T00:00:00.000Z',
    commands: [{ id: 'typecheck', duration_ms: 1000 }],
    http: [{
      id: 'api:/api/projects',
      summary: {
        total_ms: { p95: 200 },
        ttfb_ms: { p95: 80 }
      }
    }],
    startup: [{ id: 'startup:dev:web', ready_ms: 1500 }],
    prisma_log: { query_count: 12, unique_query_shape_count: 6 }
  }, null, 2));
  await writeFile(path.join(afterDir, 'performance.json'), JSON.stringify({
    run_id: 'after',
    created_at: '2026-05-02T00:00:00.000Z',
    commands: [{ id: 'typecheck', duration_ms: 900 }],
    http: [{
      id: 'api:/api/projects',
      summary: {
        total_ms: { p95: 150 },
        ttfb_ms: { p95: 60 }
      }
    }],
    startup: [{ id: 'startup:dev:web', ready_ms: 1200 }],
    prisma_log: { query_count: 10, unique_query_shape_count: 5 }
  }, null, 2));
  let output = '';

  const result = await runCli([
    'measure',
    'compare',
    repo,
    '--before',
    '.vibepro/performance/before/performance.json',
    '--after',
    '.vibepro/performance/after/performance.json'
  ], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.comparison.commands[0].delta_ms, -100);
  assert.equal(result.result.comparison.http[0].delta_p95_ms, -50);
  assert.equal(result.result.comparison.startup[0].delta_ready_ms, -300);
  assert.equal(result.result.comparison.prisma_log.delta_query_count, -2);
  assert.match(output, /Performance Comparison/);
  assert.match(output, /-50ms/);
});

test('performance evidence defines story metrics, records runs, and compares p50 p90 max', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-performance-evidence', '--title', 'セッション切替を速くする', '--view', 'dev', '--period', '2026-05']);

  const defineResult = await runCli([
    'performance',
    'define',
    repo,
    '--id',
    'story-performance-evidence',
    '--metric-id',
    'session-switch.user-terminal-ready',
    '--user-story',
    'ユーザーがセッション行を押してから入力可能になるまで',
    '--start-condition',
    'session row click',
    '--completion-condition',
    'owner + inputReady=true',
    '--intermediate-marker',
    'snapshot-visible',
    '--intermediate-marker',
    'connected=true',
    '--timeout-ms',
    '5000',
    '--evidence-source',
    'browser_e2e',
    '--readiness-kind',
    'user_perceived'
  ]);
  assert.equal(defineResult.exitCode, 0);
  assert.equal(defineResult.result.metric.completionCondition.kind, 'interactive_ready');

  for (const [runId, label, duration] of [
    ['before-1', 'before', '1200'],
    ['before-2', 'before', '900'],
    ['after-1', 'after', '600'],
    ['after-2', 'after', '500']
  ]) {
    const result = await runCli([
      'performance',
      'record',
      repo,
      '--id',
      'story-performance-evidence',
      '--metric-id',
      'session-switch.user-terminal-ready',
      '--run-id',
      runId,
      '--label',
      label,
      '--status',
      'completed',
      '--duration-ms',
      duration,
      '--marker',
      'snapshot-visible=100',
      '--marker',
      'connected=true=300',
      '--evidence-source',
      'browser_e2e:tests/session-switch.spec.ts:playwright marker'
    ]);
    assert.equal(result.exitCode, 0);
  }

  const blockedResult = await runCli([
    'performance',
    'record',
    repo,
    '--id',
    'story-performance-evidence',
    '--metric-id',
    'session-switch.user-terminal-ready',
    '--run-id',
    'after-timeout',
    '--label',
    'after',
    '--status',
    'timeout',
    '--evidence-source',
    'browser_e2e:tests/session-switch.spec.ts:timeout'
  ]);
  assert.equal(blockedResult.exitCode, 0);

  const comparison = await runCli([
    'performance',
    'compare',
    repo,
    '--id',
    'story-performance-evidence',
    '--metric-id',
    'session-switch.user-terminal-ready',
    '--json'
  ]);

  assert.equal(comparison.exitCode, 0);
  const metric = comparison.result.comparison.metrics[0];
  assert.equal(metric.comparison.status, 'comparable');
  assert.equal(metric.before.p50_ms, 900);
  assert.equal(metric.before.p90_ms, 1200);
  assert.equal(metric.after.max_ms, 600);
  assert.equal(metric.after.incomplete_count, 1);
  assert.equal(metric.comparison.delta.p50_ms, -400);
  await stat(path.join(repo, '.vibepro', 'pr', 'story-performance-evidence', 'performance-runs', 'before-1.json'));
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.performance_evidence['story-performance-evidence'].latest_run, 'after-timeout');
});

test('performance evidence refuses to compare user perceived metrics from server logs only', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-user-perceived', '--title', 'ユーザー体感改善', '--view', 'dev', '--period', '2026-05']);
  await runCli([
    'performance',
    'define',
    repo,
    '--id',
    'story-user-perceived',
    '--metric-id',
    'search.user-results-visible',
    '--user-story',
    '検索して結果が操作可能になるまで',
    '--start-condition',
    'search button click',
    '--completion-condition',
    'result DOM visible and clickable',
    '--evidence-source',
    'browser_e2e',
    '--readiness-kind',
    'user_perceived'
  ]);
  for (const [runId, label] of [['before-server', 'before'], ['after-server', 'after']]) {
    await runCli([
      'performance',
      'record',
      repo,
      '--id',
      'story-user-perceived',
      '--metric-id',
      'search.user-results-visible',
      '--run-id',
      runId,
      '--label',
      label,
      '--status',
      'completed',
      '--duration-ms',
      label === 'before' ? '800' : '400',
      '--evidence-source',
      'server_log:server.log:handler complete'
    ]);
  }

  const comparison = await runCli(['performance', 'compare', repo, '--id', 'story-user-perceived', '--json']);
  const metric = comparison.result.comparison.metrics[0];
  assert.equal(metric.comparison.status, 'not_comparable');
  assert.equal(metric.comparison.delta.p50_ms, null);
  assert.equal(metric.comparison.not_comparable_reasons.some((reason) => /server logs alone/.test(reason)), true);
});

test('pr prepare includes performance evidence summary for the story', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli([
    'performance',
    'define',
    repo,
    '--id',
    'story-pr-prepare',
    '--metric-id',
    'session-switch.server-terminal-readiness',
    '--user-story',
    'セッション切替のサーバー準備完了',
    '--start-condition',
    'TerminalTransport handleUpgrade',
    '--completion-condition',
    'tmux check running=true wsState=1',
    '--evidence-source',
    'server_log',
    '--readiness-kind',
    'server_side'
  ]);
  for (const [runId, label, duration] of [['server-before', 'before', '1000'], ['server-after', 'after', '700']]) {
    await runCli([
      'performance',
      'record',
      repo,
      '--id',
      'story-pr-prepare',
      '--metric-id',
      'session-switch.server-terminal-readiness',
      '--run-id',
      runId,
      '--label',
      label,
      '--status',
      'completed',
      '--duration-ms',
      duration,
      '--evidence-source',
      'server_log:server.log:tmux ready'
    ]);
  }
  await writeFile(path.join(repo, 'index.html'), '<!doctype html><title>Changed</title>');

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  assert.equal(result.exitCode, 0);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /## Performance Evidence/);
  assert.match(prBody, /session-switch\.server-terminal-readiness/);
  assert.match(prBody, /p50 -300ms/);
});

test('graph cleans generated graphify-out when graphify fails', async () => {
  const repo = await makeRepo();
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bin-'));
  const graphifyBin = path.join(binDir, 'graphify');
  await writeFile(graphifyBin, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

mkdirSync('graphify-out', { recursive: true });
writeFileSync(path.join('graphify-out', 'partial.txt'), 'partial');
console.error('simulated graphify failure');
process.exit(2);
`);
  await chmod(graphifyBin, 0o755);

  const result = await runCli(['graph', repo, '--run-graphify'], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(await pathExists(path.join(repo, 'graphify-out')), false);
});

test('story derive can run graphify before generating the story catalog', async () => {
  const repo = await makeRepo();
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bin-'));
  const graphifyBin = path.join(binDir, 'graphify');
  await writeFile(graphifyBin, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.argv[2] !== 'update' || process.argv[3] !== '.') {
  console.error('unexpected graphify args: ' + process.argv.slice(2).join(' '));
  process.exit(1);
}
const outDir = 'graphify-out';
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify({
  nodes: [{ id: 'src/app/api/debug/route.ts' }],
  edges: []
}));
writeFileSync(path.join(outDir, 'GRAPH_REPORT.md'), '# Generated Graph Report\\n');
`);
  await chmod(graphifyBin, 0o755);
  await runCli(['init', repo]);

  const result = await runCli(['story', 'derive', repo, '--run-graphify'], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.graph.graphifyExecuted, true);
  assert.equal((await readJson(path.join(repo, '.vibepro', 'graphify', 'graph.json'))).nodes[0].id, 'src/app/api/debug/route.ts');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.graphify.last_execution.command, 'graphify update .');
  await stat(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
});

test('story derive handles medium cyclic graphify graphs without stack overflow', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'demo', '--title', 'demo']);
  await mkdir(path.join(repo, 'src', 'pkg'), { recursive: true });
  for (let index = 0; index < 60; index += 1) {
    await writeFile(path.join(repo, 'src', 'pkg', `module-${index}.ts`), `export const value${index} = ${index};\n`);
  }
  const nodes = [];
  const links = [];
  for (let index = 0; index < 4334; index += 1) {
    nodes.push({
      id: `node-${index}`,
      label: `Node ${index}`,
      source_file: `src/pkg/module-${index % 60}.ts`,
      community: `community-${index % 17}`
    });
    links.push({ source: `node-${index}`, target: `node-${(index + 1) % 4334}`, confidence: 'EXTRACTED' });
    if (index % 4 === 0) {
      links.push({ source: `node-${index}`, target: `node-${(index + 997) % 4334}`, confidence: 'INFERRED' });
    }
  }
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({ nodes, links }));

  const result = await runCli(['story', 'derive', repo, '--preset', 'modular-web', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.catalog.source.graphify.node_count, 4334);
  assert.equal(result.result.catalog.source.graphify.edge_count, links.length);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'stories', 'story-catalog.json')), true);
});

test('story derive writes failure evidence when graph processing fails', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'demo', '--title', 'demo']);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), '{ invalid json');

  const result = await runCli(['story', 'derive', repo], {
    stderr: { write: () => {} }
  });

  assert.equal(result.exitCode, 1);
  const diagnostics = await readdir(path.join(repo, '.vibepro', 'diagnostics'));
  const failureDir = diagnostics.find((entry) => entry.startsWith('story-derive-failure-'));
  assert.equal(Boolean(failureDir), true);
  const failure = await readJson(path.join(repo, '.vibepro', 'diagnostics', failureDir, 'failure.json'));
  assert.equal(failure.status, 'failed');
  assert.match(failure.error.message, /JSON/);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'diagnostics', failureDir, 'failure.md')), true);
});

test('story add list select and archive manage local stories without NocoDB', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const addResult = await runCli([
    'story',
    'add',
    repo,
    '--id',
    'story-local-hardening',
    '--title',
    'ローカル診断強化',
    '--horizon',
    'sprint',
    '--view',
    'dev',
    '--period',
    '2026-W18',
    '--started-at',
    '2026-04-28',
    '--due-at',
    '2026-05-05'
  ]);

  assert.equal(addResult.exitCode, 0);
  const afterAdd = await readJson(path.join(repo, '.vibepro', 'config.json'));
  const localStory = afterAdd.brainbase.stories.find((story) => story.story_id === 'story-local-hardening');
  assert.equal(localStory.title, 'ローカル診断強化');
  assert.equal(localStory.ssot, 'local');
  assert.equal(localStory.status, 'active');
  assert.equal(localStory.period, '2026-W18');

  const selectResult = await runCli(['story', 'select', repo, '--id', 'story-local-hardening']);

  assert.equal(selectResult.exitCode, 0);
  const afterSelect = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(afterSelect.brainbase.current_story_id, 'story-local-hardening');

  let output = '';
  const listResult = await runCli(['story', 'list', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(listResult.exitCode, 0);
  assert.match(output, /\* story-local-hardening/);

  const archiveResult = await runCli(['story', 'archive', repo, '--id', 'story-local-hardening']);

  assert.equal(archiveResult.exitCode, 0);
  const afterArchive = await readJson(path.join(repo, '.vibepro', 'config.json'));
  const archivedStory = afterArchive.brainbase.stories.find((story) => story.story_id === 'story-local-hardening');
  assert.equal(archivedStory.status, 'archived');
  assert.equal(afterArchive.brainbase.current_story_id, null);
});

test('story derive creates a repo-wide story catalog and local stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-existing', '--title', '既存Story', '--view', 'dev', '--period', '2026-W18']);
  await mkdir(path.join(repo, 'docs', 'user_stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'features'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'webhook', 'stripe'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', '[...nextauth]'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: {
      next: '15.0.0',
      react: '19.0.0',
      'next-auth': '5.0.0',
      '@prisma/client': '6.0.0'
    },
    devDependencies: {
      '@playwright/test': '1.0.0',
      vitest: '3.0.0'
    }
  }));
  await writeFile(path.join(repo, 'docs', 'user_stories', 'active', 'US-001_login_session.md'), '# ログイン状態を保って継続利用できる\n');
  await writeFile(path.join(repo, 'docs', 'features', 'content-cms-system.md'), '# 記事CMSを整える\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'webhook', 'stripe', 'route.ts'), 'export function POST() {}\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', '[...nextauth]', 'route.ts'), 'export function GET() {}\n');
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.added_count > 0, true);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-us-001-login-session'), false);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-content-cms-system'), false);
  assert.equal(catalog.stories.some((story) => story.title.includes('仕様書')), false);
  const authStory = catalog.stories.find((story) => story.story_id === 'story-product-auth-account-access');
  assert.equal(Boolean(authStory), true);
  assert.equal(authStory.source.paths.includes('docs/user_stories/active/US-001_login_session.md'), true);
  assert.equal(authStory.source.paths.includes('src/components/auth/LoginForm.tsx'), true);
  assert.equal(authStory.view, 'business');
  assert.equal(authStory.category, 'product');
  assert.equal(authStory.horizon, 'quarter');
  assert.equal(authStory.period, null);
  assert.equal(authStory.derived.predictions.period.confidence, 'unknown');
  assert.match(authStory.derived.story_definition.who, /サービスを継続利用したいユーザー/);
  assert.match(authStory.derived.story_definition.problem, /認証/);
  assert.equal(authStory.derived.story_definition.acceptance_focus.some((item) => item.includes('セッション同期')), true);
  assert.match(authStory.derived.meaning.value_hypothesis, /継続利用/);
  assert.equal(authStory.derived.meaning.user_actor.confidence, 'high');
  assert.equal(authStory.derived.meaning.business_goal.confidence, 'low');
  assert.equal(authStory.derived.meaning.workflow_position.stage, 'activation');
  assert.equal(authStory.derived.meaning.workflow_position.after.includes('story-product-onboarding'), true);
  assert.equal(catalog.open_questions.some((item) => item.story_id === 'story-product-auth-account-access' && item.field === 'period'), true);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-content-cms'), true);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-architecture-api-surface'), true);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-security-auth-boundary'), true);
  assert.doesNotMatch(JSON.stringify(catalog), /Aitle|ホテル|旅行|hotel|shadow-call/i);
  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /# Story Map/);
  assert.match(map, /## サマリー/);
  assert.match(map, /## まず確認すること/);
  assert.match(map, /## Story構造/);
  assert.match(map, /## Storyカード/);
  assert.match(map, /誰のため: サービスを継続利用したいユーザー/);
  assert.match(map, /成果: ユーザーが安心してアカウントを作成し、継続利用できる/);
  assert.match(map, /意味づけ:/);
  assert.match(map, /位置づけ: activation/);
  assert.match(map, /付録: 不明点/);
  assert.match(map, /認証とアカウント利用開始を成立させる/);
  assert.doesNotMatch(map, /Aitle|ホテル|旅行|hotel|shadow-call/i);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.stories.some((story) => story.story_id === 'story-product-auth-account-access'), true);
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-auth-account-access').view, 'business');
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-auth-account-access').category, 'product');
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-auth-account-access').period, null);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.artifacts.story_catalog, '.vibepro/stories/story-catalog.json');
  assert.equal(manifest.artifacts.story_map, '.vibepro/stories/story-map.md');
});

test('story derive continues when manifest evidence artifact is missing', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');
  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_run = 'missing-run';
  manifest.runs = [{
    run_id: 'missing-run',
    story_id: 'story-vibepro-diagnosis-commercialization-roadmap',
    artifacts: {
      evidence: '.vibepro/diagnostics/missing-run/evidence.json'
    }
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let output = '';

  const result = await runCli(['story', 'derive', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.match(output, /Warnings:/);
  assert.match(output, /診断evidenceが見つからない/);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.run_id, null);
  assert.equal(catalog.source.warnings[0].code, 'missing_evidence');
  assert.equal(catalog.source.warnings[0].run_id, 'missing-run');
  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /警告: missing_evidence/);

  await runCli(['story', 'plan', repo]);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  const cleanupTask = plan.task_candidates.find((task) => task.id === 'story-docs-story-ssot-recovery-missing-evidence-cleanup');
  assert.equal(plan.questions.some((question) => question.field === 'missing_evidence'), true);
  assert.equal(Boolean(cleanupTask), true);
  assert.equal(cleanupTask.story_id, 'story-docs-story-ssot-recovery');
  assert.match(cleanupTask.purpose, /診断evidence/);
  await runCli(['task', 'create', repo, '--from-plan', '--id', 'story-docs-story-ssot-recovery', '--task', 'story-docs-story-ssot-recovery-missing-evidence-cleanup']);
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-docs-story-ssot-recovery', 'tasks', 'tasks.json'));
  assert.equal(tasks.tasks.some((task) => task.id === 'story-docs-story-ssot-recovery-missing-evidence-cleanup'), true);
});

test('story map renders the generated catalog as markdown and json', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'docs', 'features'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'features', 'article-cms-requirements.md'), '# 記事CMSを整える\n');
  await runCli(['story', 'derive', repo]);
  let markdown = '';
  const markdownResult = await runCli(['story', 'map', repo], {
    stdout: { write: (text) => { markdown += text; } }
  });
  let json = '';
  const jsonResult = await runCli(['story', 'map', repo, '--json'], {
    stdout: { write: (text) => { json += text; } }
  });

  assert.equal(markdownResult.exitCode, 0);
  assert.match(markdown, /Story構造/);
  assert.match(markdown, /Storyカード/);
  assert.match(markdown, /記事とCMS運用を整理する/);
  assert.match(markdown, /SEO流入/);
  assert.match(markdown, /docs\/features\/article-cms-requirements\.md/);
  assert.equal(jsonResult.exitCode, 0);
  assert.equal(JSON.parse(json).stories.some((story) => story.story_id === 'story-product-article-cms-requirements'), false);
  assert.equal(JSON.parse(json).stories.some((story) => story.story_id === 'story-product-content-cms'), true);
  assert.match(JSON.parse(json).stories.find((story) => story.story_id === 'story-product-content-cms').derived.story_definition.business_value, /SEO流入/);
});

test('story plan creates execution priorities from the generated story map', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', 'session'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', 'session', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'session-route', source_file: 'src/app/api/auth/session/route.ts', community: 'auth-account' },
      { id: 'login-form', source_file: 'src/components/auth/LoginForm.tsx', community: 'auth-account' },
      { id: 'session-helper', source_file: 'src/lib/auth/session.ts', community: 'auth-account' }
    ],
    edges: [
      { source: 'login-form', target: 'session-route' },
      { source: 'session-route', target: 'session-helper' }
    ]
  }));
  await runCli(['story', 'derive', repo]);

  let output = '';
  const result = await runCli(['story', 'plan', repo, '--limit', '3'], {
    stdout: { write: (text) => { output += text; } }
  });
  let json = '';
  const jsonResult = await runCli(['story', 'plan', repo, '--limit', '2', '--json'], {
    stdout: { write: (text) => { json += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.match(output, /# Story Plan/);
  assert.match(output, /Story実行計画/);
  assert.match(output, /まず確認する質問/);
  assert.match(output, /Source Consistency/);
  assert.match(output, /正本欠落マップ/);
  assert.match(output, /潜在バグ候補/);
  assert.match(output, /Spec欠落/);
  assert.match(output, /Spec正本を復元する/);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  assert.equal(plan.priority_stories.length <= 2, true);
  assert.equal(plan.summary.source_consistency_status, 'needs_recovery');
  assert.equal(plan.source_consistency.needs_recovery_story_count > 0, true);
  assert.equal(plan.summary.source_missing_spec_count > 0, true);
  assert.equal(plan.summary.source_alignment_finding_count > 0, true);
  assert.equal(plan.summary.source_alignment_high_count > 0, true);
  assert.equal(plan.source_recovery_map.counts.missing_spec > 0, true);
  assert.equal(plan.source_alignment_findings.items.some((finding) => finding.type === 'missing_spec_source'), true);
  assert.equal(plan.questions.some((question) => question.field === 'source_alignment'), true);
  const missingSpecRow = plan.source_recovery_map.missing.find((row) => row.story_id === 'story-product-auth-account-access');
  assert.equal(missingSpecRow.spec.suggested_path, 'docs/specs/product-auth-account-access.md');
  assert.equal(missingSpecRow.spec.suggested_task_id, 'story-product-auth-account-access-spec-recovery');
  assert.equal(missingSpecRow.graph.related_edge_count > 0, true);
  assert.equal(plan.questions.some((question) => question.field === 'source_spec_recovery'), true);
  assert.equal(plan.task_candidates.some((task) => task.id.endsWith('spec-recovery')), true);
  assert.equal(plan.task_candidates.some((task) => task.id.endsWith('source-alignment-review')), true);
  const specRecoveryCandidate = plan.task_candidates.find((task) => task.id === 'story-product-auth-account-access-spec-recovery');
  assert.equal(specRecoveryCandidate.source_recovery.sources.spec.status, 'needs_recovery');
  assert.equal(specRecoveryCandidate.graph_context.matched_node_count > 0, true);
  assert.equal(specRecoveryCandidate.recovery_drafts.some((draft) => draft.kind === 'spec'), true);
  assert.equal(specRecoveryCandidate.recovery_drafts[0].graph_evidence.related_edge_count > 0, true);
  assert.equal(specRecoveryCandidate.recovery_drafts[0].evidence_files.includes('src/lib/auth/session.ts'), true);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.artifacts.story_plan, '.vibepro/stories/story-plan.json');
  assert.equal(manifest.artifacts.story_plan_markdown, '.vibepro/stories/story-plan.md');
  assert.equal(jsonResult.exitCode, 0);
  assert.equal(JSON.parse(json).priority_stories.length > 0, true);
  assert.equal(JSON.parse(json).priority_stories.length <= 2, true);

  const createResult = await runCli(['task', 'create', repo, '--from-plan', '--id', 'story-product-auth-account-access']);
  assert.equal(createResult.exitCode, 0);
  assert.equal(createResult.result.created_story_count, 1);
  assert.equal(createResult.result.created_task_count > 0, true);
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-product-auth-account-access', 'tasks', 'tasks.json'));
  assert.equal(tasks.tasks.some((task) => task.id === 'story-product-auth-account-access-spec-recovery'), true);
  assert.equal(tasks.tasks.find((task) => task.id === 'story-product-auth-account-access-spec-recovery').source_type, 'story_plan_candidate');
  assert.equal(tasks.tasks.find((task) => task.id === 'story-product-auth-account-access-spec-recovery').source_recovery.status, 'needs_recovery');
  assert.equal(tasks.tasks.find((task) => task.id === 'story-product-auth-account-access-spec-recovery').graph_context.related_edge_count > 0, true);
  const listResult = await runCli(['task', 'list', repo, '--id', 'story-product-auth-account-access']);
  assert.equal(listResult.exitCode, 0);
  assert.equal(listResult.result.tasks.some((task) => task.id === 'story-product-auth-account-access-spec-recovery'), true);
  const briefResult = await runCli(['task', 'brief', repo, '--id', 'story-product-auth-account-access', '--task', 'story-product-auth-account-access-spec-recovery']);
  assert.equal(briefResult.exitCode, 0);
  assert.equal(briefResult.result.artifacts.markdown, '.vibepro/stories/story-product-auth-account-access/tasks/story-product-auth-account-access-spec-recovery/briefing.md');
  const briefing = await readFile(path.join(repo, '.vibepro', 'stories', 'story-product-auth-account-access', 'tasks', 'story-product-auth-account-access-spec-recovery', 'briefing.md'), 'utf8');
  assert.match(briefing, /Source Recovery/);
  assert.match(briefing, /suggested_path: docs\/specs\/product-auth-account-access.md/);
  assert.match(briefing, /graph: matched=/);
});

test('story plan creates task candidates from explicit story task sections', async () => {
  const repo = await makeRepo();
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-agent-harness',
    '--title',
    'Agent harness readiness',
    '--view',
    'dev'
  ]);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-agent-harness.md'), `---
story_id: story-agent-harness
title: Agent harness readiness
view: dev
---

# Agent harness readiness

## 受け入れ基準

- [ ] harness status can run

## 初期タスク

1. Harness診断パッケージ
   - \`agent-harness\` check packを追加する
   - \`check all\` ではデフォルト任意案内にする
2. Harness status
   - \`vibepro harness status\` を追加する
   - installed / missing / outdated を一覧化する
`);

  await runCli(['story', 'derive', repo]);
  const planResult = await runCli(['story', 'plan', repo, '--limit', '10']);

  assert.equal(planResult.exitCode, 0);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  const explicitTasks = plan.task_candidates.filter((task) => task.source_type === 'story_explicit_task');
  assert.equal(explicitTasks.length, 2);
  assert.equal(explicitTasks[0].id, 'story-agent-harness-01-harness');
  assert.equal(explicitTasks[0].title, 'Harness診断パッケージ');
  assert.equal(explicitTasks[0].priority, 'medium');
  assert.equal(explicitTasks[0].acceptance.some((item) => item.includes('agent-harness')), true);
  assert.equal(explicitTasks[1].id, 'story-agent-harness-02-harness-status');
  assert.equal(explicitTasks[1].implementation_steps.length, 2);

  const createResult = await runCli(['task', 'create', repo, '--from-plan', '--id', 'story-agent-harness']);
  assert.equal(createResult.exitCode, 0);
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-agent-harness', 'tasks', 'tasks.json'));
  assert.equal(tasks.tasks.some((task) => task.id === 'story-agent-harness-01-harness'), true);
  assert.equal(tasks.tasks.find((task) => task.id === 'story-agent-harness-02-harness-status').source_type, 'story_explicit_task');
});

test('story plan requires architecture and spec tasks for design-first stories', async () => {
  const repo = await makeRepo();
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-vibepro-architecture-aware-story-derive',
    '--title',
    '非WebリポジトリへWeb/SaaSストーリーを誤生成しない',
    '--view',
    'dev'
  ]);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-vibepro-architecture-aware-story-derive.md'), `---
story_id: story-vibepro-architecture-aware-story-derive
title: 非WebリポジトリへWeb/SaaSストーリーを誤生成しない
view: dev
category: architecture
source:
  type: github_issue
  id: "#46"
---

# 非WebリポジトリへWeb/SaaSストーリーを誤生成しない

## 受け入れ基準

- [ ] story derive は repo profile を判定してから preset applicability を決める
- [ ] Python CLI repoでは auth/CMS/notification のWeb/SaaS Storyを生成しない
- [ ] 明示 preset では従来互換を保つ
`);

  await runCli(['story', 'derive', repo]);
  const planResult = await runCli(['story', 'plan', repo, '--limit', '10']);

  assert.equal(planResult.exitCode, 0);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  const tasks = plan.task_candidates.filter((task) => task.story_id === 'story-vibepro-architecture-aware-story-derive');
  assert.equal(tasks.some((task) => task.id === 'story-vibepro-architecture-aware-story-derive-spec-recovery'), true);
  assert.equal(tasks.some((task) => task.id === 'story-vibepro-architecture-aware-story-derive-architecture-recovery'), true);
  const row = plan.source_recovery_map.missing.find((item) => item.story_id === 'story-vibepro-architecture-aware-story-derive');
  assert.equal(row.spec.status, 'needs_recovery');
  assert.equal(row.architecture.status, 'needs_decision');

  const createResult = await runCli(['task', 'create', repo, '--from-plan', '--id', 'story-vibepro-architecture-aware-story-derive']);
  assert.equal(createResult.exitCode, 0);
  const created = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-architecture-aware-story-derive', 'tasks', 'tasks.json'));
  assert.equal(created.tasks.some((task) => task.id === 'story-vibepro-architecture-aware-story-derive-spec-recovery'), true);
  assert.equal(created.tasks.some((task) => task.id === 'story-vibepro-architecture-aware-story-derive-architecture-recovery'), true);
});

test('story plan treats linked architecture and spec as source consistency for design-first stories', async () => {
  const repo = await makeRepo();
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-vibepro-architecture-aware-story-derive',
    '--title',
    '非WebリポジトリへWeb/SaaSストーリーを誤生成しない',
    '--view',
    'dev'
  ]);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-vibepro-architecture-aware-story-derive.md'), `---
story_id: story-vibepro-architecture-aware-story-derive
title: 非WebリポジトリへWeb/SaaSストーリーを誤生成しない
view: dev
category: architecture
source:
  type: github_issue
  id: "#46"
architecture_docs:
  - ../../architecture/vibepro-architecture-aware-story-derive.md
spec_docs:
  - ../../specs/vibepro-architecture-aware-story-derive.md
---

# 非WebリポジトリへWeb/SaaSストーリーを誤生成しない

## 受け入れ基準

- [ ] story derive は repo profile を判定してから preset applicability を決める
- [ ] Python CLI repoでは auth/CMS/notification のWeb/SaaS Storyを生成しない
- [ ] 明示 preset では従来互換を保つ
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'vibepro-architecture-aware-story-derive.md'), `---
story_id: story-vibepro-architecture-aware-story-derive
---

# Architecture-Aware Story Derive

Repo profile, preset applicability, Story promotion, and source recovery evidence are separate boundaries.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'vibepro-architecture-aware-story-derive.md'), `---
story_id: story-vibepro-architecture-aware-story-derive
---

# Architecture-Aware Story Derive Spec

- INV-ASD-1: story derive must classify repo profile before promoting product surface Stories.
- INV-ASD-7: source recovery hints do not satisfy design-first source consistency without explicit links.
`);

  await runCli(['story', 'derive', repo]);
  const planResult = await runCli(['story', 'plan', repo, '--limit', '10']);

  assert.equal(planResult.exitCode, 0);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  const tasks = plan.task_candidates.filter((task) => task.story_id === 'story-vibepro-architecture-aware-story-derive');
  assert.equal(tasks.some((task) => task.id === 'story-vibepro-architecture-aware-story-derive-spec-recovery'), false);
  assert.equal(tasks.some((task) => task.id === 'story-vibepro-architecture-aware-story-derive-architecture-recovery'), false);
  const row = plan.source_recovery_map.rows.find((item) => item.story_id === 'story-vibepro-architecture-aware-story-derive');
  assert.equal(row.spec.status, 'present');
  assert.equal(row.architecture.status, 'present');
});

test('story plan creates architecture recovery tasks for boundary code without ADR', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', 'session'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', 'session', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'session-route', source_file: 'src/app/api/auth/session/route.ts', community: 'auth-api' },
      { id: 'session-helper', source_file: 'src/lib/auth/session.ts', community: 'auth-api' }
    ],
    edges: [
      { source: 'session-route', target: 'session-helper' }
    ]
  }));
  await runCli(['story', 'derive', repo]);

  let json = '';
  const result = await runCli(['story', 'plan', repo, '--limit', '8', '--json'], {
    stdout: { write: (text) => { json += text; } }
  });

  assert.equal(result.exitCode, 0);
  const plan = JSON.parse(json);
  assert.equal(plan.task_candidates.some((task) => task.id.endsWith('architecture-recovery')), true);
  const task = plan.task_candidates.find((item) => item.id.endsWith('architecture-recovery'));
  assert.equal(task.source_recovery.sources.architecture.status, 'needs_decision');
  const mapRow = plan.source_recovery_map.missing.find((row) => row.story_id === task.story_id);
  assert.equal(mapRow.architecture.suggested_path.startsWith('docs/architecture/ADR-'), true);
  assert.equal(mapRow.architecture.suggested_task_id.endsWith('-architecture-recovery'), true);
  assert.equal(mapRow.graph.matched_file_count > 0, true);
  assert.equal(task.graph_context.matched_node_count > 0, true);
  assert.equal(task.recovery_drafts.some((draft) => draft.kind === 'architecture'), true);
  assert.equal(task.recovery_drafts[0].suggested_path.startsWith('docs/architecture/ADR-'), true);
  assert.equal(task.recovery_drafts[0].graph_evidence.matched_files.includes('src/lib/auth/session.ts'), true);
});

test('story derive creates stories for code surfaces that have no spec documents', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'settings'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', 'session'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(public)', 'articles'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'article'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'health'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'manager'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'settings', 'page.tsx'), 'export default function Page() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', 'session', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'app', '(public)', 'articles', 'page.tsx'), 'export default function Page() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'article', 'client.ts'), 'export function listArticles() { return []; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'health', 'route.ts'), 'export function GET() {}\n');
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'manager', 'page.tsx'), 'export default function Page() { return null; }\n');
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'login_form_file', source_file: 'src/components/auth/LoginForm.tsx', label: 'LoginForm.tsx' },
      { id: 'session_route_file', source_file: 'src/app/api/auth/session/route.ts', label: 'route.ts' },
      { id: 'article_page_file', source_file: 'src/app/(public)/articles/page.tsx', label: 'page.tsx' },
      { id: 'manager_page_file', source_file: 'src/app/(app)/manager/page.tsx', label: 'page.tsx' },
      { id: 'settings_page_file', source_file: 'src/app/(app)/settings/page.tsx', label: 'page.tsx' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const authStory = catalog.stories.find((story) => story.story_id === 'story-product-auth-account-access');
  const cmsStory = catalog.stories.find((story) => story.story_id === 'story-product-content-cms');
  const opsStory = catalog.stories.find((story) => story.story_id === 'story-ops-observability-health');

  assert.equal(Boolean(authStory), true);
  assert.equal(authStory.source.type, 'story_cluster');
  assert.equal(authStory.source.paths.includes('src/components/auth/LoginForm.tsx'), true);
  assert.match(authStory.derived.story_definition.problem, /認証/);
  assert.equal(authStory.derived.meaning.user_actor.confidence, 'low');
  assert.equal(authStory.derived.meaning.evidence_by_type.code_evidence.includes('src/components/auth/LoginForm.tsx'), true);
  assert.equal(Boolean(cmsStory), true);
  assert.equal(cmsStory.source.paths.includes('src/app/(public)/articles/page.tsx'), true);
  assert.match(cmsStory.derived.story_definition.business_value, /SEO流入/);
  assert.equal(Boolean(opsStory), true);
  assert.equal(opsStory.source.type, 'code_surface');
  assert.equal(opsStory.source.paths.includes('src/app/api/health/route.ts'), true);
  assert.equal(opsStory.derived.open_questions.some((item) => item.field === 'missing_spec'), true);
  assert.equal(catalog.coverage.status, 'warn');
  assert.equal(catalog.coverage.uncovered.some((item) => item.path === 'src/app/(app)/manager/page.tsx'), true);
  assert.equal(catalog.coverage.uncovered.some((item) => item.path === 'src/app/(app)/settings/page.tsx'), true);
  assert.equal(catalog.coverage.uncovered.some((item) => item.path === 'src/components/auth/LoginForm.tsx'), false);

  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /認証とアカウント利用開始を成立させる/);
  assert.match(map, /付録: Graph Coverage/);
  assert.match(map, /src\/app\/\(app\)\/settings\/page\.tsx/);
  assert.match(map, /コード上は機能面が確認できるが、対応するStory、要求、仕様書が見つからない/);
});

test('story derive links local management story docs to code surface stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', 'session'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-product-auth-account-access.md'), `---
story_id: story-product-auth-account-access
title: 認証とアカウント利用開始を成立させる
status: active
view: business
horizon: month
period: 2026Q2
---

# 認証とアカウント利用開始を成立させる

サービスを継続利用したいユーザーが、安全にログインしてアカウント状態を保てるようにする。

## 誰のため

サービスを継続利用したい登録ユーザー。

## 課題

認証状態やアカウント操作が不安定だと、ユーザーは利用を再開できず継続前に離脱する。

## 望む変化

ログイン、セッション継続、アカウント操作へ迷わず進める。

## 成果

アカウント状態が継続利用の中心になる。

## 事業価値

継続率とログイン完了率の改善につながる。

## 受け入れ基準

- ログイン後のセッションが維持される
- アカウント操作の失敗時の扱いが決まる
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', 'session', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const story = catalog.stories.find((item) => item.story_id === 'story-product-auth-account-access');

  assert.equal(Boolean(story), true);
  assert.equal(story.source.paths.includes('docs/management/stories/active/story-product-auth-account-access.md'), true);
  assert.equal(story.view, 'business');
  assert.equal(story.horizon, 'month');
  assert.equal(story.period, '2026Q2');
  assert.equal(story.derived.open_questions.some((item) => item.field === 'missing_spec'), false);
  assert.equal(story.derived.meaning.evidence_by_type.docs_evidence.includes('docs/management/stories/active/story-product-auth-account-access.md'), true);
  assert.equal(story.derived.meaning.user_actor.confidence, 'high');
  assert.equal(story.derived.story_definition.who, 'サービスを継続利用したい登録ユーザー。');
  assert.match(story.derived.story_definition.problem, /継続前に離脱/);
  assert.match(story.derived.story_definition.want, /迷わず進める/);
  assert.match(story.derived.story_definition.outcome, /継続利用の中心/);
  assert.match(story.derived.story_definition.business_value, /ログイン完了率/);
  assert.equal(story.derived.story_definition.acceptance_focus.includes('アカウント操作の失敗時の扱いが決まる'), true);
  assert.equal(story.derived.story_definition.source_synthesis.some((item) => item.path === 'docs/management/stories/active/story-product-auth-account-access.md'), true);
});

test('story derive links story_id frontmatter specs and architecture docs to stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', 'session'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'specs', 'product-auth-account-access.md'), `---
story_id: story-product-auth-account-access
title: 認証Spec
status: recovered
---

# 認証Spec

## 受け入れ基準

- ログイン後のセッションが維持される
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'ADR-product-auth-account-access.md'), `---
story_id: story-product-auth-account-access
title: 認証ADR
status: accepted
---

# ADR: 認証
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', 'session', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');

  await runCli(['story', 'derive', repo]);
  await runCli(['story', 'plan', repo, '--limit', '5']);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const story = catalog.stories.find((item) => item.story_id === 'story-product-auth-account-access');
  assert.equal(story.derived.meaning.evidence_by_type.docs_evidence.includes('docs/specs/product-auth-account-access.md'), true);
  assert.equal(story.derived.meaning.evidence_by_type.docs_evidence.includes('docs/architecture/ADR-product-auth-account-access.md'), true);
  assert.equal(story.derived.open_questions.some((item) => item.field === 'missing_spec'), false);
  assert.equal(story.derived.story_definition.source_synthesis.some((item) => item.path === 'docs/specs/product-auth-account-access.md'), true);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  const row = plan.source_recovery_map.rows.find((item) => item.story_id === 'story-product-auth-account-access');
  assert.equal(row.spec.status, 'present');
  assert.equal(row.architecture.status, 'present');
});

test('story derive does not emit domain-specific next-app stories from generic auth code', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-auth-account-access'), true);
  assert.doesNotMatch(JSON.stringify(catalog), /Aitle|ホテル|旅行|hotel|shadow-call/i);
});

test('story coverage keeps all uncovered graph files in the catalog', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'unmapped'), { recursive: true });
  const nodes = [];
  for (let index = 0; index < 55; index += 1) {
    await mkdir(path.join(repo, 'src', 'app', '(app)', 'unmapped', String(index)), { recursive: true });
    const filePath = `src/app/(app)/unmapped/${index}/page.tsx`;
    await writeFile(path.join(repo, filePath), 'export default function Page() { return null; }\n');
    nodes.push({ id: `unmapped_${index}`, source_file: filePath, label: 'page.tsx' });
  }
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({ nodes, links: [] }));

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.coverage.totals.uncovered_files, 55);
  assert.equal(catalog.coverage.uncovered.length, 55);
});

test('story derive does not overwrite existing story ids', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-product-auth-account-access', '--title', '既存の認証Story']);
  await mkdir(path.join(repo, 'docs', 'user_stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'user_stories', 'active', 'US-001_login_session.md'), '# 新しいタイトル\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.skipped_count >= 1, true);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-auth-account-access').title, '既存の認証Story');
});

test('story derive archives obsolete document-index stories from previous derive runs', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-product-api-specification', '--title', 'API 仕様書']);
  await runCli(['story', 'add', repo, '--id', 'story-product-us-001-login-session', '--title', 'US-001: ログイン状態維持']);
  await mkdir(path.join(repo, '.vibepro', 'stories'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'), JSON.stringify({
    stories: [
      { story_id: 'story-product-api-specification', title: 'API 仕様書' },
      { story_id: 'story-product-us-001-login-session', title: 'US-001: ログイン状態維持' }
    ]
  }));
  await mkdir(path.join(repo, 'docs', 'features'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'features', 'auth-session-system.md'), '# 認証セッション仕様書\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.archived_count, 2);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-api-specification').status, 'archived');
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-us-001-login-session').status, 'archived');
  assert.equal(config.brainbase.stories.some((story) => story.story_id === 'story-product-auth-account-access' && story.status === 'active'), true);
});

test('brainbase import uses selected local story and excludes archived stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-active-local', '--title', 'Active Local', '--view', 'dev']);
  await runCli(['story', 'add', repo, '--id', 'story-archived-local', '--title', 'Archived Local', '--view', 'dev']);
  await runCli(['story', 'select', repo, '--id', 'story-active-local']);
  await runCli(['story', 'archive', repo, '--id', 'story-archived-local']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T235900Z']);

  const result = await runCli(['brainbase', repo]);

  assert.equal(result.exitCode, 0);
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.story.story_id, 'story-active-local');
  assert.equal(importState.story.ssot, 'local');
  assert.equal(importState.stories.some((story) => story.story_id === 'story-archived-local'), false);
});

test('pr prepare writes PR artifacts for the selected story', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'management', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'frames'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'feature'), { recursive: true });
  await mkdir(path.join(repo, 'tests', 'unit'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'STR-001-pr-prepare.md'), `---
story_id: STR-001
title: PR準備の文脈を厚くする
source:
  type: bug
  id: BUG-001
  url: https://noco.example.test/bug/1
  title: PR本文に背景が出ない
architecture_docs:
  - path: N/A
    status: not_required
    reason: 既存のPR準備出力の改善で対応できるため
---

# ストーリー: PR準備の文脈を厚くする

## 背景

PR本文がファイル数だけでは、レビュアーがなぜこの変更を読むべきか判断できない。

## 受け入れ基準

- [x] PR本文に背景が入る
- [x] PR本文にADR判断が入る
- [x] PR本文に検証候補が入る
`);
  await writeFile(path.join(repo, 'docs', 'management', 'architecture', 'ADR-001-pr-prepare.md'), '# ADR');
  await writeFile(path.join(repo, 'docs', 'architecture', 'ADR-story-pr-prepare.md'), `---
story_id: story-pr-prepare
spec_ref: docs/specs/story-pr-prepare.md
---
# ADR: story-pr-prepare
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
architecture_ref: docs/architecture/ADR-story-pr-prepare.md
---
# Spec: story-pr-prepare
`);
  await writeFile(path.join(repo, 'docs', 'frames', 'vibepro-operating-philosophy.md'), '# VibePro operating philosophy\n');
  await writeFile(path.join(repo, 'src', 'feature', 'pr-prepare.js'), 'export const ok = true;\n');
  await writeFile(path.join(repo, 'src', 'feature', 'pr-prepare.test.js'), 'export const ok = true;\n');
  await writeFile(path.join(repo, 'tests', 'unit', 'pr-prepare.test.js'), 'export const ok = true;\n');
  await mkdir(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'tasks.json'), JSON.stringify({
    schema_version: '0.1.0',
    generated_at: '2026-04-30T00:00:00.000Z',
    story: {
      story_id: 'story-pr-prepare',
      title: 'PR準備'
    },
    source_run: {
      run_id: 'story-plan',
      gate_status: 'pass'
    },
    tasks: [{
      id: 'TASK-001',
      source_type: 'story_plan_candidate',
      source_id: 'TASK-001',
      title: 'PR準備Task',
      priority: 'high',
      status: 'todo',
      execution_policy: 'proposal_only',
      mutates_repository: false,
      target_count: 1,
      target_files: ['src/feature/pr-prepare.js'],
      target_routes: [],
      target_groups: [],
      read_first_files: [{ file: 'src/feature/pr-prepare.js', reason: '対象実装' }],
      recommended_strategy: { id: 'task-driven-pr', reason: 'Task/HandoffとPRを接続する' },
      implementation_steps: [],
      acceptance_criteria: ['Task/HandoffがPR本文に入る'],
      graph_context: null,
      pre_fix_briefing: null
    }]
  }));
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'briefing.json'), JSON.stringify({ mode: 'pre_fix_briefing' }));
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'briefing.md'), '# briefing');
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'plan.json'), JSON.stringify({ mode: 'implementation_plan' }));
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'plan.md'), '# plan');
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'handoff.json'), JSON.stringify({ mode: 'implementation_handoff' }));
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'handoff.md'), '# handoff');
  await mkdir(path.join(repo, '.vibepro', 'diagnostics', 'run-refactoring-delta'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'diagnostics', 'run-refactoring-delta', 'evidence.json'), JSON.stringify({
    run_id: 'run-refactoring-delta',
    refactoring_delta: {
      schema_version: '0.1.0',
      status: 'available',
      before_run_id: 'run-before',
      after_run_id: 'run-refactoring-delta',
      summary: {
        total_before: 1,
        total_after: 1,
        improved: 1,
        removed: 0,
        regressed: 0,
        new: 0,
        unchanged: 0
      },
      top_improvements: [{
        key: 'duplicate_query_shape:t_UserInfo.findFirst|top:nextAuthUserId,where|where:nextAuthUserId|select:-|order:-',
        title: 'user identity lookupの重複query形状を共通化する',
        refactoring_intent: 'query_policy',
        before: {
          target_file_count: 5,
          occurrence_count: 8,
          rank: 1,
          score_total: 12
        },
        after: {
          target_file_count: 3,
          occurrence_count: 5,
          rank: 1,
          score_total: 8
        },
        target_files_removed: ['src/features/accounts/actions.ts', 'src/features/groups/actions.ts'],
        target_files_added: [],
        status: 'improved'
      }],
      top_regressions: [],
      top_remaining: [{
        key: 'duplicate_query_shape:t_UserInfo.update|top:Id,data,where|where:Id|select:-|order:-',
        title: 'user identity updateの重複query形状を共通化する',
        refactoring_intent: 'identity_resolution',
        after: {
          target_file_count: 3,
          occurrence_count: 5,
          rank: 2,
          score_total: 10
        },
        target_files_after: ['src/features/accounts/actions.ts', 'src/features/groups/actions.ts', 'src/features/profile/actions.ts'],
        status: 'unchanged'
      }],
      items: []
    }
  }, null, 2));
  await mkdir(path.join(repo, '.vibepro', 'qa', 'story-pr-prepare-visual', 'iteration-1'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'qa', 'story-pr-prepare-visual', 'residual-analysis.md'), `# Visual QA

Weighted semantic/layout residual: **34%**
`);
  await writeFile(path.join(repo, '.vibepro', 'qa', 'story-pr-prepare-visual', 'iteration-1', 'pixel-residual.json'), JSON.stringify({
    meanAbsResidualPct: 13.41,
    rmsResidualPct: 21.47,
    pixelChangedPctOver32: 46.99
  }, null, 2));
  const manifestWithDelta = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  manifestWithDelta.latest_run = 'run-refactoring-delta';
  manifestWithDelta.latest_run_by_story = {
    ...(manifestWithDelta.latest_run_by_story ?? {}),
    'story-pr-prepare': 'run-refactoring-delta'
  };
  manifestWithDelta.runs = [{
    run_id: 'run-refactoring-delta',
    story_id: 'story-pr-prepare',
    gate_status: 'pass',
    artifacts: {
      evidence: '.vibepro/diagnostics/run-refactoring-delta/evidence.json'
    }
  }, ...(manifestWithDelta.runs ?? [])];
  await writeFile(path.join(repo, '.vibepro', 'vibepro-manifest.json'), `${JSON.stringify(manifestWithDelta, null, 2)}\n`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add pr prepare target']);

  let prepareSummaryOutput = '';
  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--task', 'TASK-001'], {
    stdout: { write: (text) => { prepareSummaryOutput += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.match(prepareSummaryOutput, /\| Gate readiness \| needs_verification \|/);
  assert.match(prepareSummaryOutput, /\| Ready for pr create \| no \|/);
  assert.match(prepareSummaryOutput, /\| Scope \| reviewable \(PR size only; not completion approval\) \|/);
  assert.match(prepareSummaryOutput, /Do not treat scope\.status=reviewable as completion approval/);
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
  assert.equal(prepare.story.story_id, 'story-pr-prepare');
  assert.equal(prepare.gate_status.overall_status, 'needs_verification');
  assert.equal(prepare.gate_status.ready_for_pr_create, false);
  assert.equal(prepare.gate_status.completion_quality_status, 'needs_quality_closure');
  assert.equal(prepare.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:e2e'), true);
  assert.equal(prepare.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:visual_qa'), true);
  assert.match(prepare.gate_status.agent_instruction, /Do not treat scope\.status=reviewable/);
  assert.equal(prepare.toolchain.package.name, 'vibepro');
  assert.match(prepare.toolchain.package.version, /^0\.1\.0/);
  assert.equal(typeof prepare.toolchain.package.root, 'string');
  assert.equal(prepare.pr_context.toolchain.package.name, 'vibepro');
  assert.equal(prepare.task_context.task.id, 'TASK-001');
  assert.equal(prepare.task_context.artifacts.handoff_json, '.vibepro/stories/story-pr-prepare/tasks/TASK-001/handoff.json');
  assert.equal(prepare.scope.status, 'reviewable');
  assert.equal(prepare.file_groups.story_docs.count, 1);
  assert.equal(prepare.file_groups.architecture_docs.count, 2);
  assert.equal(prepare.file_groups.specifications.count, 1);
  assert.equal(prepare.file_groups.policy_docs.count, 1);
  assert.equal(prepare.file_groups.architecture_docs.files.includes('docs/architecture/ADR-story-pr-prepare.md'), true);
  assert.equal(prepare.file_groups.specifications.files.includes('docs/specs/story-pr-prepare.md'), true);
  assert.equal(prepare.file_groups.policy_docs.files.includes('docs/frames/vibepro-operating-philosophy.md'), true);
  assert.equal(prepare.file_groups.source.count, 1);
  assert.equal(prepare.file_groups.tests.count, 2);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /story-pr-prepare/);
  assert.match(prBody, /## 背景・要求/);
  assert.match(prBody, /PR本文がファイル数だけでは/);
  assert.match(prBody, /ADRあり \(docs\/architecture\/ADR-story-pr-prepare.md, docs\/management\/architecture\/ADR-001-pr-prepare.md\)/);
  assert.match(prBody, /PR本文に背景が入る/);
  assert.match(prBody, /npm test -- --runTestsByPath src\/feature\/pr-prepare.test.js tests\/unit\/pr-prepare.test.js --runInBand/);
  assert.match(prBody, /npm run typecheck/);
  assert.match(prBody, /## 要件整合性/);
  assert.match(prBody, /Requirement Gate: not_applicable/);
  assert.match(prBody, /## Gate DAG/);
  assert.match(prBody, /## Gate Enforcement/);
  assert.match(prBody, /blocked_by_gate/);
  assert.match(prBody, /生の `gh pr create` はVibePro Gateを通らない/);
  assert.match(prBody, /## AI Agent Handoff/);
  assert.match(prBody, /最初に見る: このPR本文/);
  assert.match(prBody, /## VibePro refactoring delta/);
  assert.match(prBody, /runtime: vibepro@0\.1\.0/);
  assert.match(prBody, /5ファイル \/ 8出現 -> 3ファイル \/ 5出現/);
  assert.match(prBody, /### 次の候補/);
  assert.match(prBody, /3ファイル \/ 5出現/);
  assert.match(prBody, /## Task \/ Handoff/);
  assert.match(prBody, /TASK-001 PR準備Task/);
  assert.match(prBody, /Task\/HandoffがPR本文に入る/);
  assert.match(prBody, /E2E Gate: needs_(setup|evidence) \(required\) - `npx playwright test`/);
  assert.match(prBody, /## Visual QA Evidence/);
  assert.match(prBody, /story-pr-prepare-visual: needs_review/);
  assert.match(prBody, /MAE 13\.41%/);
  assert.match(prBody, /## Completion Quality/);
  assert.match(prBody, /status: needs_quality_closure/);
  assert.match(prBody, /final_20_auto_closure_rate: 0/);
  assert.equal(prepare.pr_context.story_source.requirement_id, 'BUG-001');
  assert.equal(prepare.pr_context.verification_commands.length, 2);
  assert.equal(prepare.pr_context.visual_qa.status, 'needs_review');
  assert.equal(prepare.pr_context.completion_quality.status, 'needs_quality_closure');
  assert.equal(prepare.pr_context.completion_quality.metrics.e2e_experience_reach_rate, 0);
  assert.equal(prepare.pr_context.completion_quality.metrics.visual_qa_pass_rate, 0);
  assert.equal(prepare.pr_context.completion_quality.required_evidence.some((item) => item.includes('E2E experience')), true);
  assert.equal(prepare.pr_context.visual_qa.threshold_pct, 5);
  assert.equal(prepare.pr_context.visual_qa.runs[0].qa_id, 'story-pr-prepare-visual');
  assert.equal(prepare.pr_context.visual_qa.runs[0].latest_residual.meanAbsResidualPct, 13.41);
  assert.equal(prepare.pr_context.visual_qa.runs[0].semantic_layout_residual_pct, 34);
  assert.equal(prepare.pr_context.gate_dag.overall_status, 'needs_verification');
  assert.equal(prepare.pr_context.refactoring_delta.status, 'available');
  assert.equal(prepare.pr_context.refactoring_delta.top_remaining.length, 1);
  assert.equal(prepare.pr_context.gate_dag.summary.acceptance_criteria_count, 3);
  assert.equal(prepare.pr_context.gate_dag.summary.requirement_status, 'not_applicable');
  assert.equal(prepare.pr_context.gate_dag.nodes.some((node) => node.id === 'gate:requirement'), true);
  assert.equal(prepare.pr_context.gate_dag.nodes.some((node) => node.id === 'gate:e2e'), true);
  assert.equal(prepare.pr_context.gate_dag.nodes.some((node) => node.id === 'gate:visual_qa'), true);
  assert.equal(prepare.pr_context.gate_dag.nodes.some((node) => node.id === 'gate:agent_review'), true);
  assert.equal(prepare.pr_context.review_points.some((point) => point.includes('TASK-001')), true);
  const gateDag = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'gate-dag.json'));
  assert.equal(gateDag.model, 'story-acceptance-verification-dag');
  assert.equal(gateDag.edges.some((edge) => edge.from === 'ac:1' && edge.to === 'gate:e2e'), true);
  const gateDagHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'gate-dag.html'), 'utf8');
  assert.match(gateDagHtml, /<!doctype html>/);
  assert.match(gateDagHtml, /data-vibepro-report="gate-dag"/);
  assert.match(gateDagHtml, /<svg class="dag-svg"/);
  assert.match(gateDagHtml, /data-node-id="gate:e2e"/);
  assert.match(gateDagHtml, /VibePro Gate DAG/);
  const prepareHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.html'), 'utf8');
  assert.match(prepareHtml, /data-vibepro-report="pr-prepare"/);
  assert.match(prepareHtml, /VibePro PR Prepare/);
  assert.match(prepareHtml, /Story -> Architecture -> Spec -> Code -> Gate/);
  assert.match(prepareHtml, /まず見る場所/);
  assert.match(prepareHtml, /AIエージェントへの渡し方/);
  assert.match(prepareHtml, /次に足すもの/);
  assert.match(prepareHtml, /Graphify影響範囲/);
  assert.match(prepareHtml, /変更ファイル分類/);
  assert.match(prepareHtml, /実行Gate/);
  assert.match(prepareHtml, /Requirement Consistency/);
  assert.match(prepareHtml, /gate-dag\.html/);
  const reviewCockpitHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'review-cockpit.html'), 'utf8');
  assert.equal(reviewCockpitHtml, prepareHtml);
  const architectureReview = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'architecture-review.json'));
  assert.equal(architectureReview.story_id, 'story-pr-prepare');
  assert.equal(architectureReview.status, 'satisfied');
  assert.equal(architectureReview.required, true);
  assert.equal(architectureReview.source_artifacts.review_cockpit, '.vibepro/pr/story-pr-prepare/review-cockpit.html');
  assert.equal(architectureReview.review_record.approved, null);
  assert.equal(architectureReview.toolchain.package.name, 'vibepro');
  const humanReview = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'human-review.json'));
  assert.equal(humanReview.story_id, 'story-pr-prepare');
  assert.equal(humanReview.recommended_decision, 'add_evidence');
  assert.equal(humanReview.source_artifacts.review_cockpit, '.vibepro/pr/story-pr-prepare/review-cockpit.html');
  assert.equal(humanReview.source_artifacts.architecture_review, '.vibepro/pr/story-pr-prepare/architecture-review.json');
  assert.deepEqual(humanReview.source_artifacts.visual_qa, [
    '.vibepro/qa/story-pr-prepare-visual/residual-analysis.md',
    '.vibepro/qa/story-pr-prepare-visual/iteration-1/pixel-residual.json'
  ]);
  assert.equal(humanReview.evidence_summary.architecture.status, 'satisfied');
  assert.equal(humanReview.evidence_summary.spec.status, 'present');
  assert.equal(humanReview.evidence_summary.visual_qa.status, 'needs_review');
  assert.equal(humanReview.evidence_summary.visual_qa.needs_review_count, 1);
  assert.equal(humanReview.evidence_summary.completion_quality.status, 'needs_quality_closure');
  assert.equal(humanReview.evidence_summary.completion_quality.required_evidence_count > 0, true);
  assert.equal(humanReview.review_record.selected_decision, null);
  assert.equal(humanReview.toolchain.package.name, 'vibepro');
  assert.equal(prepare.next_commands.some((command) => command.startsWith('gh pr create')), false);
  assert.equal(prepare.next_commands.some((command) => command.includes('vibepro pr create')), true);

  // gate guard: flag無しなら needs_verification で拒否される
  let stderrOutput = '';
  const blockedResult = await runCli(['pr', 'create', repo, '--base', 'main', '--task', 'TASK-001', '--dry-run'], {
    stderr: { write: (text) => { stderrOutput += text; } }
  });
  assert.equal(blockedResult.exitCode, 1);
  assert.match(stderrOutput, /Pre-create gate check failed/);
  assert.match(stderrOutput, /needs_verification/);
  assert.match(stderrOutput, /--verification-waiver <reason>/);

  // --allow-needs-verification だけでは通らず、理由付きwaiverを要求する
  let waiverStderrOutput = '';
  const missingWaiverResult = await runCli(['pr', 'create', repo, '--base', 'main', '--task', 'TASK-001', '--dry-run', '--allow-needs-verification'], {
    stderr: { write: (text) => { waiverStderrOutput += text; } }
  });
  assert.equal(missingWaiverResult.exitCode, 1);
  assert.match(waiverStderrOutput, /Pre-create gate waiver missing/);

  // critical gate は --allow-needs-verification と --verification-waiver だけでは通らない
  let criticalWaiverStderrOutput = '';
  const criticalWaiverResult = await runCli([
    'pr',
    'create',
    repo,
    '--base',
    'main',
    '--task',
    'TASK-001',
    '--dry-run',
    '--allow-needs-verification',
    '--verification-waiver',
    'UI影響のないPR本文生成テストのためE2Eは対象外'
  ], {
    stderr: { write: (text) => { criticalWaiverStderrOutput += text; } }
  });
  assert.equal(criticalWaiverResult.exitCode, 1);
  assert.match(criticalWaiverStderrOutput, /Pre-create critical gate check failed/);
  assert.match(criticalWaiverStderrOutput, /E2E Gate:needs_(setup|evidence)/);
  assert.match(criticalWaiverStderrOutput, /Visual QA Gate:needs_review/);
  assert.match(criticalWaiverStderrOutput, /Agent Review Gate:needs_review/);
  assert.match(criticalWaiverStderrOutput, /vibepro verify record/);

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npm run test:e2e',
    '--summary', 'E2E passed'
  ])).exitCode, 0);
  await writeFile(path.join(repo, '.vibepro', 'qa', 'story-pr-prepare-visual', 'residual-analysis.md'), `# Visual QA

Weighted semantic/layout residual: **1%**
`);
  await writeFile(path.join(repo, '.vibepro', 'qa', 'story-pr-prepare-visual', 'iteration-1', 'pixel-residual.json'), JSON.stringify({
    meanAbsResidualPct: 1,
    rmsResidualPct: 1,
    pixelChangedPctOver32: 1
  }, null, 2));
  await mkdir(path.join(repo, 'tests', 'e2e'), { recursive: true });
  await writeFile(path.join(repo, 'tests', 'e2e', 'story-pr-prepare-pr-artifacts.spec.ts'), `
// story-pr-prepare ac:1
// story-pr-prepare ac:2
// story-pr-prepare ac:3
import { test } from '@playwright/test';
test('story-pr-prepare PR artifacts acceptance coverage', async () => {});
`);
  assert.equal((await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'e2e',
    '--status',
    'pass',
    '--command',
    'npx playwright test tests/e2e/story-pr-prepare-pr-artifacts.spec.ts',
    '--summary',
    'Story acceptance E2E coverage passed'
  ])).exitCode, 0);
  await recordRequiredAgentReviews(repo, 'story-pr-prepare');

  // critical gate 解消後、残る非critical gateだけを理由付きwaiverで通す
  const createResult = await runCli([
    'pr',
    'create',
    repo,
    '--base',
    'main',
    '--task',
    'TASK-001',
    '--dry-run',
    '--allow-needs-verification',
    '--verification-waiver',
    'UI影響のないPR本文生成テストのためE2Eは対象外'
  ]);
  assert.equal(createResult.exitCode, 0);
  assert.equal(createResult.result.execution.dry_run, true);
  assert.equal(createResult.result.execution.gate_override.allowed, true);
  assert.equal(createResult.result.execution.gate_override.waiver_policy, 'cli_reason');
  assert.equal(createResult.result.execution.gate_override.severity, 'warning');
  assert.equal(createResult.result.execution.gate_override.reason, 'UI影響のないPR本文生成テストのためE2Eは対象外');
  assert.equal(createResult.result.execution.gate_override.critical_unresolved_gates.length, 0);
  assert.equal(createResult.result.execution.gate_override.completion_quality.status, 'needs_quality_closure');
  assert.equal(createResult.result.execution.gate_override.required_evidence.length > 0, true);
  assert.equal(createResult.result.execution.toolchain.package.name, 'vibepro');
  assert.equal(createResult.result.execution.task_context.task.id, 'TASK-001');
  assert.equal(createResult.result.execution.base, 'main');
  assert.equal(createResult.result.execution.head, 'feature/test-story');
  assert.equal(createResult.result.execution.commands.some((command) => command.includes('git push -u origin feature/test-story')), true);
  assert.equal(createResult.result.execution.commands.some((command) => command.includes('gh pr create')), true);
  const prCreate = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-create.json'));
  assert.equal(prCreate.mode, 'pr_create');
  assert.equal(prCreate.dry_run, true);
  assert.equal(prCreate.gate_override.allowed, true);
  assert.equal(prCreate.gate_override.waiver_policy, 'cli_reason');
  assert.equal(prCreate.gate_override.critical_unresolved_gates.length, 0);
  assert.equal(prCreate.toolchain.package.name, 'vibepro');
  const prCreateHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-create.html'), 'utf8');
  assert.match(prCreateHtml, /data-vibepro-report="pr-create"/);
  assert.match(prCreateHtml, /VibePro PR Create/);
  assert.match(prCreateHtml, /Gate Override/);
  assert.match(prCreateHtml, /Critical Unresolved Gates/);
  assert.match(prCreateHtml, /Completion Quality Waiver Evidence/);
  assert.match(prCreateHtml, /VibePro Runtime/);
  assert.match(prCreateHtml, /Command Timeline/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.pr_creations['story-pr-prepare'].latest_create, '.vibepro/pr/story-pr-prepare/pr-create.json');
  assert.equal(manifest.pr_creations['story-pr-prepare'].latest_report, '.vibepro/pr/story-pr-prepare/pr-create.html');
  assert.equal(manifest.pr_preparations['story-pr-prepare'].latest_review_cockpit, '.vibepro/pr/story-pr-prepare/review-cockpit.html');
  assert.equal(manifest.pr_preparations['story-pr-prepare'].latest_human_review, '.vibepro/pr/story-pr-prepare/human-review.json');
  assert.equal(manifest.pr_preparations['story-pr-prepare'].latest_architecture_review, '.vibepro/pr/story-pr-prepare/architecture-review.json');

  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-remote-'));
  await git(remote, ['init', '--bare']);
  await git(repo, ['remote', 'add', 'origin', remote]);
  await git(repo, ['push', '-u', 'origin', 'main']);
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gh-'));
  const ghBin = path.join(binDir, 'gh');
  await writeFile(ghBin, `#!/usr/bin/env node
if (process.argv[2] !== 'pr' || process.argv[3] !== 'create') {
  console.error('unexpected gh args: ' + process.argv.slice(2).join(' '));
  process.exit(1);
}
console.log('https://github.example.test/unson/vibepro/pull/123');
`);
  await chmod(ghBin, 0o755);
  const actualCreateResult = await runCli([
    'pr',
    'create',
    repo,
    '--base',
    'main',
    '--task',
    'TASK-001',
    '--title',
    'Test PR',
    '--allow-needs-verification',
    '--verification-waiver',
    'fixtureではGitHub作成経路だけを検証する'
  ], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });
  assert.equal(actualCreateResult.exitCode, 0);
  assert.equal(actualCreateResult.result.execution.dry_run, false);
  assert.equal(actualCreateResult.result.execution.pr_url, 'https://github.example.test/unson/vibepro/pull/123');
  assert.equal(actualCreateResult.result.execution.results.length, 2);
});

test('pr prepare carries configured output language into human artifacts', async () => {
  const repo = await makeGitRepoWithStory({ language: 'en' });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'language-target.js'), 'export const ok = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add language target']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.preparation.output.language, 'en');
  const prepareHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.html'), 'utf8');
  assert.match(prepareHtml, /<html lang="en">/);
  assert.match(prepareHtml, /Where To Look First/);
  assert.match(prepareHtml, /Agent handoff/);
  assert.match(prepareHtml, /Graphify Impact/);
  assert.match(prepareHtml, /Changed File Groups/);
  assert.doesNotMatch(prepareHtml, /まず見る場所/);
  assert.doesNotMatch(prepareHtml, /Graphify影響範囲/);
  const gateDagHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'gate-dag.html'), 'utf8');
  assert.match(gateDagHtml, /<html lang="en">/);
  const splitPlanHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'split-plan.html'), 'utf8');
  assert.match(splitPlanHtml, /<html lang="en">/);
});

test('pr prepare flags empty commit messages in the PR range', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'empty-message.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/empty-message.js']);
  await git(repo, ['commit', '--allow-empty-message', '-m', '']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--json']);

  assert.equal(result.exitCode, 0);
  const prepare = result.result.preparation;
  assert.equal(prepare.git.commits.length, 1);
  assert.equal(prepare.git.commits[0].message, '');
  assert.equal(prepare.git.commits[0].message_empty, true);
  assert.equal(prepare.git.commit_message_health.status, 'needs_review');
  assert.equal(prepare.git.commit_message_health.scope, 'base_head');
  assert.equal(prepare.git.commit_message_health.empty_message_count, 1);
  assert.deepEqual(prepare.git.commit_message_health.ignored_internal_ref_patterns, ['refs/jj/keep/*']);
  assert.equal(prepare.scope.status, 'needs_clean_branch');
  assert.equal(prepare.scope.reasons.some((reason) => reason.includes('commit messageが空')), true);
  assert.equal(prepare.pr_context.risks.some((risk) => risk.includes('commit messageが空')), true);
});

test('pr prepare does not require Playwright E2E for CLI-only source changes', async () => {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    name: 'cli-only-app',
    type: 'module',
    scripts: {
      test: 'node --test',
      typecheck: 'node --check src/cli-helper.js'
    }
  }, null, 2));
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
architecture_docs:
  reason: CLI-only utility change
---

# PR準備

## 受け入れ基準

- [x] CLIの補助関数が検証される
`);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'cli-helper.js'), 'export function normalize(value) { return String(value).trim(); }\n');
  await writeFile(path.join(repo, 'test', 'cli-helper.test.js'), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { normalize } from "../src/cli-helper.js";\ntest("normalize", () => assert.equal(normalize(" ok "), "ok"));\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: cli helper']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);

  assert.equal(result.exitCode, 0);
  const prepare = result.result.preparation;
  const e2eGate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(e2eGate.required, false);
  assert.equal(e2eGate.status, 'not_required');
  assert.equal(e2eGate.command, null);
  assert.match(e2eGate.reason, /UI\/E2E対象の差分ではない/);
  assert.equal(prepare.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:e2e'), false);
  assert.equal(prepare.pr_context.completion_quality.metrics.e2e_experience_reach_rate, null);
  assert.equal(prepare.split_plan.stacked_gate_plan.summary.requires_cumulative_e2e, false);
  assert.equal(prepare.split_plan.lanes.some((lane) => lane.id === 'e2e-gate'), false);
});

test('review prepare generates stage role requests', async () => {
  const repo = await makeGitRepoWithStory();

  const result = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'test_plan', '--json']);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.result.plan.roles, ['unit_integration', 'e2e_ux', 'gate_coverage']);
  assert.equal(result.result.plan.parallel_dispatch.mode, 'manual_parallel_subagents');
  assert.equal(result.result.plan.parallel_dispatch.subagent_count, 3);
  assert.equal(result.result.plan.mandatory_review_lenses.some((lens) => lens.id === 'regression_guard'), true);
  assert.equal(result.result.plan.parallel_dispatch.coordinator_behavior.expected, 'dispatch_parallel_subagents');
  assert.equal(result.result.plan.parallel_dispatch.coordinator_behavior.user_confirmation_required_by_vibepro, false);
  assert.match(result.result.plan.parallel_dispatch.record_commands.e2e_ux, /vibepro review record .*--role e2e_ux/);
  assert.match(result.result.plan.parallel_dispatch.record_commands.e2e_ux, /--agent-system <codex\|claude_code>/);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'review-plan.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'parallel-dispatch.md')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'review-request-e2e_ux.md')), true);
  const dispatch = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'parallel-dispatch.md'), 'utf8');
  assert.match(dispatch, /Start all subagents below in parallel/);
  assert.match(dispatch, /VibePro does not require a separate user confirmation prompt/);
  assert.doesNotMatch(dispatch, /サブエージェントレビューを実行していいですか/);
  assert.match(dispatch, /Subagent 2: test_plan:e2e_ux/);
  assert.match(dispatch, /regression_guard/);
  assert.match(dispatch, /mandatory regression_guard lens/);
  assert.match(dispatch, /vibepro review record .*--role e2e_ux/);
  assert.match(dispatch, /Required provenance/);
  assert.match(dispatch, /--agent-system codex --execution-mode parallel_subagent/);
  assert.match(dispatch, /--agent-system claude_code --execution-mode parallel_subagent/);
  const request = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'review-request-e2e_ux.md'), 'utf8');
  assert.match(request, /VibePro Agent Review Request/);
  assert.match(request, /Role: e2e_ux/);
  assert.match(request, /Mandatory Review Lenses/);
  assert.match(request, /regression_guard/);
  assert.match(request, /A `pass` must cover both the role focus and every mandatory review lens/);
  assert.match(request, /coordinator records it/);
  assert.match(request, /Codex coordinators must include/);
  assert.match(request, /Claude Code coordinators must include/);
});

test('explore prepare record status and pr prepare surface read-only exploration evidence', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'explore-target.js'), 'export const value = 1;\n');

  const prepareResult = await runCli([
    'explore',
    'prepare',
    repo,
    '--id',
    'story-pr-prepare',
    '--topic',
    'map risky entrypoints',
    '--role',
    'codebase_context',
    '--role',
    'test_surface',
    '--json'
  ]);

  assert.equal(prepareResult.exitCode, 0);
  assert.deepEqual(prepareResult.result.plan.roles, ['codebase_context', 'test_surface']);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'explore', 'story-pr-prepare', 'parallel-dispatch.md')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'explore', 'story-pr-prepare', 'requests', 'codebase_context.md')), true);

  const recordResult = await runCli([
    'explore',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--role',
    'codebase_context',
    '--status',
    'pass',
    '--summary',
    'entrypoints mapped',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-explore-agent',
    '--finding',
    'info:entrypoints:src explored'
  ]);

  assert.equal(recordResult.exitCode, 0);
  assert.equal(recordResult.result.summary.status, 'needs_review');
  const statusResult = await runCli(['explore', 'status', repo, '--id', 'story-pr-prepare', '--json']);
  assert.equal(statusResult.result.summary.recorded_role_count, 1);
  assert.equal(statusResult.result.roles.find((role) => role.role === 'test_surface').status, 'missing');

  const prResult = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main']);
  assert.equal(prResult.exitCode, 0);
  assert.equal(prResult.result.preparation.pr_context.explore_evidence.summary.recorded_role_count, 1);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /## Explore Evidence/);
  assert.match(prBody, /codebase_context: pass - entrypoints mapped/);
});

test('review record updates status summary and marks stale after source change', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'agent-review-target.js'), 'export const value = 1;\n');

  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'runtime contract reviewed',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-runtime-contract-agent',
    '--agent-thread-id',
    'thread-runtime-contract',
    '--agent-model',
    'gpt-5.5',
    '--finding',
    'low:note:no blocking issue'
  ]);
  assert.equal(recordResult.exitCode, 0);
  const before = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(before.exitCode, 0);
  const roleBefore = before.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(roleBefore.effective_status, 'pass');

  await writeFile(path.join(repo, 'src', 'agent-review-target.js'), 'export const value = 2;\n');
  const after = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  const roleAfter = after.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(roleAfter.effective_status, 'stale');
  assert.match(roleAfter.stale_reason, /dirty worktree fingerprint/);
});

test('review pass without Codex or Claude Code subagent provenance does not satisfy agent review gate', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'agent-review-provenance.js'), 'export const value = 1;\n');

  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation']);
  const manualRecord = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'manual pass without subagent proof'
  ]);
  assert.equal(manualRecord.exitCode, 0);
  assert.equal(manualRecord.result.review.agent_provenance.system, 'unknown');
  assert.equal(manualRecord.result.review.agent_provenance.evidence_strength, 'missing');

  const statusWithoutProvenance = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  const roleWithoutProvenance = statusWithoutProvenance.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(roleWithoutProvenance.effective_status, 'unverified_agent');
  assert.match(roleWithoutProvenance.provenance_reason, /not Codex\/Claude Code subagent review/);

  const prWithoutProvenance = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  const missingRuntime = prWithoutProvenance.result.preparation.pr_context.agent_reviews.unmet_required_reviews.find((item) => (
    item.stage === 'implementation' && item.role === 'runtime_contract'
  ));
  assert.equal(missingRuntime.status, 'unverified_agent');
  assert.match(missingRuntime.detail, /not Codex\/Claude Code subagent review/);

  const claudeRecord = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'Claude Code subagent reviewed runtime contract',
    '--agent-system',
    'claude-code',
    '--execution-mode',
    'parallel-subagent',
    '--agent-id',
    'claude-task-runtime-contract',
    '--agent-session-id',
    'claude-session-123',
    '--agent-model',
    'claude-sonnet'
  ]);
  assert.equal(claudeRecord.exitCode, 0);
  assert.equal(claudeRecord.result.review.agent_provenance.system, 'claude_code');
  assert.equal(claudeRecord.result.review.agent_provenance.execution_mode, 'parallel_subagent');
  assert.equal(claudeRecord.result.review.agent_provenance.evidence_strength, 'strong');

  const statusWithProvenance = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  const roleWithProvenance = statusWithProvenance.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(roleWithProvenance.effective_status, 'pass');
  assert.equal(roleWithProvenance.provenance_status, 'verified_agent');
});

test('pr prepare requires agent reviews for source changes and passes the agent gate when recorded', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
architecture_docs:
  reason: CLI-only utility change
---

# PR準備

## 受け入れ基準

- CLIの補助関数が検証される
`);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'cli-helper.js'), 'export function normalize(value) { return String(value).trim(); }\n');

  const missingResult = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(missingResult.exitCode, 0);
  const missingGate = missingResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:agent_review');
  assert.equal(missingGate.required, true);
  assert.equal(missingGate.status, 'needs_review');
  assert.equal(missingGate.parallel_dispatch.required, true);
  assert.equal(missingGate.parallel_dispatch.required_stages.some((stage) => stage.prepare_command.includes('vibepro review prepare')), true);
  assert.deepEqual(
    missingGate.parallel_dispatch.required_stages.map((stage) => stage.stage),
    ['planning_spec', 'test_plan', 'implementation']
  );
  assert.equal(missingResult.result.preparation.pr_context.agent_reviews.summary.required_review_count, 9);
  assert.match(missingGate.reason, /mandatory parallel subagent review step/);
  assert.equal(missingGate.required_actions.some((action) => action.includes('vibepro review prepare')), true);
  assert.equal(missingGate.required_actions.some((action) => action.includes('parallel-dispatch.md')), true);
  assert.equal(missingGate.dispatch_contract.expected, 'dispatch_parallel_subagents');
  assert.equal(missingGate.dispatch_contract.user_confirmation_required_by_vibepro, false);
  assert.equal(missingGate.required_actions.some((action) => action.includes('サブエージェントレビューを実行していいですか')), false);
  const missingDag = missingResult.result.preparation.pr_context.gate_dag;
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:prepare:test_plan' && node.type === 'agent_review_prepare_gate'), true);
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:test_plan:e2e_ux' && node.type === 'agent_review_role_gate'), true);
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:record:test_plan:e2e_ux' && node.type === 'agent_review_record_gate'), true);
  assert.equal(missingDag.edges.some((edge) => edge.from === 'review:prepare:test_plan' && edge.to === 'review:test_plan:e2e_ux'), true);
  assert.equal(missingDag.edges.some((edge) => edge.from === 'review:test_plan:e2e_ux' && edge.to === 'review:record:test_plan:e2e_ux'), true);
  assert.equal(missingDag.edges.some((edge) => edge.from === 'review:record:test_plan:e2e_ux' && edge.to === 'gate:agent_review'), true);
  assert.match(missingResult.result.preparation.gate_status.agent_review_instruction, /mandatory parallel subagent review instruction/);
  assert.equal(missingResult.result.preparation.gate_status.agent_review_dispatch_required, true);
  assert.equal(missingResult.result.preparation.gate_status.agent_review_user_confirmation_required_by_vibepro, false);
  assert.equal(missingResult.result.preparation.gate_status.next_required_actions.some((action) => action.includes('vibepro review prepare')), true);
  const gateDagHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'gate-dag.html'), 'utf8');
  assert.match(gateDagHtml, /data-node-id="review:prepare:test_plan"/);
  assert.match(gateDagHtml, /data-node-id="review:test_plan:e2e_ux"/);
  assert.match(gateDagHtml, /data-node-id="review:record:test_plan:e2e_ux"/);
  assert.equal(missingResult.result.preparation.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:agent_review'), true);
  let summaryStdout = '';
  const summaryOutput = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare'], {
    stdout: { write: (text) => { summaryStdout += text; } }
  });
  assert.equal(summaryOutput.exitCode, 0);
  assert.match(summaryStdout, /Agent Review Gate is a mandatory parallel subagent review instruction/);

  await recordRequiredAgentReviews(repo);
  const passedResult = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  const passedGate = passedResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:agent_review');
  const passedDag = passedResult.result.preparation.pr_context.gate_dag;
  assert.equal(passedGate.status, 'passed');
  assert.equal(passedDag.nodes.find((node) => node.id === 'review:prepare:test_plan').status, 'passed');
  assert.equal(passedDag.nodes.find((node) => node.id === 'review:test_plan:e2e_ux').status, 'passed');
  assert.equal(passedDag.nodes.find((node) => node.id === 'review:record:test_plan:e2e_ux').status, 'passed');
  assert.equal(passedResult.result.preparation.pr_context.agent_reviews.summary.unmet_required_review_count, 0);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /## Agent Review/);
  assert.match(prBody, /status: pass/);
});

test('verify record promotes gate evidence into the next pr prepare', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'tests'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: {
      test: 'vitest',
      typecheck: 'tsc --noEmit',
      'test:e2e': 'playwright test'
    },
    devDependencies: {
      vitest: '^2.0.0',
      typescript: '^5.0.0',
      '@playwright/test': '^1.0.0'
    }
  }, null, 2));
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
---

# PR準備

## 受け入れ基準

- PR本文に検証証跡が入る
`);
  await writeFile(path.join(repo, 'src', 'feature.js'), 'export const ok = true;\n');
  await writeFile(path.join(repo, 'tests', 'feature.test.js'), 'import test from "node:test";\ntest("ok", () => {});\n');

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'unit',
    '--status', 'pass',
    '--command', 'npm test -- tests/feature.test.js',
    '--summary', 'unit passed'
  ])).exitCode, 0);
  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'typecheck',
    '--status', 'pass',
    '--command', 'npm run typecheck',
    '--summary', 'typecheck passed'
  ])).exitCode, 0);
  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'fail',
    '--command', 'npm run test:e2e',
    '--summary', 'button did not navigate'
  ])).exitCode, 0);

  const evidence = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'verification-evidence.json'));
  assert.equal(evidence.commands.some((command) => command.kind === 'typecheck' && command.summary === 'typecheck passed'), true);
  assert.equal(evidence.commands.some((command) => command.kind === 'integration' && command.summary === 'typecheck passed'), false);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  assert.equal(result.exitCode, 0);
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
  const unitGate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:unit');
  const integrationGate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:integration');
  const e2eGate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(unitGate.status, 'passed');
  assert.match(unitGate.reason, /unit passed/);
  assert.equal(integrationGate.status, 'passed');
  assert.match(integrationGate.reason, /typecheck passed/);
  assert.equal(e2eGate.status, 'failed');
  assert.match(e2eGate.reason, /button did not navigate/);
  assert.equal(prepare.pr_context.completion_quality.required_evidence.some((item) => item.includes('E2E experience: failed')), true);
});

test('pr prepare rejects stale verification evidence recorded before a dirty UI change', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), 'export default function Page() { return <button>Save</button>; }\n');

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npm run test:e2e',
    '--summary', 'E2E passed before final UI edit'
  ])).exitCode, 0);

  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), 'export default function Page() { return <button>Save changes</button>; }\n');

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);

  assert.equal(result.exitCode, 0);
  const e2eGate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(e2eGate.status, 'needs_evidence');
  assert.match(e2eGate.evidence.binding.reason, /dirty worktree fingerprint/);
  assert.equal(result.result.preparation.gate_status.execution_gate.status, 'blocked');
});

test('pr prepare requires story acceptance criteria coverage in E2E specs', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
---

# PR準備

## 受け入れ基準

- [ ] ユーザーが保存ボタンを押すと完了画面へ遷移する
- [ ] APIが失敗したらエラー表示から再試行できる
`);
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), 'export default function Page() { return <button>Save</button>; }\n');

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npm run test:e2e',
    '--summary', 'E2E command passed'
  ])).exitCode, 0);

  const missingCoverageResult = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(missingCoverageResult.exitCode, 0);
  const missingCoverageGate = missingCoverageResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(missingCoverageGate.status, 'needs_evidence');
  assert.equal(missingCoverageGate.acceptance_e2e_coverage.status, 'needs_evidence');
  assert.deepEqual(missingCoverageGate.acceptance_e2e_coverage.missing_acceptance_criteria.map((item) => item.id), ['ac:1', 'ac:2']);
  assert.match(missingCoverageGate.reason, /Story E2E coverage needs evidence/);

  await mkdir(path.join(repo, 'tests', 'e2e'), { recursive: true });
  await writeFile(path.join(repo, 'tests', 'e2e', 'story-pr-prepare-main.spec.ts'), `
// story-pr-prepare ac:1
// story-pr-prepare ac:2
import { test } from '@playwright/test';
test('story-pr-prepare acceptance criteria', async () => {});
`);

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npm run test:e2e',
    '--summary', 'E2E command passed with story acceptance spec coverage'
  ])).exitCode, 0);

  const coveredResult = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(coveredResult.exitCode, 0);
  const coveredGate = coveredResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(coveredGate.status, 'passed');
  assert.equal(coveredGate.acceptance_e2e_coverage.status, 'passed');
  assert.equal(coveredGate.acceptance_e2e_coverage.covered_acceptance_criteria_count, 2);
  assert.deepEqual(coveredGate.acceptance_e2e_coverage.matched_files, ['tests/e2e/story-pr-prepare-main.spec.ts']);
});

test('pr prepare requires Visual QA evidence when UI source changes', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'components'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'components', 'PrimaryButton.tsx'), 'export function PrimaryButton() { return <button>Save</button>; }\n');

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);

  assert.equal(result.exitCode, 0);
  const visualGate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:visual_qa');
  assert.equal(visualGate.status, 'needs_evidence');
  assert.equal(result.result.preparation.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:visual_qa'), true);
});

test('pr prepare blocks new API client calls until network-aware evidence exists even when route exists', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'app', 'detail'), { recursive: true });
  const executorPath = path.join(repo, 'src', 'app', 'detail', 'searchExecutor.ts');
  await writeFile(executorPath, `
import { searchHotelsDetail } from './actions';
export async function execute(actionParams) {
  return searchHotelsDetail(actionParams);
}
`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add direct detail search caller']);
  await writeFile(executorPath, `
export async function execute(actionParams) {
  const response = await fetch('/api/detail-search', { method: 'POST', body: JSON.stringify(actionParams) });
  return response.json();
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'detail-search'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'detail-search', 'route.ts'), 'export async function POST() { return Response.json({ ok: true }); }\n');

  const result = await runCli(['pr', 'prepare', repo, '--base', 'HEAD', '--story-id', 'story-pr-prepare', '--json']);

  assert.equal(result.exitCode, 0);
  const networkGate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:network_contract');
  assert.equal(networkGate.status, 'needs_evidence');
  assert.equal(networkGate.summary.missing_route_count, 0);
  assert.equal(result.result.preparation.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:network_contract'), true);
});

test('verify record keeps verification evidence valid under concurrent writes', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-concurrent-record', '--title', 'Concurrent verification']);

  const results = await Promise.all([
    runCli([
      'verify', 'record', repo,
      '--id', 'story-concurrent-record',
      '--kind', 'unit',
      '--status', 'pass',
      '--command', 'npm test',
      '--summary', 'unit passed'
    ]),
    runCli([
      'verify', 'record', repo,
      '--id', 'story-concurrent-record',
      '--kind', 'integration',
      '--status', 'pass',
      '--command', 'npm run typecheck',
      '--summary', 'integration passed'
    ]),
    runCli([
      'verify', 'record', repo,
      '--id', 'story-concurrent-record',
      '--kind', 'e2e',
      '--status', 'pass',
      '--command', 'npm run test:e2e',
      '--summary', 'e2e passed'
    ])
  ]);

  assert.deepEqual(results.map((result) => result.exitCode), [0, 0, 0]);
  const evidence = await readJson(path.join(repo, '.vibepro', 'pr', 'story-concurrent-record', 'verification-evidence.json'));
  assert.equal(evidence.story_id, 'story-concurrent-record');
  assert.deepEqual(new Set(evidence.commands.map((command) => command.kind)), new Set(['unit', 'integration', 'e2e']));
});

test('verify record quarantines corrupt verification evidence instead of overwriting it', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-corrupt-record', '--title', 'Corrupt verification']);
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-corrupt-record');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'verification-evidence.json'), '{ "schema_version": "0.1.0" }\n{ "fragment": true');
  let stderrOutput = '';

  const result = await runCli([
    'verify', 'record', repo,
    '--id', 'story-corrupt-record',
    '--kind', 'unit',
    '--status', 'pass',
    '--command', 'npm test'
  ], {
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderrOutput, /verification evidence JSON is corrupt/);
  await assert.rejects(stat(path.join(prDir, 'verification-evidence.json')), { code: 'ENOENT' });
  const backupFile = (await readdir(prDir)).find((file) => /^verification-evidence\.json\.corrupt-.+\.bak$/.test(file));
  assert.ok(backupFile);
  assert.match(await readFile(path.join(prDir, backupFile), 'utf8'), /\{ "fragment": true/);
});

test('pr prepare flags requirement contradictions from story invariants and code states', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'stripe', 'cancel-subscription'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'STR-REQ-001-billing-cancel.md'), `---
story_id: STR-REQ-001
title: Stripe cancel keeps premium until period end
architecture_docs:
  - path: docs/architecture/ADR-billing-subscription.md
    status: required
specifications:
  - path: docs/specs/billing-subscription.md
---

# Stripe cancel keeps premium until period end

## 背景

Stripe subscription cancellation must keep premium access until current_period_end.

## 方針

キャンセル予約時は期間終了までプレミアム状態を維持する。

## 受け入れ基準

- [x] premium userType is kept until current_period_end
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'billing-subscription.md'), `# Billing Subscription Spec

## Acceptance Criteria

- Subscription cancellation must keep premium access until current_period_end.
- Missing subscription must never downgrade a premium user before current_period_end.
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'ADR-billing-subscription.md'), `# Billing Subscription Boundary

## 方針

- Billing route must keep HTTP response mapping separate from subscription state transition policy.
- Subscription state transitions shall be handled in the billing service boundary.
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'stripe', 'cancel-subscription', 'route.ts'), `
export async function POST() {
  if (!subscriptionId) {
    return Response.json({ data: { userType: 1, message: 'free now' } });
  }
  return Response.json({ data: { userType: 2, currentPeriodEnd: '2026-06-01' } });
}
`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'refactor: split billing cancel route']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);

  assert.equal(result.exitCode, 0);
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
  assert.equal(prepare.pr_context.requirement_consistency.status, 'contradicted');
  assert.equal(prepare.pr_context.requirement_consistency.contradictions.length, 1);
  assert.equal(prepare.pr_context.requirement_consistency.requirement_sources.some((source) => source.kind === 'spec'), true);
  assert.equal(prepare.pr_context.requirement_consistency.requirement_sources.some((source) => source.kind === 'architecture'), true);
  assert.equal(prepare.pr_context.requirement_consistency.invariants.some((invariant) => invariant.source.kind === 'spec'), true);
  assert.equal(prepare.pr_context.requirement_consistency.invariants.some((invariant) => invariant.source.kind === 'architecture'), true);
  assert.equal(prepare.pr_context.gate_dag.summary.requirement_status, 'contradicted');
  assert.equal(prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:requirement').status, 'contradicted');
  assert.equal(prepare.pr_context.risks.some((risk) => risk.includes('Requirement Gate')), true);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /Potential Contradiction/);
  assert.match(prBody, /Spec Sources: 1/);
  assert.match(prBody, /Architecture Sources: 1/);
  assert.match(prBody, /Requirement Source: spec:docs\/specs\/billing-subscription.md/);
  assert.match(prBody, /Requirement Source: architecture:docs\/architecture\/ADR-billing-subscription.md/);
  assert.match(prBody, /期間終了までpremium維持/);
});

test('pr prepare extracts invariants from story_id matched Spec and ADR sources', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'actions'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'specs', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
architecture_ref: docs/architecture/ADR-story-pr-prepare.md
---

# PR準備 Spec

## 受け入れ基準

- 同一ユーザー・同一項目はリスト上で重複表示されない。
- 追加時は現在状態を1件に正規化する。
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'ADR-story-pr-prepare.md'), `---
story_id: story-pr-prepare
spec_ref: docs/specs/story-pr-prepare.md
---

# ADR: PR準備

## Decision

- UIアクションは履歴追加ではなく現在状態トグルとして扱う。
- 履歴分析が必要な場合は現在状態と履歴記録を分離する。

## Consequences

- 責務境界を越える変更ではADR更新要否を確認する。
`);
  await writeFile(path.join(repo, 'src', 'lib', 'actions', 'item_actions.ts'), `
export async function updateVisited(isAdd: boolean) {
  if (isAdd) {
    return { isVisited: true };
  }
  return { isVisited: false };
}
`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'fix: update visited state']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);

  assert.equal(result.exitCode, 0);
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
  const requirement = prepare.pr_context.requirement_consistency;
  assert.equal(requirement.requirement_sources.some((source) => source.kind === 'spec' && source.matched_by_story_id), true);
  assert.equal(requirement.requirement_sources.some((source) => source.kind === 'architecture' && source.matched_by_story_id), true);
  assert.equal(requirement.summary.spec_ref_count, 1);
  assert.equal(requirement.summary.architecture_ref_count, 1);
  assert.equal(requirement.invariants.some((invariant) => invariant.source.kind === 'spec' && /重複表示されない/.test(invariant.text)), true);
  assert.equal(requirement.invariants.some((invariant) => invariant.source.kind === 'architecture' && /現在状態トグルとして扱う/.test(invariant.text)), true);
  assert.equal(requirement.invariants.some((invariant) => invariant.source.kind === 'architecture' && /分離する/.test(invariant.text)), true);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /Spec Sources: 1/);
  assert.match(prBody, /Architecture Sources: 1/);
});

test('pr prepare treats internal spec clauses as coverage for changed source scenario gaps', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'app', 'account'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'account', 'page.tsx'), `
export function AccountPanel({ session, customer }) {
  if (!session?.user) {
    return 'sign in required';
  }
  if (customer.cancelAtPeriodEnd) {
    return 'premium until period end';
  }
  return 'active';
}
`);
  await writeInferredSpec(repo, 'story-pr-prepare', {
    schema_version: '0.1.0',
    story_id: 'story-pr-prepare',
    generated_at: '2026-05-16T00:00:00.000Z',
    clauses: [
      {
        id: 'INV-001',
        type: 'invariant',
        statement: 'The AccountPanel session.user branch must block unauthenticated access before customer state is shown.',
        origin: {
          code_refs: [
            { file: 'src/app/account/page.tsx', anchor: 'session?.user' }
          ]
        },
        verifiable_by: {
          code_pattern: [
            { file_glob: 'src/app/account/page.tsx', must_contain: 'session?.user' }
          ]
        }
      },
      {
        id: 'INV-002',
        type: 'invariant',
        statement: 'The customer.cancelAtPeriodEnd branch must keep premium access visible until the billing period ends.',
        origin: {
          code_refs: [
            { file: 'src/app/account/page.tsx', anchor: 'customer.cancelAtPeriodEnd' }
          ]
        },
        verifiable_by: {
          code_pattern: [
            { file_glob: 'src/app/account/page.tsx', must_contain: 'customer.cancelAtPeriodEnd' }
          ]
        }
      }
    ]
  });
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: implement account state panel']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);

  assert.equal(result.exitCode, 0);
  const requirement = result.result.preparation.pr_context.requirement_consistency;
  assert.equal(requirement.status, 'pass');
  assert.equal(requirement.summary.invariant_count, 2);
  assert.equal(requirement.summary.scenario_gap_count, 0);
  const gate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:requirement');
  assert.equal(gate.status, 'passed');
});

test('pr prepare classifies implementation guards and documented inherited behavior without product-specific rules', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'session'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'session', 'runtime.js'), `
export function sendInput(controller, session) {
  if (typeof controller.terminalIo?.repairCollapsedSessionWindow !== 'function') {
    return { status: 204 };
  }
  if (session.workspaceRotationStatus === 'rotating') {
    return { status: 409 };
  }
  if (session.workspaceRotationStatus === 'blocked') {
    return { status: 409 };
  }
  return { status: 200 };
}

export function patchState(req) {
  if (req.body.sessions !== undefined) {
    return req.body.sessions;
  }
  return [];
}
`);
  await writeFile(path.join(repo, 'src', 'session', 'archive-finalizer.js'), `
export function finalizeArchive(session, sessionId) {
  if (session.intendedState !== 'archived' || session.archive?.status) {
    return false;
  }
  if (this._running.has(sessionId)) {
    return false;
  }
  if (typeof this.stateStore.patchSession === 'function') {
    return true;
  }
  if (session.id !== sessionId) {
    return false;
  }
  return true;
}
`);
  await writeInferredSpec(repo, 'story-pr-prepare', {
    schema_version: '0.1.0',
    story_id: 'story-pr-prepare',
    generated_at: '2026-05-16T00:00:00.000Z',
    clauses: [
      {
        id: 'INV-001',
        type: 'invariant',
        statement: 'The visible session id must remain stable while the runtime moves to the active workspace generation.',
        origin: {},
        verifiable_by: {}
      },
      {
        id: 'S-001',
        type: 'scenario',
        statement: 'Terminal input must be rejected while workspace rotation is rotating or blocked.',
        origin: {},
        verifiable_by: {}
      },
      {
        id: 'S-002',
        type: 'scenario',
        statement: 'Existing archive cleanup behavior remains inherited: archived session finalizers continue to skip non-archived sessions and duplicate running finalizers.',
        origin: {},
        verifiable_by: {}
      }
    ]
  });
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add generic rotation guards']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);

  assert.equal(result.exitCode, 0);
  const requirement = result.result.preparation.pr_context.requirement_consistency;
  assert.equal(requirement.status, 'pass');
  assert.equal(requirement.summary.scenario_gap_count, 0);
  const gate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:requirement');
  assert.equal(gate.status, 'passed');
});

test('pr prepare still flags uncovered product domain branches after generic scope classification', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'session'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'session', 'billing.js'), `
export function resolveAccess(customer) {
  if (customer.subscriptionTier === 'premium') {
    return 'premium';
  }
  return 'standard';
}
`);
  await writeInferredSpec(repo, 'story-pr-prepare', {
    schema_version: '0.1.0',
    story_id: 'story-pr-prepare',
    generated_at: '2026-05-16T00:00:00.000Z',
    clauses: [
      {
        id: 'INV-001',
        type: 'invariant',
        statement: 'The visible session id must remain stable while runtime state is refreshed.',
        origin: {},
        verifiable_by: {}
      }
    ]
  });
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add uncovered subscription branch']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);

  assert.equal(result.exitCode, 0);
  const requirement = result.result.preparation.pr_context.requirement_consistency;
  assert.equal(requirement.status, 'needs_review');
  assert.equal(requirement.summary.scenario_gap_count, 1);
  assert.match(requirement.scenario_gaps[0].evidence.condition, /subscriptionTier/);
});

test('pr prepare does not initialize or dirty an uninitialized PR branch', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: initial app']);
  await git(repo, ['switch', '-c', 'fix/form-zero-cta']);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'feature.js'), 'export const fixed = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'fix: hide zero cta']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-bug-147']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.preparation.workspace.initialized, false);
  assert.equal(result.result.preparation.workspace.artifact_location, 'temporary');
  assert.equal(result.result.preparation.story.story_id, 'story-bug-147');
  assert.equal(result.result.preparation.scope.status, 'reviewable');
  assert.equal(result.result.artifacts.json.startsWith(repo), false);
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(repo, '.vibeproignore')), { code: 'ENOENT' });
  const status = await git(repo, ['status', '--porcelain']);
  assert.equal(status.stdout, '');
});

test('pr prepare help does not run diagnostics or initialize the repository', async () => {
  const repo = await makeRepo();

  const result = await runCli(['pr', 'prepare', repo, '--help'], {
    stdout: { write: () => {} }
  });

  assert.equal(result.exitCode, 0);
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
});

test('pr prepare with explicit head excludes unrelated dirty files from changed files and scope', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-explicit-head', '--title', 'Explicit head']);
  await mkdir(path.join(repo, '.claude', 'skills', 'brainbase-infisical-env-management'), { recursive: true });
  const dirtySkillPath = path.join(repo, '.claude', 'skills', 'brainbase-infisical-env-management', 'SKILL.md');
  await writeFile(dirtySkillPath, '# Infisical\n\nInitial guidance.\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init explicit head fixture']);
  const base = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(repo, ['switch', '-c', 'feature/explicit-head']);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'feature.js'), 'export const explicitHead = true;\n');
  await git(repo, ['add', 'src/feature.js']);
  await git(repo, ['commit', '-m', 'feat: add explicit head feature']);
  const head = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(dirtySkillPath, '# Infisical\n\nDirty local guidance.\n');

  const result = await runCli([
    'pr', 'prepare', repo,
    '--base', base,
    '--head', head,
    '--story-id', 'story-explicit-head',
    '--json'
  ]);

  assert.equal(result.exitCode, 0);
  const prepare = result.result.preparation;
  assert.deepEqual(prepare.git.changed_files.map((file) => file.path), ['src/feature.js']);
  assert.equal(prepare.git.dirty_files.some((file) => file.path === '.claude/skills/brainbase-infisical-env-management/SKILL.md'), true);
  assert.equal(prepare.git.includes_dirty_in_changed_files, false);
  assert.equal(prepare.scope.status, 'reviewable');
  assert.equal(prepare.scope.reasons.some((reason) => /未コミット差分/.test(reason)), false);
  assert.equal(prepare.file_groups.repo_control.files.includes('.claude/skills/brainbase-infisical-env-management/SKILL.md'), false);
  assert.equal(prepare.split_plan.lanes.some((lane) => lane.files.includes('.claude/skills/brainbase-infisical-env-management/SKILL.md')), false);
});

test('pr prepare recommends a clean branch for broad session diffs', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, '.claude', 'commands'), { recursive: true });
  await writeFile(path.join(repo, '.claude', 'commands', 'commit.md'), '# command');
  for (let index = 0; index < 5; index += 1) {
    await mkdir(path.join(repo, 'src', `feature-${index}`), { recursive: true });
    await writeFile(path.join(repo, 'src', `feature-${index}`, 'index.js'), `export const value = ${index};\n`);
  }
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'feature-0', source_file: 'src/feature-0/index.js' },
      { id: 'shared-security', source_file: 'src/shared/security.js' }
    ],
    edges: [
      { source: 'feature-0', target: 'shared-security', relation: 'imports' }
    ]
  }, null, 2));
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: broad session work']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--max-files', '3']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.preparation.scope.status, 'needs_clean_branch');
  assert.equal(result.result.preparation.scope.recommended_strategy, 'clean_branch_or_split_pr');
  assert.equal(result.result.preparation.file_groups.repo_control.count, 1);
  assert.equal(result.result.preparation.split_plan.status, 'split_recommended');
  assert.equal(result.result.preparation.split_plan.graph_context.available, true);
  assert.equal(result.result.preparation.split_plan.graph_context.investigation_files.includes('src/shared/security.js'), true);
  assert.equal(result.result.preparation.split_plan.lanes.some((lane) => lane.id === 'runtime-behavior' && lane.graph_investigation_files.includes('src/shared/security.js')), true);
  assert.equal(result.result.preparation.split_plan.lanes.some((lane) => lane.id === 'repo-control' && lane.files.includes('.claude/commands/commit.md')), true);
  assert.match(result.result.preparation.next_commands.join('\n'), /git switch -c feat\/pr-prepare main/);
  const splitPlan = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'split-plan.json'));
  assert.equal(splitPlan.model, 'story-pr-split-plan-v1');
  const splitPlanHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'split-plan.html'), 'utf8');
  assert.match(splitPlanHtml, /<!doctype html>/);
  assert.match(splitPlanHtml, /data-vibepro-report="split-plan"/);
  assert.match(splitPlanHtml, /class="lane-board"/);
  assert.match(splitPlanHtml, /data-lane-id="runtime-behavior"/);
  assert.match(splitPlanHtml, /Graphify Investigation Scope/);
});

test('pr prepare treats split repo-control and e2e gate lanes as reviewable', async () => {
  const e2eRepo = await makeGitRepoWithStory();
  await writeFile(path.join(e2eRepo, 'package.json'), JSON.stringify({
    scripts: {
      'test:e2e': 'playwright test'
    },
    devDependencies: {
      '@playwright/test': '^1.50.0'
    }
  }, null, 2));
  await writeFile(path.join(e2eRepo, 'playwright.config.ts'), "export default {};\n");
  await mkdir(path.join(e2eRepo, 'e2e', 'tests'), { recursive: true });
  await writeFile(path.join(e2eRepo, 'e2e', 'tests', 'smoke.spec.ts'), 'import { test } from "@playwright/test"; test("smoke", async () => {});\n');
  await git(e2eRepo, ['add', '.']);
  await git(e2eRepo, ['commit', '-m', 'test: split e2e gate lane']);

  const e2eResult = await runCli(['pr', 'prepare', e2eRepo, '--base', 'main']);

  assert.equal(e2eResult.exitCode, 0);
  assert.equal(e2eResult.result.preparation.scope.status, 'reviewable');
  assert.equal(e2eResult.result.preparation.file_groups.repo_control.count, 2);
  assert.equal(e2eResult.result.preparation.file_groups.tests.count, 1);

  const repoControlRepo = await makeGitRepoWithStory();
  await writeFile(path.join(repoControlRepo, '.gitignore'), `${await readFile(path.join(repoControlRepo, '.gitignore'), 'utf8')}\n.editorconfig\n`);
  await git(repoControlRepo, ['add', '.gitignore']);
  await git(repoControlRepo, ['commit', '-m', 'chore: split repo control lane']);

  const repoControlResult = await runCli(['pr', 'prepare', repoControlRepo, '--base', 'main']);

  assert.equal(repoControlResult.exitCode, 0);
  assert.equal(repoControlResult.result.preparation.scope.status, 'reviewable');
  assert.equal(repoControlResult.result.preparation.file_groups.repo_control.count, 1);
});

test('pr prepare avoids masked E2E scripts and detects type-check script names', async () => {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: {
      test: 'vitest run',
      'type-check': 'tsc --noEmit',
      'test:e2e': "playwright test && pkill -f 'next dev' || true"
    },
    devDependencies: {
      '@playwright/test': '^1.50.0',
      typescript: '^5.9.0',
      vitest: '^3.0.0'
    }
  }, null, 2));
  await writeFile(path.join(repo, 'playwright.config.ts'), "export default { globalTeardown: './e2e/global-teardown.ts' };\n");
  await mkdir(path.join(repo, 'e2e'), { recursive: true });
  await writeFile(path.join(repo, 'e2e', 'global-teardown.ts'), 'export default async function teardown() { process.exit(0); }\n');
  await mkdir(path.join(repo, 'e2e', 'tests'), { recursive: true });
  await writeFile(path.join(repo, 'e2e', 'tests', 'smoke.spec.ts'), 'import { test } from "@playwright/test"; test("smoke", async () => {});\n');
  await mkdir(path.join(repo, 'src', 'feature'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'feature', 'typed.ts'), 'export const value: string = "ok";\n');
  await writeFile(path.join(repo, 'src', 'feature', 'typed.test.ts'), 'import "./typed";\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: typed feature']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);

  assert.equal(result.exitCode, 0);
  const prepare = result.result.preparation;
  const integrationGate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:integration');
  const e2eGate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(integrationGate.command, 'npm run type-check');
  assert.equal(prepare.pr_context.verification_commands.some((item) => item.kind === 'unit' && item.command === 'npm test -- src/feature/typed.test.ts'), true);
  assert.equal(prepare.pr_context.verification_commands.some((item) => item.kind === 'typecheck' && item.command === 'npm run type-check'), true);
  assert.equal(prepare.file_groups.repo_control.files.includes('playwright.config.ts'), true);
  assert.equal(prepare.file_groups.tests.files.includes('e2e/global-teardown.ts'), true);
  assert.equal(prepare.file_groups.tests.files.includes('e2e/tests/smoke.spec.ts'), true);
  assert.equal(prepare.pr_context.verification_commands.some((item) => item.kind === 'unit' && item.command.includes('e2e/tests/smoke.spec.ts')), false);
  assert.equal(e2eGate.command, 'npx playwright test e2e/tests/smoke.spec.ts --project=chromium');
  assert.equal(e2eGate.status, 'needs_setup');
  assert.match(e2eGate.reason, /差分に含まれるE2E specへスコープ/);
  assert.match(e2eGate.reason, /global-teardown\.ts が process\.exit\(0\)/);
  assert.equal(prepare.split_plan.stacked_gate_plan.summary.requires_cumulative_e2e, true);
  const e2eLanePlan = prepare.split_plan.stacked_gate_plan.lane_plans.find((lane) => lane.lane_id === 'e2e-gate');
  assert.equal(e2eLanePlan.gate_mode, 'cumulative_after_dependencies');
  assert.equal(e2eLanePlan.depends_on.includes('runtime-behavior'), true);
  assert.equal(e2eLanePlan.cumulative_checks.includes('npx playwright test e2e/tests/smoke.spec.ts --project=chromium'), true);
  assert.equal(prepare.split_plan.stacked_gate_plan.final_validation.required, true);
  assert.equal(prepare.split_plan.merge_order.indexOf('runtime-behavior') < prepare.split_plan.merge_order.indexOf('e2e-gate'), true);
});

test('story task generator groups admin API routes by domain', () => {
  const taskState = buildStoryTaskState({
    story: { story_id: 'story-admin-hardening', title: '管理API保護' },
    runId: '2026-04-30Tadmin-groups',
    gateStatus: 'block',
    evidence: {
      findings: [],
      action_candidates: [{
        id: 'VP-ACTION-API-001',
        finding_id: 'VP-API-001',
        title: '管理APIの保護境界を修正する',
        severity: 'High',
        execution_policy: 'proposal_only',
        mutates_repository: false,
        implementation_plan: {
          priority: 'high',
          read_first_files: [
            { file: 'src/app/api/admin/queue/status/route.ts', reason: 'queue status' },
            { file: 'src/app/api/admin/queue/obliterate/route.ts', reason: 'queue obliterate' },
            { file: 'src/app/api/admin/users/route.ts', reason: 'users' }
          ],
          acceptance_criteria: ['対象グループごとに保護根拠を確認できる'],
          pre_fix_briefing: {
            recommended_strategy: { id: 'route-level-auth', reason: 'middleware除外の影響を抑える' },
            target_routes: [
              {
                route_path: '/api/admin/queue/status',
                file: 'src/app/api/admin/queue/status/route.ts',
                methods: ['GET'],
                classification: 'admin'
              },
              {
                route_path: '/api/admin/queue/obliterate',
                file: 'src/app/api/admin/queue/obliterate/route.ts',
                methods: ['POST'],
                classification: 'admin'
              },
              {
                route_path: '/api/admin/users',
                file: 'src/app/api/admin/users/route.ts',
                methods: ['GET'],
                classification: 'admin'
              }
            ]
          }
        }
      }]
    }
  });

  const task = taskState.tasks[0];
  assert.equal(task.target_groups.length, 2);
  assert.deepEqual(task.target_groups.map((group) => group.id), ['queue', 'users']);
  assert.equal(task.target_groups.find((group) => group.id === 'queue').route_count, 2);
  assert.equal(task.target_groups.find((group) => group.id === 'users').route_count, 1);
  assert.equal(task.target_groups.find((group) => group.id === 'queue').read_first_files.length, 2);
});

test('local dev scanner detects heavy dev scripts and task generator taskifies performance findings', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: {
      dev: 'concurrently "next dev" "npm:worker" "npm:worker:generation" "npm:worker:email" "npm:worker:delivery-task"',
      'dev:web': 'next dev',
      worker: 'tsx src/workers/index.ts',
      'worker:generation': 'tsx src/workers/generation.ts',
      'worker:email': 'tsx src/workers/email.ts',
      'worker:delivery-task': 'tsx src/workers/delivery-task.ts'
    },
    dependencies: {
      next: '^15.0.0',
      react: '^19.0.0'
    }
  }, null, 2));

  const localDev = await scanLocalDev(repo);

  assert.equal(localDev.heavy_dev_scripts.length, 1);
  assert.equal(localDev.heavy_dev_scripts[0].script_name, 'dev');
  assert.equal(localDev.heavy_dev_scripts[0].has_next_dev, true);
  assert.equal(localDev.heavy_dev_scripts[0].worker_script_refs, 4);
  assert.equal(localDev.runtime_probe_plan.status, 'available');
  assert.equal(localDev.runtime_probe_plan.auto_run, false);
  assert.equal(localDev.runtime_probe_plan.commands.some((command) => command.id === 'web-dev-startup'), true);

  const taskState = buildStoryTaskState({
    story: { story_id: 'story-local-perf', title: 'ローカル性能を改善する' },
    runId: '2026-05-07Tlocal-perf',
    gateStatus: 'needs_review',
    evidence: {
      local_dev: localDev,
      database_access: {
        unbounded_find_many: [{
          file: 'src/app/api/projects/route.ts',
          gate_effect: 'review'
        }]
      },
      findings: [
        {
          id: 'VP-PERF-001',
          severity: 'Medium',
          category: 'パフォーマンス',
          title: 'ローカルdev起動が複数runtimeを同時起動している',
          recommendation: 'web-only dev scriptとworker起動scriptを分離する。'
        },
        {
          id: 'VP-DB-001',
          severity: 'Medium',
          category: 'パフォーマンス',
          title: '未ページングのDB一覧取得候補がある',
          recommendation: '一覧取得に件数上限を設ける。'
        }
      ],
      action_candidates: []
    }
  });

  assert.deepEqual(taskState.tasks.map((task) => task.id), ['VP-TASK-PERF-001', 'VP-TASK-DB-001-API_PROJECTS']);
  assert.equal(taskState.tasks[0].target_files.includes('package.json'), true);
  assert.equal(taskState.tasks[1].target_files.includes('src/app/api/projects/route.ts'), true);
  assert.equal(taskState.tasks[1].target_groups[0].id, 'api-projects');
});

test('diagnose emits local dev performance findings and tasks', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: {
      dev: 'concurrently "next dev" "npm:worker" "npm:worker:generation" "npm:worker:email"',
      worker: 'tsx src/workers/index.ts',
      'worker:generation': 'tsx src/workers/generation.ts',
      'worker:email': 'tsx src/workers/email.ts'
    },
    dependencies: {
      next: '^15.0.0',
      react: '^19.0.0'
    }
  }, null, 2));
  await runCli(['init', repo, '--story-id', 'story-local-dev-performance', '--title', 'ローカルdev性能', '--view', 'dev', '--period', '2026-05']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [], links: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-05-07Tlocal-dev']);

  assert.equal(result.exitCode, 0);
  const evidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', '2026-05-07Tlocal-dev', 'evidence.json'));
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-PERF-001'), true);
  assert.equal(evidence.local_dev.heavy_dev_scripts[0].script_name, 'dev');
  assert.equal(evidence.local_dev.runtime_probe_plan.commands.length > 0, true);
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-local-dev-performance', 'tasks', 'tasks.json'));
  assert.equal(tasks.tasks.some((task) => task.id === 'VP-TASK-PERF-001'), true);
  assert.equal(tasks.tasks.find((task) => task.id === 'VP-TASK-PERF-001').target_files.includes('package.json'), true);
  const summary = await readFile(path.join(repo, '.vibepro', 'diagnostics', '2026-05-07Tlocal-dev', 'summary.md'), 'utf8');
  assert.match(summary, /重いdev script候補/);
  assert.match(summary, /runtime probe plan/);
});

test('story task generator keeps resolved finding tasks as done after re-diagnosis', () => {
  const taskState = buildStoryTaskState({
    story: { story_id: 'story-local-perf', title: 'ローカル性能を改善する' },
    runId: '2026-05-07Tresolved',
    gateStatus: 'pass',
    existingTaskState: {
      tasks: [{
        id: 'VP-TASK-PERF-001',
        source_type: 'finding',
        source_id: 'VP-PERF-001',
        finding_id: 'VP-PERF-001',
        title: 'ローカルdev起動が複数runtimeを同時起動している',
        priority: 'medium',
        status: 'todo',
        target_files: ['package.json'],
        target_routes: [],
        target_groups: [],
        read_first_files: [],
        recommended_strategy: { id: 'manual-review', reason: '分離する' },
        implementation_steps: [],
        acceptance_criteria: ['分離する']
      }]
    },
    evidence: {
      findings: [],
      action_candidates: []
    }
  });

  assert.equal(taskState.tasks.length, 1);
  assert.equal(taskState.tasks[0].id, 'VP-TASK-PERF-001');
  assert.equal(taskState.tasks[0].status, 'done');
  assert.equal(taskState.tasks[0].completion_evidence.run_id, '2026-05-07Tresolved');
});

test('story task generator splits DB findings by route and service domain', () => {
  const taskState = buildStoryTaskState({
    story: { story_id: 'story-db-perf', title: 'DB性能を改善する' },
    runId: '2026-05-07Tdb-split',
    gateStatus: 'needs_review',
    evidence: {
      database_access: {
        unbounded_find_many: [
          { file: 'src/app/api/projects/route.ts', gate_effect: 'review' },
          { file: 'src/app/api/projects/[projectId]/tasks/route.ts', gate_effect: 'review' },
          { file: 'src/app/api/analytics/project-summary/route.ts', gate_effect: 'review' },
          { file: 'src/lib/services/admin/llmUsageAnalyticsService.ts', gate_effect: 'review' }
        ]
      },
      findings: [{
        id: 'VP-DB-001',
        severity: 'Medium',
        category: 'パフォーマンス',
        title: '未ページングのDB一覧取得候補がある',
        recommendation: '一覧取得に件数上限を設ける。'
      }],
      action_candidates: []
    }
  });

  assert.deepEqual(taskState.tasks.map((task) => task.id), [
    'VP-TASK-DB-001-API_PROJECTS',
    'VP-TASK-DB-001-API_ANALYTICS',
    'VP-TASK-DB-001-SERVICES_ADMIN'
  ]);
  assert.equal(taskState.tasks[0].target_files.length, 2);
  assert.equal(taskState.tasks[0].target_groups[0].id, 'api-projects');
});

test('api boundary treats authorization header with environment secret as route protection', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'status'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'status', 'route.ts'), `
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  const apiKey = process.env.SALESTAILOR_API_KEY;
  if (!authHeader || authHeader !== \`Bearer \${apiKey}\`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: ['src/app/api/admin/queue/status/route.ts']
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  assert.equal(result.routes[0].protection.status, 'protected_by_route');
  assert.equal(result.routes[0].protection.evidence.includes('route_auth_reference'), true);
  assert.equal(result.routes[0].risk_hints.includes('privileged_route_unprotected'), false);
});

test('api boundary follows imported auth helper references for route protection', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'deals'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'deals', 'route.ts'), `
import { getUser } from '@/lib/get-user';

export async function GET() {
  const user = await getUser();
  if (!user || user.role !== 'ADMIN') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'get-user'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'get-user.ts'), `
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user;
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: ['src/app/api/admin/deals/route.ts']
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  assert.equal(result.routes[0].protection.status, 'protected_by_route');
  assert.equal(result.routes[0].protection.evidence.includes('route_auth_reference'), true);
  assert.equal(result.routes[0].protection.evidence.includes('imported_auth_helper'), true);
  assert.equal(result.routes[0].risk_hints.includes('privileged_route_unprotected'), false);
});

test('api boundary follows nested imported auth helper references for route protection', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'inquiries'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'inquiries', 'route.ts'), `
import { verifyAdminAuth } from '@/lib/utils/admin-auth';

export async function GET() {
  const authResult = await verifyAdminAuth();
  if (!authResult.success) {
    return authResult.response;
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'lib', 'utils'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'utils', 'admin-auth.ts'), `
import { getUser } from '@/lib/get-user';

export async function verifyAdminAuth() {
  const sessionUser = await getUser();
  if (!sessionUser || sessionUser.role !== 'ADMIN') {
    return { success: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { success: true, user: sessionUser };
}
`);
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'get-user.ts'), `
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user;
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: ['src/app/api/admin/inquiries/route.ts']
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  assert.equal(result.routes[0].protection.status, 'protected_by_route');
  assert.equal(result.routes[0].protection.evidence.includes('route_auth_reference'), true);
  assert.equal(result.routes[0].protection.evidence.includes('imported_auth_helper'), true);
  assert.equal(result.routes[0].risk_hints.includes('privileged_route_unprotected'), false);
});

test('api boundary follows imported debug access gate helpers for route protection', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'debug', 'session'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'debug', 'session', 'route.ts'), `
import { validateDebugAccess } from '@/lib/api/debug-access';

export async function GET() {
  const access = validateDebugAccess(await auth());
  if (access !== 'allowed') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'lib', 'api'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'api', 'debug-access.ts'), `
export function validateDebugAccess(session, env = process.env) {
  if (env.NODE_ENV === 'production' || env.DEBUG_API_ENABLED !== 'true') {
    return 'disabled';
  }
  if (!session?.user?.id) {
    return 'unauthorized';
  }
  if (Number(session.user.userType) !== 9) {
    return 'forbidden';
  }
  return 'allowed';
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: ['src/app/api/debug/session/route.ts']
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  assert.equal(result.routes[0].protection.status, 'protected_by_route');
  assert.equal(result.routes[0].protection.evidence.includes('debug_access_gate'), true);
  assert.equal(result.routes[0].protection.evidence.includes('imported_debug_gate_helper'), true);
  assert.equal(result.routes[0].risk_hints.includes('debug_route_exposed'), false);
});

test('api boundary detects webhook signature checks for Svix and token based routes', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'webhooks', 'resend'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'webhooks', 'resend', 'route.ts'), `
import { Webhook } from 'svix';

export async function POST(request) {
  const webhook = new Webhook(process.env.RESEND_WEBHOOK_SECRET);
  const payload = await request.text();
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');
  webhook.verify(payload, {
    'svix-id': svixId ?? '',
    'svix-timestamp': svixTimestamp ?? '',
    'svix-signature': svixSignature ?? ''
  });
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'webhooks', 'timerex'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'webhooks', 'timerex', 'route.ts'), `
import { verifyTimerexWebhookSignature } from '@/lib/services/timerex';

export async function POST(request) {
  const webhookHeaderName = 'x-timerex-authorization';
  const expectedWebhookToken = process.env.TIMEREX_WEBHOOK_DEFAULT_TOKEN;
  const actualWebhookToken = request.headers.get(webhookHeaderName);
  if (!verifyTimerexWebhookSignature({ actualToken: actualWebhookToken, expectedToken: expectedWebhookToken })) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: [
          'src/app/api/webhooks/resend/route.ts',
          'src/app/api/webhooks/timerex/route.ts'
        ]
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  for (const route of result.routes) {
    assert.equal(route.protection.status, 'protected_by_route');
    assert.equal(route.protection.evidence.includes('webhook_signature_check'), true);
    assert.equal(route.risk_hints.includes('webhook_signature_not_detected'), false);
  }
});

test('api boundary follows imported provider webhook signature helpers', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'openai', 'webhook', 'response'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'openai', 'webhook', 'response', 'route.ts'), `
import { verifyOpenAIWebhook } from '@/lib/api/webhookSecurity';

export async function POST(request) {
  const rawBody = await request.text();
  const verification = await verifyOpenAIWebhook(request, rawBody);
  if (!verification.ok) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'twilio', 'webhook', 'voice'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'twilio', 'webhook', 'voice', 'route.ts'), `
import { verifyTwilioFormWebhook } from '@/lib/api/webhookSecurity';

export async function POST(request) {
  const formData = await request.formData();
  const verification = await verifyTwilioFormWebhook(request, formData);
  if (!verification.ok) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'lib', 'api'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'api', 'webhookSecurity.ts'), `
export async function verifyOpenAIWebhook(request, rawBody, env = process.env) {
  if (!env.OPENAI_WEBHOOK_SECRET) return { ok: false };
  const headers = Object.fromEntries(request.headers.entries());
  const client = {
    webhooks: {
      verifySignature: async () => true
    }
  };
  await client.webhooks.verifySignature(rawBody, headers, { secret: env.OPENAI_WEBHOOK_SECRET });
  return { ok: true };
}

export async function verifyTwilioFormWebhook(request, formData, env = process.env) {
  const signature = request.headers.get('x-twilio-signature');
  const twilio = {
    validateRequest: () => true
  };
  return twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, request.url, Object.fromEntries(formData.entries()))
    ? { ok: true }
    : { ok: false };
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: [
          'src/app/api/openai/webhook/response/route.ts',
          'src/app/api/twilio/webhook/voice/route.ts'
        ]
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  for (const route of result.routes) {
    assert.equal(route.classification, 'webhook');
    assert.equal(route.protection.status, 'protected_by_route');
    assert.equal(route.protection.evidence.includes('webhook_signature_check'), true);
    assert.equal(route.protection.evidence.includes('imported_signature_helper'), true);
    assert.equal(route.protection.evidence.includes('imported_webhook_signature_helper'), true);
    assert.equal(route.risk_hints.includes('webhook_signature_not_detected'), false);
  }
});

test('network contract scanner detects Aitle-style API route regression and clears after route exists', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'detail', '_components', 'hooks', 'utils'), { recursive: true });
  const executorPath = path.join(repo, 'src', 'app', '(app)', 'detail', '_components', 'hooks', 'utils', 'searchExecutor.ts');
  await writeFile(executorPath, `
import { searchHotelsDetail } from '../actions';
export async function execute(actionParams) {
  return searchHotelsDetail(actionParams);
}
`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add detail search server action caller']);

  await writeFile(executorPath, `
export async function execute(actionParams) {
  const response = await fetch('/api/detail-search', {
    method: 'POST',
    body: JSON.stringify(actionParams)
  });
  return response.json();
}
`);

  const missing = await scanNetworkContracts(repo, {
    changedFiles: [{ path: 'src/app/(app)/detail/_components/hooks/utils/searchExecutor.ts', status: 'M' }],
    baseRef: 'HEAD',
    headRef: null
  });

  assert.equal(missing.status, 'block');
  assert.equal(missing.missing_routes.some((item) => item.api_path === '/api/detail-search' && item.gate_effect === 'block'), true);
  assert.equal(missing.high_risk_replacements.some((item) => item.removed_calls.includes('searchHotelsDetail')), true);

  await mkdir(path.join(repo, 'src', 'app', 'api', 'detail-search'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'detail-search', 'route.ts'), `
export async function POST(request) {
  const body = await request.json();
  return Response.json({ ok: true, body });
}
`);

  const fixed = await scanNetworkContracts(repo, {
    changedFiles: [
      { path: 'src/app/(app)/detail/_components/hooks/utils/searchExecutor.ts', status: 'M' },
      { path: 'src/app/api/detail-search/route.ts', status: 'A' }
    ],
    baseRef: 'HEAD',
    headRef: null
  });

  assert.equal(fixed.missing_routes.some((item) => item.api_path === '/api/detail-search'), false);
});

test('network contract scanner ignores external absolute URLs that contain /api/', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'components', 'mypage'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'components', 'mypage', 'AddressInfoCard.tsx'), `
export async function searchPostalCode(normalizedPostalCode) {
  const response = await fetch(
    \`https://zipcloud.ibsnet.co.jp/api/search?zipcode=\${normalizedPostalCode}\`,
  );
  return response.json();
}
`);

  const result = await scanNetworkContracts(repo, {
    changedFiles: [{ path: 'src/components/mypage/AddressInfoCard.tsx', status: 'M' }]
  });

  assert.equal(result.status, 'pass');
  assert.equal(result.api_client_calls.some((item) => item.raw_argument.includes('zipcloud.ibsnet.co.jp')), false);
  assert.equal(result.missing_routes.some((item) => item.api_path === '/api/search'), false);
  assert.equal(result.dynamic_calls.some((item) => item.api_path === '/api/search'), false);
});

test('pr prepare blocks missing route for newly introduced API client call', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'detail', '_components', 'hooks', 'utils'), { recursive: true });
  const executorPath = path.join(repo, 'src', 'app', '(app)', 'detail', '_components', 'hooks', 'utils', 'searchExecutor.ts');
  await writeFile(executorPath, `
import { searchHotelsDetail } from '../actions';
export async function execute(actionParams) {
  return searchHotelsDetail(actionParams);
}
`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add direct detail search']);
  await writeFile(executorPath, `
export async function execute(actionParams) {
  const response = await fetch('/api/detail-search', { method: 'POST', body: JSON.stringify(actionParams) });
  return response.json();
}
`);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'HEAD', '--story-id', 'story-pr-prepare', '--json']);

  assert.equal(result.exitCode, 0);
  const prepare = result.result.preparation;
  assert.equal(prepare.pr_context.network_contracts.missing_routes.some((item) => item.api_path === '/api/detail-search'), true);
  const networkGate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:network_contract');
  assert.equal(networkGate.status, 'failed');
  assert.equal(prepare.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:network_contract'), true);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /Network Contract/);
  assert.match(prBody, /\/api\/detail-search/);
});

test('task commands list show and create a pre-fix briefing without mutating repository code', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'status'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'status', 'route.ts'), 'export async function GET() { return Response.json({ ok: true }); }\n');
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'obliterate'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'obliterate', 'route.ts'), 'export async function POST() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'middleware.ts'), `
export const config = {
  matcher: ['/((?!api|_next/static).*)']
};
export function middleware() {}
`);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'queue-status', source_file: 'src/app/api/admin/queue/status/route.ts', community: 1 },
      { id: 'queue-obliterate', source_file: 'src/app/api/admin/queue/obliterate/route.ts', community: 1 }
    ],
    links: [{ source: 'queue-status', target: 'queue-obliterate', relation: 'same_domain', confidence: 'INFERRED' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', 'run-task-cli']);

  let listOutput = '';
  const listResult = await runCli(['task', 'list', repo], {
    stdout: { write: (text) => { listOutput += text; } }
  });
  assert.equal(listResult.exitCode, 0);
  assert.match(listOutput, /# Story Tasks/);
  assert.match(listOutput, /VP-TASK-API-001/);
  assert.match(listOutput, /queue\(2\)/);

  let showOutput = '';
  const showResult = await runCli(['task', 'show', repo, '--task', 'VP-TASK-API-001'], {
    stdout: { write: (text) => { showOutput += text; } }
  });
  assert.equal(showResult.exitCode, 0);
  assert.match(showOutput, /## Target Groups/);
  assert.match(showOutput, /queue/);

  const briefResult = await runCli(['task', 'brief', repo, '--task', 'VP-TASK-API-001', '--group', 'queue']);
  assert.equal(briefResult.exitCode, 0);
  assert.equal(briefResult.result.briefing.task.id, 'VP-TASK-API-001');
  assert.equal(briefResult.result.briefing.group.id, 'queue');
  assert.equal(briefResult.result.briefing.mutates_repository, false);
  assert.equal(briefResult.result.artifacts.markdown, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/briefing.md');
  const briefingJson = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'briefing.json'));
  assert.equal(briefingJson.target_routes.length, 2);
  assert.equal(briefingJson.read_first_files.some((item) => item.file === 'src/app/api/admin/queue/status/route.ts'), true);
  assert.equal(briefingJson.guardrails.includes('このCLIは対象リポジトリのコードを修正しない'), true);
  const briefingMarkdown = await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'briefing.md'), 'utf8');
  assert.match(briefingMarkdown, /# 修正前ブリーフィング/);
  assert.match(briefingMarkdown, /このCLIは対象リポジトリのコードを修正しない/);
  assert.match(briefingMarkdown, /\/api\/admin\/queue\/status/);

  const planResult = await runCli(['task', 'plan', repo, '--task', 'VP-TASK-API-001', '--group', 'queue']);
  assert.equal(planResult.exitCode, 0);
  assert.equal(planResult.result.plan.mode, 'implementation_plan');
  assert.equal(planResult.result.plan.execution.cli_mutates_repository, false);
  assert.equal(planResult.result.plan.execution.plan_allows_repository_changes, true);
  assert.equal(planResult.result.plan.target_files.length, 2);
  assert.equal(planResult.result.artifacts.markdown, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/plan.md');
  const planJson = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'plan.json'));
  assert.equal(planJson.verification_commands.some((command) => command.command === 'npx vibepro diagnose . --run-id verify-VP-TASK-API-001-queue'), true);
  assert.equal(planJson.rollback_considerations.some((item) => item.includes('対象ファイル単位')), true);
  const planMarkdown = await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'plan.md'), 'utf8');
  assert.match(planMarkdown, /# 実装修正計画/);
  assert.match(planMarkdown, /このplanは修正可能な作業計画/);
  assert.match(planMarkdown, /CLI自身は対象リポジトリのコードを変更しない/);

  const handoffResult = await runCli(['task', 'handoff', repo, '--task', 'VP-TASK-API-001', '--group', 'queue']);
  assert.equal(handoffResult.exitCode, 0);
  assert.equal(handoffResult.result.handoff.mode, 'implementation_handoff');
  assert.equal(handoffResult.result.handoff.execution.vibepro_mutates_repository, false);
  assert.equal(handoffResult.result.handoff.execution.recipient_may_mutate_repository, true);
  assert.equal(handoffResult.result.handoff.references.briefing_json, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/briefing.json');
  assert.equal(handoffResult.result.handoff.references.plan_json, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/plan.json');
  assert.equal(handoffResult.result.artifacts.markdown, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/handoff.md');
  const handoffJson = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'handoff.json'));
  assert.equal(handoffJson.target_files.length, 2);
  assert.equal(handoffJson.target_routes[0].protection_status, 'excluded_by_middleware');
  assert.equal(handoffJson.current_protection.route_statuses.excluded_by_middleware, 2);
  assert.equal(handoffJson.expected_fix_signals.includes('対象routeのprotection_statusがprotected_by_routeまたはprotected_by_middlewareになる'), true);
  assert.equal(handoffJson.environment_assumptions.some((item) => item.includes('npx vibepro')), true);
  assert.equal(handoffJson.implementation_instructions.some((item) => item.includes('plan.md')), true);
  assert.equal(handoffJson.prohibited_actions.some((item) => item.includes('対象グループ外')), true);
  const handoffMarkdown = await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'handoff.md'), 'utf8');
  assert.match(handoffMarkdown, /# 実装依頼パッケージ/);
  assert.match(handoffMarkdown, /VibeProは実装を実行しない/);
  assert.match(handoffMarkdown, /修正はhandoffを受けた人間\/AIが行う/);
  assert.match(handoffMarkdown, /## 対象route/);
  assert.match(handoffMarkdown, /protection=excluded_by_middleware/);
  assert.match(handoffMarkdown, /## 期待する修正後シグナル/);
  assert.match(handoffMarkdown, /npx vibepro/);

  const executionResult = await runCli(['task', 'execute', repo, '--task', 'VP-TASK-API-001', '--group', 'queue', '--base', 'origin/develop']);
  assert.equal(executionResult.exitCode, 0);
  assert.equal(executionResult.result.execution.mode, 'task_execution_session');
  assert.equal(executionResult.result.execution.execution.vibepro_mutates_repository, false);
  assert.equal(executionResult.result.execution.execution.implementation_agent_may_mutate_repository, true);
  assert.equal(executionResult.result.execution.commands.pr_prepare, 'npx vibepro pr prepare . --story-id story-vibepro-diagnosis-commercialization-roadmap --task VP-TASK-API-001 --group queue --base origin/develop');
  assert.equal(executionResult.result.execution.commands.pr_create, 'npx vibepro pr create . --story-id story-vibepro-diagnosis-commercialization-roadmap --task VP-TASK-API-001 --group queue --base origin/develop');
  assert.equal(executionResult.result.execution.phases.some((phase) => phase.id === 'prepare_pr'), true);
  const executionJson = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'execution.json'));
  assert.equal(executionJson.references.handoff_json, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/handoff.json');
  const executionMarkdown = await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'execution.md'), 'utf8');
  assert.match(executionMarkdown, /# 実行セッション/);
  assert.match(executionMarkdown, /PR接続/);
});

test('diagnose binds runs to selected story and brainbase prefers the selected story run', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-alpha', '--title', 'Alpha', '--view', 'dev']);
  await runCli(['story', 'add', repo, '--id', 'story-beta', '--title', 'Beta', '--view', 'dev']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);
  await runCli(['diagnose', repo, '--run-id', 'run-alpha']);
  await runCli(['story', 'select', repo, '--id', 'story-beta']);
  await runCli(['diagnose', repo, '--run-id', 'run-beta']);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);

  const result = await runCli(['brainbase', repo]);

  assert.equal(result.exitCode, 0);
  const alphaEvidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', 'run-alpha', 'evidence.json'));
  assert.equal(alphaEvidence.story_id, 'story-alpha');
  assert.equal(alphaEvidence.story.story_id, 'story-alpha');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_run, 'run-beta');
  assert.equal(manifest.runs[0].story_id, 'story-beta');
  assert.equal(manifest.runs[1].story_id, 'story-alpha');
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.story.story_id, 'story-alpha');
  assert.equal(importState.latest_run.run_id, 'run-alpha');
  assert.equal(importState.latest_run.story_id, 'story-alpha');
  assert.equal(manifest.brainbase.last_export.story_id, 'story-alpha');
  assert.equal(manifest.brainbase.last_export.latest_run_story_id, 'story-alpha');
});

test('story runs and status show selected story diagnosis history', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-alpha', '--title', 'Alpha', '--view', 'dev']);
  await runCli(['story', 'add', repo, '--id', 'story-beta', '--title', 'Beta', '--view', 'dev']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);
  await runCli(['diagnose', repo, '--run-id', 'run-alpha']);
  await runCli(['story', 'select', repo, '--id', 'story-beta']);
  await runCli(['diagnose', repo, '--run-id', 'run-beta']);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);

  let runsOutput = '';
  const runsResult = await runCli(['story', 'runs', repo], {
    stdout: { write: (text) => { runsOutput += text; } }
  });

  assert.equal(runsResult.exitCode, 0);
  assert.equal(runsResult.result.story.story_id, 'story-alpha');
  assert.equal(runsResult.result.runs.length, 1);
  assert.match(runsOutput, /run-alpha/);
  assert.doesNotMatch(runsOutput, /run-beta/);

  let statusOutput = '';
  const statusResult = await runCli(['story', 'status', repo], {
    stdout: { write: (text) => { statusOutput += text; } }
  });

  assert.equal(statusResult.exitCode, 0);
  assert.equal(statusResult.result.story.story_id, 'story-alpha');
  assert.equal(statusResult.result.latestRun.run_id, 'run-alpha');
  assert.equal(statusResult.result.findingCount, 0);
  assert.match(statusOutput, /Story ID \| story-alpha/);
  assert.match(statusOutput, /Latest run \| run-alpha/);
  assert.match(statusOutput, /Gate \| pass/);
  assert.match(statusOutput, /Findings \| 0/);
  assert.match(statusOutput, /\.vibepro\/diagnostics\/run-alpha\/evidence.json/);
});

test('story report creates a Story diagnosis report artifact', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-alpha', '--title', 'Alpha', '--view', 'dev', '--period', '2026-W18']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);
  await runCli(['diagnose', repo, '--run-id', 'run-alpha']);

  const result = await runCli(['story', 'report', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.story.story_id, 'story-alpha');
  assert.equal(result.result.reportPath.endsWith(path.join('.vibepro', 'stories', 'story-alpha', 'story-report.md')), true);
  const report = await readFile(path.join(repo, '.vibepro', 'stories', 'story-alpha', 'story-report.md'), 'utf8');
  assert.match(report, /# Story診断レポート/);
  assert.match(report, /Story ID \| story-alpha/);
  assert.match(report, /Run ID \| run-alpha/);
  assert.match(report, /Gate \| needs_review/);
  assert.match(report, /graphify nodes \| 2/);
  assert.match(report, /VP-GRAPH-001/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.stories['story-alpha'].latest_report, '.vibepro/stories/story-alpha/story-report.md');
});

test('story diagnose runs the local story workflow in one command', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-alpha', '--title', 'Alpha', '--view', 'dev']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  let output = '';

  const result = await runCli(['story', 'diagnose', repo, '--id', 'story-alpha', '--run-id', 'run-alpha'], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.story.story_id, 'story-alpha');
  assert.equal(result.result.diagnosis.run.run_id, 'run-alpha');
  assert.match(output, /Story selected: story-alpha/);
  assert.match(output, /graphify artifacts imported/);
  assert.match(output, /diagnosis created/);
  assert.match(output, /Story report created/);
  assert.match(output, /# Story Status/);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.current_story_id, 'story-alpha');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_run_by_story['story-alpha'], 'run-alpha');
  assert.equal(manifest.stories['story-alpha'].latest_report, '.vibepro/stories/story-alpha/story-report.md');
});

test('diagnose preserves plan-derived story tasks and writes run tasks separately', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', 'session'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', 'session', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'), 'export function LoginForm() { return null; }\n');
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'login', source_file: 'src/components/auth/LoginForm.tsx' }],
    edges: [{ source: 'login', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }]
  }));
  await runCli(['story', 'derive', repo]);
  await runCli(['story', 'plan', repo]);
  await runCli(['task', 'create', repo, '--from-plan', '--id', 'story-product-auth-account-access']);
  const canonicalTasksPath = path.join(repo, '.vibepro', 'stories', 'story-product-auth-account-access', 'tasks', 'tasks.json');
  const beforeTasks = await readJson(canonicalTasksPath);
  assert.equal(beforeTasks.source_run.run_id, 'story-plan');
  assert.equal(beforeTasks.tasks.some((task) => task.id === 'story-product-auth-account-access-spec-recovery'), true);

  await runCli(['story', 'select', repo, '--id', 'story-product-auth-account-access']);
  await runCli(['diagnose', repo, '--run-id', 'run-detail']);

  const afterTasks = await readJson(canonicalTasksPath);
  assert.equal(afterTasks.source_run.run_id, 'story-plan');
  assert.equal(afterTasks.tasks.some((task) => task.id === 'story-product-auth-account-access-spec-recovery'), true);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.runs[0].artifacts.story_tasks_json, '.vibepro/stories/story-product-auth-account-access/diagnostics/run-detail/tasks.json');
  const runTasks = await readJson(path.join(repo, manifest.runs[0].artifacts.story_tasks_json));
  assert.equal(runTasks.source_run.run_id, 'run-detail');
  assert.equal(runTasks.tasks.some((task) => task.id === 'story-product-auth-account-access-spec-recovery'), false);
});

test('status reports an uninitialized repository without creating a workspace', async () => {
  const repo = await makeRepo();
  let output = '';

  const result = await runCli(['status', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.status.initialized, false);
  assert.match(output, /# VibePro Status/);
  assert.match(output, /Initialized \| no/);
  assert.match(output, /vibepro init/);
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
});

test('status reports initialized repositories with no active stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'archive', repo, '--id', 'story-vibepro-diagnosis-commercialization-roadmap']);
  let output = '';

  const result = await runCli(['status', repo, '--json'], {
    stdout: { write: (text) => { output += text; } }
  });

  const status = JSON.parse(output);
  assert.equal(result.exitCode, 0);
  assert.equal(status.initialized, true);
  assert.equal(status.active_stories.length, 0);
  assert.match(status.next_commands[0], /story add/);
});

test('status surfaces doctor maintenance before the next workflow command', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-alpha', '--title', 'Alpha']);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.brainbase.current_story_id = 'missing-story';
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runCli(['status', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.status.doctor.overall_status, 'needs_maintenance');
  assert.equal(result.status.doctor.blocking_check_ids.includes('VP-DOCTOR-CURRENT-STORY-MISSING'), true);
  assert.equal(result.status.doctor.next_actions[0].command, `vibepro doctor ${repo} --fix`);
  assert.equal(result.status.next_commands[0], `vibepro doctor ${repo} --fix`);
  await assert.rejects(stat(path.join(repo, '.vibepro', 'doctor', 'doctor-result.json')), { code: 'ENOENT' });
});

test('status reports repository diagnosis state as text and json', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-alpha', '--title', 'Alpha', '--view', 'dev', '--period', '2026-W18']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['story', 'diagnose', repo, '--id', 'story-alpha', '--run-id', 'run-alpha']);
  let output = '';

  const result = await runCli(['status', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.status.initialized, true);
  assert.equal(result.status.current_story_id, 'story-alpha');
  assert.equal(result.status.latest_run.run_id, 'run-alpha');
  assert.equal(result.status.selected_story_latest_run.run_id, 'run-alpha');
  assert.equal(result.status.gate_status, 'needs_review');
  assert.equal(result.status.finding_count, 1);
  assert.match(output, /Selected Story \| story-alpha/);
  assert.match(output, /Latest Run \| run-alpha/);
  assert.match(output, /Selected Story Latest Run \| run-alpha/);
  assert.match(output, /Gate \| needs_review/);
  assert.match(output, /Findings \| 1/);
  assert.match(output, /story report/);

  let jsonOutput = '';
  const jsonResult = await runCli(['status', repo, '--json'], {
    stdout: { write: (text) => { jsonOutput += text; } }
  });
  const status = JSON.parse(jsonOutput);
  assert.equal(jsonResult.exitCode, 0);
  assert.equal(status.initialized, true);
  assert.equal(status.current_story_id, 'story-alpha');
  assert.equal(status.active_stories[0].story_id, 'story-alpha');
  assert.equal(status.latest_run.run_id, 'run-alpha');
  assert.equal(status.selected_story_latest_run.run_id, 'run-alpha');
  assert.equal(status.artifacts.evidence, '.vibepro/diagnostics/run-alpha/evidence.json');
});

test('diagnose creates a run, evidence, reports, and updates the manifest', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(graphDir, { recursive: true }));
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    links: [
      { source: 'app', target: 'api', relation: 'calls', confidence: 'EXTRACTED' },
      { source: 'api', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }
    ]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-04-28T120000Z']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'diagnose');
  const runDir = path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T120000Z');
  await stat(path.join(runDir, 'summary.md'));
  await stat(path.join(runDir, 'risk-register.md'));
  await stat(path.join(runDir, 'requirement-consistency.md'));
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  const summary = await readFile(path.join(runDir, 'summary.md'), 'utf8');
  assert.equal(evidence.graphify.node_count, 2);
  assert.equal(evidence.graphify.edge_count, 2);
  assert.equal(evidence.graphify.edge_source_key, 'links');
  assert.equal(evidence.graphify.extracted_edges.length, 1);
  assert.equal(evidence.graphify.ambiguous_edges.length, 1);
  assert.equal(evidence.requirement_consistency.status, 'not_applicable');
  assert.equal(evidence.toolchain.package.name, 'vibepro');
  assert.match(summary, /VibePro Runtime/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_run, '2026-04-28T120000Z');
  assert.equal(manifest.runs[0].toolchain.package.name, 'vibepro');
  assert.equal(manifest.runs[0].artifacts.summary, '.vibepro/diagnostics/2026-04-28T120000Z/summary.md');
  assert.equal(manifest.runs[0].artifacts.requirement_consistency, '.vibepro/diagnostics/2026-04-28T120000Z/requirement-consistency.md');
});

test('diagnose creates static site evidence and a static site report under the run directory', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'index.html'), `<!doctype html>
<html>
  <head>
    <script src="https://cdn.example.com/app.js"></script>
    <link rel="stylesheet" href="./style.css">
  </head>
  <body>
    <button class="primary-button" data-component="button">Run</button>
    <script src="./app.js"></script>
  </body>
</html>
`);
  await writeFile(path.join(repo, 'style.css'), `
:root { --bb-surface-main: #101113; }
.primary-button {
  background: #1e293b;
  border-radius: 16px;
}
.task-action-btn {
  width: 24px;
  height: 24px;
  transition: all 0.15s ease;
}
.task-action-btn:hover { transform: translateY(-1px); }
.task-card { box-shadow: 0 24px 80px rgba(0, 0, 0, 0.3); }
`);
  await writeFile(path.join(repo, 'app.js'), `
const apiKey = "sk-123456789012345678901234";
const access_token = "runtimeReviewToken123";
const secret_key = plainsecretvalue;
const api_key = request.headers.get('x-api-key');
const accessToken = body.access_token ?? null;
const callConfig = {
  authToken: twilioAuthToken,
  apiKey: openaiConfig.apiKey!,
  access_token: accessToken
};
FireCrawlApi(api_key=firecrawl_api_key);
document.body.innerHTML = location.hash;
eval("1+1");
`);
  await mkdir(path.join(repo, '.claude', 'skills', 'security-patterns'), { recursive: true });
  await writeFile(path.join(repo, '.claude', 'skills', 'security-patterns', 'SKILL.md'), `
Example:
const apiKey = process.env.EXAMPLE_API_KEY;
element.innerHTML = userInput;
`);
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'security.md'), 'Use API_KEY="st_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" in examples only.\n');
  await writeFile(path.join(repo, 'server.py'), 'print("not a static asset")\n');
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: []
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-04-28T130000Z']);

  assert.equal(result.exitCode, 0);
  const runDir = path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T130000Z');
  await stat(path.join(runDir, 'static-site-check-result.md'));
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  assert.equal(evidence.static_site.has_index_html, true);
  assert.equal(evidence.static_site.secret_hits.length > 0, true);
  assert.equal(evidence.static_site.xss_risk_hits.length > 0, true);
  const runtimeSecret = evidence.static_site.secret_hits.find((hit) => hit.file === 'app.js');
  assert.equal(runtimeSecret.confidence, 'high');
  assert.equal(runtimeSecret.source_kind, 'runtime_code');
  assert.equal(runtimeSecret.gate_effect, 'block');
  const skillSecret = evidence.static_site.secret_hits.find((hit) => hit.file === '.claude/skills/security-patterns/SKILL.md');
  assert.equal(skillSecret.confidence, 'low');
  assert.equal(skillSecret.source_kind, 'agent_skill');
  assert.equal(skillSecret.gate_effect, 'info');
  const skillXss = evidence.static_site.xss_risk_hits.find((hit) => hit.file === '.claude/skills/security-patterns/SKILL.md');
  assert.equal(skillXss.confidence, 'low');
  assert.equal(skillXss.gate_effect, 'info');
  const dynamicSecrets = evidence.static_site.secret_hits.filter(
    (hit) => hit.file === 'app.js'
      && /request\.headers|body\.access_token|twilioAuthToken|openaiConfig\.apiKey|accessToken|firecrawl_api_key/.test(hit.excerpt)
  );
  assert.equal(dynamicSecrets.length, 6);
  assert.equal(dynamicSecrets.every((hit) => hit.gate_effect === 'info'), true);
  assert.equal(dynamicSecrets.every((hit) => hit.confidence === 'low'), true);
  const unquotedPlainSecret = evidence.static_site.secret_hits.find((hit) => hit.excerpt.includes('plainsecretvalue'));
  assert.equal(unquotedPlainSecret.gate_effect, 'review');
  assert.equal(unquotedPlainSecret.confidence, 'medium');
  assert.equal(evidence.static_site.risk_summary.secret_hits.block, 1);
  assert.equal(evidence.static_site.risk_summary.secret_hits.info, 8);
  assert.equal(evidence.static_site.risk_summary.xss_risk_hits.review, 2);
  assert.equal(evidence.static_site.risk_summary.xss_risk_hits.info, 1);
  assert.equal(evidence.static_site.external_resources.length > 0, true);
  assert.equal(evidence.static_site.non_static_files.some((item) => item.file === 'server.py'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('component-style'), true);
  assert.equal(evidence.component_style.component_kinds.includes('button'), true);
  assert.equal(evidence.component_style.component_kinds.includes('card'), true);
  assert.equal(evidence.component_style.design_system_markers.length > 0, true);
  assert.equal(evidence.component_style.legacy_style_hits.some((hit) => hit.file === 'style.css' && hit.token === '#1e293b'), true);
  assert.equal(evidence.component_style.risk_summary.legacy_style_hits.review >= 2, true);
  assert.equal(evidence.component_style.interaction_reliability_hits.some((hit) => hit.kind === 'interactive_target_moves_on_state'), true);
  assert.equal(evidence.component_style.interaction_reliability_hits.some((hit) => hit.kind === 'small_interactive_target'), true);
  assert.equal(evidence.component_style.risk_summary.interaction_reliability_hits.review, 3);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-UI-001'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-UI-002'), true);
  assert.equal(evidence.gates[0].status, 'block');
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'tasks.json'));
  assert.equal(tasks.source_run.run_id, '2026-04-28T130000Z');
  assert.equal(tasks.source_run.gate_status, 'block');
  const secretBlockTask = tasks.tasks.find((task) => task.id === 'VP-TASK-STATIC-002-BLOCK');
  const secretReviewTask = tasks.tasks.find((task) => task.id === 'VP-TASK-STATIC-002-REVIEW');
  assert.equal(secretBlockTask.priority, 'critical');
  assert.equal(secretBlockTask.source_type, 'finding');
  assert.equal(secretBlockTask.target_files.includes('app.js'), true);
  assert.equal(secretBlockTask.gate_effect, 'block');
  assert.equal(secretBlockTask.order, 10);
  assert.equal(secretBlockTask.mutates_repository, false);
  assert.equal(secretReviewTask.priority, 'high');
  assert.equal(secretReviewTask.gate_effect, 'review');
  assert.equal(secretReviewTask.target_files.includes('app.js'), true);
  assert.match(await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'tasks.md'), 'utf8'), /VP-TASK-STATIC-002-BLOCK/);
  assert.match(await readFile(path.join(runDir, 'risk-register.md'), 'utf8'), /秘密情報/);
  assert.match(await readFile(path.join(runDir, 'static-site-check-result.md'), 'utf8'), /gate_effect/);
  const componentStyleReport = await readFile(path.join(runDir, 'component-style-check-result.md'), 'utf8');
  assert.match(componentStyleReport, /旧トークン候補/);
  assert.match(componentStyleReport, /操作信頼性候補/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(
    manifest.runs[0].artifacts.static_site_check,
    '.vibepro/diagnostics/2026-04-28T130000Z/static-site-check-result.md'
  );
  assert.equal(
    manifest.runs[0].artifacts.component_style_check,
    '.vibepro/diagnostics/2026-04-28T130000Z/component-style-check-result.md'
  );
  assert.equal(
    manifest.runs[0].artifacts.story_tasks_json,
    '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/tasks.json'
  );
});

test('diagnose ignores gitignored env files and downgrades variable secret references', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await writeFile(path.join(repo, '.gitignore'), '.env\n.env.preview\n');
  await writeFile(path.join(repo, '.env'), 'OPENAI_API_KEY=sk-123456789012345678901234\n');
  await writeFile(path.join(repo, '.env.preview'), 'NEXTAUTH_SECRET=secret_1234567890abcdef\n');
  await writeFile(path.join(repo, '.env.production'), [
    'DOTENV_PUBLIC_KEY_PRODUCTION=dotenvx_public_key_1234567890123456789012345678901234567890',
    'OPENAI_API_KEY=encrypted:abc1234567890abcdef',
    'DATABASE_URL="encrypted:def1234567890abcdef"',
    ''
  ].join('\n'));
  await writeFile(path.join(repo, 'app.js'), `
const provider = new OpenAIProvider({ apiKey: openaiKey });
access_token = get_token()
const secret_key = plainsecretvalue;
`);
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: []
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-05-09T010000Z']);

  assert.equal(result.exitCode, 0);
  const evidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', '2026-05-09T010000Z', 'evidence.json'));
  assert.equal(evidence.static_site.secret_hits.some((hit) => hit.file === '.env'), false);
  assert.equal(evidence.static_site.secret_hits.some((hit) => hit.file === '.env.preview'), false);
  assert.equal(evidence.static_site.secret_hits.some((hit) => hit.file === '.env.production'), false);
  const variableReferenceHits = evidence.static_site.secret_hits.filter(
    (hit) => hit.file === 'app.js' && /openaiKey|get_token/.test(hit.excerpt)
  );
  assert.equal(variableReferenceHits.length, 2);
  assert.equal(variableReferenceHits.every((hit) => hit.gate_effect === 'info'), true);
  const hardcodedReference = evidence.static_site.secret_hits.find(
    (hit) => hit.file === 'app.js' && hit.excerpt.includes('plainsecretvalue')
  );
  assert.equal(hardcodedReference.gate_effect, 'review');
});

test('diagnose profiles a Next.js repository and selects applicable checks without static site entry findings', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-nextjs-test-'));
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: { dev: 'next dev', test: 'vitest' },
    dependencies: {
      next: '^15.0.0',
      react: '^19.0.0',
      '@prisma/client': '^6.0.0',
      pg: '^8.0.0'
    },
    devDependencies: {
      typescript: '^5.0.0',
      vitest: '^3.0.0'
    }
  }, null, 2));
  await mkdir(path.join(repo, 'src', 'app', 'api', 'companies'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', 'route.ts'), `
import { prisma } from '@/lib/db';

export async function GET() {
  const companies = await prisma.company.findMany({
    where: { active: true },
    orderBy: { createdAt: 'desc' }
  });
  return Response.json(companies);
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'accounts', '[id]'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'accounts', '[id]', 'route.ts'), `
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function GET(request, { params }) {
  const session = await auth();
  if (!session) return Response.json({}, { status: 401 });
  const events = await prisma.auditLog.findMany({
    where: { accountId: params.id },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  const account = await prisma.account.findUnique({
    where: { id: params.id }
  });
  if (account.userId !== session.user.id) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }
  return Response.json({ events });
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', 'route.test.ts'), 'import test from "node:test";\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', 'helper.ts'), 'export const helper = true;\n');
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'users'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'users', 'route.ts'), 'export async function GET() { return Response.json([]); }\n');
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'webhook-monitor'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'webhook-monitor', 'route.ts'), 'export async function GET() { return Response.json([]); }\n');
  await mkdir(path.join(repo, 'src', 'app', 'api', 'debug-env'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'debug-env', 'route.ts'), `
// auth debug endpoint: the word auth alone must not count as protection.
export async function GET() { return Response.json(process.env); }
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'webhooks', 'stripe'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'webhooks', 'stripe', 'route.ts'), `
// TODO: verify signature before handling this webhook.
export async function POST() { return Response.json({ ok: true }); }
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'internal', 'health'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'internal', 'health', 'route.ts'), `
import { auth } from '@/lib/auth';
export async function GET(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({}, { status: 401 });
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'queue', 'status'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'queue', 'status', 'route.ts'), 'export async function GET() { return Response.json({ ok: true }); }\n');
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'db.ts'), 'export const prisma = {};\n');
  await writeFile(path.join(repo, 'src', 'lib', 'queue.ts'), `
export function requireQueueAuth(request) {
  return request.headers.get('authorization');
}
export function verifyQueueSignature(signature) {
  return Boolean(signature);
}
`);
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-alpha.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesAlpha() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-beta.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesBeta() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'mixed-workflow.ts'), `
import { prisma } from '@/lib/db';
import { z } from 'zod';

export async function mixedWorkflow(request) {
  const session = await auth();
  const schema = z.object({ id: z.string() });
  const input = schema.parse(await request.json());
  const company = await prisma.company.findUnique({ where: { id: input.id } });
  await fetch(process.env.WEBHOOK_URL, { method: 'POST', body: JSON.stringify(company) });
  await notifyTeam(session.user.email);
  return company;
}

${Array.from({ length: 155 }, (_, index) => `const workflowLine${index} = ${index};`).join('\n')}
`);
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), `
const api_secret = "runtimeReviewToken123";
export default function Page() { return <main>SalesTailor</main>; }
`);
  await writeFile(path.join(repo, 'src', 'middleware.ts'), `
export const config = {
  matcher: ['/api/admin/:path*', '/api/companies/:path*', '/((?!api|_next/static).*)']
};
export function middleware() {}
`);
  await writeFile(path.join(repo, '.env.local'), 'NEXTAUTH_SECRET=secret_1234567890abcdef\n');
  await writeFile(path.join(repo, 'vercel.json'), JSON.stringify({ framework: 'nextjs' }));
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'queue-route', label: 'queue route', source_file: 'src/app/api/queue/status/route.ts', community: 7 },
      { id: 'queue-handler', label: 'handleQueue()', source_file: 'src/app/api/queue/status/route.ts', community: 7 },
      { id: 'queue-service', label: 'QueueService', source_file: 'src/lib/queue.ts', community: 7 },
      { id: 'debug-route', label: 'debug route', source_file: 'src/app/api/debug-env/route.ts', community: 9 },
      { id: 'webhook-route', label: 'stripe webhook', source_file: 'src/app/api/webhooks/stripe/route.ts', community: 10 },
      { id: 'company-alpha-service', label: 'listActiveCompaniesAlpha()', source_file: 'src/lib/services/company-alpha.ts', community: 11 },
      { id: 'company-beta-service', label: 'listActiveCompaniesBeta()', source_file: 'src/lib/services/company-beta.ts', community: 11 },
      { id: 'company-repository', label: 'prisma.company repository', source_file: 'src/lib/db.ts', community: 11 }
    ],
    links: [
      { source: 'queue-route', target: 'queue-handler', confidence: 'EXTRACTED', relation: 'contains' },
      { source: 'queue-handler', target: 'queue-service', confidence: 'EXTRACTED', relation: 'calls' },
      { source: 'debug-route', target: 'queue-service', confidence: 'INFERRED', relation: 'calls' },
      { source: 'webhook-route', target: 'queue-service', confidence: 'INFERRED', relation: 'calls' },
      { source: 'company-alpha-service', target: 'company-repository', confidence: 'EXTRACTED', relation: 'queries' },
      { source: 'company-beta-service', target: 'company-repository', confidence: 'EXTRACTED', relation: 'queries' }
    ]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-04-28T140000Z']);

  assert.equal(result.exitCode, 0);
  const runDir = path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T140000Z');
  await stat(path.join(runDir, 'architecture-profile.md'));
  await stat(path.join(runDir, 'finding-review.md'));
  await stat(path.join(runDir, 'refactoring-delta.md'));
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  assert.equal(evidence.architecture_profile.app_type, 'web_app');
  assert.equal(evidence.architecture_profile.system_type, 'web_application');
  assert.equal(evidence.architecture_profile.rendering, 'nextjs');
  assert.equal(evidence.architecture_profile.frameworks.includes('nextjs'), true);
  assert.equal(evidence.architecture_profile.has_api_routes, true);
  assert.equal(evidence.architecture_profile.has_database, true);
  assert.equal(evidence.architecture_profile.has_auth, true);
  assert.equal(evidence.architecture_profile.auth.includes('next-middleware'), true);
  assert.deepEqual(Object.keys(evidence.architecture_profile.views), [
    'structure',
    'runtime',
    'data',
    'security',
    'deployment',
    'quality'
  ]);
  assert.equal(evidence.architecture_profile.views.structure.components.includes('api_routes'), true);
  assert.equal(evidence.architecture_profile.views.runtime.entrypoints.includes('src/app/api/companies/route.ts'), true);
  assert.equal(evidence.architecture_profile.views.runtime.entrypoints.includes('src/app/api/companies/route.test.ts'), false);
  assert.equal(evidence.architecture_profile.views.runtime.entrypoints.includes('src/app/api/companies/helper.ts'), false);
  assert.equal(evidence.architecture_profile.views.runtime.server_boundaries.includes('api_routes'), true);
  assert.equal(evidence.architecture_profile.views.data.stores.includes('postgres'), true);
  assert.equal(evidence.architecture_profile.views.data.access_patterns.includes('prisma'), true);
  assert.equal(evidence.architecture_profile.views.security.auth_boundaries.some((item) => item.file === 'src/middleware.ts'), true);
  assert.equal(evidence.architecture_profile.views.security.secret_files.includes('.env.local'), true);
  assert.equal(evidence.architecture_profile.views.deployment.targets.includes('vercel'), true);
  assert.equal(evidence.architecture_profile.views.quality.test_tools.includes('vitest'), true);
  assert.equal(evidence.check_catalog.selected_views.includes('security'), true);
  assert.equal(evidence.check_catalog.selected_views.includes('data'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('api-boundary'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('database-access'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('code-quality'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('auth-boundary'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('static-entry'), false);
  assert.equal(evidence.static_site.secret_hits.some((hit) => hit.file === '.env.local'), true);
  assert.equal(evidence.database_access.unbounded_find_many.length, 1);
  assert.equal(evidence.database_access.unbounded_find_many[0].file, 'src/app/api/companies/route.ts');
  assert.equal(evidence.database_access.unbounded_find_many[0].gate_effect, 'review');
  assert.equal(evidence.code_quality.authorization_order_risks.length, 1);
  assert.equal(evidence.code_quality.authorization_order_risks[0].file, 'src/app/api/accounts/[id]/route.ts');
  assert.equal(evidence.code_quality.duplicate_query_shapes.length, 1);
  assert.equal(evidence.code_quality.duplicate_query_shapes[0].files.includes('src/lib/services/company-alpha.ts'), true);
  assert.equal(evidence.code_quality.duplicate_query_shapes[0].files.includes('src/lib/services/company-beta.ts'), true);
  assert.equal(evidence.code_quality.responsibility_hotspots.length, 1);
  assert.equal(evidence.code_quality.responsibility_hotspots[0].file, 'src/lib/services/mixed-workflow.ts');
  assert.equal(evidence.refactoring_opportunities.length, 2);
  const dryOpportunity = evidence.refactoring_opportunities.find((opportunity) => opportunity.finding_id === 'VP-DRY-001');
  assert.equal(dryOpportunity.source, 'duplicate_query_shape');
  assert.equal(dryOpportunity.refactoring_intent, 'query_policy');
  assert.equal(dryOpportunity.target_files.includes('src/lib/services/company-alpha.ts'), true);
  assert.equal(dryOpportunity.target_files.includes('src/lib/services/company-beta.ts'), true);
  assert.match(dryOpportunity.story_blueprint.title, /重複query形状/);
  assert.equal(dryOpportunity.story_blueprint.acceptance_criteria.some((item) => item.includes('VibePro診断')), true);
  assert.equal(dryOpportunity.graph_context.matched_file_count, 2);
  assert.equal(dryOpportunity.graph_context.related_files.includes('src/lib/db.ts'), true);
  assert.equal(dryOpportunity.graph_context.affected_communities[0].id, 11);
  assert.equal(dryOpportunity.graph_context.affected_communities[0].file_count, 2);
  const archOpportunity = evidence.refactoring_opportunities.find((opportunity) => opportunity.finding_id === 'VP-ARCH-001');
  assert.equal(archOpportunity.refactoring_intent, 'responsibility_split');
  assert.equal(archOpportunity.target_files.includes('src/lib/services/mixed-workflow.ts'), true);
  assert.equal(dryOpportunity.rank > 0, true);
  assert.equal(dryOpportunity.score.total > 0, true);
  assert.equal(dryOpportunity.priority_reasons.includes('confidence:medium'), true);
  assert.equal(evidence.refactoring_campaigns.length, 2);
  assert.equal(evidence.refactoring_campaigns[0].rank, 1);
  assert.equal(evidence.refactoring_campaigns.some((campaign) => campaign.recommended_first_opportunity_id === dryOpportunity.id), true);
  assert.equal(evidence.refactoring_delta.status, 'no_baseline');
  const dryCampaign = evidence.refactoring_campaigns.find((campaign) => campaign.opportunity_ids.includes(dryOpportunity.id));
  assert.equal(dryCampaign.story_blueprint.source_opportunity_ids.includes(dryOpportunity.id), true);
  assert.equal(dryCampaign.expected_diagnostic_delta.duplicate_query_shapes, 1);
  assert.equal(evidence.api_boundary.routes.length, 8);
  assert.equal(evidence.api_boundary.protection_summary.protected_by_middleware, 3);
  assert.equal(evidence.api_boundary.protection_summary.protected_by_route, 1);
  assert.equal(evidence.api_boundary.protection_summary.excluded_by_middleware, 4);
  const adminRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/admin/users');
  assert.equal(adminRoute.classification, 'admin');
  assert.equal(adminRoute.protection.status, 'protected_by_middleware');
  assert.equal(adminRoute.protection.evidence.includes('middleware_matcher'), true);
  const adminWebhookMonitorRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/admin/webhook-monitor');
  assert.equal(adminWebhookMonitorRoute.classification, 'admin');
  const publicRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/companies');
  assert.equal(publicRoute.classification, 'public');
  assert.equal(publicRoute.protection.status, 'protected_by_middleware');
  const debugRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/debug-env');
  assert.equal(debugRoute.classification, 'debug');
  assert.equal(debugRoute.protection.status, 'excluded_by_middleware');
  assert.equal(debugRoute.protection.evidence.includes('route_auth_reference'), false);
  assert.equal(debugRoute.risk_hints.includes('debug_route_exposed'), true);
  const webhookRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/webhooks/stripe');
  assert.equal(webhookRoute.classification, 'webhook');
  assert.equal(webhookRoute.protection.evidence.includes('webhook_signature_check'), false);
  assert.equal(webhookRoute.risk_hints.includes('webhook_signature_not_detected'), true);
  const internalRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/internal/health');
  assert.equal(internalRoute.protection.status, 'protected_by_route');
  assert.equal(internalRoute.protection.evidence.includes('route_auth_reference'), true);
  const queueRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/queue/status');
  assert.equal(queueRoute.protection.status, 'excluded_by_middleware');
  assert.equal(queueRoute.protection.evidence.includes('middleware_excludes_api'), true);
  assert.equal(queueRoute.risk_hints.includes('privileged_route_unprotected'), true);
  assert.equal(evidence.action_candidates.length, 5);
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'tasks.json'));
  assert.equal(tasks.tasks[0].id, 'VP-TASK-STATIC-002-BLOCK');
  assert.equal(tasks.tasks[0].priority, 'critical');
  assert.equal(tasks.tasks[1].id, 'VP-TASK-STATIC-002-REVIEW');
  assert.equal(tasks.tasks[2].source_id, 'VP-ACTION-API-002');
  assert.equal(tasks.tasks[3].source_id, 'VP-ACTION-API-003');
  assert.equal(tasks.tasks[4].source_id, 'VP-ACTION-API-001');
  assert.equal(tasks.tasks[4].recommended_strategy.id, 'route-level-auth');
  assert.equal(tasks.tasks[4].read_first_files.some((item) => item.file === 'src/lib/queue.ts'), true);
  assert.equal(tasks.tasks[4].target_count, tasks.tasks[4].pre_fix_briefing.target_routes.length);
  assert.equal(tasks.tasks[4].target_files.length, tasks.tasks[4].pre_fix_briefing.target_routes.length);
  assert.equal(tasks.tasks[4].target_groups.length, 1);
  assert.equal(tasks.tasks[4].target_groups[0].id, 'queue-status');
  assert.equal(tasks.tasks[4].target_groups[0].route_count, 1);
  assert.equal(tasks.tasks[4].pre_fix_briefing.current_boundary.middleware.excludes_api, true);
  assert.equal(tasks.tasks[6].source_id, 'VP-DB-001');
  assert.equal(tasks.tasks[6].priority, 'medium');
  assert.equal(tasks.tasks[6].target_files.includes('src/app/api/companies/route.ts'), true);
  assert.equal(tasks.tasks[7].source_id, 'VP-ACTION-DRY-001');
  assert.equal(tasks.tasks[7].target_files.includes('src/lib/services/company-alpha.ts'), true);
  assert.equal(tasks.tasks[7].pre_fix_briefing.opportunity.refactoring_intent, 'query_policy');
  assert.equal(tasks.tasks[7].pre_fix_briefing.campaign.id, dryCampaign.id);
  assert.equal(tasks.tasks[7].graph_context.matched_file_count, 2);
  assert.equal(tasks.tasks[7].read_first_files.some((item) => item.file === 'src/lib/db.ts'), true);
  assert.equal(tasks.tasks[7].pre_fix_briefing.investigation_scope.related_files.includes('src/lib/db.ts'), true);
  assert.equal(tasks.tasks[7].recommended_strategy.id, 'extract-shared-boundary');
  assert.equal(tasks.tasks[8].source_id, 'VP-ACTION-ARCH-001');
  assert.equal(tasks.tasks[8].pre_fix_briefing.opportunity.refactoring_intent, 'responsibility_split');
  const apiAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-API-001');
  assert.equal(apiAction.finding_id, 'VP-API-001');
  assert.equal(apiAction.execution_policy, 'proposal_only');
  assert.equal(apiAction.mutates_repository, false);
  assert.equal(apiAction.target_count, 1);
  assert.equal(apiAction.route_examples[0].route_path, '/api/queue/status');
  assert.equal(apiAction.route_examples[0].file, 'src/app/api/queue/status/route.ts');
  assert.equal(apiAction.graph_context.matched_route_count, 1);
  assert.equal(apiAction.graph_context.matched_node_count, 2);
  assert.equal(apiAction.graph_context.related_edge_count, 2);
  assert.equal(apiAction.graph_context.affected_communities[0].id, 7);
  assert.equal(apiAction.graph_context.hub_nodes.some((node) => node.id === 'queue-service'), true);
  assert.equal(apiAction.graph_context.impact_score > 0, true);
  assert.equal(apiAction.implementation_plan.priority, 'high');
  assert.equal(apiAction.implementation_plan.read_first_files[0].file, 'src/app/api/queue/status/route.ts');
  assert.equal(apiAction.implementation_plan.read_first_files.some((item) => item.file === 'src/middleware.ts'), true);
  assert.equal(apiAction.implementation_plan.read_first_files.some((item) => item.file === 'src/lib/queue.ts'), true);
  assert.match(apiAction.implementation_plan.steps[0].detail, /middleware matcher/);
  assert.match(apiAction.implementation_plan.acceptance_criteria.join('\n'), /保護根拠/);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.current_boundary.middleware.excludes_api, true);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.current_boundary.route_protection.excluded_by_middleware, 1);
  const apiAuthHelper = apiAction.implementation_plan.pre_fix_briefing.auth_helpers.find((helper) => helper.file === 'src/lib/queue.ts');
  assert.equal(apiAuthHelper?.functions.includes('requireQueueAuth'), true);
  assert.equal(apiAuthHelper?.functions.includes('verifyQueueSignature'), false);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.target_routes[0].file, 'src/app/api/queue/status/route.ts');
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.target_routes[0].methods.includes('GET'), true);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.strategy_options.length, 2);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.recommended_strategy.id, 'route-level-auth');
  const debugAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-API-002');
  assert.equal(debugAction.target_count, 1);
  assert.equal(debugAction.graph_context.matched_route_count, 1);
  assert.match(debugAction.implementation_plan.steps.map((step) => step.detail).join('\n'), /削除/);
  assert.equal(debugAction.implementation_plan.pre_fix_briefing.recommended_strategy.id, 'delete-debug-routes');
  const webhookAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-API-003');
  assert.equal(webhookAction.target_count, 1);
  assert.equal(webhookAction.graph_context.matched_route_count, 1);
  assert.match(webhookAction.implementation_plan.acceptance_criteria.join('\n'), /署名検証/);
  assert.equal(webhookAction.implementation_plan.pre_fix_briefing.recommended_strategy.id, 'provider-signature-verification');
  assert.equal(
    webhookAction.implementation_plan.pre_fix_briefing.auth_helpers.some((helper) => helper.file === 'src/lib/queue.ts'),
    false
  );
  const dryAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-DRY-001');
  assert.equal(dryAction.finding_id, 'VP-DRY-001');
  assert.equal(dryAction.scope, 'refactoring');
  assert.equal(dryAction.refactoring_opportunity_id, dryOpportunity.id);
  assert.equal(dryAction.refactoring_campaign_id, dryCampaign.id);
  assert.equal(dryAction.target_files.includes('src/lib/services/company-beta.ts'), true);
  assert.equal(dryAction.story_blueprint.refactoring_intent, 'query_policy');
  assert.equal(dryAction.graph_context.matched_file_count, 2);
  assert.equal(dryAction.graph_context.related_files.includes('src/lib/db.ts'), true);
  assert.equal(dryAction.graph_context.hub_nodes.some((node) => node.id === 'company-repository'), true);
  assert.equal(dryAction.implementation_plan.read_first_files.some((item) => item.file === 'src/lib/db.ts'), true);
  assert.equal(dryAction.implementation_plan.pre_fix_briefing.graph_context.impact_score > 0, true);
  assert.equal(dryAction.implementation_plan.pre_fix_briefing.investigation_scope.cross_community, false);
  assert.equal(dryAction.implementation_plan.pre_fix_briefing.opportunity.id, dryOpportunity.id);
  const archAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-ARCH-001');
  assert.equal(archAction.finding_id, 'VP-ARCH-001');
  assert.equal(archAction.scope, 'refactoring');
  assert.equal(archAction.target_files.includes('src/lib/services/mixed-workflow.ts'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-API-002'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-API-003'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-DB-001'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-SEC-004'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-DRY-001'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-ARCH-001'), true);
  assert.equal(evidence.finding_review.status, 'needs_review');
  assert.equal(evidence.finding_review.summary.total, evidence.findings.length);
  assert.equal(evidence.finding_review.summary.unreviewed, evidence.findings.length);
  assert.equal(evidence.finding_review.items.find((item) => item.finding_id === 'VP-API-001').suggested_classification, 'implementation_gap');
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-GRAPH-002'), false);
  assert.equal(evidence.graphify.quality_notices.find((notice) => notice.id === 'VP-GRAPH-002').level, 'info');
  assert.equal(evidence.finding_review.items.find((item) => item.finding_id === 'VP-API-001').allowed_classifications.includes('false_negative'), true);
  const apiFinding = evidence.findings.find((finding) => finding.id === 'VP-API-001');
  assert.match(apiFinding.detail, /excluded_by_middleware: 1件/);
  assert.match(apiFinding.recommendation, /APIを除外しているmiddleware matcher/);
  assert.equal(apiFinding.graph_context.impact_score, apiAction.graph_context.impact_score);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-STATIC-001'), false);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-STATIC-004'), false);
  const summary = await readFile(path.join(runDir, 'summary.md'), 'utf8');
  assert.match(summary, /## アーキテクチャView/);
  assert.match(summary, /Security \|/);
  assert.doesNotMatch(summary, /静的サイト scanned files/);
  assert.match(summary, /共通スキャン対象/);
  assert.match(summary, /DB未ページング候補/);
  assert.match(summary, /認可前bulk DB候補/);
  assert.match(summary, /重複query形状候補/);
  assert.match(summary, /責務混在候補/);
  assert.match(summary, /リファクタリング機会/);
  assert.match(summary, /リファクタリングcampaign/);
  assert.match(summary, /保護状態別/);
  assert.match(summary, /excluded_by_middleware \| 4/);
  assert.match(summary, /## 次アクション候補/);
  assert.match(summary, /VP-ACTION-API-001/);
  assert.match(summary, /VP-ACTION-DRY-001/);
  assert.match(summary, /VP-ACTION-ARCH-001/);
  assert.match(summary, /Impact/);
  assert.match(summary, /読むファイル/);
  assert.match(summary, /実装手順/);
  assert.match(summary, /修正前ブリーフィング/);
  assert.match(summary, /## 文脈品質ノート/);
  assert.match(summary, /VP-GRAPH-002/);
  assert.match(summary, /## 診断レビュー/);
  assert.match(summary, /## リファクタリング差分/);
  assert.match(summary, /差分は未算出/);
  assert.match(summary, /suggested implementation_gap/);
  assert.match(summary, /方針A/);
  assert.match(summary, /7\(route: 1, node: 2, edge: 2\)/);
  assert.match(summary, /11\(file: 2, node: 2, edge: 2\)/);
  const riskRegister = await readFile(path.join(runDir, 'risk-register.md'), 'utf8');
  assert.match(riskRegister, /## API境界の保護状態/);
  assert.match(riskRegister, /## 診断レビュー分類/);
  assert.match(riskRegister, /VP-API-001 \| unreviewed \| implementation_gap/);
  assert.match(riskRegister, /excluded_by_middleware \| 4/);
  assert.match(riskRegister, /proposal_only/);
  assert.match(riskRegister, /Impact/);
  const findingReview = await readFile(path.join(runDir, 'finding-review.md'), 'utf8');
  assert.match(findingReview, /# VibePro 診断レビュー/);
  assert.match(findingReview, /true_positive/);
  assert.match(findingReview, /false_positive/);
  assert.match(findingReview, /false_negative/);
  assert.match(findingReview, /detector_gap/);
  assert.match(findingReview, /implementation_gap/);
  const storyReport = await runCli(['story', 'report', repo]);
  assert.equal(storyReport.exitCode, 0);
  const report = await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'story-report.md'), 'utf8');
  assert.doesNotMatch(report, /## 静的サイト診断/);
  assert.match(report, /## 共通スキャン/);
  assert.match(report, /## API境界/);
  assert.match(report, /protected_by_route \| 1/);
  assert.match(report, /## 診断レビュー/);
  assert.match(report, /implementation_gap/);
  assert.match(report, /## 次アクション候補/);
  assert.match(report, /## 生成タスク/);
  assert.match(report, /VP-TASK-API-001/);
  assert.match(report, /Impact/);
  assert.match(report, /実装手順/);
  assert.match(report, /修正前ブリーフィング/);
  await runCli(['brainbase', repo]);
  const importSummary = await readFile(path.join(repo, '.vibepro', 'brainbase', 'import-summary.md'), 'utf8');
  assert.doesNotMatch(importSummary, /静的サイト走査ファイル/);
  assert.match(importSummary, /共通スキャン対象/);
  assert.match(importSummary, /## API境界/);
  assert.match(importSummary, /認可前bulk DB候補/);
  assert.match(importSummary, /重複query形状候補/);
  assert.match(importSummary, /責務混在候補/);
  assert.match(importSummary, /リファクタリング機会/);
  assert.match(importSummary, /リファクタリングcampaign/);
  assert.match(importSummary, /リファクタリング差分/);
  assert.match(importSummary, /excluded_by_middleware \| 4/);
  assert.match(importSummary, /## 診断レビュー/);
  assert.doesNotMatch(importSummary, /suggested detector_gap: [1-9]/);
  assert.match(importSummary, /## 次アクション候補/);
  assert.match(importSummary, /## 生成タスク/);
  assert.match(importSummary, /VP-TASK-API-001/);
  assert.match(importSummary, /Impact/);
  assert.match(importSummary, /読むファイル/);
  assert.match(importSummary, /修正前ブリーフィング/);
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.signals.architecture_profile.system_type, 'web_application');
  assert.equal(importState.signals.architecture_profile.views.security.auth_boundaries.length, 1);
  assert.equal(importState.signals.check_catalog.selected_views.includes('runtime'), true);
  assert.equal(importState.signals.api_boundary.route_count, 8);
  assert.equal(importState.signals.api_boundary.summary.debug, 1);
  assert.equal(importState.signals.api_boundary.protection_summary.excluded_by_middleware, 4);
  assert.equal(importState.signals.code_quality.authorization_order_risks_count, 1);
  assert.equal(importState.signals.code_quality.duplicate_query_shapes_count, 1);
  assert.equal(importState.signals.code_quality.responsibility_hotspots_count, 1);
  assert.equal(importState.signals.refactoring_opportunities.length, 2);
  assert.equal(importState.signals.refactoring_opportunities[0].rank > 0, true);
  assert.equal(importState.signals.refactoring_opportunities[0].story_blueprint.source_finding_id, 'VP-DRY-001');
  assert.equal(importState.signals.refactoring_opportunities.find((opportunity) => opportunity.id === dryOpportunity.id).graph_context.matched_file_count, 2);
  assert.equal(importState.signals.refactoring_campaigns.length, 2);
  assert.equal(importState.signals.refactoring_delta.status, 'no_baseline');
  assert.equal(importState.signals.refactoring_campaigns.some((campaign) => campaign.opportunity_ids.includes(dryOpportunity.id)), true);
  assert.equal(importState.signals.refactoring_campaigns.find((campaign) => campaign.opportunity_ids.includes(dryOpportunity.id)).graph_context.related_files.includes('src/lib/db.ts'), true);
  assert.equal(importState.signals.finding_review.summary.total, importState.findings.length);
  assert.equal(importState.signals.graphify.quality_notices.find((notice) => notice.id === 'VP-GRAPH-002').level, 'info');
  assert.equal(importState.findings.find((finding) => finding.id === 'VP-API-001').review.suggested_classification, 'implementation_gap');
  assert.equal(importState.signals.tasks.length, 9);
  assert.equal(importState.signals.tasks[0].id, 'VP-TASK-STATIC-002-BLOCK');
  assert.equal(importState.signals.tasks[4].source_id, 'VP-ACTION-API-001');
  assert.equal(importState.signals.tasks[6].source_id, 'VP-DB-001');
  assert.equal(importState.signals.tasks[7].source_id, 'VP-ACTION-DRY-001');
  assert.equal(importState.signals.tasks[8].source_id, 'VP-ACTION-ARCH-001');
  assert.equal(importState.signals.action_candidates.length, 5);
  assert.equal(importState.signals.action_candidates[0].mutates_repository, false);
  assert.equal(importState.signals.action_candidates[0].graph_context.matched_route_count, 1);
  assert.equal(importState.signals.action_candidates[0].implementation_plan.read_first_files.some((item) => item.file === 'src/lib/queue.ts'), true);
  assert.equal(importState.signals.action_candidates[0].implementation_plan.pre_fix_briefing.recommended_strategy.id, 'route-level-auth');
  const importedDryAction = importState.signals.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-DRY-001');
  assert.equal(importedDryAction.refactoring_opportunity_id, dryOpportunity.id);
  assert.equal(importedDryAction.refactoring_campaign_id, dryCampaign.id);
  assert.equal(importedDryAction.story_blueprint.refactoring_intent, 'query_policy');
  assert.equal(importedDryAction.target_files.includes('src/lib/services/company-alpha.ts'), true);
  assert.equal(importedDryAction.graph_context.matched_file_count, 2);
  assert.equal(importedDryAction.implementation_plan.read_first_files.some((item) => item.file === 'src/lib/db.ts'), true);
  assert.equal(importState.findings.find((finding) => finding.id === 'VP-API-001').graph_context.impact_score > 0, true);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(
    manifest.runs[0].artifacts.architecture_profile,
    '.vibepro/diagnostics/2026-04-28T140000Z/architecture-profile.md'
  );
  assert.equal(
    manifest.runs[0].artifacts.finding_review,
    '.vibepro/diagnostics/2026-04-28T140000Z/finding-review.md'
  );
  assert.equal(
    manifest.runs[0].artifacts.refactoring_delta,
    '.vibepro/diagnostics/2026-04-28T140000Z/refactoring-delta.md'
  );
});

test('diagnose records refactoring delta against the previous story run', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-refactoring-delta-test-'));
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: { dev: 'next dev' },
    dependencies: {
      '@prisma/client': '^5.0.0',
      next: '^14.0.0',
      react: '^18.2.0'
    }
  }));
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), 'export default function Page() { return <main>Example App</main>; }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-alpha.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesAlpha() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-beta.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesBeta() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-gamma.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesGamma() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await runCli(['init', repo, '--story-id', 'story-refactoring-delta', '--title', '差分計測']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const beforeResult = await runCli(['diagnose', repo, '--run-id', 'run-before']);
  assert.equal(beforeResult.exitCode, 0);

  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-beta.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesBeta() {
  return prisma.company.findMany({
    where: { archived: false },
    select: { id: true, displayName: true },
    orderBy: { updatedAt: 'desc' },
    take: 20
  });
}
`);

  const afterResult = await runCli(['diagnose', repo, '--run-id', 'run-after']);
  assert.equal(afterResult.exitCode, 0);
  const afterRunDir = path.join(repo, '.vibepro', 'diagnostics', 'run-after');
  const afterEvidence = await readJson(path.join(afterRunDir, 'evidence.json'));
  assert.equal(afterEvidence.refactoring_delta.status, 'available');
  const improved = afterEvidence.refactoring_delta.top_improvements.find((item) => item.status === 'improved');
  assert.match(improved.key, /company\.findMany/);
  assert.equal(improved.before.target_file_count, 3);
  assert.equal(improved.before.occurrence_count, 3);
  assert.equal(improved.after.target_file_count, 2);
  assert.equal(improved.after.occurrence_count, 2);
  assert.equal(afterEvidence.refactoring_delta.top_remaining[0].key, improved.key);
  assert.equal(afterEvidence.refactoring_delta.top_remaining[0].after.target_file_count, 2);
  const deltaReport = await readFile(path.join(afterRunDir, 'refactoring-delta.md'), 'utf8');
  assert.match(deltaReport, /## 残っている上位候補/);
  assert.match(deltaReport, /3ファイル \/ 3出現/);
  assert.match(deltaReport, /2ファイル \/ 2出現/);
  const summary = await readFile(path.join(afterRunDir, 'summary.md'), 'utf8');
  assert.match(summary, /## リファクタリング差分/);
  assert.match(summary, /3ファイル \/ 3出現 -> 2ファイル \/ 2出現/);
  assert.match(summary, /次の候補/);
});

test('brainbase creates an import state from the latest VibePro manifest run', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'app.js'), 'document.body.innerHTML = location.hash;\n');
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'page' }],
    edges: [
      { source: 'app', target: 'page', relation: 'renders', confidence: 'AMBIGUOUS' }
    ]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T150000Z']);

  const result = await runCli(['brainbase', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'brainbase');
  const importStatePath = path.join(repo, '.vibepro', 'brainbase', 'import-state.json');
  const importSummaryPath = path.join(repo, '.vibepro', 'brainbase', 'import-summary.md');
  await stat(importSummaryPath);
  const importState = await readJson(importStatePath);
  assert.equal(importState.schema_version, '0.1.0');
  assert.equal(importState.story.story_id, 'story-vibepro-diagnosis-commercialization-roadmap');
  assert.equal(importState.latest_run.run_id, '2026-04-28T150000Z');
  assert.equal(importState.latest_run.gate_status, 'needs_review');
  assert.equal(importState.signals.graphify.node_count, 2);
  assert.equal(importState.signals.graphify.ambiguous_edges_count, 1);
  assert.equal(importState.signals.architecture_profile.app_type, 'static_site');
  assert.equal(importState.signals.check_catalog.applicable_checks.includes('static-entry'), true);
  assert.equal(importState.signals.static_site.xss_risk_hits_count, 1);
  assert.equal(importState.findings.some((finding) => finding.id === 'VP-STATIC-003'), true);
  assert.match(await readFile(importSummaryPath, 'utf8'), /Brainbase 取り込み状態/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.artifacts.brainbase_import_state, '.vibepro/brainbase/import-state.json');
});

test('brainbase import state supports multiple stories with NocoDB horizon, view, period, and dates', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.brainbase = {
    stories: [
      {
        story_id: 'story-vibepro-diagnosis-commercialization-roadmap',
        title: 'M1: VibePro 診断→商用化ロードマップ',
        horizon: 'month',
        view: 'dev',
        period: '2026-04',
        started_at: '2026-04-01',
        due_at: '2026-04-30'
      },
      {
        story_id: 'story-vibepro-brainbase-rollup',
        title: 'Brainbase 横断取り込み',
        horizon: 'quarter',
        view: 'business',
        period: '2026Q2',
        started_at: '2026-04-01',
        due_at: '2026-06-30'
      }
    ]
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T180000Z']);

  const result = await runCli(['brainbase', repo]);

  assert.equal(result.exitCode, 0);
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.stories.length, 2);
  assert.deepEqual(importState.stories.map((story) => story.story_id), [
    'story-vibepro-diagnosis-commercialization-roadmap',
    'story-vibepro-brainbase-rollup'
  ]);
  assert.equal(importState.stories[0].horizon, 'month');
  assert.equal(importState.stories[0].view, 'dev');
  assert.equal(importState.stories[0].period, '2026-04');
  assert.equal(importState.stories[0].started_at, '2026-04-01');
  assert.equal(importState.stories[0].due_at, '2026-04-30');
  assert.equal(importState.stories[1].horizon, 'quarter');
  assert.equal(importState.stories[1].period, '2026Q2');
  assert.equal(importState.story.story_id, 'story-vibepro-diagnosis-commercialization-roadmap');
  assert.match(await readFile(path.join(repo, '.vibepro', 'brainbase', 'import-summary.md'), 'utf8'), /2026Q2/);
});

test('brainbase sync-stories updates config stories from NocoDB Story records before import', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T210000Z']);
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, token: options.headers['xc-token'] });
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '名前', column_name: 'name' },
          { title: 'ステータス', column_name: 'status' },
          { title: 'Horizon', column_name: 'horizon' },
          { title: 'View', column_name: 'view' },
          { title: 'Period', column_name: 'period' },
          { title: '開始日', column_name: 'started_at' },
          { title: '期限日', column_name: 'due_at' }
        ]
      });
    }
    return jsonResponse({
      list: [
        {
          'Story ID': 'story-active-dev',
          '名前': 'Dev Story',
          'ステータス': 'active',
          Horizon: 'sprint',
          View: 'dev',
          Period: '2026-W18',
          '開始日': '2026-04-27',
          '期限日': '2026-05-01'
        },
        {
          'Story ID': 'story-archived',
          '名前': 'Archived Story',
          'ステータス': 'archived',
          Horizon: 'month',
          View: 'business',
          Period: '2026-04',
          '開始日': '2026-04-01',
          '期限日': '2026-04-30'
        },
        {
          'Story ID': 'story-active-business',
          '名前': 'Business Story',
          'ステータス': 'active',
          Horizon: 'quarter',
          View: 'business',
          Period: '2026Q2',
          '開始日': '2026-04-01',
          '期限日': '2026-06-30'
        }
      ],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--sync-stories'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => request.token === 'test-token'), true);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.deepEqual(config.brainbase.stories.map((story) => story.story_id), [
    'story-active-dev',
    'story-active-business'
  ]);
  assert.equal(config.brainbase.story_source.table_id, 'table-1');
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.stories.length, 2);
  assert.equal(importState.stories[0].horizon, 'sprint');
  assert.equal(importState.stories[1].period, '2026Q2');
});

test('brainbase publish-status replaces the VibePro diagnosis section in the NocoDB Story description', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: [{ source: 'app', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T230000Z']);
  const requests = [];
  let description = '既存説明\n\n<!-- vibepro:diagnosis-sync:start -->\n古い診断\n<!-- vibepro:diagnosis-sync:end -->\n\n手書きメモ';
  const fakeFetch = async (url, options) => {
    requests.push({ url, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '説明', column_name: 'description' }
        ]
      });
    }
    if ((options.method ?? 'GET') === 'PATCH') {
      description = JSON.parse(options.body).説明;
      return jsonResponse({ Id: 42 });
    }
    return jsonResponse({
      list: [{
        Id: 42,
        'Story ID': 'story-vibepro-diagnosis-commercialization-roadmap',
        '説明': description
      }],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--publish-status'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  const patch = requests.find((request) => request.method === 'PATCH');
  assert.ok(patch);
  assert.match(patch.url, /\/api\/v1\/db\/data\/noco\/base-1\/table-1\/42$/);
  assert.equal(patch.body.ステータス, undefined);
  assert.match(patch.body.説明, /既存説明/);
  assert.match(patch.body.説明, /手書きメモ/);
  assert.match(patch.body.説明, /VibePro診断同期/);
  assert.match(patch.body.説明, /Gate: needs_review/);
  assert.doesNotMatch(patch.body.説明, /古い診断/);
});

test('brainbase publish-status writes backup and result artifacts after verified NocoDB update', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: [{ source: 'app', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T230500Z']);
  let description = '既存説明\n\n手書きメモ';
  const requests = [];
  const fakeFetch = async (url, options) => {
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, method, body });
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '説明', column_name: 'description' }
        ]
      });
    }
    if (method === 'PATCH') {
      description = body.説明;
      return jsonResponse({ '番号': 2 });
    }
    return jsonResponse({
      list: [{
        '番号': 2,
        'Story ID': 'story-vibepro-diagnosis-commercialization-roadmap',
        '説明': description
      }],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--publish-status'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  const patch = requests.find((request) => request.method === 'PATCH');
  assert.ok(patch);
  assert.match(patch.url, /\/2$/);
  const backup = await readJson(path.join(repo, '.vibepro', 'brainbase', 'publish-backup.json'));
  assert.equal(backup.story_id, 'story-vibepro-diagnosis-commercialization-roadmap');
  assert.equal(backup.record_id, 2);
  assert.match(backup.existing_description, /手書きメモ/);
  const publishResult = await readJson(path.join(repo, '.vibepro', 'brainbase', 'publish-result.json'));
  assert.equal(publishResult.verified, true);
  assert.equal(publishResult.description_matches_expected, true);
  assert.equal(publishResult.updated_fields.length, 1);
  assert.equal(publishResult.updated_fields[0], '説明');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.brainbase.last_publish_result.backup_json, '.vibepro/brainbase/publish-backup.json');
  assert.equal(manifest.brainbase.last_publish_result.result_json, '.vibepro/brainbase/publish-result.json');
});

test('brainbase publish-status dry-run writes preview artifacts without patching NocoDB', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: [{ source: 'app', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T231500Z']);
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, method: options.method ?? 'GET' });
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '説明', column_name: 'description' }
        ]
      });
    }
    return jsonResponse({
      list: [{
        Id: 42,
        'Story ID': 'story-vibepro-diagnosis-commercialization-roadmap',
        '説明': '既存説明'
      }],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--publish-status', '--dry-run'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  assert.equal(requests.some((request) => request.method === 'PATCH'), false);
  const preview = await readJson(path.join(repo, '.vibepro', 'brainbase', 'publish-preview.json'));
  assert.equal(preview.dry_run, true);
  assert.equal(preview.story_id, 'story-vibepro-diagnosis-commercialization-roadmap');
  assert.equal(preview.latest_run_id, '2026-04-28T231500Z');
  assert.match(preview.next_description, /Gate: needs_review/);
  assert.match(await readFile(path.join(repo, '.vibepro', 'brainbase', 'publish-preview.md'), 'utf8'), /PATCHは実行していない/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.brainbase.last_publish_preview.preview_json, '.vibepro/brainbase/publish-preview.json');
});

test('brainbase publish-status dry-run can target an explicit story id', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.brainbase.stories = [
    { story_id: 'story-first', title: 'First', ssot: 'NocoDB' },
    { story_id: 'story-target', title: 'Target', ssot: 'NocoDB' }
  ];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T234000Z']);
  const requestedUrls = [];
  const fakeFetch = async (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '説明', column_name: 'description' }
        ]
      });
    }
    return jsonResponse({
      list: [{ Id: 99, 'Story ID': 'story-target', '説明': 'target description' }],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--publish-status', '--dry-run', '--story-id', 'story-target'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  assert.equal(requestedUrls.some((url) => url.includes('story-target')), true);
  assert.equal(requestedUrls.some((url) => url.includes('story-first')), false);
  const preview = await readJson(path.join(repo, '.vibepro', 'brainbase', 'publish-preview.json'));
  assert.equal(preview.story_id, 'story-target');
});

test('brainbase publish-status fails when explicit story id is not in import state', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T234500Z']);

  const result = await runCli(['brainbase', repo, '--publish-status', '--dry-run', '--story-id', 'missing-story'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: async () => {
      throw new Error('fetch should not be called');
    }
  });

  assert.equal(result.exitCode, 1);
});

test('story derive supports modular-web preset for non Next.js layouts', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'cli'), { recursive: true });
  await mkdir(path.join(repo, 'lib', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'mcp', 'server'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'core'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'domain', 'task'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'routes'), { recursive: true });
  await writeFile(path.join(repo, 'cli', 'index.js'), 'export function main() {}\n');
  await writeFile(path.join(repo, 'lib', 'services', 'auth-service.js'), 'export class AuthService {}\n');
  await writeFile(path.join(repo, 'mcp', 'server', 'index.js'), 'export function startServer() {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'core', 'event-bus.js'), 'export const eventBus = {};\n');
  await writeFile(path.join(repo, 'public', 'modules', 'domain', 'task', 'task-service.js'), 'export class TaskService {}\n');
  await writeFile(path.join(repo, 'server', 'routes', 'api.js'), 'export default function api() {}\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'cli_index', source_file: 'cli/index.js', label: 'cli/index.js' },
      { id: 'lib_auth', source_file: 'lib/services/auth-service.js', label: 'AuthService' },
      { id: 'mcp_server', source_file: 'mcp/server/index.js', label: 'mcp server' },
      { id: 'web_core', source_file: 'public/modules/core/event-bus.js', label: 'eventBus' },
      { id: 'web_domain_task', source_file: 'public/modules/domain/task/task-service.js', label: 'TaskService' },
      { id: 'server_route', source_file: 'server/routes/api.js', label: 'api route' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo, '--preset', 'modular-web']);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.preset, 'modular-web');
  assert.ok(catalog.coverage.totals.graph_story_relevant_files > 0,
    `expected coverage.relevant_files > 0, got ${catalog.coverage.totals.graph_story_relevant_files}`);
  assert.ok(catalog.coverage.by_role.length > 0,
    `expected by_role to have entries, got ${JSON.stringify(catalog.coverage.by_role)}`);

  const roles = catalog.coverage.by_role.map((entry) => entry.role);
  const expectedAny = ['cli', 'mcp_server', 'web_core', 'web_module', 'domain_service', 'server_route'];
  assert.ok(roles.some((role) => expectedAny.includes(role)),
    `expected modular-web role in ${JSON.stringify(roles)}`);

  const codeSurface = catalog.stories.filter((story) => story.source.type === 'code_surface');
  assert.ok(codeSurface.length >= 1,
    `expected at least 1 code_surface story for modular-web, got ${codeSurface.length}`);
});

test('story derive does not leak next-app product stories into modular-web preset', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await mkdir(path.join(repo, 'lib', 'services', 'auth'), { recursive: true });
  await mkdir(path.join(repo, 'lib', 'services', 'stripe'), { recursive: true });
  await writeFile(path.join(repo, 'lib', 'services', 'auth', 'session.js'), 'export {}\n');
  await writeFile(path.join(repo, 'lib', 'services', 'stripe', 'billing.js'), 'export {}\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'auth', source_file: 'lib/services/auth/session.js', label: 'auth-session' },
      { id: 'bill', source_file: 'lib/services/stripe/billing.js', label: 'billing' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const nextAppProductIds = [
    'story-product-auth-account-access',
    'story-product-premium-billing',
    'story-product-content-cms'
  ];
  const leaked = catalog.stories.filter((s) => nextAppProductIds.includes(s.story_id));
  assert.equal(leaked.length, 0,
    `next-app product stories must not leak into modular-web preset, found ${JSON.stringify(leaked.map((s) => s.story_id))}`);
});

test('story derive uses salestailor preset without next-app product story leakage', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'sample-review'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'projects', '[projectId]', 'sample-review', 'regenerate'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services', 'prompt-improvement'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services', 'formSubmission'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'sample-review', 'page.tsx'),
    'export default function Page() { return <main>SalesTailor</main>; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'projects', '[projectId]', 'sample-review', 'regenerate', 'route.ts'),
    'export async function POST() {}\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'prompt-improvement', 'promptFeedbackService.ts'),
    'export class PromptFeedbackService {}\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'formSubmission', 'formSubmissionOrchestrator.ts'),
    'export class FormSubmissionOrchestrator {}\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'review_page', source_file: 'src/app/projects/[projectId]/sample-review/page.tsx', label: 'SampleReview' },
      { id: 'regen_route', source_file: 'src/app/api/projects/[projectId]/sample-review/regenerate/route.ts', label: 'regenerate' },
      { id: 'feedback', source_file: 'src/lib/services/prompt-improvement/promptFeedbackService.ts', label: 'PromptFeedbackService' },
      { id: 'form', source_file: 'src/lib/services/formSubmission/formSubmissionOrchestrator.ts', label: 'FormSubmissionOrchestrator' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo, '--preset', 'salestailor']);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.preset, 'salestailor');
  const storyIds = catalog.stories.map((story) => story.story_id);
  assert.ok(storyIds.includes('story-salestailor-letter-generation-review'));
  assert.ok(storyIds.includes('story-salestailor-prompt-improvement-loop'));
  assert.ok(storyIds.includes('story-salestailor-contact-form-automation'));
  assert.equal(storyIds.some((id) => id === 'story-product-auth-account-access' || id === 'story-product-premium-billing'), false,
    `salestailor preset must not emit next-app story ids, got ${JSON.stringify(storyIds)}`);

  const serialized = JSON.stringify(catalog);
  assert.doesNotMatch(serialized, /Aitle|ホテル|旅行|hotel|shadow-call/i);
});

test('story derive emits story_candidates clustering uncovered files', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  // lib/auth/* and lib/legacy/* match modular-web relevant patterns but NOT
  // codeSurfaceSignatures, so they end up in coverage.uncovered.
  await mkdir(path.join(repo, 'lib', 'auth'), { recursive: true });
  await mkdir(path.join(repo, 'lib', 'legacy'), { recursive: true });
  for (let i = 0; i < 5; i += 1) {
    await writeFile(path.join(repo, 'lib', 'auth', `auth${i}.js`), 'export {}\n');
  }
  for (let i = 0; i < 6; i += 1) {
    await writeFile(path.join(repo, 'lib', 'legacy', `legacy${i}.js`), 'export {}\n');
  }

  const nodes = [];
  for (let i = 0; i < 5; i += 1) nodes.push({ id: `auth_${i}`, source_file: `lib/auth/auth${i}.js`, label: `auth${i}` });
  for (let i = 0; i < 6; i += 1) nodes.push({ id: `legacy_${i}`, source_file: `lib/legacy/legacy${i}.js`, label: `legacy${i}` });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({ nodes, links: [] }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.ok(Array.isArray(catalog.story_candidates),
    `catalog.story_candidates must be an array, got ${typeof catalog.story_candidates}`);
  assert.ok(catalog.story_candidates.length >= 2,
    `expected >= 2 candidates from uncovered clusters, got ${catalog.story_candidates.length} (uncovered=${catalog.coverage.totals.uncovered_files})`);

  const authCandidate = catalog.story_candidates.find((c) => c.common_path === 'lib/auth');
  assert.ok(authCandidate, `expected candidate for lib/auth, got ${JSON.stringify(catalog.story_candidates.map((c) => c.common_path))}`);
  assert.equal(authCandidate.role, 'auth');
  assert.equal(authCandidate.file_count, 5);
  assert.equal(authCandidate.confidence, 'medium');
  assert.match(authCandidate.candidate_id, /^candidate-auth-/);
  assert.ok(authCandidate.evidence.length > 0);
  assert.ok(authCandidate.open_questions.length > 0);

  const legacyCandidate = catalog.story_candidates.find((c) => c.common_path === 'lib/legacy');
  assert.ok(legacyCandidate);
  assert.equal(legacyCandidate.role, 'lib_module');
  assert.equal(legacyCandidate.file_count, 6);

  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /## Story候補（uncovered cluster）/);
  assert.match(map, /candidate-auth-lib-auth/);
});

test('modular-web preset coveragePatterns absorb broader paths into active stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await mkdir(path.join(repo, 'cli', 'sub'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'utils'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'controllers'), { recursive: true });
  await writeFile(path.join(repo, 'cli', 'main.js'), 'export {}\n');
  await writeFile(path.join(repo, 'cli', 'sub', 'extra.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'utils', 'helper.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'controllers', 'foo-controller.js'), 'export {}\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'cli_main', source_file: 'cli/main.js', label: 'main' },
      { id: 'cli_extra', source_file: 'cli/sub/extra.js', label: 'extra' },
      { id: 'utils_helper', source_file: 'public/modules/utils/helper.js', label: 'helper' },
      { id: 'foo_ctrl', source_file: 'server/controllers/foo-controller.js', label: 'foo' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.coverage.totals.uncovered_files, 0,
    `expected coveragePatterns to absorb all 4 files, got ${catalog.coverage.totals.uncovered_files} uncovered: ${JSON.stringify(catalog.coverage.uncovered.map((u) => u.path))}`);
  assert.equal(catalog.coverage.totals.coverage_ratio, 1,
    `expected coverage_ratio = 1, got ${catalog.coverage.totals.coverage_ratio}`);
});

test('brainbase preset emits semantically separated active stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'brainbase' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await mkdir(path.join(repo, 'cli'), { recursive: true });
  await mkdir(path.join(repo, 'mcp', 'brainbase', 'src'), { recursive: true });
  await mkdir(path.join(repo, 'mcp', 'jibble', 'src'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'mesh', 'crypto'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'services', 'session-runtime'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'core'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'app'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'domain', 'nocodb-task'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'terminal'), { recursive: true });

  await writeFile(path.join(repo, 'cli', 'main.js'), 'export {}\n');
  await writeFile(path.join(repo, 'mcp', 'brainbase', 'src', 'server.js'), 'export {}\n');
  await writeFile(path.join(repo, 'mcp', 'jibble', 'src', 'index.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'mesh', 'crypto', 'cipher.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'services', 'session-runtime', 'state.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'services', 'terminal-transport-service.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'services', 'github-service.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'core', 'event-bus.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'app', 'home.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'domain', 'nocodb-task', 'service.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'terminal', 'view.js'), 'export {}\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'cli', source_file: 'cli/main.js', label: 'cli' },
      { id: 'mcp_bb', source_file: 'mcp/brainbase/src/server.js', label: 'mcp-bb' },
      { id: 'mcp_jb', source_file: 'mcp/jibble/src/index.js', label: 'mcp-jb' },
      { id: 'mesh', source_file: 'server/mesh/crypto/cipher.js', label: 'mesh' },
      { id: 'sess', source_file: 'server/services/session-runtime/state.js', label: 'sess' },
      { id: 'term', source_file: 'server/services/terminal-transport-service.js', label: 'term' },
      { id: 'gh', source_file: 'server/services/github-service.js', label: 'gh' },
      { id: 'core', source_file: 'public/modules/core/event-bus.js', label: 'core' },
      { id: 'portal', source_file: 'public/modules/app/home.js', label: 'portal' },
      { id: 'nocodb', source_file: 'public/modules/domain/nocodb-task/service.js', label: 'nocodb' },
      { id: 'tview', source_file: 'public/modules/terminal/view.js', label: 'tview' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const ids = catalog.stories.map((s) => s.story_id);

  const expected = [
    'story-code-cli-tooling',
    'story-code-mcp-ssot',
    'story-code-mcp-external',
    'story-code-portal-views',
    'story-code-domain-data',
    'story-code-mana-detection',
    'story-code-terminal-runtime',
    'story-code-mesh-network',
    'story-code-external-integrations',
    'story-code-core-platform'
  ];
  for (const id of expected) {
    assert.ok(ids.includes(id), `expected ${id} in active stories, got ${JSON.stringify(ids)}`);
  }

  assert.equal(catalog.coverage.totals.uncovered_files, 0,
    `expected uncovered = 0 with brainbase preset, got ${catalog.coverage.totals.uncovered_files}`);
});

test('story derive surfaces domain subdirectories as separate candidates', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  // Place files under public/modules/domain/{task,session} so they would all
  // be grouped under "public/modules/domain" at depth 3 — but with depth 4
  // tuning, each subdomain should surface as its own candidate.
  await mkdir(path.join(repo, 'lib', 'auth-local'), { recursive: true });
  await mkdir(path.join(repo, 'lib', 'session-local'), { recursive: true });
  for (let i = 0; i < 3; i += 1) {
    await writeFile(path.join(repo, 'lib', 'auth-local', `auth${i}.js`), 'export {}\n');
  }
  for (let i = 0; i < 4; i += 1) {
    await writeFile(path.join(repo, 'lib', 'session-local', `sess${i}.js`), 'export {}\n');
  }

  const nodes = [];
  for (let i = 0; i < 3; i += 1) nodes.push({ id: `a${i}`, source_file: `lib/auth-local/auth${i}.js`, label: `auth${i}` });
  for (let i = 0; i < 4; i += 1) nodes.push({ id: `s${i}`, source_file: `lib/session-local/sess${i}.js`, label: `sess${i}` });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({ nodes, links: [] }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const paths = catalog.story_candidates.map((c) => c.common_path);

  assert.ok(paths.includes('lib/auth-local'),
    `expected lib/auth-local subdir candidate, got ${JSON.stringify(paths)}`);
  assert.ok(paths.includes('lib/session-local'),
    `expected lib/session-local subdir candidate, got ${JSON.stringify(paths)}`);
});

test('story derive omits singletons from story_candidates', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await mkdir(path.join(repo, 'cli'), { recursive: true });
  await writeFile(path.join(repo, 'cli', 'lonely.js'), 'export {}\n');
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'lonely', source_file: 'cli/lonely.js', label: 'lonely' }],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const cliCandidates = catalog.story_candidates.filter((c) => c.role === 'cli');
  assert.equal(cliCandidates.length, 0,
    `singletons must not be emitted as candidates, got ${JSON.stringify(cliCandidates)}`);
});

test('story derive suppresses next-app product stories for non-web repositories by default', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'src', 'pkg', 'trading_dag'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'pkg', 'decision_dag'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services', 'profile'), { recursive: true });
  await mkdir(path.join(repo, 'scripts'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'backtest_engine.py'), 'class BacktestEngine: pass\n');
  await writeFile(path.join(repo, 'src', 'session_learning.py'), 'def load_session(): return None\n');
  await writeFile(path.join(repo, 'src', 'lib', 'auth.py'), 'def auth_score(): return 0\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'profile', 'profile_score.py'), 'def score_profile(): return 0\n');
  await writeFile(path.join(repo, 'src', 'pkg', 'trading_dag', 'signals.py'), 'def emit_entry_signal(): pass\n');
  await writeFile(path.join(repo, 'src', 'pkg', 'decision_dag', 'notification_score.py'), 'def score(): return 0\n');
  await writeFile(path.join(repo, 'scripts', 'run_ctrader_shadow_trade.py'), 'print("shadow trade")\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'engine', source_file: 'src/backtest_engine.py', label: 'BacktestEngine' },
      { id: 'session', source_file: 'src/session_learning.py', label: 'load_session' },
      { id: 'auth', source_file: 'src/lib/auth.py', label: 'auth_score' },
      { id: 'profile', source_file: 'src/lib/services/profile/profile_score.py', label: 'profile_score' },
      { id: 'signals', source_file: 'src/pkg/trading_dag/signals.py', label: 'emit_entry_signal' },
      { id: 'notification', source_file: 'src/pkg/decision_dag/notification_score.py', label: 'notification_score' },
      { id: 'script', source_file: 'scripts/run_ctrader_shadow_trade.py', label: 'run_ctrader' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const storyIds = catalog.stories.map((story) => story.story_id);
  assert.equal(catalog.source.repo_profile.id, 'data-pipeline');
  assert.equal(storyIds.includes('story-product-auth-account-access'), false);
  assert.equal(storyIds.includes('story-product-content-cms'), false);
  assert.equal(storyIds.includes('story-product-notification'), false);
  assert.equal(storyIds.includes('story-product-profile-personalization'), false);
  const warning = catalog.source.warnings.find((item) => item.code === 'needs_domain_confirmation');
  assert.ok(warning, `expected needs_domain_confirmation warning, got ${JSON.stringify(catalog.source.warnings)}`);
  assert.equal(warning.suppressed_story_ids.includes('story-product-auth-account-access'), true);
  assert.equal(warning.suppressed_story_ids.includes('story-product-notification'), true);
  assert.equal(warning.suppressed_story_ids.includes('story-product-profile-personalization'), true);
  const profileSuppression = warning.suppressed.find((item) => item.story_id === 'story-product-profile-personalization');
  assert.equal(profileSuppression.reason, 'repo_profile_not_web_product');
  assert.equal(profileSuppression.evidence_paths.includes('src/lib/services/profile/profile_score.py'), true);
  assert.deepEqual(profileSuppression.required_profile, ['next-app', 'web']);

  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /Repo profile: data-pipeline/);
  assert.match(map, /needs_domain_confirmation/);

  const explicitResult = await runCli(['story', 'derive', repo, '--preset', 'next-app']);
  assert.equal(explicitResult.exitCode, 0);
  const explicitCatalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const explicitIds = explicitCatalog.stories.map((story) => story.story_id);
  assert.equal(explicitCatalog.source.preset_resolution.mode, 'explicit');
  assert.equal(explicitIds.includes('story-product-auth-account-access'), true);
  assert.equal(explicitIds.includes('story-product-profile-personalization'), true);
  assert.equal(explicitCatalog.source.warnings.some((item) => item.code === 'needs_domain_confirmation'), false);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { ...(config.story_catalog ?? {}), preset: 'next-app' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const configPresetResult = await runCli(['story', 'derive', repo]);
  assert.equal(configPresetResult.exitCode, 0);
  const configPresetCatalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const configPresetIds = configPresetCatalog.stories.map((story) => story.story_id);
  assert.equal(configPresetCatalog.source.preset_resolution.mode, 'explicit');
  assert.equal(configPresetCatalog.source.preset_resolution.requested, 'next-app');
  assert.equal(configPresetIds.includes('story-product-auth-account-access'), true);
  assert.equal(configPresetIds.includes('story-product-profile-personalization'), true);
  assert.equal(configPresetCatalog.source.warnings.some((item) => item.code === 'needs_domain_confirmation'), false);
});

test('story derive keeps next-app preset behavior when preset is unset', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'src', 'components', 'auth'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'components', 'auth', 'LoginForm.tsx'),
    'export function LoginForm() { return null; }\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'login_form', source_file: 'src/components/auth/LoginForm.tsx', label: 'LoginForm' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.preset, 'next-app');
  assert.equal(catalog.source.preset_resolution.mode, 'auto');
  assert.equal(catalog.source.repo_profile.id, 'web');
  assert.equal(catalog.source.warnings.some((item) => item.code === 'needs_domain_confirmation'), false);
  const storyIds = catalog.stories.map((story) => story.story_id);
  assert.equal(storyIds.includes('story-product-auth-account-access'), true);
  assert.ok(catalog.coverage.totals.graph_story_relevant_files > 0,
    `default preset must keep classifying src/ files as relevant`);
  const roles = catalog.coverage.by_role.map((entry) => entry.role);
  assert.ok(roles.includes('component'),
    `default preset must classify src/components/** as 'component', got ${JSON.stringify(roles)}`);
});

test('story derive uses document evidence without weak non-web code paths', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'features'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'session_learning.py'), 'def load_session(): return None\n');
  await writeFile(path.join(repo, 'docs', 'features', 'auth.md'), `---
story_id: story-product-auth-account-access
---

# Auth Story

User-facing account access is an explicit product requirement.
`);
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'session', source_file: 'src/session_learning.py', label: 'load_session' },
      { id: 'auth_doc', source_file: 'docs/features/auth.md', label: 'Auth Story' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.repo_profile.product_surface_applicable, false);
  const story = catalog.stories.find((item) => item.story_id === 'story-product-auth-account-access');
  assert.ok(story, `expected doc-promoted auth story, got ${catalog.stories.map((item) => item.story_id).join(', ')}`);
  assert.equal(story.source.paths.includes('docs/features/auth.md'), true);
  assert.equal(story.source.paths.includes('src/session_learning.py'), false);
});

test('pr prepare --strict requires --task option', async () => {
  const repo = await makeGitRepoWithStory();
  let stderrOut = '';
  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--strict'], {
    stderr: { write: (text) => { stderrOut += text; } }
  });
  assert.equal(result.exitCode, 1);
  assert.match(stderrOut, /Strict mode requires --task/);
});

test('pr prepare --strict rejects when task artifacts are missing', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-strict', '--title', 'Strict Test', '--view', 'dev', '--period', '2026-W18']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init']);
  await git(repo, ['switch', '-c', 'feature/strict']);

  // task list のみ作成（briefing/plan/handoff は未作成）
  const taskDir = path.join(repo, '.vibepro', 'stories', 'story-strict', 'tasks');
  await mkdir(taskDir, { recursive: true });
  await writeFile(path.join(taskDir, 'tasks.json'), JSON.stringify({
    schema_version: '0.1.0',
    story: { story_id: 'story-strict' },
    source_run: { run_id: 'run-1' },
    tasks: [{ id: 'TASK-S1', title: 'strict task', target_files: ['src/index.js'] }]
  }));

  let stderrOut = '';
  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--task', 'TASK-S1', '--strict'], {
    stderr: { write: (text) => { stderrOut += text; } }
  });
  assert.equal(result.exitCode, 1);
  assert.match(stderrOut, /Strict mode requires task artifacts/);
  assert.match(stderrOut, /briefing\.md/);
});

test('--version prints the package version', async () => {
  const versions = [];
  for (const arg of ['--version', '-v', 'version']) {
    let out = '';
    const result = await runCli([arg], { stdout: { write: (text) => { out += text; } } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.command, 'version');
    assert.match(out.trim(), /^\d+\.\d+\.\d+/);
    versions.push(out.trim());
  }
  assert.equal(new Set(versions).size, 1);
});

test('doctor detects missing .vibepro/ entry in .gitignore and fixes it', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  // Overwrite .gitignore so .vibepro/ entry is missing
  await writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');

  const dryRun = await runCli(['doctor', repo, '--json']);
  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.checks.some((check) => check.id === 'VP-DOCTOR-GITIGNORE-MISSING'), true);
  assert.equal(dryRun.result.overall_status, 'needs_maintenance');

  const fixed = await runCli(['doctor', repo, '--fix']);
  assert.equal(fixed.exitCode, 0);
  assert.equal(fixed.result.repairs.some((repair) => repair.id === 'ensure-gitignore-vibepro'), true);
  const gitignore = await readFile(path.join(repo, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.vibepro\/$/m);
  assert.match(gitignore, /node_modules\//);

  const after = await runCli(['doctor', repo, '--json']);
  assert.equal(after.result.checks.some((check) => check.id === 'VP-DOCTOR-GITIGNORE-MISSING'), false);
});

test('doctor --fix creates .gitignore when it is absent', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  // Remove the .gitignore entirely.
  await writeFile(path.join(repo, '.gitignore'), '');

  const dryRun = await runCli(['doctor', repo, '--json']);
  assert.equal(dryRun.result.checks.some((check) => check.id === 'VP-DOCTOR-GITIGNORE-MISSING'), true);

  await runCli(['doctor', repo, '--fix']);
  const gitignore = await readFile(path.join(repo, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.vibepro\/$/m);
});

test('story report writes index.html and links resolve to latest run artifacts', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-html', '--title', 'HTML Story', '--view', 'dev', '--period', '2026-W18']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  // Provide a graph.html artefact since graphify import may not produce one in tests.
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.html'), '<!doctype html><title>Graph</title>');
  await runCli(['story', 'select', repo, '--id', 'story-html']);
  await runCli(['diagnose', repo, '--run-id', 'run-old']);
  await runCli(['diagnose', repo, '--run-id', 'run-latest']);

  const result = await runCli(['story', 'report', repo]);
  assert.equal(result.exitCode, 0);
  const storyDir = path.join(repo, '.vibepro', 'stories', 'story-html');
  const htmlPath = path.join(storyDir, 'index.html');
  await stat(htmlPath);

  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /Latest Run Artifacts \(run-latest\)/);
  // Old run id should not appear in the latest-run section.
  assert.equal(html.includes('Latest Run Artifacts (run-old)'), false);

  // Extract every href and confirm it resolves to an actual file.
  const hrefMatches = [...html.matchAll(/href="([^"#]+)"/g)].map((match) => match[1]);
  assert.equal(hrefMatches.length > 0, true);
  for (const href of hrefMatches) {
    const resolved = path.resolve(storyDir, href);
    await stat(resolved);
  }

  // Spot-check: the summary link must point to the latest run, not the older one.
  const summaryHref = hrefMatches.find((href) => href.endsWith('summary.md'));
  assert.equal(summaryHref?.includes('run-latest'), true);
  assert.equal(summaryHref?.includes('run-old'), false);

  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.stories['story-html'].latest_report_html, '.vibepro/stories/story-html/index.html');
  assert.equal(manifest.stories['story-html'].latest_report_run_id, 'run-latest');
});

test('vibepro commands only write files under .vibepro/ in the target repo', async () => {
  const repo = await makeRepo();
  // Snapshot of repo top-level entries before any vibepro command (just index.html created by makeRepo).
  const before = new Set(await readdirSafe(repo));
  await runCli(['init', repo, '--story-id', 'story-stray', '--title', 'No Stray', '--view', 'dev', '--period', '2026-W18']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'a' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', 'run-stray']);
  await runCli(['story', 'report', repo]);
  await runCli(['doctor', repo, '--fix']);

  const after = new Set(await readdirSafe(repo));
  const allowed = new Set([...before, '.vibepro', '.gitignore', 'graphify-out']);
  for (const entry of after) {
    assert.equal(allowed.has(entry), true, `Unexpected top-level entry "${entry}" written by vibepro outside .vibepro/`);
  }
  // Verify nothing else changed under repo root that's not in allowed list.
  // Crucially the workspace must exist.
  await stat(path.join(repo, '.vibepro'));
});

async function readdirSafe(dir) {
  const { readdir } = await import('node:fs/promises');
  try {
    return await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    }
  };
}
