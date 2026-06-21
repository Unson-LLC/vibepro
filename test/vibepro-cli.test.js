import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
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
import { collectGitStatusFingerprints } from '../src/git-fingerprint.js';
import { scanLocalDev } from '../src/local-dev-scanner.js';
import { scanNetworkContracts } from '../src/network-contract-scanner.js';
import { preparePullRequest } from '../src/pr-manager.js';
import { scanPublicDiscovery } from '../src/public-discovery-scanner.js';
import { renderAgentReviewPrSection } from '../src/agent-review.js';
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

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

async function runCliWithStdout(args) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdout: {
      write(chunk) {
        stdout += chunk;
      }
    },
    stderr: {
      write(chunk) {
        stderr += chunk;
      }
    }
  });
  return { ...result, stdout, stderr };
}

async function makeFakeGh(pr) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gh-bin-'));
  const ghPath = path.join(binDir, 'gh');
  await writeFile(ghPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] !== 'pr' || args[1] !== 'view') {
  process.stderr.write('unexpected gh command: ' + args.join(' '));
  process.exit(1);
}
console.log(${JSON.stringify(JSON.stringify(pr))});
`);
  await chmod(ghPath, 0o755);
  return binDir;
}

async function makeFakeGhMerge(state) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gh-merge-bin-'));
  const ghPath = path.join(binDir, 'gh');
  const statePath = path.join(binDir, 'state.json');
  await writeJson(statePath, state);
  await writeFile(ghPath, `#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const statePath = ${JSON.stringify(statePath)};
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (args[0] !== 'pr') {
  process.stderr.write('unexpected gh command: ' + args.join(' '));
  process.exit(1);
}
if (args[1] === 'view') {
  const merged = state.merged === true;
  const fieldsArg = args[args.indexOf('--json') + 1] || '';
  if (fieldsArg.includes('mergedAt')) {
    console.log(JSON.stringify({
      url: state.url,
      state: merged ? 'MERGED' : 'OPEN',
      mergedAt: merged ? state.mergedAt : null,
      mergeCommit: merged && !state.omitMergeCommit ? { oid: state.mergeCommit } : null
    }));
    process.exit(0);
  }
  console.log(JSON.stringify({
    url: state.url,
    state: merged ? 'MERGED' : 'OPEN',
    isDraft: false,
    mergeStateStatus: merged ? 'UNKNOWN' : state.mergeStateStatus,
    reviewDecision: state.reviewDecision,
    headRefName: state.headRefName,
    headRefOid: state.headRefOid,
    baseRefName: state.baseRefName,
    statusCheckRollup: state.statusCheckRollup
  }));
  process.exit(0);
}
if (args[1] === 'merge') {
  if (state.mergeExitCode && state.mergeExitCode !== 0) {
    process.stderr.write(state.mergeStderr || 'merge failed');
    process.exit(state.mergeExitCode);
  }
  state.merged = true;
  if (state.remotePath) {
    execFileSync('git', [
      '--git-dir',
      state.remotePath,
      'update-ref',
      'refs/heads/' + state.baseRefName,
      state.headRefOid
    ]);
    if (!state.omitMergeCommit) state.mergeCommit = state.headRefOid;
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
  console.log(state.mergeStdout || 'merged');
  process.exit(0);
}
process.stderr.write('unexpected gh command: ' + args.join(' '));
process.exit(1);
`);
  await chmod(ghPath, 0o755);
  return { binDir, statePath };
}

async function gitFingerprintHash(repo) {
  const [status, diff, untracked] = await Promise.all([
    git(repo, ['status', '--porcelain', '-uall']),
    git(repo, ['diff', '--binary']),
    collectUntrackedFingerprint(repo)
  ]);
  const dirtyDiff = [diff.stdout.trimEnd(), untracked].filter(Boolean).join('\n');
  return createHash('sha256').update([
    'git-status --porcelain -uall',
    status.stdout.trimEnd(),
    'git-diff --binary',
    dirtyDiff
  ].join('\n')).digest('hex');
}

async function collectUntrackedFingerprint(repo) {
  const output = await git(repo, ['ls-files', '--others', '--exclude-standard']);
  const files = output.stdout.split('\n').filter(Boolean).sort().slice(0, 200);
  const chunks = [];
  for (const file of files) {
    chunks.push(`untracked:${file}\n${await readFile(path.join(repo, file), 'utf8')}`);
  }
  return chunks.join('\n');
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
    architecture_spec: ['architecture_boundary', 'spec_consistency', 'regression_risk'],
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
        'gpt-5.5',
        ...(stage === 'gate' && role === 'gate_evidence'
          ? ['--inspection-summary', 'read route gate evidence and verified required test coverage']
          : []),
        '--agent-closed'
      ]);
      assert.equal(result.exitCode, 0);
    }
  }
}

async function recordAgentReviewStage(repo, storyId, stage, roles) {
  await runCli([
    'review',
    'prepare',
    repo,
    '--id',
    storyId,
    '--stage',
    stage,
    ...roles.flatMap((role) => ['--role', role])
  ]);
  for (const role of roles) {
    const result = await runCliWithStdout([
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
      `${stage}-${role}-agent`,
      '--agent-thread-id',
      `${stage}-${role}-thread`,
      ...(stage === 'gate'
        ? [
            '--inspection-summary',
            `read ${stage}:${role} evidence and verified required test coverage`,
            '--inspection-input',
            '.vibepro/pr/story-pr-prepare/pr-prepare.json',
            '--inspection-input',
            'test/vibepro-cli.test.js',
            '--judgment-delta',
            `generic ${stage}:${role} pass -> accepted because PR artifacts and focused tests were inspected`
          ]
        : []),
      '--agent-closed'
    ]);
    assert.equal(result.exitCode, 0, JSON.stringify(result, null, 2));
  }
}

async function writeMinimalTaskState(repo, storyId = 'story-pr-prepare') {
  const tasksDir = path.join(repo, '.vibepro', 'stories', storyId, 'tasks');
  await mkdir(tasksDir, { recursive: true });
  await writeFile(path.join(tasksDir, 'tasks.json'), JSON.stringify({
    schema_version: '0.1.0',
    generated_at: '2026-04-30T00:00:00.000Z',
    story: {
      story_id: storyId,
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
      target_files: ['src/cli-helper.js'],
      target_routes: [],
      target_groups: [],
      read_first_files: [{ file: 'src/cli-helper.js', reason: '対象実装' }],
      recommended_strategy: { id: 'task-driven-pr', reason: 'Task/HandoffとPRを接続する' },
      implementation_steps: [],
      acceptance_criteria: ['Task/HandoffがPR本文に入る'],
      graph_context: null,
      pre_fix_briefing: null
    }]
  }, null, 2));
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

test('pr prepare reports preferred managed worktree gate without blocking', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'managed-worktree-preferred.js'), 'export const preferred = true;\n');
  await git(repo, ['add', 'src/managed-worktree-preferred.js']);
  await git(repo, ['commit', '-m', 'feat: add preferred worktree fixture']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);

  assert.equal(result.exitCode, 0);
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
  const gate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:managed_worktree');
  assert.equal(gate.status, 'needs_review');
  assert.equal(gate.required, false);
  assert.equal(prepare.pr_context.managed_worktree_gate.status, 'needs_review');
  assert.equal(prepare.pr_context.gate_dag.summary.managed_worktree_status, 'needs_review');
  assert.equal(prepare.gate_status.critical_unresolved_gates.some((node) => node.id === 'gate:managed_worktree'), false);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /- 管理worktree: needs_review/);
});

test('managed worktree gate is not applicable when disabled', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution.managed_worktree = 'disabled';
  await writeJson(configPath, config);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'managed-worktree-disabled.js'), 'export const disabled = true;\n');
  await git(repo, ['add', 'src/managed-worktree-disabled.js']);
  await git(repo, ['commit', '-m', 'feat: add disabled worktree fixture']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);

  assert.equal(result.exitCode, 0);
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
  const gate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:managed_worktree');
  assert.equal(gate.status, 'not_applicable');
  assert.equal(gate.required, false);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /- 管理worktree: disabled/);
});

test('required managed worktree gate blocks evidence commands outside managed worktree', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution.managed_worktree = 'required';
  await writeJson(configPath, config);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'managed-worktree-required.js'), 'export const required = true;\n');
  await git(repo, ['add', 'src/managed-worktree-required.js']);
  await git(repo, ['commit', '-m', 'feat: add required worktree fixture']);

  const prepareResult = await runCliWithStdout(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  assert.equal(prepareResult.exitCode, 1);
  assert.match(prepareResult.stderr, /managed worktree required for pr prepare/);

  let verifyStderr = '';
  const verifyResult = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--summary',
    'unit passed'
  ], {
    stderr: { write: (text) => { verifyStderr += text; } }
  });
  assert.equal(verifyResult.exitCode, 1);
  assert.match(verifyStderr, /managed worktree required for verify record/);

  let reviewStderr = '';
  const reviewResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence passed',
    '--inspection-summary',
    'checked managed worktree gate',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'gate-agent',
    '--agent-closed'
  ], {
    stderr: { write: (text) => { reviewStderr += text; } }
  });
  assert.equal(reviewResult.exitCode, 1);
  assert.match(reviewStderr, /managed worktree required for review record/);
});

test('required managed worktree gate accepts local execution state or accepted waiver', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution.managed_worktree = 'required';
  await writeJson(configPath, config);
  await mkdir(path.join(repo, '.vibepro', 'executions', 'story-pr-prepare'), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'executions', 'story-pr-prepare', 'state.json'), {
    schema_version: '0.1.0',
    story_id: 'story-pr-prepare',
    managed_worktree: {
      mode: 'required',
      status: 'available',
      required: true,
      path: repo,
      branch: 'feature/test-story'
    }
  });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'managed-worktree-passed.js'), 'export const passed = true;\n');
  await git(repo, ['add', 'src/managed-worktree-passed.js']);
  await git(repo, ['commit', '-m', 'feat: add passed worktree fixture']);

  const prepareResult = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  assert.equal(prepareResult.exitCode, 0);
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
  assert.equal(prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:managed_worktree').status, 'passed');

  const outsideRepo = await makeGitRepoWithStory();
  const outsideConfigPath = path.join(outsideRepo, '.vibepro', 'config.json');
  const outsideConfig = await readJson(outsideConfigPath);
  outsideConfig.execution.managed_worktree = 'required';
  await writeJson(outsideConfigPath, outsideConfig);
  await runCli([
    'decision',
    'record',
    outsideRepo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:managed_worktree',
    '--summary',
    'Emergency fix can run outside the managed worktree.',
    '--reason',
    'CI recovery requires recording evidence before a managed worktree is available.',
    '--reviewer',
    'codex',
    '--status',
    'accepted'
  ]);
  const verifyResult = await runCli([
    'verify',
    'record',
    outsideRepo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--summary',
    'unit passed with accepted managed worktree waiver'
  ]);
  assert.equal(verifyResult.exitCode, 0);
});

test('decision record captures noise waiver and secret exposure in auditable artifacts', async () => {
  const repo = await makeGitRepoWithStory();
  const runCliExpectingStderr = async (args) => {
    let stderr = '';
    const result = await runCli(args, {
      stderr: { write: (text) => { stderr += text; } }
    });
    return { ...result, stderr };
  };

  const noise = await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'noise',
    '--source',
    'gate:requirement',
    '--source-status',
    'needs_review',
    '--summary',
    'Mock-only branch was flagged as needs_review but does not affect runtime behavior.',
    '--reason',
    'The finding points to a test fixture and has no production route.',
    '--reviewer',
    'codex',
    '--json'
  ]);
  assert.equal(noise.exitCode, 0);

  const secret = await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'secret_exposure',
    '--source',
    'chat:latest',
    '--summary',
    'User pasted API key AIzaSyCCXrP25ExGU0CIW3RJhNmUaUVOaEcxglM in chat.',
    '--secret-location',
    'conversation',
    '--secret-action',
    'rotated',
    '--json'
  ]);
  assert.equal(secret.exitCode, 0);
  assert.match(secret.result.decision.summary, /\[REDACTED:/);
  assert.doesNotMatch(secret.result.decision.summary, /AIzaSyCCXrP25ExGU0CIW3RJhNmUaUVOaEcxglM/);

  const waiver = await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:e2e',
    '--summary',
    'E2E is not applicable for this CLI-only artifact workflow.',
    '--reason',
    'The changed surface is non-UI CLI and PR artifact generation covered by unit and integration checks.',
    '--reviewer',
    'codex',
    '--json'
  ]);
  assert.equal(waiver.exitCode, 0);

  const missingNoiseReason = await runCliExpectingStderr([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'noise',
    '--summary',
    'Missing reason should fail.',
    '--json'
  ]);
  assert.notEqual(missingNoiseReason.exitCode, 0);
  assert.match(missingNoiseReason.stderr, /--type noise requires --reason/);

  const missingWaiverReason = await runCliExpectingStderr([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--summary',
    'Missing reason should fail.',
    '--json'
  ]);
  assert.notEqual(missingWaiverReason.exitCode, 0);
  assert.match(missingWaiverReason.stderr, /--type waiver requires --reason/);

  const missingSecretLocation = await runCliExpectingStderr([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'secret_exposure',
    '--summary',
    'A secret was pasted and redacted.',
    '--secret-action',
    'redacted',
    '--json'
  ]);
  assert.notEqual(missingSecretLocation.exitCode, 0);
  assert.match(missingSecretLocation.stderr, /--type secret_exposure requires --secret-location/);

  const missingSecretAction = await runCliExpectingStderr([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'secret_exposure',
    '--summary',
    'A secret was pasted and redacted.',
    '--secret-location',
    'conversation',
    '--json'
  ]);
  assert.notEqual(missingSecretAction.exitCode, 0);
  assert.match(missingSecretAction.stderr, /--type secret_exposure requires --secret-action/);

  const records = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'decision-records.json'));
  assert.equal(records.decisions.length, 3);
  assert.equal(records.decisions.find((decision) => decision.type === 'secret_exposure').secret_exposure.value_recorded, false);

  const status = await runCli([
    'decision',
    'status',
    repo,
    '--id',
    'story-pr-prepare',
    '--json'
  ]);
  assert.equal(status.exitCode, 0, status.stderr);
  assert.equal(status.result.summary.total, 3);
  assert.equal(status.result.summary.open, 0);
  assert.equal(status.result.summary.by_type.noise, 1);
  assert.equal(status.result.summary.by_type.waiver, 1);
  assert.equal(status.result.summary.by_type.secret_exposure, 1);

  const prepare = await runCli([
    'pr',
    'prepare',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--json'
  ]);
  assert.equal(prepare.exitCode, 0, prepare.stderr);
  assert.equal(prepare.result.preparation.pr_context.decision_records.summary.by_type.noise, 1);
  assert.equal(prepare.result.preparation.pr_context.decision_records.summary.by_type.waiver, 1);
  assert.equal(prepare.result.preparation.pr_context.decision_records.summary.by_type.secret_exposure, 1);
  const decisionGate = prepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:decision_record');
  assert.equal(decisionGate.status, 'passed');
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'decision-records.json')), true);
  const humanReview = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'human-review.json'));
  assert.equal(humanReview.source_artifacts.decision_records, '.vibepro/pr/story-pr-prepare/decision-records.json');
});

test('open decision records remain blocking until classified', async () => {
  const repo = await makeGitRepoWithStory();
  const result = await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'needs_review',
    '--source',
    'check:ui',
    '--summary',
    'Interactive element finding still needs owner classification.',
    '--status',
    'open',
    '--json'
  ]);
  assert.equal(result.exitCode, 0);

  const prepare = await runCli([
    'pr',
    'prepare',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--json'
  ]);
  assert.equal(prepare.exitCode, 0, prepare.stderr);
  const decisionGate = prepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:decision_record');
  assert.equal(decisionGate.status, 'needs_review');
  assert.equal(decisionGate.open_decisions[0].source, 'check:ui');
  assert.equal(prepare.result.preparation.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:decision_record'), true);
});

test('INV-001 INV-002 INV-003 C-001 C-002 S-001 design-modernize plan creates Design Cognition Loop evidence and explicit gate checks', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'home', '_components'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'map'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'home', 'page.tsx'), `
    export default function HomePage() {
      const [loading] = useState(false);
      return <>
        <button aria-label="地図で探す">地図で探す</button>
        <Button>{loading ? 'loading' : iconOnly}</Button>
      </>;
    }
  `);
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'home', '_components', 'HomeActions.tsx'), `
    export function HomeActions() {
      return <Button>条件から探す</Button>;
    }
  `);
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'map', 'page.tsx'), `
    export default function MapPage({ searchParams }) {
      return <a href="/detail">詳しく探す</a>;
    }
  `);
  await writeFile(path.join(repo, 'aitle-ds.json'), JSON.stringify({
    version: { versionNumber: 1 },
    bundle: {
      theme: ':root { --ds-color-brand: #7c3aed; --ds-space-2: 8px; --ds-font-body: "Noto Sans JP"; }',
      styles: ':root { --ds-surface-base: #111111; --ds-text-primary: #ffffff; }',
      componentsCss: '.ds-ai-phone-cta { color: var(--ds-color-brand); } .ds-hotel-card { display: grid; }',
      componentsJs: 'customElements.define("ds-ai-phone-cta", class extends HTMLElement {}); customElements.define("ds-hotel-card", class extends HTMLElement {});'
    },
    overview: 'Keep dense search controls scannable. AI phone CTA is the primary action.'
  }));

  const result = await runCli([
    'design-modernize',
    'plan',
    repo,
    '--id',
    'story-aitle-ds-modernize',
    '--product',
    'Aitle',
    '--routes',
    '/home,/map',
    '--brief',
    'Japanese hotel discovery app with map exploration, hotel cards, AI phone confirmation, and availability search.',
    '--design-system-bundle',
    'aitle-ds.json',
    '--design-system-id',
    '1c436280-9432-4bf0-b4fd-15585d6482f0',
    '--json'
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.plan.spec_gate.mode, 'explicit');
  assert.equal(result.result.plan.spec_gate.fallback_allowed, false);
  assert.equal(result.result.plan.design_intelligence.external_generator_required, false);
  assert.equal(result.result.plan.derived_design_system.source, 'vibepro_derived_from_product_evidence');
  assert.equal(result.result.plan.derived_design_system.authority, 'internal_design_constraints');
  assert.equal(result.result.plan.product_semantic_model.primary_domain, 'hotel_discovery');
  assert.equal(result.result.plan.derived_design_system.visual_hypothesis_policy.image_generation_role, 'explore_candidate_visual_directions_only');
  assert.ok(result.result.plan.component_role_map.roles.some((role) => role.name === 'AIPhoneCTA'));
  assert.equal(result.result.plan.design_quality_dag.model, 'vibepro-design-quality-dag-v1');
  assert.equal(result.result.plan.visual_hypothesis.authority, 'evidence_only');
  assert.equal(result.result.plan.visual_hypothesis.status, 'needs_image_generation');
  assert.equal(result.result.plan.visual_hypothesis.screens[0].route, '/home');
  assert.match(result.result.plan.visual_hypothesis.screens[0].prompt, /current screenshot/);
  assert.match(result.result.plan.visual_hypothesis.screens[0].prompt, /risky or rejected moves/);
  assert.ok(result.result.plan.design_constraint_graph.component_roles.includes('primary_cta'));
  assert.ok(result.result.plan.design_constraint_graph.state_semantics.includes('available'));
  assert.equal(result.result.plan.reference_design_system.version, 1);
  assert.ok(result.result.plan.reference_design_system.token_summary.count >= 5);
  assert.ok(result.result.plan.reference_design_system.component_summary.names.includes('ds-ai-phone-cta'));
  assert.equal(result.result.plan.screens.length, 2);
  assert.match(result.result.plan.screens[0].design_brief.body, /Design Quality DAG/);
  assert.match(result.result.plan.screens[0].design_brief.body, /地図で探す/);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'implementation-spec.md')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'design-constraint-graph.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'derived-design-system.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'product-semantic-model.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'component-role-map.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'composition-guidelines.md')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'ds-gate.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'visual-hypothesis-prompts.md')), true);
  const spec = await readFile(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'implementation-spec.md'), 'utf8');
  const visualPrompts = await readFile(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'visual-hypothesis-prompts.md'), 'utf8');
  const derivedDesignSystem = await readJson(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'derived-design-system.json'));
  const dsGate = await readJson(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'ds-gate.json'));
  assert.match(spec, /INV-HOME-1/);
  assert.match(spec, /AP-GLOBAL-1/);
  assert.match(spec, /DQ-GLOBAL-1/);
  assert.match(visualPrompts, /Generated images are not implementation authority/);
  assert.match(visualPrompts, /VH-HOME-INV/);
  assert.equal(derivedDesignSystem.foundations.token_dependency_order[0], 'raw_theme');
  assert.ok(derivedDesignSystem.composition_guidelines.rules.some((rule) => /AI phone confirmation/.test(rule.statement)));
  assert.equal(dsGate.fallback_allowed, false);
  assert.ok(dsGate.checks.some((check) => check.id === 'DS-GATE-VISUAL-HYPOTHESIS'));

  const derivedOnly = await runCli([
    'design-modernize',
    'derive-system',
    repo,
    '--id',
    'story-aitle-derived-only',
    '--product',
    'Aitle',
    '--routes',
    '/home,/map',
    '--brief',
    'Japanese hotel discovery app with map exploration, AI電話で空室確認, 休憩, 宿泊, サービスタイム, 今すぐ. Avoid Book Now.',
    '--json'
  ]);
  assert.equal(derivedOnly.exitCode, 0);
  assert.equal(derivedOnly.result.result.workflow, 'design-system-derivation');
  assert.equal(derivedOnly.result.result.external_generator_required, false);
  assert.equal(derivedOnly.result.result.product_semantic_model.interaction_model, 'discovery_to_ai_phone_confirmation');
  assert.ok(derivedOnly.result.result.derived_design_system.anti_patterns.some((item) => /Book Now/.test(item.statement)));
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-derived-only', 'design-system-derivation.md')), true);

  const operationalRepo = await makeRepo();
  await mkdir(path.join(operationalRepo, 'src', 'app', 'dashboard'), { recursive: true });
  await mkdir(path.join(operationalRepo, 'src', 'app', 'projects'), { recursive: true });
  await mkdir(path.join(operationalRepo, 'src', 'app', 'companies'), { recursive: true });
  await mkdir(path.join(operationalRepo, 'src', 'app', 'admin', 'templates'), { recursive: true });
  await writeFile(path.join(operationalRepo, 'src', 'app', 'dashboard', 'page.tsx'), `
    export function DashboardHeader() {
      return <header><button>新規プロジェクト</button></header>;
    }
    export default function DashboardPage() {
      return <DashboardHeader />;
    }
  `);
  await writeFile(path.join(operationalRepo, 'src', 'app', 'projects', 'page.tsx'), `
    export function ProjectListTable() {
      return <section><button>プロジェクトを作成</button><a href="/companies">Companies</a></section>;
    }
    export default function ProjectsPage() {
      return <ProjectListTable />;
    }
  `);
  await writeFile(path.join(operationalRepo, 'src', 'app', 'companies', 'page.tsx'), `
    export function CompanyManagementGrid() {
      const [loading] = useState(false);
      return <section>{loading ? 'loading' : <button>会社を追加</button>}</section>;
    }
    export default function CompaniesPage() {
      return <CompanyManagementGrid />;
    }
  `);
  await writeFile(path.join(operationalRepo, 'src', 'app', 'admin', 'templates', 'page.tsx'), `
    export function TemplateOperationsPanel() {
      return <section><button>テンプレートを保存</button></section>;
    }
    export default function TemplatesPage() {
      return <TemplateOperationsPanel />;
    }
  `);

  const salesTailorDs = await runCli([
    'design-system',
    'derive',
    operationalRepo,
    '--id',
    'salestailor-core-uiux',
    '--product',
    'SalesTailor',
    '--brief',
    'Operational SaaS for sales engagement. Preserve dashboards, project management, company management, product management, and template operations. Do not use hotel, map, or booking metaphors.',
    '--from-code',
    '--json'
  ]);
  assert.equal(salesTailorDs.exitCode, 0);
  assert.equal(salesTailorDs.result.result.product_semantics.primary_domain, 'product_workflow');
  assert.doesNotMatch(JSON.stringify(salesTailorDs.result.result.product_semantics), /hotel_discovery|location_search|map_exploration/);
  assert.deepEqual(salesTailorDs.result.result.source_evidence.routes.sort(), ['/admin/templates', '/companies', '/dashboard', '/projects']);
  const salesTailorRoles = salesTailorDs.result.result.component_roles.roles.map((role) => role.name);
  assert.ok(salesTailorRoles.includes('ProjectListTable'));
  assert.ok(salesTailorRoles.includes('CompanyManagementGrid'));
  assert.equal(salesTailorRoles.some((name) => ['HotelCard', 'MapPricePin', 'AIPhoneCTA'].includes(name)), false);

  const negatedDerived = await runCli([
    'design-modernize',
    'derive-system',
    operationalRepo,
    '--id',
    'story-sales-ops-ds',
    '--product',
    'SalesTailor',
    '--routes',
    '/dashboard,/projects',
    '--brief',
    'Sales operations workspace. Do not use hotel, map, or booking metaphors; keep project tables, company lists, filters, and admin templates.',
    '--json'
  ]);
  assert.equal(negatedDerived.exitCode, 0);
  assert.equal(negatedDerived.result.result.product_semantic_model.primary_domain, 'product_workflow');
  assert.equal(negatedDerived.result.result.component_role_map.roles.some((role) => ['HotelCard', 'MapPricePin', 'AIPhoneCTA'].includes(role.name)), false);

  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'route:/home', kind: 'route', file: 'src/app/(app)/home/page.tsx' },
      { id: 'component:HomeActions', kind: 'component', file: 'src/app/(app)/home/_components/HomeActions.tsx' },
      { id: 'route:/map', kind: 'route', file: 'src/app/(app)/map/page.tsx' }
    ],
    edges: [
      { from: 'route:/home', to: 'component:HomeActions' },
      { from: 'route:/home', to: 'route:/map' }
    ]
  }, null, 2));
  await writeFile(path.join(repo, 'visual-brief.md'), `# Aitle Visual Foundations

- Design language: quiet premium travel utility, not a marketing landing page.
- Mobile density: dense scannable hotel comparison with compact Japanese labels.
- Semantic color roles: brand interactive, surface raised, text muted, availability positive, urgency caution.
- Typography: compact Japanese mobile scale with tabular price numerals.
- Spacing radius motion shadow: 8px radius, restrained elevation, snappy sheet motion.
- Component visual requirements: AI電話 CTA is the primary native action; hotel cards stay dense.
- Composition requirements: map and result screens preserve current hierarchy and bottom sheet behavior.
- Native CTA language: AI電話で空室確認, 地図で探す, 条件から探す.
- Forbidden generic CTAs: avoid Book Now and generic booking-funnel language.
`);

  const nativeDesignSystem = await runCli([
    'design-system',
    'derive',
    repo,
    '--id',
    'aitle',
    '--product',
    'Aitle',
    '--routes',
    '/home,/map',
    '--brief',
    'Japanese hotel discovery app with location search, map exploration, AI電話で空室確認, 休憩, 宿泊, サービスタイム, 今すぐ.',
    '--brief-file',
    'visual-brief.md',
    '--from-code',
    '--json'
  ]);
  assert.equal(nativeDesignSystem.exitCode, 0);
  assert.equal(nativeDesignSystem.result.result.workflow, 'native-design-system-derivation');
  assert.equal(nativeDesignSystem.result.result.output.language, 'ja');
  assert.equal(nativeDesignSystem.result.result.design_system_id, 'aitle');
  assert.equal(nativeDesignSystem.result.result.authority, 'vibepro_native_design_system');
  assert.equal(nativeDesignSystem.result.result.external_generator_required, false);
  assert.equal(nativeDesignSystem.result.result.source_evidence.graphify.status, 'available');
  assert.equal(nativeDesignSystem.result.result.source_evidence.graphify.edge_count, 2);
  assert.equal(nativeDesignSystem.result.result.product_semantics.primary_domain, 'hotel_discovery');
  assert.equal(nativeDesignSystem.result.result.screen_patterns.patterns.length, 2);
  assert.ok(nativeDesignSystem.result.result.semantic_tokens.color_roles.some((role) => role.name === 'availability_positive'));
  assert.ok(nativeDesignSystem.result.result.component_roles.roles.some((role) => role.name === 'AIPhoneCTA'));
  assert.equal(nativeDesignSystem.result.result.ds_gate.fallback_allowed, false);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'design-system.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'product-semantics.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'theme-tokens.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'semantic-tokens.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'component-roles.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'component-states.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'screen-patterns.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'cta-policy.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'density-policy.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'navigation-policy.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'anti-patterns.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'implementation-mapping.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'evidence-coverage.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'ds-gate.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'visual-foundations.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'visual-foundations.md')), true);
  const nativeOutDir = path.join(repo, '.vibepro', 'design-system', 'aitle');
  const nativeDesignSystemJson = await readJson(path.join(nativeOutDir, 'design-system.json'));
  const nativeSemanticTokens = await readJson(path.join(nativeOutDir, 'semantic-tokens.json'));
  const nativeComponentStates = await readJson(path.join(nativeOutDir, 'component-states.json'));
  const nativeCtaPolicy = await readJson(path.join(nativeOutDir, 'cta-policy.json'));
  const nativeDensityPolicy = await readJson(path.join(nativeOutDir, 'density-policy.json'));
  const nativeNavigationPolicy = await readJson(path.join(nativeOutDir, 'navigation-policy.json'));
  const nativeAntiPatterns = await readJson(path.join(nativeOutDir, 'anti-patterns.json'));
  const nativeEvidenceCoverage = await readJson(path.join(nativeOutDir, 'evidence-coverage.json'));
  const nativeDsGate = await readJson(path.join(nativeOutDir, 'ds-gate.json'));
  const nativeVisualFoundations = await readJson(path.join(nativeOutDir, 'visual-foundations.json'));
  const nativeScreenPatterns = await readJson(path.join(nativeOutDir, 'screen-patterns.json'));
  const nativeSummary = await readFile(path.join(nativeOutDir, 'design-system.md'), 'utf8');
  assert.equal(nativeDesignSystemJson.source_evidence.visual_foundations.source, 'visual-brief.md');
  assert.match(nativeVisualFoundations.authority, /reference_only/);
  assert.ok(nativeVisualFoundations.semantic_color_roles.some((line) => /availability positive/.test(line)));
  assert.ok(nativeSemanticTokens.color_roles.some((role) => role.name === 'availability_positive'));
  assert.match(JSON.stringify(nativeComponentStates.required_states), /loading/);
  assert.ok(nativeCtaPolicy.discovered_ctas.includes('地図で探す'));
  assert.equal(nativeCtaPolicy.discovered_ctas.includes('iconOnly'), false);
  assert.match(nativeDensityPolicy.rules.join('\n'), /scanability/);
  assert.equal(nativeNavigationPolicy.policy, 'preserve_current_navigation_model');
  assert.ok(nativeAntiPatterns.global_rules.some((rule) => /new product concept/.test(rule)));
  assert.equal(nativeEvidenceCoverage.findings.find((finding) => finding.id === 'DS-EVIDENCE-GRAPH').status, 'pass');
  assert.equal(nativeDsGate.fallback_allowed, false);
  assert.ok(nativeDsGate.checks.some((check) => check.id === 'DS-GATE-VISUAL-HYPOTHESIS'));
  assert.ok(nativeDsGate.checks.some((check) => check.id === 'DS-GATE-VISUAL-FOUNDATIONS-AUTHORITY'));
  assert.equal(nativeScreenPatterns.graphify_status, 'available');
  assert.match(nativeSummary, /graphify: available/);
  assert.match(nativeSummary, /visual foundations: visual-brief.md/);
  assert.match(nativeSummary, /## プロダクト意味論/);
  assert.doesNotMatch(nativeSummary, /## Product Semantics/);

  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-aitle-ui-refresh.md'), `---
story_id: story-aitle-ui-refresh
title: Aitle UI refresh
spec_docs:
  - ../../specs/story-aitle-ui-refresh.md
---

# Aitle UI refresh

Refresh the existing UI using the Design System while preserving CTA priority, loading/error states, navigation, and dense hotel comparison layout.
`);
  const validation = await runCli([
    'design-system',
    'validate',
    repo,
    '--id',
    'aitle',
    '--story-id',
    'story-aitle-ui-refresh',
    '--json'
  ]);
  assert.equal(validation.exitCode, 0);
  assert.equal(validation.result.result.workflow, 'design-system-validation');
  assert.equal(validation.result.result.output.language, 'ja');
  assert.equal(validation.result.result.summary.status, 'pass');
  assert.equal(validation.result.result.findings.find((finding) => finding.id === 'DS-VALIDATE-CTA-PRIORITY').status, 'pass');
  assert.equal(validation.result.result.findings.find((finding) => finding.id === 'DS-VALIDATE-STATE-SEMANTICS').status, 'pass');
  assert.equal(validation.result.result.findings.find((finding) => finding.id === 'DS-VALIDATE-COMPONENT-ROLES').status, 'pass');
  assert.equal(validation.result.result.findings.find((finding) => finding.id === 'DS-VALIDATE-NAV-DENSITY').status, 'pass');
  assert.equal(validation.result.result.findings.find((finding) => finding.id === 'DS-VALIDATE-SECRET-SCAN').status, 'pass');
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'validation', 'story-aitle-ui-refresh.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'validation', 'story-aitle-ui-refresh.md')), true);
  const validationSummary = await readFile(path.join(repo, '.vibepro', 'design-system', 'aitle', 'validation', 'story-aitle-ui-refresh.md'), 'utf8');
  assert.match(validationSummary, /# Design System検証: aitle/);
  assert.match(validationSummary, /## 検出事項/);
  assert.doesNotMatch(validationSummary, /# Design System Validation:/);

  const dsWithDrift = await readJson(path.join(nativeOutDir, 'design-system.json'));
  dsWithDrift.authority = 'external_visual_reference';
  await writeFile(path.join(nativeOutDir, 'design-system.json'), JSON.stringify(dsWithDrift, null, 2));
  const driftValidation = await runCli([
    'design-system',
    'validate',
    repo,
    '--id',
    'aitle',
    '--story-id',
    'story-aitle-ui-refresh',
    '--json'
  ]);
  assert.equal(driftValidation.result.result.summary.status, 'block');
  assert.equal(driftValidation.result.result.findings.find((finding) => finding.id === 'DS-VALIDATE-DRIFT').status, 'block');

  await writeFile(path.join(nativeOutDir, 'design-system.json'), JSON.stringify(nativeDesignSystemJson, null, 2));
  const missingContextValidation = await runCli([
    'design-system',
    'validate',
    repo,
    '--id',
    'aitle',
    '--story-id',
    'story-missing-design-context',
    '--json'
  ]);
  assert.equal(missingContextValidation.result.result.summary.status, 'needs_evidence');
  assert.equal(missingContextValidation.result.result.findings.find((finding) => finding.id === 'DS-VALIDATE-STORY-CONTEXT').status, 'needs_evidence');

  const dsWithSecret = await readJson(path.join(nativeOutDir, 'design-system.json'));
  dsWithSecret.theme_tokens.leaked = 'sk_live_1234567890abcdef1234567890abcdef';
  await writeFile(path.join(nativeOutDir, 'design-system.json'), JSON.stringify(dsWithSecret, null, 2));
  const blockedValidation = await runCli([
    'design-system',
    'validate',
    repo,
    '--id',
    'aitle',
    '--story-id',
    'story-aitle-ui-refresh',
    '--json'
  ]);
  assert.equal(blockedValidation.result.result.summary.status, 'block');
  assert.equal(blockedValidation.result.result.findings.find((finding) => finding.id === 'DS-VALIDATE-SECRET-SCAN').status, 'block');

  await writeFile(path.join(nativeOutDir, 'design-system.json'), JSON.stringify(nativeDesignSystemJson, null, 2));
  const dsWithFreeTextSecret = await readJson(path.join(nativeOutDir, 'design-system.json'));
  dsWithFreeTextSecret.anti_patterns.global_rules.push('Do not store api_token=secret-value in DS artifacts.');
  await writeFile(path.join(nativeOutDir, 'design-system.json'), JSON.stringify(dsWithFreeTextSecret, null, 2));
  const freeTextSecretValidation = await runCli([
    'design-system',
    'validate',
    repo,
    '--id',
    'aitle',
    '--story-id',
    'story-aitle-ui-refresh',
    '--json'
  ]);
  assert.equal(freeTextSecretValidation.result.result.summary.status, 'block');
  assert.equal(freeTextSecretValidation.result.result.findings.find((finding) => finding.id === 'DS-VALIDATE-SECRET-SCAN').status, 'block');

  await writeFile(path.join(nativeOutDir, 'design-system.json'), JSON.stringify(nativeDesignSystemJson, null, 2));
  await writeFile(path.join(repo, 'external-ds-bundle.json'), JSON.stringify({
    title: 'Aitle External Reference DS',
    version: { versionNumber: 2 },
    bundle: {
      theme: ':root { --ds-color-brand: #2563eb; --ds-color-success: #16a34a; --ds-space-compact: 8px; --ds-font-body: "Noto Sans JP"; }',
      componentsCss: '.ds-primary-cta { color: var(--ds-color-brand); } .ds-result-card { display: grid; }',
      componentsJs: 'customElements.define("ds-filter-chip", class extends HTMLElement {});',
      documentation: [
        'CTA: AI電話で空室確認 is primary; map and filter actions are secondary.',
        'States: loading, disabled, error, selected, available, limited, unavailable.',
        'Density: compact scannable hotel comparison, preserve navigation and bottom sheet.',
        'Avoid generic Book Now language.',
        'Do not store api_token=secret-value in Design System artifacts.'
      ].join('\n')
    },
    credentials: {
      apiKey: 'sk_live_1234567890abcdef1234567890abcdef'
    }
  }, null, 2));
  const bundleIngest = await runCli([
    'design-system',
    'ingest',
    repo,
    '--id',
    'aitle',
    '--bundle',
    'external-ds-bundle.json',
    '--json'
  ]);
  assert.equal(bundleIngest.exitCode, 0);
  assert.equal(bundleIngest.result.result.authority, 'vibepro_native_design_system');
  assert.equal(bundleIngest.result.result.source_evidence.external_bundle.source, 'external-ds-bundle.json');
  assert.equal(bundleIngest.result.result.external_bundle.redacted_value_count, 2);
  assert.ok(bundleIngest.result.result.theme_tokens.css_variables.includes('--ds-color-brand'));
  assert.ok(bundleIngest.result.result.component_roles.roles.some((role) => role.name === 'PrimaryCta'));
  assert.match(JSON.stringify(bundleIngest.result.result.component_states.required_states), /available/);
  assert.match(JSON.stringify(bundleIngest.result.result.cta_policy.discovered_ctas), /AI電話で空室確認/);
  assert.equal(bundleIngest.result.result.ds_gate.fallback_allowed, false);
  assert.ok(bundleIngest.result.result.ds_gate.checks.some((check) => check.id === 'DS-GATE-EXTERNAL-BUNDLE-AUTHORITY'));
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'external-bundle.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'semantic-tokens.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'aitle', 'component-roles.json')), true);
  const ingestedDesignSystemText = await readFile(path.join(nativeOutDir, 'design-system.json'), 'utf8');
  const ingestedExternalBundleText = await readFile(path.join(nativeOutDir, 'external-bundle.json'), 'utf8');
  assert.doesNotMatch(ingestedDesignSystemText, /sk_live_1234567890abcdef1234567890abcdef/);
  assert.doesNotMatch(ingestedExternalBundleText, /sk_live_1234567890abcdef1234567890abcdef/);
  assert.doesNotMatch(ingestedDesignSystemText, /secret-value/);
  assert.doesNotMatch(ingestedExternalBundleText, /secret-value/);

  await writeFile(path.join(repo, 'string-token-ds-bundle.json'), JSON.stringify({
    files: {
      tokens: ':root { --ds-color-inline-brand: #0f766e; --ds-space-inline: 12px; }',
      components: '.ds-inline-cta { color: var(--ds-color-inline-brand); }',
      guidelines: 'CTA: inline action remains primary. States: loading and disabled. Density: compact.'
    },
    accessToken: 'Bearer abcdefghijklmnopqrstuvwxyz1234567890'
  }, null, 2));
  const stringTokenIngest = await runCli([
    'design-system',
    'ingest',
    repo,
    '--id',
    'aitle',
    '--bundle',
    'string-token-ds-bundle.json',
    '--json'
  ]);
  assert.equal(stringTokenIngest.exitCode, 0);
  assert.ok(stringTokenIngest.result.result.theme_tokens.css_variables.includes('--ds-color-inline-brand'));
  assert.equal(stringTokenIngest.result.result.external_bundle.redacted_value_count, 1);
  const stringTokenDesignSystemText = await readFile(path.join(nativeOutDir, 'design-system.json'), 'utf8');
  assert.doesNotMatch(stringTokenDesignSystemText, /abcdefghijklmnopqrstuvwxyz1234567890/);

  await writeFile(path.join(repo, 'visual-brief-v2.md'), '- Native CTA language: 空室をAI電話で確認.\n- Forbidden generic CTAs: avoid Book Now.\n');
  const ingested = await runCli([
    'design-system',
    'ingest-brief',
    repo,
    '--id',
    'aitle',
    '--brief-file',
    'visual-brief-v2.md',
    '--json'
  ]);
  assert.equal(ingested.exitCode, 0);
  assert.equal(ingested.result.result.visual_foundations.source, 'visual-brief-v2.md');

  const planFromNativeDs = await runCli([
    'design-modernize',
    'plan',
    repo,
    '--id',
    'story-aitle-native-ds-plan',
    '--product',
    'Aitle',
    '--routes',
    '/home,/map',
    '--design-system-bundle',
    '.vibepro/design-system/aitle/design-system.json',
    '--json'
  ]);
  assert.equal(planFromNativeDs.exitCode, 0);
  assert.ok(planFromNativeDs.result.plan.reference_design_system.token_summary.count > 0);
  assert.ok(planFromNativeDs.result.plan.reference_design_system.component_summary.count > 0);
  assert.equal(planFromNativeDs.result.plan.visual_foundations_reference.source, 'visual-brief-v2.md');
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-native-ds-plan', 'visual-foundations-reference.json')), true);

  const capture = await runCli([
    'design-modernize',
    'capture',
    repo,
    '--id',
    'story-aitle-ds-modernize',
    '--routes',
    '/home',
    '--json'
  ]);
  assert.equal(capture.exitCode, 0);
  assert.equal(capture.result.result.status, 'needs_setup');
  assert.match(capture.result.result.setup.next_commands[0], /base-url/);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-modernize', 'story-aitle-ds-modernize', 'screen-capture.json')), true);
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

test('design-system init and export cover scaffold lifecycle', async () => {
  const repo = await makeRepo();

  const initialized = await runCli([
    'design-system',
    'init',
    repo,
    '--id',
    'sales-core',
    '--product',
    'Sales Core',
    '--json'
  ]);

  assert.equal(initialized.exitCode, 0);
  assert.equal(initialized.result.result.workflow, 'native-design-system-init');
  assert.equal(initialized.result.result.design_system_id, 'sales-core');
  assert.equal(initialized.result.result.product_id, 'sales-core');
  assert.equal(initialized.result.result.product, 'Sales Core');
  assert.equal(initialized.result.result.authority, 'vibepro_native_design_system');
  assert.equal(initialized.result.result.ds_gate.status, 'needs_evidence');
  assert.equal(initialized.result.result.ds_gate.fallback_allowed, false);
  assert.equal(initialized.result.result.evidence_coverage.status, 'needs_evidence');
  assert.equal(initialized.result.result.theme_tokens.css_variables.length, 0);
  assert.equal(initialized.result.result.semantic_tokens.color_roles.length, 0);
  assert.equal(initialized.result.result.component_roles.roles.length, 0);
  assert.equal(initialized.result.result.component_states.required_states.length, 0);
  assert.equal(initialized.result.result.cta_policy.hierarchy.length, 0);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'sales-core', 'design-system.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'sales-core', 'design-system.md')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'design-system', 'sales-core', 'ds-gate.json')), true);

  let jsonOutput = '';
  const jsonExport = await runCli([
    'design-system',
    'export',
    repo,
    '--id',
    'sales-core',
    '--format',
    'json'
  ], {
    stdout: { write: (text) => { jsonOutput += text; } }
  });
  assert.equal(jsonExport.exitCode, 0);
  assert.equal(JSON.parse(jsonOutput).design_system_id, 'sales-core');

  let markdownOutput = '';
  const markdownExport = await runCli([
    'design-system',
    'export',
    repo,
    '--id',
    'sales-core',
    '--format',
    'markdown'
  ], {
    stdout: { write: (text) => { markdownOutput += text; } }
  });
  assert.equal(markdownExport.exitCode, 0);
  assert.match(markdownOutput, /# Design System: Sales Core/);
  assert.match(markdownOutput, /gate fallback allowed: false/);

  const cssNeedsTokens = await runCli([
    'design-system',
    'export',
    repo,
    '--id',
    'sales-core',
    '--format',
    'css',
    '--json'
  ]);
  assert.equal(cssNeedsTokens.exitCode, 0);
  assert.equal(cssNeedsTokens.result.result.status, 'needs_tokens');
  assert.match(cssNeedsTokens.result.result.content, /needs_tokens/);

  const dsPath = path.join(repo, '.vibepro', 'design-system', 'sales-core', 'design-system.json');
  const designSystem = await readJson(dsPath);
  designSystem.theme_tokens.css_variables = ['--ds-color-brand'];
  designSystem.theme_tokens.color_values = ['#2563eb'];
  designSystem.semantic_tokens.color_roles = [
    { name: 'brand', purpose: 'primary action', candidate_tokens: ['--ds-color-brand'] }
  ];
  await writeFile(dsPath, `${JSON.stringify(designSystem, null, 2)}\n`);

  let cssOutput = '';
  const cssExport = await runCli([
    'design-system',
    'export',
    repo,
    '--id',
    'sales-core',
    '--format',
    'css'
  ], {
    stdout: { write: (text) => { cssOutput += text; } }
  });
  assert.equal(cssExport.exitCode, 0);
  assert.equal(cssExport.result.result.status, 'pass');
  assert.match(cssOutput, /--vibepro-theme-ds-color-brand: var\(--ds-color-brand\);/);
  assert.match(cssOutput, /--vibepro-brand: var\(--ds-color-brand\);/);
  assert.match(cssOutput, /--vibepro-color-1: #2563eb;/);
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
  assert.match(output, /risk-adaptive Gate DAG/);
  assert.match(output, /workflow_heavy/);
  assert.match(output, /\.vibepro\/ の意味/);
  assert.match(output, /vibepro pr create <repo> --base <base-branch> --head <branch> --story-id <id>/);
  assert.match(output, /vibepro execute merge <repo> --story-id <id>/);
  assert.match(output, /vibepro design-modernize derive-system \[repo\]/);
  assert.match(output, /vibepro design-system init \[repo\]/);
  assert.match(output, /vibepro design-system derive \[repo\]/);
  assert.match(output, /vibepro design-system ingest \[repo\]/);
  assert.match(output, /vibepro design-system export \[repo\]/);
  assert.match(output, /vibepro design-system validate \[repo\]/);
  assert.match(output, /既存UI modernize/);
  assert.match(output, /プロダクトローカルなDesign System正本/);
  assert.match(output, /evidence-coverage\.json と ds-gate\.json/);
  assert.match(output, /GitHub CLIの直接実行はVibePro Gateとwaiver auditを通らない/);
  assert.doesNotMatch(output, /gh pr create.*標準経路として使/i);
  assert.match(output, /vibepro measure \[repo\].*--base-url <url>/);
  assert.match(output, /vibepro harness status \[repo\]/);
  assert.match(output, /vibepro harness map \[repo\]/);
  assert.match(output, /vibepro harness learn \[repo\]/);
  assert.match(output, /vibepro check <ui\|security\|performance\|architecture\|pr-readiness\|launch-readiness\|agent-harness\|public-discovery\|self-dogfood\|oss-readiness\|regression-risk\|all>/);
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
  assert.match(englishOutput, /safer AI-driven PRs/);
  assert.match(englishOutput, /risk-adaptive Gate DAG/);
  assert.match(englishOutput, /vibepro pr prepare <repo> --base <base-branch>/);
  assert.match(englishOutput, /vibepro pr create <repo> --base <base-branch> --head <branch> --story-id <id>/);
  assert.match(englishOutput, /vibepro execute merge <repo> --story-id <id>/);
  assert.match(englishOutput, /vibepro design-modernize derive-system \[repo\]/);
  assert.match(englishOutput, /vibepro design-system init \[repo\]/);
  assert.match(englishOutput, /vibepro design-system derive \[repo\]/);
  assert.match(englishOutput, /vibepro design-system ingest \[repo\]/);
  assert.match(englishOutput, /vibepro design-system export \[repo\]/);
  assert.match(englishOutput, /vibepro design-system validate \[repo\]/);
  assert.match(englishOutput, /Existing UI modernization/);
  assert.match(englishOutput, /product-local Design System/);
  assert.match(englishOutput, /evidence-coverage\.json and ds-gate\.json/);
  assert.match(englishOutput, /Do not use raw\s+gh pr create/i);
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
  assert.match(output, /self-dogfood: VibePro self-dogfood gate readiness check/);
  assert.match(output, /oss-readiness: OSS publication readiness check/);
  assert.equal(result.packs.some((pack) => pack.id === 'launch-readiness'), true);
});

test('help documents check fail-on-findings enforcement mode', async () => {
  let output = '';

  const result = await runCli(['help'], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.match(output, /--fail-on-findings/);
});

test('check self-dogfood detects verify evidence without final gate artifacts', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await runCli(['init', repo, '--story-id', 'story-self-dogfood', '--title', 'Self dogfood']);
  await mkdir(path.join(repo, '.vibepro', 'pr', 'story-self-dogfood'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'pr', 'story-self-dogfood', 'verification-evidence.json'), JSON.stringify({
    story_id: 'story-self-dogfood',
    commands: [
      { kind: 'unit', status: 'pass', command: 'npm test' }
    ]
  }, null, 2));
  await mkdir(path.join(repo, 'agent-instructions', 'codex'), { recursive: true });
  await writeFile(path.join(repo, 'agent-instructions', 'codex', 'AGENTS.vibepro.md'), 'Do not call raw `gh pr create`; use `vibepro pr create`.\n');

  const result = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-self-dogfood', '--run-id', 'self-dogfood-test', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'needs_review');
  assert.equal(result.result.check.evidence.self_dogfood.findings.length, 1);
  assert.match(result.result.check.evidence.self_dogfood.findings[0].detail, /final pr-prepare\/gate-dag artifacts are missing/);
  assert.equal(result.result.check.evidence.self_dogfood.findings.some((finding) => finding.id.includes('raw_gh_pr_create_guidance')), false);
});

test('check self-dogfood detects fixed English text in ja human artifacts', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await runCli(['init', repo, '--story-id', 'story-language', '--title', '言語検証', '--language', 'ja']);
  const reviewDir = path.join(repo, '.vibepro', 'reviews', 'story-language', 'gate');
  await mkdir(reviewDir, { recursive: true });
  await writeFile(path.join(reviewDir, 'parallel-dispatch.md'), [
    '# VibePro Parallel Agent Review Dispatch',
    '',
    '## Coordinator Instructions',
    '',
    'If your coordinator runtime supports subagents, start them.'
  ].join('\n'));

  const result = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-language', '--run-id', 'self-dogfood-language', '--json']);

  assert.equal(result.exitCode, 0);
  const findings = result.result.check.evidence.self_dogfood.findings;
  const languageFinding = findings.find((finding) => finding.id.includes('human_doc_language'));
  assert.ok(languageFinding);
  assert.match(languageFinding.path, /parallel-dispatch\.md/);
  assert.match(languageFinding.detail, /fixed English text/);
});

test('check self-dogfood surfaces PR create bypass and finding details in markdown', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await runCli(['init', repo, '--story-id', 'story-self-dogfood', '--title', 'Self dogfood']);
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-self-dogfood');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'verification-evidence.json'), JSON.stringify({
    story_id: 'story-self-dogfood',
    commands: [
      { kind: 'unit', status: 'pass', command: 'npm test' }
    ]
  }, null, 2));
  await writeFile(path.join(prDir, 'pr-create.json'), JSON.stringify({
    gate_dag: { overall_status: 'needs_verification' }
  }, null, 2));
  const standalonePrDir = path.join(repo, '.vibepro', 'pr', 'story-standalone-bypass');
  await mkdir(standalonePrDir, { recursive: true });
  await writeFile(path.join(standalonePrDir, 'gate-dag.json'), JSON.stringify({
    overall_status: 'needs_verification'
  }, null, 2));
  await writeFile(path.join(standalonePrDir, 'pr-create.json'), JSON.stringify({
    mode: 'pr_create'
  }, null, 2));
  const weakWaiverDir = path.join(repo, '.vibepro', 'pr', 'story-weak-waiver');
  await mkdir(weakWaiverDir, { recursive: true });
  await writeFile(path.join(weakWaiverDir, 'pr-create.json'), JSON.stringify({
    gate_dag: { overall_status: 'needs_verification' },
    gate_override: { allowed: true }
  }, null, 2));

  const result = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-self-dogfood', '--run-id', 'self-dogfood-bypass', '--json']);
  const standaloneResult = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-standalone-bypass', '--run-id', 'self-dogfood-standalone-bypass', '--json']);
  const weakWaiverResult = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-weak-waiver', '--run-id', 'self-dogfood-weak-waiver', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'fail');
  const findings = result.result.check.evidence.self_dogfood.findings;
  assert.equal(findings.some((finding) => finding.id.includes('final_gate_missing')), true);
  assert.equal(findings.some((finding) => finding.id.includes('pr_create_without_gate_override')), true);
  const markdown = await readFile(path.join(repo, '.vibepro', 'checks', 'self-dogfood', 'self-dogfood-bypass', 'check.md'), 'utf8');
  assert.match(markdown, /## 検出事項/);
  assert.match(markdown, /self_dogfood\.pr_create_without_gate_override\.story-self-dogfood/);
  assert.match(markdown, /Use vibepro pr create/);
  assert.equal(standaloneResult.exitCode, 0);
  assert.equal(standaloneResult.result.check.evidence.self_dogfood.findings.some((finding) => finding.id.includes('pr_create_without_gate_override.story-standalone-bypass')), true);
  assert.equal(weakWaiverResult.exitCode, 0);
  assert.equal(weakWaiverResult.result.check.evidence.self_dogfood.findings.some((finding) => finding.id.includes('pr_create_without_gate_override.story-weak-waiver')), true);
});

test('check self-dogfood blocks GitHub PRs that bypass VibePro PR evidence', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  const fakeGh = await makeFakeGh({
    number: 97,
    url: 'https://github.com/Unson-LLC/vibepro/pull/97',
    headRefName: 'codex/publication-precheck-fixes',
    body: '## Summary\\n- patched through a raw gh pr create path'
  });

  const result = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-pr-path', '--run-id', 'self-dogfood-gh-pr-bypass', '--json'], {
    env: { ...process.env, PATH: `${fakeGh}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'fail');
  const findings = result.result.check.evidence.self_dogfood.findings;
  assert.equal(findings.some((finding) => finding.id.includes('github_pr_non_vibepro_body.codex-publication-precheck-fixes')), true);
  assert.equal(findings.some((finding) => finding.id.includes('github_pr_body_escaped_newlines.codex-publication-precheck-fixes')), true);
  assert.equal(findings.some((finding) => finding.id.includes('github_pr_missing_vibepro_create.codex-publication-precheck-fixes')), true);
});

test('check self-dogfood accepts GitHub PRs with VibePro body and matching pr-create evidence', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  const fakeGh = await makeFakeGh({
    number: 96,
    url: 'https://github.com/Unson-LLC/vibepro/pull/96',
    headRefName: 'feat/vibepro-pr-path',
    headRefOid: '1111111111111111111111111111111111111111',
    body: [
      '## このPRで決めたいこと',
      '- このPRで閉じる問い: VibePro経由のPRとして受け入れてよいか。',
      '',
      '## 監査ログ',
      '',
      '## Gate DAG',
      '- overall_status: ready_for_review',
      '',
      '## Execution Gate',
      '- status: ready'
    ].join('\n')
  });
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-path');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-create.json'), JSON.stringify({
    mode: 'pr_create',
    dry_run: false,
    pr_url: 'https://github.com/Unson-LLC/vibepro/pull/96',
    head: 'feat/vibepro-pr-path',
    toolchain: {
      source_git: {
        commit: '1111111111111111111111111111111111111111'
      }
    },
    gate_dag: { overall_status: 'ready_for_review' }
  }, null, 2));

  const result = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-pr-path', '--run-id', 'self-dogfood-gh-pr-vibepro', '--json'], {
    env: { ...process.env, PATH: `${fakeGh}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'pass');
  const findings = result.result.check.evidence.self_dogfood.findings;
  assert.equal(findings.some((finding) => finding.id.includes('github_pr_')), false);
});

test('check self-dogfood rejects failed pr-create evidence for visible GitHub PRs', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  const fakeGh = await makeFakeGh({
    number: 98,
    url: 'https://github.com/Unson-LLC/vibepro/pull/98',
    headRefName: 'feat/failed-pr-create-artifact',
    headRefOid: '2222222222222222222222222222222222222222',
    body: [
      '## このPRで決めたいこと',
      '- このPRで閉じる問い: 失敗証跡をPR作成証跡として扱わないか。',
      '',
      '## Gate DAG',
      '- overall_status: ready_for_review',
      '',
      '## Execution Gate',
      '- status: ready'
    ].join('\n')
  });
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-path');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-create.json'), JSON.stringify({
    mode: 'pr_create',
    dry_run: false,
    status: 'failed',
    error: 'Command failed: gh pr create',
    pr_url: null,
    head: 'feat/failed-pr-create-artifact',
    results: [
      { command: 'gh pr create --base main --head feat/failed-pr-create-artifact', exit_code: 1 }
    ]
  }, null, 2));

  const result = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-pr-path', '--run-id', 'self-dogfood-gh-pr-failed-evidence', '--json'], {
    env: { ...process.env, PATH: `${fakeGh}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'fail');
  const findings = result.result.check.evidence.self_dogfood.findings;
  assert.equal(findings.some((finding) => finding.id.includes('github_pr_missing_vibepro_create.feat-failed-pr-create-artifact')), true);
});

test('check self-dogfood rejects dry-run pr-create evidence for visible GitHub PRs', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  const fakeGh = await makeFakeGh({
    number: 99,
    url: 'https://github.com/Unson-LLC/vibepro/pull/99',
    headRefName: 'feat/dry-run-pr-create-artifact',
    headRefOid: '3333333333333333333333333333333333333333',
    body: [
      '## このPRで決めたいこと',
      '- このPRで閉じる問い: dry-run証跡をPR作成証跡として扱わないか。',
      '',
      '## Gate DAG',
      '- overall_status: ready_for_review',
      '',
      '## Execution Gate',
      '- status: ready'
    ].join('\n')
  });
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-path');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-create.json'), JSON.stringify({
    mode: 'pr_create',
    dry_run: true,
    pr_url: 'https://github.com/Unson-LLC/vibepro/pull/99',
    head: 'feat/dry-run-pr-create-artifact',
    toolchain: {
      source_git: {
        commit: '3333333333333333333333333333333333333333'
      }
    }
  }, null, 2));

  const result = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-pr-path', '--run-id', 'self-dogfood-gh-pr-dry-run-evidence', '--json'], {
    env: { ...process.env, PATH: `${fakeGh}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'fail');
  const findings = result.result.check.evidence.self_dogfood.findings;
  assert.equal(findings.some((finding) => finding.id.includes('github_pr_missing_vibepro_create.feat-dry-run-pr-create-artifact')), true);
});

test('check self-dogfood rejects stale pr-create evidence for visible GitHub PRs', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  const fakeGh = await makeFakeGh({
    number: 100,
    url: 'https://github.com/Unson-LLC/vibepro/pull/100',
    headRefName: 'feat/stale-pr-create-artifact',
    headRefOid: '4444444444444444444444444444444444444444',
    body: [
      '## このPRで決めたいこと',
      '- このPRで閉じる問い: stale証跡をPR作成証跡として扱わないか。',
      '',
      '## Gate DAG',
      '- overall_status: ready_for_review',
      '',
      '## Execution Gate',
      '- status: ready'
    ].join('\n')
  });
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-path');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-create.json'), JSON.stringify({
    mode: 'pr_create',
    dry_run: false,
    pr_url: 'https://github.com/Unson-LLC/vibepro/pull/100',
    head: 'feat/stale-pr-create-artifact',
    toolchain: {
      source_git: {
        commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }
    },
    results: [
      { command: 'gh pr create --base main --head feat/stale-pr-create-artifact', exit_code: 0 }
    ]
  }, null, 2));

  const result = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-pr-path', '--run-id', 'self-dogfood-gh-pr-stale-evidence', '--json'], {
    env: { ...process.env, PATH: `${fakeGh}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'fail');
  const findings = result.result.check.evidence.self_dogfood.findings;
  assert.equal(findings.some((finding) => finding.id.includes('github_pr_missing_vibepro_create.feat-stale-pr-create-artifact')), true);
});

test('check --fail-on-findings exits non-zero for non-pass check packs', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await runCli(['init', repo, '--story-id', 'story-self-dogfood', '--title', 'Self dogfood']);
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-self-dogfood');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'verification-evidence.json'), JSON.stringify({
    story_id: 'story-self-dogfood',
    commands: [
      { kind: 'unit', status: 'pass', command: 'npm test' }
    ]
  }, null, 2));

  const defaultResult = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-self-dogfood', '--run-id', 'self-dogfood-default-exit', '--json']);
  const failOnFindingsResult = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-self-dogfood', '--run-id', 'self-dogfood-fail-exit', '--fail-on-findings', '--json']);

  assert.equal(defaultResult.exitCode, 0);
  assert.equal(defaultResult.result.check.status, 'needs_review');
  assert.equal(failOnFindingsResult.exitCode, 1);
  assert.equal(failOnFindingsResult.result.check.status, 'needs_review');
});

test('check oss-readiness records missing external tools as setup evidence', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await runCli(['init', repo, '--story-id', 'story-oss-readiness', '--title', 'OSS readiness']);

  const result = await runCli(['check', 'oss-readiness', repo, '--run-id', 'oss-missing-tools', '--json'], {
    env: { ...process.env, PATH: '' }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.pack_id, 'oss-readiness');
  assert.equal(result.result.check.status, 'needs_setup');
  assert.equal(result.result.check.evidence.oss_readiness.summary.needs_setup, 5);
  assert.equal(result.result.check.evidence.oss_readiness.tools.every((tool) => tool.status === 'needs_setup'), true);
  assert.equal(result.result.check.checks.some((check) => check.id === 'oss_readiness' && check.status === 'needs_setup'), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'checks', 'oss-readiness', 'oss-missing-tools', 'check.json')), true);
  const markdown = await readFile(path.join(repo, '.vibepro', 'checks', 'oss-readiness', 'oss-missing-tools', 'check.md'), 'utf8');
  assert.match(markdown, /OSS Publication Readiness/);
  assert.match(markdown, /gitleaks is not installed/);
});

test('check oss-readiness records unusable external tool output as setup evidence', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['remote', 'add', 'origin', 'https://github.com/Unson-LLC/vibepro.git']);
  await runCli(['init', repo, '--story-id', 'story-oss-readiness', '--title', 'OSS readiness']);
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-oss-bin-'));
  for (const name of ['gitleaks', 'scorecard', 'syft', 'grype', 'reuse']) {
    await writeFile(path.join(binDir, name), `#!/usr/bin/env node
console.log('not-json');
${name === 'reuse' ? 'process.exit(1);' : ''}
`);
    await chmod(path.join(binDir, name), 0o755);
  }

  const result = await runCli(['check', 'oss-readiness', repo, '--run-id', 'oss-unusable-output', '--json'], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'needs_setup');
  const evidence = result.result.check.evidence.oss_readiness;
  assert.equal(evidence.summary.needs_setup, 5);
  assert.equal(evidence.tools.every((tool) => tool.status === 'needs_setup'), true);
  assert.equal(evidence.findings.length, 5);
  assert.equal(evidence.findings.every((finding) => finding.gate_effect === 'review'), true);
});

test('check oss-readiness treats empty successful gitleaks output as pass', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['remote', 'add', 'origin', 'https://github.com/Unson-LLC/vibepro.git']);
  await runCli(['init', repo, '--story-id', 'story-oss-readiness', '--title', 'OSS readiness']);
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-oss-bin-'));
  await writeFile(path.join(binDir, 'gitleaks'), `#!/usr/bin/env node
process.exit(0);
`);
  await writeFile(path.join(binDir, 'scorecard'), `#!/usr/bin/env node
console.log(JSON.stringify({ score: 8, checks: [] }));
`);
  await writeFile(path.join(binDir, 'syft'), `#!/usr/bin/env node
console.log(JSON.stringify({ components: [{ name: 'vibepro' }] }));
`);
  await writeFile(path.join(binDir, 'grype'), `#!/usr/bin/env node
console.log(JSON.stringify({ matches: [] }));
`);
  await writeFile(path.join(binDir, 'reuse'), `#!/usr/bin/env node
console.log(JSON.stringify({ compliant: true }));
`);
  for (const name of ['gitleaks', 'scorecard', 'syft', 'grype', 'reuse']) {
    await chmod(path.join(binDir, name), 0o755);
  }

  const result = await runCli(['check', 'oss-readiness', repo, '--run-id', 'oss-gitleaks-empty-pass', '--json'], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'pass');
  const evidence = result.result.check.evidence.oss_readiness;
  assert.equal(evidence.tools.find((tool) => tool.id === 'gitleaks').status, 'pass');
  assert.equal(evidence.tools.find((tool) => tool.id === 'gitleaks').summary, 'No secret candidates reported');
});

test('check oss-readiness normalizes Core 5 tool findings without leaking secret values', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['remote', 'add', 'origin', 'https://github.com/Unson-LLC/vibepro.git']);
  await runCli(['init', repo, '--story-id', 'story-oss-readiness', '--title', 'OSS readiness']);
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-oss-bin-'));
  await writeFile(path.join(binDir, 'gitleaks'), `#!/usr/bin/env node
console.log(JSON.stringify([{ RuleID: 'generic-api-key', File: 'src/config.js', StartLine: 2, Secret: 'sk-THISSECRETISNOTSAVED' }]));
process.exit(1);
`);
  await writeFile(path.join(binDir, 'scorecard'), `#!/usr/bin/env node
console.log(JSON.stringify({ score: 6.5, checks: [{ name: 'Branch-Protection', score: -1 }] }));
`);
  await writeFile(path.join(binDir, 'syft'), `#!/usr/bin/env node
console.log(JSON.stringify({ components: [{ name: 'vibepro' }, { name: 'left-pad' }] }));
`);
  await writeFile(path.join(binDir, 'grype'), `#!/usr/bin/env node
console.log(JSON.stringify({ matches: [
  { vulnerability: { id: 'CVE-TEST-HIGH', severity: 'High' }, artifact: { name: 'left-pad' } },
  { vulnerability: { id: 'CVE-TEST-MEDIUM', severity: 'Medium' }, artifact: { name: 'debug' } }
] }));
`);
  await writeFile(path.join(binDir, 'reuse'), `#!/usr/bin/env node
console.log(JSON.stringify({ compliant: false, files_without_license: ['src/index.js'] }));
process.exit(1);
`);
  for (const name of ['gitleaks', 'scorecard', 'syft', 'grype', 'reuse']) {
    await chmod(path.join(binDir, name), 0o755);
  }

  const result = await runCli(['check', 'oss-readiness', repo, '--run-id', 'oss-core5-findings', '--json'], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'fail');
  const evidence = result.result.check.evidence.oss_readiness;
  assert.equal(evidence.tools.find((tool) => tool.id === 'syft').status, 'pass');
  assert.equal(evidence.tools.find((tool) => tool.id === 'gitleaks').status, 'fail');
  assert.equal(evidence.tools.find((tool) => tool.id === 'scorecard').status, 'needs_review');
  assert.equal(evidence.tools.find((tool) => tool.id === 'grype').status, 'fail');
  assert.equal(evidence.tools.find((tool) => tool.id === 'reuse').status, 'needs_review');
  assert.equal(evidence.risk_summary.findings.block >= 2, true);
  assert.equal(evidence.findings.some((finding) => finding.id.includes('gitleaks.secret')), true);
  const checkJson = await readFile(path.join(repo, '.vibepro', 'checks', 'oss-readiness', 'oss-core5-findings', 'check.json'), 'utf8');
  assert.doesNotMatch(checkJson, /sk-THISSECRETISNOTSAVED/);

  const failResult = await runCli(['check', 'oss-readiness', repo, '--run-id', 'oss-core5-fail-exit', '--fail-on-findings', '--json'], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });
  assert.equal(failResult.exitCode, 1);
});

test('check self-dogfood accepts auditable gate_override and scans docs guidance', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await runCli(['init', repo, '--story-id', 'story-self-dogfood', '--title', 'Self dogfood']);
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-waived');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-create.json'), JSON.stringify({
    gate_dag: { overall_status: 'needs_verification' },
    gate_override: {
      allowed: true,
      waiver_policy: 'cli_reason',
      reason: 'non-critical waiver recorded'
    }
  }, null, 2));
  const executionWaiverPrDir = path.join(repo, '.vibepro', 'pr', 'story-execution-waived');
  await mkdir(executionWaiverPrDir, { recursive: true });
  await writeFile(path.join(executionWaiverPrDir, 'pr-create.json'), JSON.stringify({
    execution: {
      gate_dag: { overall_status: 'needs_verification' },
      gate_override: {
        allowed: true,
        waiver_policy: 'cli_reason',
        reason: 'non-critical execution waiver recorded'
      }
    }
  }, null, 2));
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'release.md'), 'Use `gh pr create` directly for release PRs.\n');
  await writeFile(path.join(repo, 'docs', 'bypass.md'), 'Use gh pr create directly to bypass VibePro final gates.\n');
  await writeFile(path.join(repo, 'docs', 'detector.md'), [
    'raw `gh pr create` guidance should be detected by self-dogfood.',
    '否定文の「raw gh pr createを使わない」はfalse positiveにしない。',
    'VibePro `pr create` records the planned external `gh pr create` command.'
  ].join('\n'));

  const result = await runCli(['check', 'self-dogfood', repo, '--run-id', 'self-dogfood-docs', '--json']);

  assert.equal(result.exitCode, 0);
  const findings = result.result.check.evidence.self_dogfood.findings;
  assert.equal(findings.some((finding) => finding.id.includes('pr_create_without_gate_override')), false);
  assert.equal(findings.some((finding) => finding.id.includes('raw_gh_pr_create_guidance.docs/release.md')), true);
  assert.equal(findings.some((finding) => finding.id.includes('raw_gh_pr_create_guidance.docs/bypass.md')), true);
  assert.equal(findings.some((finding) => finding.id.includes('raw_gh_pr_create_guidance.docs/detector.md')), false);
});

test('check self-dogfood detects unresolved gate DAG and bypass-oriented instructions', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await runCli(['init', repo, '--story-id', 'story-self-dogfood', '--title', 'Self dogfood']);
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-self-dogfood');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'gate-dag.json'), JSON.stringify({
    overall_status: 'needs_verification',
    nodes: [
      { type: 'agent_review_gate', required: true, status: 'missing' }
    ]
  }, null, 2));
  await mkdir(path.join(repo, 'skills', 'vibepro-workflow'), { recursive: true });
  await writeFile(path.join(repo, 'skills', 'vibepro-workflow', 'SKILL.md'), [
    'story-self-dogfood guidance:',
    'Agent Review Gate skip is fine for small changes.',
    'Ask exactly whether explicit user authorization is still required before subagent dispatch.'
  ].join('\n'));

  const result = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-self-dogfood', '--run-id', 'self-dogfood-gate-instructions', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.check.status, 'fail');
  const findings = result.result.check.evidence.self_dogfood.findings;
  assert.equal(findings.some((finding) => finding.id.includes('unresolved_gate_dag')), true);
  assert.equal(findings.some((finding) => finding.id.includes('agent_review_skip_language')), true);
  assert.equal(findings.some((finding) => finding.id.includes('subagent_permission_waiting_language')), true);
});

test('check self-dogfood blocks malformed gate DAG and scopes instruction findings by story id', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await runCli(['init', repo, '--story-id', 'story-self-dogfood', '--title', 'Self dogfood']);
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-self-dogfood');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'verification-evidence.json'), JSON.stringify({
    story_id: 'story-self-dogfood',
    commands: [
      { kind: 'unit', status: 'pass', command: 'npm test' }
    ]
  }, null, 2));
  await writeFile(path.join(prDir, 'pr-prepare.json'), JSON.stringify({ story_id: 'story-self-dogfood' }, null, 2));
  await writeFile(path.join(prDir, 'gate-dag.json'), '{ "overall_status": ');
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'unrelated.md'), 'Use `gh pr create` directly for an unrelated workflow.\n');
  await writeFile(path.join(repo, 'docs', 'story-self-dogfood.md'), 'story-self-dogfood should not say: Use `gh pr create` directly.\n');

  const scopedResult = await runCli(['check', 'self-dogfood', repo, '--story-id', 'story-self-dogfood', '--run-id', 'self-dogfood-malformed-scoped', '--json']);

  assert.equal(scopedResult.exitCode, 0);
  assert.equal(scopedResult.result.check.status, 'fail');
  const scopedFindings = scopedResult.result.check.evidence.self_dogfood.findings;
  assert.equal(scopedFindings.some((finding) => finding.id.includes('invalid_gate_dag.story-self-dogfood')), true);
  assert.equal(scopedFindings.some((finding) => finding.id.includes('raw_gh_pr_create_guidance.docs/story-self-dogfood.md')), true);
  assert.equal(scopedFindings.some((finding) => finding.id.includes('raw_gh_pr_create_guidance.docs/unrelated.md')), false);
});

test('pr prepare resolves explicit story id from local Story docs even when config catalog is stale', async () => {
  const repo = await makeGitRepoWithStory();
  const storyDir = path.join(repo, 'docs', 'management', 'stories', 'active');
  await mkdir(storyDir, { recursive: true });
  await writeFile(path.join(storyDir, 'story-doc-only-gate.md'), `---
story_id: story-doc-only-gate
title: Docs-only gate Story
status: active
---

# Docs-only gate Story

Docs-only Story should be usable before story derive refreshes config.

## Acceptance Criteria

- pr prepare resolves this explicit Story ID from local docs.
`);
  await writeFile(path.join(repo, 'src.js'), 'export const value = 1;\n');

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-doc-only-gate', '--base', 'main', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.story.story_id, 'story-doc-only-gate');
  assert.equal(result.result.story.title, 'Docs-only gate Story');
  assert.equal(result.result.story.ssot.endsWith('story-doc-only-gate.md'), true);
  const prBody = await readFile(result.result.artifacts.pr_body, 'utf8');
  assert.match(prBody, /Docs-only gate Story/);
});

test('pr prepare blocks mismatched changed Story docs before building trusted PR evidence', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['story', 'add', repo, '--id', 'story-terminal-history-scrollback', '--title', 'Terminal session history remains scrollable', '--view', 'runtime']);
  const storyDir = path.join(repo, 'docs', 'stories');
  await mkdir(storyDir, { recursive: true });
  await writeFile(path.join(storyDir, 'STR-001-wiki-project-filter.md'), `---
story_id: STR-001
title: Wiki検索結果にページのproject_idフィルタを追加
---

# Wiki検索結果にページのproject_idフィルタを追加

## 背景

brainbaseのWikiには複数プロジェクトのナレッジが格納されている。

## 受け入れ基準

- search_wiki に project_id を追加する
`);
  await mkdir(path.join(repo, 'server', 'services'), { recursive: true });
  await writeFile(path.join(repo, 'server', 'services', 'terminal-transport-service.js'), 'export const scrollback = true;\n');

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-terminal-history-scrollback', '--base', 'main', '--json']);

  assert.equal(result.exitCode, 0);
  const prepare = result.result.preparation;
  assert.equal(prepare.pr_context.story_source.path, null);
  assert.equal(prepare.pr_context.story_source_integrity.status, 'story_source_mismatch');
  assert.equal(prepare.gate_status.ready_for_pr_create, false);
  assert.equal(prepare.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:story_source_integrity'), true);
  const integrityGate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:story_source_integrity');
  assert.equal(integrityGate.status, 'story_source_mismatch');
  assert.equal(integrityGate.mismatched_changed_story_docs[0].path, 'docs/stories/STR-001-wiki-project-filter.md');
  const prBody = await readFile(result.result.artifacts.pr_body, 'utf8');
  assert.match(prBody, /Story Source story_source_mismatch/);
  assert.doesNotMatch(prBody, /search_wiki に project_id を追加する/);
});

test('pr prepare accepts path surface matrix decision records', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'stories'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'stories', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
---

# PR準備

## 受け入れ基準

- Gate review surface evidence is explicit.
`);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'pr-manager.js'), 'export function buildGateDag() { return \"gate review surface\"; }\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: update gate review surface']);
  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const cleanFingerprintHash = createHash('sha256').update('git-status --porcelain -uall\n\ngit-diff --binary\n').digest('hex');
  await mkdir(path.join(repo, '.vibepro', 'verification', 'flow-needs-setup'), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'verification', 'flow-needs-setup', 'flow-verification.json'), {
    schema_version: '0.1.0',
    run_id: 'flow-needs-setup',
    story_id: 'story-pr-prepare',
    created_at: '2026-05-12T00:00:00.000Z',
    status: 'needs_setup',
    reason: 'review artifact gate report is mentioned, but no runtime probe passed',
    git_context: {
      head_sha: headSha,
      dirty: false,
      status_fingerprint_hash: cleanFingerprintHash,
      recorded_at: '2026-05-12T00:00:00.000Z'
    },
    base_url: 'http://127.0.0.1:3000',
    summary: {
      total: 1,
      pass: 0,
      fail: 0,
      skipped: 0,
      needs_setup: 1
    },
    probes: [{
      id: 'review-artifact-probe',
      status: 'needs_setup'
    }]
  });
  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_flow_verification_run = 'flow-needs-setup';
  manifest.flow_verification_runs = [{
    run_id: 'flow-needs-setup',
    story_id: 'story-pr-prepare',
    created_at: '2026-05-12T00:00:00.000Z',
    status: 'needs_setup',
    git_context: {
      head_sha: headSha,
      dirty: false,
      status_fingerprint_hash: cleanFingerprintHash,
      recorded_at: '2026-05-12T00:00:00.000Z'
    },
    artifacts: {
      flow_verification_json: '.vibepro/verification/flow-needs-setup/flow-verification.json'
    }
  }];
  await writeJson(manifestPath, manifest);

  const before = await runCli(['pr', 'prepare', repo, '--base', 'main', '--json']);

  assert.equal(before.exitCode, 0);
  const beforeGate = before.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:path_surface_matrix');
  assert.equal(beforeGate.status, 'partial_surface');
  assert.equal(beforeGate.missing_surfaces.includes('review_surface'), true);
  await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:path_surface_matrix',
    '--source-status',
    'partial_surface',
    '--summary',
    'Gate review surface is covered by generated PR evidence.',
    '--reason',
    'This fixture has no runtime user path; the review surface is the generated VibePro PR evidence.',
    '--reviewer',
    'codex',
    '--status',
    'accepted',
    '--json'
  ]);

  const after = await runCli(['pr', 'prepare', repo, '--base', 'main', '--json']);

  assert.equal(after.exitCode, 0);
  const afterGate = after.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:path_surface_matrix');
  assert.equal(afterGate.status, 'passed');
  assert.equal(afterGate.accepted_decision.source, 'gate:path_surface_matrix');
  assert.match(afterGate.reason, /Path\/surface matrix accepted by decision record/);
});

test('pr prepare blocks PR freshness when base advanced after branch creation', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'feature.js'), 'export const feature = true;\n');
  await git(repo, ['add', 'src/feature.js']);
  await git(repo, ['commit', '-m', 'feat: add feature branch work']);

  const freshResult = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);

  assert.equal(freshResult.exitCode, 0);
  const freshGate = freshResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:pr_freshness');
  assert.equal(freshGate.status, 'passed');
  assert.equal(freshGate.head_contains_base, true);
  assert.match(freshGate.reason, /contains current main/);

  await git(repo, ['switch', 'main']);
  await writeFile(path.join(repo, 'base-change.md'), 'main moved\n');
  await git(repo, ['add', 'base-change.md']);
  await git(repo, ['commit', '-m', 'docs: move base branch']);
  await git(repo, ['switch', 'feature/test-story']);

  const staleResult = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);

  assert.equal(staleResult.exitCode, 0);
  const staleGate = staleResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:pr_freshness');
  assert.equal(staleGate.status, 'needs_rebase');
  assert.equal(staleGate.head_contains_base, false);
  assert.match(staleGate.reason, /does not contain current main/);
  assert.equal(
    staleResult.result.preparation.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:pr_freshness'),
    true
  );
  const actions = staleResult.result.preparation.gate_status.execution_gate.required_actions.join('\n');
  assert.match(actions, /git fetch origin/);
  assert.match(actions, /vibepro pr prepare/);
});

test('pr prepare exposes stale verification evidence through artifact consistency gate', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'artifact-consistency.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/artifact-consistency.js']);
  await git(repo, ['commit', '-m', 'feat: add artifact consistency fixture']);

  const recordResult = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'npm test',
    '--summary',
    'unit suite passed for artifact consistency fixture'
  ]);
  assert.equal(recordResult.exitCode, 0);

  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation']);
  await runCli([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--agent-system',
    'codex',
    '--agent-id',
    'codex-artifact-consistency-runtime'
  ]);
  await runCli([
    'review',
    'close',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--agent-id',
    'codex-artifact-consistency-runtime',
    '--close-reason',
    'completed',
    '--close-evidence',
    'test:artifact-consistency-runtime'
  ]);
  const reviewRecordResult = await runCli([
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
    'runtime contract reviewed for artifact consistency',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-artifact-consistency-runtime',
    '--agent-model',
    'gpt-5',
    '--agent-transcript',
    'test:artifact-consistency-runtime',
    '--agent-closed',
    '--agent-close-evidence',
    'test:artifact-consistency-runtime'
  ]);
  assert.equal(reviewRecordResult.exitCode, 0);

  const currentResult = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(currentResult.exitCode, 0);
  const currentGate = currentResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:artifact_consistency');
  assert.equal(currentGate.status, 'passed');
  assert.equal(currentGate.artifact_count >= 1, true);
  const reviewArtifact = currentGate.artifacts.find((artifact) => artifact.artifact_type === 'agent_review_result');
  assert.equal(reviewArtifact.recorded_head_sha, currentResult.result.preparation.git.head_sha);
  assert.match(reviewArtifact.recorded_user_status_fingerprint_hash, /^[a-f0-9]{64}$/);
  assert.equal(currentResult.result.preparation.pr_context.gate_dag.summary.artifact_consistency_status, 'passed');

  await writeFile(path.join(repo, 'src', 'artifact-consistency.js'), 'export const value = 2;\n');

  const reuseResult = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(reuseResult.exitCode, 0);
  const reuseGate = reuseResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:artifact_consistency');
  assert.equal(reuseGate.status, 'passed');
  assert.equal(reuseGate.artifacts.some((artifact) => artifact.status === 'reused_low_risk'), true);

  const largeRewrite = Array.from({ length: 40 }, (_, index) => `export const value${index} = ${index};`).join('\n');
  await writeFile(path.join(repo, 'src', 'artifact-consistency.js'), `${largeRewrite}\n`);

  const staleResult = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(staleResult.exitCode, 0);
  const staleGate = staleResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:artifact_consistency');
  assert.equal(staleGate.status, 'stale_evidence');
  assert.equal(staleGate.inconsistent_artifact_count >= 1, true);
  const staleVerificationArtifact = staleGate.inconsistent_artifacts.find((artifact) => artifact.artifact_type === 'verification_command');
  assert.equal(staleVerificationArtifact.kind, 'unit');
  assert.match(staleGate.reason, /not bound to the current git state/);
  assert.equal(
    staleResult.result.preparation.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:artifact_consistency'),
    true
  );
  const actions = staleResult.result.preparation.gate_status.execution_gate.required_actions.join('\n');
  assert.match(actions, /Regenerate stale VibePro evidence artifacts/);
  assert.match(actions, /Rerun current-bound verification evidence/);
});

test('pr prepare annotates stale PR lifecycle artifacts with current HEAD mismatch', async () => {
  const repo = await makeGitRepoWithStory();
  const oldHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-prepare');
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-05-10T00:00:00.000Z',
    mode: 'pr_create',
    dry_run: true,
    workspace_initialized: true,
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    task_context: null,
    output: { language: 'ja' },
    gate_dag: { overall_status: 'ready_for_review', summary: { needs_evidence_count: 0 }, nodes: [] },
    execution_gate: { status: 'passed', pr_create_allowed: true },
    gate_override: null,
    toolchain: {
      source_git: {
        commit: oldHead,
        branch: 'feature/test-story'
      }
    },
    base: 'main',
    head: 'feature/test-story',
    title: 'Old green PR create',
    body_file: '.vibepro/pr/story-pr-prepare/pr-body.md',
    prepare_artifacts: {},
    warnings: [],
    commands: ['gh pr create --base main --head feature/test-story'],
    results: []
  });
  await writeFile(path.join(prDir, 'pr-create.html'), '<html><body>old green create</body></html>\n');
  await writeJson(path.join(prDir, 'pr-merge.json'), {
    schema_version: '0.1.0',
    created_at: '2026-05-10T00:00:00.000Z',
    mode: 'execute_merge',
    dry_run: true,
    workspace_initialized: true,
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    output: { language: 'ja' },
    strategy: 'squash',
    delete_branch: false,
    base: 'main',
    current_branch: 'feature/test-story',
    current_head_sha: oldHead,
    repository_slug: 'Unson-LLC/vibepro',
    pr: {
      selector: '123',
      url: 'https://github.example.test/unson/vibepro/pull/123',
      state: 'OPEN',
      is_draft: false,
      merge_state_status: 'CLEAN',
      review_decision: '',
      head_ref_name: 'feature/test-story',
      head_ref_oid: oldHead,
      base_ref_name: 'main',
      checks: []
    },
    gate_dag: { overall_status: 'ready_for_review', summary: { needs_evidence_count: 0 }, nodes: [] },
    preconditions: {
      gate_ready: true,
      clean_worktree: true,
      base_freshness: { status: 'passed' },
      remote_head_match: { status: 'passed' },
      checks_ready: { status: 'passed' },
      review_policy: { status: 'passed' },
      open_pull_request: { status: 'passed' }
    },
    warnings: [],
    commands: [],
    results: [],
    branch_cleanup: {
      requested: false,
      remote: { attempted: false, deleted: false, command: null },
      local: { attempted: false, deleted: false, command: null }
    },
    status: 'ready_to_merge',
    stop_reason: 'ready_to_merge_dry_run',
    merge_commit_sha: null,
    merged_at: null
  });
  await writeFile(path.join(prDir, 'pr-merge.html'), '<html><body>old green merge</body></html>\n');

  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lifecycle-freshness.js'), 'export const lifecycleFreshness = true;\n');
  await git(repo, ['add', 'src/lifecycle-freshness.js']);
  await git(repo, ['commit', '-m', 'feat: advance lifecycle artifact head']);
  const currentHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.preparation.lifecycle_artifacts.status, 'stale');
  assert.equal(result.result.preparation.lifecycle_artifacts.current_head_sha, currentHead);
  assert.equal(
    result.result.preparation.lifecycle_artifacts.artifacts.every((artifact) => artifact.status === 'stale'),
    true
  );

  const prCreate = await readJson(path.join(prDir, 'pr-create.json'));
  assert.equal(prCreate.artifact_freshness.status, 'stale');
  assert.equal(prCreate.artifact_freshness.artifact_head_sha, oldHead);
  assert.equal(prCreate.artifact_freshness.current_head_sha, currentHead);
  assert.match(prCreate.warnings.join('\n'), /VibePro lifecycle artifact freshness: pr-create artifact was recorded/);
  const prCreateHtml = await readFile(path.join(prDir, 'pr-create.html'), 'utf8');
  assert.match(prCreateHtml, /Artifact Freshness/);
  assert.match(prCreateHtml, /pr-create artifact was recorded/);
  assert.match(prCreateHtml, new RegExp(currentHead.slice(0, 12)));

  const prMerge = await readJson(path.join(prDir, 'pr-merge.json'));
  assert.equal(prMerge.artifact_freshness.status, 'stale');
  assert.equal(prMerge.artifact_freshness.artifact_head_sha, oldHead);
  assert.equal(prMerge.artifact_freshness.current_head_sha, currentHead);
  assert.match(prMerge.warnings.join('\n'), /VibePro lifecycle artifact freshness: pr-merge artifact was recorded/);
  const prMergeHtml = await readFile(path.join(prDir, 'pr-merge.html'), 'utf8');
  assert.match(prMergeHtml, /Artifact Freshness/);
  assert.match(prMergeHtml, /pr-merge artifact was recorded/);
  assert.match(prMergeHtml, new RegExp(currentHead.slice(0, 12)));

  const prPrepareHtml = await readFile(path.join(prDir, 'review-cockpit.html'), 'utf8');
  assert.match(prPrepareHtml, /PR lifecycle artifact/);
  assert.match(prPrepareHtml, /pr-create\.json/);
  assert.match(prPrepareHtml, /pr-merge\.json/);
});

test('pr prepare keeps verification evidence current when only tracked VibePro manifest changes', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'internal-artifact-fingerprint.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/internal-artifact-fingerprint.js']);
  await git(repo, ['commit', '-m', 'feat: add internal artifact fingerprint fixture']);
  await git(repo, ['add', '-f', '.vibepro/vibepro-manifest.json']);
  await git(repo, ['commit', '-m', 'test: track vibepro manifest fixture']);

  const recordResult = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'npm test',
    '--summary',
    'unit suite passed for internal artifact fingerprint fixture'
  ]);
  assert.equal(recordResult.exitCode, 0);

  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_internal_update_for_test = new Date().toISOString();
  await writeJson(manifestPath, manifest);

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const gitState = result.result.preparation.git;
  assert.equal(gitState.dirty, false);
  assert.equal(gitState.raw_dirty, true);
  assert.equal(gitState.vibepro_internal_dirty_files.some((file) => file.path === '.vibepro/vibepro-manifest.json'), true);
  const gate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:artifact_consistency');
  assert.equal(gate.status, 'passed');
});

test('pr prepare keeps legacy full-fingerprint evidence stale when tracked VibePro manifest changes', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'legacy-internal-artifact-fingerprint.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/legacy-internal-artifact-fingerprint.js']);
  await git(repo, ['commit', '-m', 'feat: add legacy internal artifact fixture']);
  await git(repo, ['add', '-f', '.vibepro/vibepro-manifest.json']);
  await git(repo, ['commit', '-m', 'test: track legacy vibepro manifest fixture']);

  const recordResult = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'npm test',
    '--summary',
    'legacy unit suite passed for internal artifact fingerprint fixture'
  ]);
  assert.equal(recordResult.exitCode, 0);

  const evidencePath = path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'verification-evidence.json');
  const evidence = await readJson(evidencePath);
  delete evidence.commands[0].git_context.user_status_fingerprint_hash;
  delete evidence.commands[0].git_context.fingerprint_scope;
  await writeJson(evidencePath, evidence);

  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_internal_update_for_test = new Date().toISOString();
  await writeJson(manifestPath, manifest);

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const gate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:artifact_consistency');
  assert.equal(gate.status, 'stale_evidence');
  assert.equal(gate.inconsistent_artifacts.some((artifact) => artifact.artifact_type === 'verification_command'), true);
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

test('public-discovery classifies private routes and inherits App Router metadata', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-public-discovery-next-'));
  await mkdir(path.join(repo, 'src', 'app', '(public)', 'articles'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(public)', 'articles', 'demo'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(public)', 'override'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(auth)', 'login'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'profile'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'log_viewer'), { recursive: true });
  await mkdir(path.join(repo, 'public'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'layout.tsx'), `
export const metadata = {
  title: 'ExampleTravel',
  description: 'Public hotel search'
};
export default function Layout({ children }) {
  return <html><body>{children}</body></html>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', '(public)', 'layout.tsx'), `
export const metadata = {
  openGraph: { title: 'ExampleTravel' }
};
export default function Layout({ children }) {
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Organization' };
  return <section>{children}</section>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', '(public)', 'articles', 'page.tsx'), 'export default function Page() { return <main><h1>Article</h1><p>Public article content.</p></main>; }\n');
  await writeFile(path.join(repo, 'src', 'app', '(public)', 'override', 'page.tsx'), `
export const metadata = {
  title: 'Override',
  description: 'Page level override',
  openGraph: { title: 'Override' }
};
export default function Page() {
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Article' };
  return <main><h1>Override</h1><p>Public override content.</p></main>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', '(public)', 'articles', 'demo', 'page.tsx'), 'export default function Page() { return <button>Demo</button>; }\n');
  await writeFile(path.join(repo, 'src', 'app', '(auth)', 'login', 'page.tsx'), 'export default function Page() { return <form>Login</form>; }\n');
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'profile', 'page.tsx'), 'export default function Page() { return <main>Profile</main>; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'log_viewer', 'page.tsx'), 'export default function Page() { return <main>Logs</main>; }\n');
  await writeFile(path.join(repo, 'public', 'googleb7a465fcaf621318.html'), 'google-site-verification: googleb7a465fcaf621318.html\n');
  await writeFile(path.join(repo, 'public', 'robots.txt'), 'User-agent: *\nAllow: /\nUser-agent: GPTBot\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\n');
  await writeFile(path.join(repo, 'public', 'llms.txt'), '# ExampleTravel\n');

  const scan = await scanPublicDiscovery(repo);

  assert.equal(scan.route_targets.some((item) => item.file === 'public/googleb7a465fcaf621318.html' && item.target_type === 'verification_file' && item.scan_mode === 'skip'), true);
  assert.equal(scan.route_targets.some((item) => item.file.includes('/(auth)/') && item.target_type === 'auth_flow' && item.scan_mode === 'skip'), true);
  assert.equal(scan.route_targets.some((item) => item.file.includes('/(app)/') && item.target_type === 'private_app_route' && item.scan_mode === 'skip'), true);
  assert.equal(scan.route_targets.some((item) => item.file.includes('/demo/') && item.target_type === 'internal_dev_route' && item.scan_mode === 'skip'), true);
  assert.equal(scan.metadata_findings.some((finding) => finding.file === 'src/app/(public)/articles/page.tsx' && finding.kind === 'missing_title'), false);
  assert.equal(scan.metadata_findings.some((finding) => finding.file === 'src/app/(public)/articles/page.tsx' && finding.kind === 'missing_meta_description'), false);
  assert.equal(scan.metadata_findings.some((finding) => finding.file === 'src/app/(public)/articles/page.tsx' && finding.kind === 'missing_social_metadata'), false);
  assert.equal(scan.structured_data_findings.some((finding) => finding.file === 'src/app/(public)/articles/page.tsx' && finding.kind === 'missing_structured_data_hint'), false);
  assert.equal(scan.metadata_findings.some((finding) => finding.file === 'src/app/(public)/override/page.tsx' && finding.kind === 'missing_title'), false);
  assert.equal(scan.metadata_findings.some((finding) => finding.file === 'src/app/(public)/override/page.tsx' && finding.kind === 'missing_meta_description'), false);
  assert.equal(scan.metadata_findings.some((finding) => finding.file === 'src/app/(public)/override/page.tsx' && finding.kind === 'missing_social_metadata'), false);
  assert.equal(scan.structured_data_findings.some((finding) => finding.file === 'src/app/(public)/override/page.tsx' && finding.kind === 'missing_structured_data_hint'), false);
  assert.equal(scan.metadata_findings.some((finding) => finding.file.includes('/(auth)/') || finding.file.includes('/(app)/') || finding.file.includes('/demo/') || finding.file.includes('google')), false);
});

test('public-discovery applies documented suppressions and reports warnings', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-public-discovery-suppress-'));
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(path.join(repo, 'index.html'), '<!doctype html><main><p>Short</p></main>');
  await writeFile(path.join(repo, '.vibepro', 'public-discovery-suppressions.json'), JSON.stringify([
    {
      file: 'index.html',
      finding_kinds: ['missing_title'],
      reason: 'Legacy static entry keeps title outside generated HTML',
      expires_at: null
    },
    {
      file: 'missing.html',
      finding_kinds: ['not_a_real_finding_kind'],
      reason: 'Exercise suppression warnings',
      expires_at: null
    }
  ], null, 2));

  const scan = await scanPublicDiscovery(repo);

  assert.equal(scan.metadata_findings.some((finding) => finding.kind === 'missing_title'), false);
  assert.equal(scan.suppressions.suppressed_findings.some((finding) => finding.kind === 'missing_title' && finding.suppression.reason.includes('Legacy static entry')), true);
  assert.equal(scan.suppressions.warnings.some((warning) => warning.kind === 'unknown_finding_kind'), true);
  assert.equal(scan.suppressions.warnings.some((warning) => warning.kind === 'unmatched_suppression'), true);

  const result = await runCli(['check', 'public-discovery', repo, '--run-id', 'public-discovery-suppressions', '--json']);
  assert.equal(result.exitCode, 0);
  const suppressionCheck = result.result.check.checks.find((check) => check.id === 'public_discovery.suppressions');
  assert.equal(suppressionCheck.status, 'needs_review');
  assert.match(suppressionCheck.summary, /1 suppressed/);
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
  assert.match(checkMarkdown, /## 次に見る場所/);
  assert.match(checkMarkdown, /## 共有テンプレート/);
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

test('graph reports install guidance when graphify is missing (INV-GPD-3)', async () => {
  const repo = await makeRepo();
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-empty-home-'));
  let stderrOutput = '';

  const result = await runCli(['graph', repo, '--run-graphify'], {
    env: { ...process.env, HOME: homeDir, PATH: '' },
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.command, 'graph');
  assert.match(stderrOutput, /graphify command was not found on PATH/);
  assert.match(stderrOutput, /optional but recommended/);
  assert.match(stderrOutput, /No graphify executable was found in common install locations/);
  assert.match(stderrOutput, /uv tool install graphifyy/);
});

test('graph reports PATH guidance when graphify exists outside PATH (INV-GPD-1, INV-GPD-2)', async () => {
  const repo = await makeRepo();
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-home-'));
  const localBin = path.join(homeDir, '.local', 'bin');
  await mkdir(localBin, { recursive: true });
  const graphifyBin = path.join(localBin, 'graphify');
  await writeFile(graphifyBin, '#!/bin/sh\nexit 0\n');
  await chmod(graphifyBin, 0o755);
  let stderrOutput = '';

  const result = await runCli(['graph', repo, '--run-graphify'], {
    env: { ...process.env, HOME: homeDir, PATH: '' },
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderrOutput, /graphify command was not found on PATH/);
  assert.match(stderrOutput, /Found graphify outside PATH/);
  assert.match(stderrOutput, new RegExp(graphifyBin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(stderrOutput, /PATH="\$HOME\/\.local\/bin:\$PATH"/);
  assert.doesNotMatch(stderrOutput, /graphify is not installed/);
  assert.doesNotMatch(stderrOutput, /uv tool install graphifyy/);
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
    if (!searchQuery) return;
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
    <button onClick={searchByName}>検索</button>
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
        profile: 'configured-case-management',
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

test('flow design scanner limits silent noop to event paths and ignores test mock buttons', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'ai-search'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'detail', '_components'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'ai-search', 'client.tsx'), `
"use client";
function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return String(Date.now());
}
function confidenceLabel(confidence) {
  if (confidence === 'db_confirmed') return 'DB確認済み';
  if (confidence === 'needs_call') return '要架電';
  if (confidence === 'unknown') return '不明';
  return '未確認';
}
function getLatestCarousel(history) {
  if (history.length === 0) return null;
  return history[history.length - 1];
}
function selectedCallHotel(history, id) {
  const hotel = history.find((item) => item.id === id);
  if (hotel) return hotel;
  return null;
}
export default function AiSearchClient() {
  const isLoading = false;
  const composerMessage = '';
  const choose = () => {
    selectedCallHotel([], 'h1');
  };
  const submit = () => {
    if (!composerMessage || isLoading) return;
    void fetch('/api/ai-search', { method: 'POST' });
  };
  return <form onSubmit={submit}>
    <button type="submit" disabled={isLoading || !composerMessage.trim()}>
      検索する
    </button>
    {isLoading && <span>読み込み中</span>}
    <button type="button" onClick={choose}>選択</button>
  </form>;
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'detail', '_components', 'SearchResultHotelCard.test.tsx'), `
import { vi } from 'vitest';
vi.mock('@/components/premium/PremiumGatedShadowCallButton', () => ({
  PremiumGatedShadowCallButton: ({ children }) => <button type="button">{children}</button>
}));
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-AI', title: 'AI検索UIの操作信頼性を診断する', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.some((hit) => /createId|confidenceLabel|getLatestCarousel|selectedCallHotel/.test(hit.handler ?? '')), false);
  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'submit');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'info');
  assert.equal(result.silent_noop_hits[0].mitigation, 'disabled UI mitigation');
  assert.equal(result.interactive_contract_hits.some((hit) => hit.file.endsWith('.test.tsx')), false);
  assert.equal(result.status, 'pass');
});

test('flow design scanner detects async function handlers after event-path gating', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'async-handler'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'async-handler', 'page.tsx'), `
"use client";
export default function AsyncHandlerPage() {
  async function handleSubmit() {
    if (!query) return;
    setSaved(true);
  }
  return <form onSubmit={handleSubmit}><button type="submit">保存</button></form>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-ASYNC', title: 'async function handlerを診断する', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'handleSubmit');
  assert.equal(result.silent_noop_hits[0].event_path, 'onSubmit:handleSubmit');
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner does not downgrade partially mitigated early returns', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'partial'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'partial', 'page.tsx'), `
"use client";
export default function PartialPage() {
  const submit = () => {
    if (!query || isLoading) return;
    setSaved(true);
  };
  return <button onClick={submit} disabled={isLoading}>検索</button>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-PARTIAL', title: '部分的なdisabledでは空入力noopを隠さない', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'submit');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'review');
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner does not use unrelated element disabled state as mitigation', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'unrelated-disabled'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'unrelated-disabled', 'page.tsx'), `
"use client";
export default function UnrelatedDisabledPage() {
  const save = () => {
    if (!query) return;
    setSaved(true);
  };
  return <main>
    <button onClick={save}>保存</button>
    <button disabled={!query}>別の操作</button>
  </main>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-UNRELATED', title: '別UIのdisabledで無反応を隠さない', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'save');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'review');
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner preserves unmitigated duplicate event paths for the same handler', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'duplicate-handler'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'duplicate-handler', 'page.tsx'), `
"use client";
export default function DuplicateHandlerPage() {
  const save = () => {
    if (!query) return;
    setSaved(true);
  };
  return <main>
    <button onClick={save}>保存</button>
    <button onClick={save} disabled={!query}>別配置の保存</button>
  </main>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-DUPLICATE', title: '同一handlerの未mitigate経路を残す', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'save');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'review');
  assert.match(result.silent_noop_hits[0].event_path, /onClick:save/);
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner does not treat loading state variable as visible mitigation', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'loading-state'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'loading-state', 'page.tsx'), `
"use client";
export default function LoadingStatePage() {
  const run = () => {
    if (isLoading) return;
    void fetch('/api/search');
    setSaved(true);
  };
  return <button onClick={run}>保存</button>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-LOADING', title: 'loading stateだけで無反応を隠さない', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'run');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'review');
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner follows direct calls from inline event handlers', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'inline'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'inline', 'page.tsx'), `
"use client";
export default function InlinePage() {
  const submit = () => {
    if (!ready) return;
    setSaved(true);
  };
  return <button onClick={() => submit()}>保存</button>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-INLINE', title: 'inline handler経由の操作を診断する', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'submit');
  assert.equal(result.silent_noop_hits[0].event_path, 'onClick:submit');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'review');
  assert.equal(result.status, 'needs_review');
});

test('flow design scanner reads disabled mitigation from inline arrow event elements', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'inline-disabled'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'inline-disabled', 'page.tsx'), `
"use client";
export default function InlineDisabledPage() {
  const submit = () => {
    if (!query) return;
    setSaved(true);
  };
  return <button onClick={() => submit()} disabled={!query}>保存</button>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-INLINE-DISABLED', title: 'inline handlerのdisabledを診断に使う', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'submit');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'info');
  assert.equal(result.silent_noop_hits[0].mitigation, 'disabled UI mitigation');
  assert.equal(result.status, 'pass');
});

test('flow design scanner preserves unmitigated one-hop helper paths', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'helper-paths'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'helper-paths', 'page.tsx'), `
"use client";
export default function HelperPathsPage() {
  const saveCore = () => {
    if (!query) return;
    setSaved(true);
  };
  const saveA = () => saveCore();
  const saveB = () => saveCore();
  return <main>
    <button onClick={saveA} disabled={!query}>保存A</button>
    <button onClick={saveB}>保存B</button>
  </main>;
}
`);

  const result = await scanFlowDesign(repo, {
    story: { story_id: 'U-HELPER-PATHS', title: 'helperに複数event pathがある', view: 'user' }
  });

  assert.equal(result.silent_noop_hits.length, 1);
  assert.equal(result.silent_noop_hits[0].handler, 'saveCore');
  assert.equal(result.silent_noop_hits[0].gate_effect, 'review');
  assert.match(result.silent_noop_hits[0].event_path, /saveA->saveCore/);
  assert.match(result.silent_noop_hits[0].event_path, /saveB->saveCore/);
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
  config.flow_design = {
    profile: 'configured-case-management',
    value_contract: {
      forbidden_labels: ['退院予定日'],
      required_labels: ['退院目標日']
    }
  };
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
  assert.equal(evidence.flow_design.profile, 'configured-case-management');
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

test('diagnose does not gate mitigated info-level silent noop findings', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-mitigated-flow-'));
  await runCli([
    'init',
    repo,
    '--story-id',
    'U-MITIGATED',
    '--title',
    '検索UIの空入力をdisabledで防ぐ',
    '--view',
    'user'
  ]);
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: { next: '16.2.1', react: '19.0.0' }
  }, null, 2));
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), `
"use client";
export default function Page() {
  const submit = () => {
    if (!query || isLoading) return;
    setSaved(true);
  };
  return <button onClick={submit} disabled={!query || isLoading}>検索</button>;
}
`);
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'page' }],
    edges: []
  }));

  const result = await runCli(['diagnose', repo, '--run-id', '2026-05-10T010000Z']);

  assert.equal(result.exitCode, 0);
  const evidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', '2026-05-10T010000Z', 'evidence.json'));
  assert.equal(evidence.flow_design.silent_noop_hits.length, 1);
  assert.equal(evidence.flow_design.silent_noop_hits[0].gate_effect, 'info');
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-FLOW-002'), false);
  assert.equal(evidence.gates.find((gate) => gate.id === 'production-readiness')?.status, 'pass');
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
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: { '@playwright/test': '^1.50.0' }
  }, null, 2));
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.flow_design = {
    profile: 'configured-case-management',
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
  assert.match(verification.git_context.head_sha, /^[a-f0-9]{40}$/);
  assert.match(verification.git_context.status_fingerprint_hash, /^[a-f0-9]{64}$/);
  assert.match(verification.git_context.user_status_fingerprint_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(verification.git_context.fingerprint_scope.user_excludes, ['.vibepro/', '.worktrees/vibepro/']);
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
  assert.equal(manifest.flow_verification_runs[0].git_context.head_sha, verification.git_context.head_sha);
  assert.equal(manifest.flow_verification_runs[0].git_context.user_status_fingerprint_hash, verification.git_context.user_status_fingerprint_hash);
  assert.deepEqual(manifest.flow_verification_runs[0].git_context.fingerprint_scope.user_excludes, ['.vibepro/', '.worktrees/vibepro/']);
});

test('verify flow does not pass when no runtime probes are configured', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'U-021', '--title', 'No probe flow']);
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: { '@playwright/test': '^1.50.0' }
  }, null, 2));

  const result = await runCli([
    'verify',
    'flow',
    repo,
    '--base-url',
    'http://127.0.0.1:3000',
    '--run-id',
    'flow-no-probes',
    '--json'
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.verification.status, 'needs_evidence');
  assert.match(result.result.verification.reason, /No runtime probes/);
  assert.equal(result.result.verification.summary.total, 0);
  const verification = await readJson(path.join(repo, '.vibepro', 'verification', 'flow-no-probes', 'flow-verification.json'));
  assert.equal(verification.status, 'needs_evidence');
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
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.flow_design = {
    runtime_probes: [{
      id: 'auth-smoke',
      title: 'Authenticated smoke probe',
      path: '/',
      mutates: false,
      steps: [{ action: 'screenshot', name: 'auth-smoke' }]
    }]
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
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
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.flow_design = {
    runtime_probes: [{
      id: 'basic-auth-smoke',
      title: 'Basic auth smoke probe',
      path: '/',
      mutates: false,
      steps: [{ action: 'screenshot', name: 'basic-auth-smoke' }]
    }]
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const binDir = path.join(repo, 'fake-bin');
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(binDir, 'npx'), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(process.env.FAKE_NPX_LOG, [
  process.argv.slice(2).join(' '),
  'auth=' + process.env.VIBEPRO_BASIC_AUTH_USER + ':' + process.env.VIBEPRO_BASIC_AUTH_PASSWORD
	].join('\\n') + '\\n');
	console.log('fake playwright ok ' + process.env.VIBEPRO_BASIC_AUTH_PASSWORD);
	`);
  await chmod(path.join(binDir, 'npx'), 0o755);

  const result = await runCli([
    'verify',
    'flow',
    repo,
    '--base-url',
    'http://54.221.232.92',
    '--basic-auth-env',
    'APP_BASIC_AUTH',
    '--run-id',
    'flow-basic-auth',
    '--json'
  ], {
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      FAKE_NPX_LOG: path.join(repo, 'fake-npx-basic-auth.log'),
      APP_BASIC_AUTH: 'nurse:super-secret'
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.verification.status, 'pass');
  assert.deepEqual(result.result.verification.http_auth, {
    enabled: true,
    source: 'env:APP_BASIC_AUTH',
    username_redacted: true,
    password_redacted: true
  });
  assert.match(await readFile(path.join(repo, 'fake-npx-basic-auth.log'), 'utf8'), /auth=nurse:super-secret/);
	  const verificationText = await readFile(path.join(repo, '.vibepro', 'verification', 'flow-basic-auth', 'flow-verification.json'), 'utf8');
	  assert.doesNotMatch(verificationText, /super-secret/);
	  assert.doesNotMatch(verificationText, /nurse/);
	  assert.match(verificationText, /\[REDACTED\]/);
	  const logText = await readFile(path.join(repo, '.vibepro', 'verification', 'flow-basic-auth', 'playwright-output.log'), 'utf8');
	  assert.doesNotMatch(logText, /super-secret/);
	  assert.doesNotMatch(logText, /nurse/);
	  assert.match(logText, /\[REDACTED\]/);
	  const specText = await readFile(path.join(repo, '.vibepro', 'verification', 'flow-basic-auth', 'flow-verification.spec.js'), 'utf8');
	  assert.doesNotMatch(specText, /super-secret/);
	  assert.doesNotMatch(specText, /nurse/);
	  const reportText = await readFile(path.join(repo, '.vibepro', 'verification', 'flow-basic-auth', 'flow-verification.md'), 'utf8');
	  assert.doesNotMatch(reportText, /nurse/);
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
    profile: 'configured-case-management',
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
	  await git(repo, ['add', 'src/feature/flow.js']);
	  await git(repo, ['commit', '-m', 'feat: add flow source']);
	  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
	  const cleanFingerprintHash = createHash('sha256').update('git-status --porcelain -uall\n\ngit-diff --binary\n').digest('hex');
	  await mkdir(path.join(repo, '.vibepro', 'verification', 'flow-pass'), { recursive: true });
	  await writeFile(path.join(repo, '.vibepro', 'verification', 'flow-pass', 'flow-verification.json'), JSON.stringify({
    schema_version: '0.1.0',
    run_id: 'flow-pass',
    story_id: 'story-pr-prepare',
    created_at: '2026-05-10T00:00:00.000Z',
	    status: 'pass',
	    git_context: {
	      head_sha: headSha,
	      dirty: false,
	      status_fingerprint_hash: cleanFingerprintHash,
	      recorded_at: '2026-05-10T00:00:00.000Z'
	    },
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
  await mkdir(path.join(repo, '.vibepro', 'verification', 'flow-summary-only'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'verification', 'flow-summary-only', 'flow-verification.json'), JSON.stringify({
    schema_version: '0.1.0',
    run_id: 'flow-summary-only',
    story_id: 'story-pr-prepare',
    created_at: '2026-05-11T00:00:00.000Z',
    status: 'pass',
    git_context: {
      head_sha: headSha,
      dirty: false,
      status_fingerprint_hash: cleanFingerprintHash,
      recorded_at: '2026-05-11T00:00:00.000Z'
    },
    base_url: 'http://127.0.0.1:3000',
    summary: {
      total: 1,
      pass: 1,
      fail: 0,
      skipped: 0,
      needs_setup: 0
    },
    probes: []
  }, null, 2));
	  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
	  const manifest = await readJson(manifestPath);
  manifest.latest_flow_verification_run = 'flow-summary-only';
	  manifest.flow_verification_runs = [{
    run_id: 'flow-summary-only',
    story_id: 'story-pr-prepare',
    created_at: '2026-05-11T00:00:00.000Z',
    status: 'pass',
    git_context: {
      head_sha: headSha,
      dirty: false,
      status_fingerprint_hash: cleanFingerprintHash,
      recorded_at: '2026-05-11T00:00:00.000Z'
    },
    base_url: 'http://127.0.0.1:3000',
    artifacts: {
      flow_verification_json: '.vibepro/verification/flow-summary-only/flow-verification.json'
    },
    summary: {
      total: 1,
      pass: 1,
      fail: 0,
      skipped: 0,
      needs_setup: 0
    }
  }, {
	    run_id: 'flow-pass',
	    story_id: 'story-pr-prepare',
	    created_at: '2026-05-10T00:00:00.000Z',
	    status: 'pass',
	    git_context: {
	      head_sha: headSha,
	      dirty: false,
	      status_fingerprint_hash: cleanFingerprintHash,
	      recorded_at: '2026-05-10T00:00:00.000Z'
	    },
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

  const summaryOnlyResult = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  assert.equal(summaryOnlyResult.exitCode, 0);
  const summaryOnlyPrepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
  assert.equal(summaryOnlyPrepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e').status, 'needs_evidence');

  manifest.latest_flow_verification_run = 'flow-pass';
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

test('pr prepare keeps flow verification current when only tracked VibePro manifest changes', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src', 'feature'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'feature', 'flow-user-fingerprint.js'), 'export const flowUserFingerprint = true;\n');

  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const trackedManifest = await readJson(manifestPath);
  trackedManifest.test_tracking_marker = 'flow-user-fingerprint';
  await writeJson(manifestPath, trackedManifest);
  await git(repo, ['add', 'src/feature/flow-user-fingerprint.js']);
  await git(repo, ['add', '-f', '.vibepro/vibepro-manifest.json']);
  await git(repo, ['commit', '-m', 'feat: add flow user fingerprint fixture']);

  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const cleanFingerprints = await collectGitStatusFingerprints(repo);
  assert.equal(cleanFingerprints.dirty, false);
  assert.equal(cleanFingerprints.user_dirty, false);

  await mkdir(path.join(repo, '.vibepro', 'verification', 'flow-user-fingerprint'), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'verification', 'flow-user-fingerprint', 'flow-verification.json'), {
    schema_version: '0.1.0',
    run_id: 'flow-user-fingerprint',
    story_id: 'story-pr-prepare',
    created_at: '2026-05-12T00:00:00.000Z',
    status: 'pass',
    git_context: {
      head_sha: headSha,
      dirty: false,
      status_fingerprint_hash: cleanFingerprints.status_fingerprint_hash,
      user_status_fingerprint_hash: cleanFingerprints.user_status_fingerprint_hash,
      fingerprint_scope: cleanFingerprints.fingerprint_scope,
      recorded_at: '2026-05-12T00:00:00.000Z'
    },
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
      status: 'pass'
    }]
  });
  await writeFile(path.join(repo, '.vibepro', 'verification', 'flow-user-fingerprint', 'flow-verification.md'), '# Flow Verification\n');

  const manifest = await readJson(manifestPath);
  manifest.latest_flow_verification_run = 'flow-user-fingerprint';
  manifest.flow_verification_runs = [{
    run_id: 'flow-user-fingerprint',
    story_id: 'story-pr-prepare',
    created_at: '2026-05-12T00:00:00.000Z',
    status: 'pass',
    git_context: {
      head_sha: headSha,
      dirty: false,
      status_fingerprint_hash: cleanFingerprints.status_fingerprint_hash,
      user_status_fingerprint_hash: cleanFingerprints.user_status_fingerprint_hash,
      fingerprint_scope: cleanFingerprints.fingerprint_scope,
      recorded_at: '2026-05-12T00:00:00.000Z'
    },
    base_url: 'http://127.0.0.1:3000',
    artifacts: {
      flow_verification_json: '.vibepro/verification/flow-user-fingerprint/flow-verification.json',
      flow_verification_report: '.vibepro/verification/flow-user-fingerprint/flow-verification.md'
    },
    summary: {
      total: 1,
      pass: 1,
      fail: 0,
      skipped: 0,
      needs_setup: 0
    }
  }];
  await writeJson(manifestPath, manifest);

  const dirtyFingerprints = await collectGitStatusFingerprints(repo);
  assert.equal(dirtyFingerprints.dirty, true);
  assert.equal(dirtyFingerprints.user_dirty, false);
  assert.equal(dirtyFingerprints.user_status_fingerprint_hash, cleanFingerprints.user_status_fingerprint_hash);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const flowVerification = result.result.preparation.pr_context.flow_verification;
  assert.equal(flowVerification.binding.status, 'current');
  assert.equal(flowVerification.stale, false);
  assert.equal(flowVerification.verification.binding.status, 'current');
  const e2eGate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(e2eGate.status, 'passed');
  assert.equal(e2eGate.flow_verification.run_id, 'flow-user-fingerprint');
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
  assert.doesNotMatch(JSON.stringify(catalog), /ExampleTravel|ホテル|旅行|hotel|shadow-call/i);
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
  assert.doesNotMatch(map, /ExampleTravel|ホテル|旅行|hotel|shadow-call/i);
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
  assert.equal(createResult.exitCode, 0, JSON.stringify(createResult.result ?? createResult.error ?? createResult, null, 2));
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
  assert.match(briefing, /Source復旧/);
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
  assert.equal(createResult.exitCode, 0, JSON.stringify(createResult.result ?? createResult.error ?? createResult, null, 2));
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
  assert.equal(createResult.exitCode, 0, JSON.stringify(createResult.result ?? createResult.error ?? createResult, null, 2));
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
  assert.doesNotMatch(JSON.stringify(catalog), /ExampleTravel|ホテル|旅行|hotel|shadow-call/i);
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
  await git(repo, ['remote', 'add', 'origin', 'https://github.com/Unson-LLC/vibepro.git']);

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
  assert.ok(prBody.indexOf('## このPRで決めたいこと') < prBody.indexOf('## 概要'));
  assert.match(prBody, /このPRで閉じる問い: PR本文に背景が出ない を満たす変更として、Runtime \/ Contract Docs \/ Tests の差分をこのPRで受け入れてよいか。/);
  assert.match(prBody, /### 判断グラフ/);
  assert.match(prBody, /- 目的: PR本文に背景が出ない/);
  assert.match(prBody, /- 正本: \[docs\/management\/stories\/active\/STR-001-pr-prepare.md\]\(https:\/\/github.com\/Unson-LLC\/vibepro\/blob\/feature\/test-story\/docs\/management\/stories\/active\/STR-001-pr-prepare.md\)/);
  assert.match(prBody, /- 差分: runtime 1件 \/ contract docs 5件 \/ tests 2件を変更/);
  assert.match(prBody, /\[src\/feature\/pr-prepare.js\]\(https:\/\/github.com\/Unson-LLC\/vibepro\/blob\/feature\/test-story\/src\/feature\/pr-prepare.js\)/);
  assert.match(prBody, /\[tests\/unit\/pr-prepare.test.js\]\(https:\/\/github.com\/Unson-LLC\/vibepro\/blob\/feature\/test-story\/tests\/unit\/pr-prepare.test.js\)/);
  assert.match(prBody, /- 証跡: Engineering Judgment passed \/ Story Source passed \/ Judgment Spine (passed|needs_evidence) \/ PR Route passed \/ PR Body passed \/ Managed Worktree needs_review(?: \/ Split passed)? \/ Requirement not_applicable \/ Unit candidate \/ Integration needs_evidence \/ E2E (passed|needs_(setup|evidence)) \/ Agent Review (passed|needs_review) \/ Network Contract passed \/ DAG Connectivity passed/);
  assert.match(prBody, /- 分割判断: single_pr_ok \/ keep_current_pr/);
  assert.match(prBody, /Gate状況: 未解決Gateがあります（対象: .*Gate/);
  assert.ok(prBody.indexOf('## このPRで決めたいこと') < prBody.indexOf('## 変更内容'));
  assert.ok(prBody.indexOf('## 変更内容') < prBody.indexOf('## なぜこの変更か'));
  assert.ok(prBody.indexOf('## なぜこの変更か') < prBody.indexOf('## レビューしてほしい観点'));
  assert.ok(prBody.indexOf('## レビューしてほしい観点') < prBody.indexOf('## 検証'));
  assert.ok(prBody.indexOf('## 検証') < prBody.indexOf('## リスク・確認事項'));
  assert.ok(prBody.indexOf('## リスク・確認事項') < prBody.indexOf('## 明示的にやらないこと'));
  assert.ok(prBody.indexOf('## 明示的にやらないこと') < prBody.indexOf('## 監査ログ'));
  assert.ok(prBody.indexOf('## 監査ログ') < prBody.indexOf('## 概要'));
  assert.ok(prBody.indexOf('## 監査ログ') < prBody.indexOf('## Agent Review'));
  assert.ok(prBody.indexOf('## 監査ログ') < prBody.indexOf('## Explore Evidence'));
  assert.ok(prBody.indexOf('## 監査ログ') < prBody.indexOf('## Gate DAG'));
  assert.ok(prBody.indexOf('## 監査ログ') < prBody.indexOf('## VibePro'));
  const humanPrBody = prBody.slice(0, prBody.indexOf('## 監査ログ'));
  assert.doesNotMatch(humanPrBody, /## Gate DAG/);
  assert.doesNotMatch(humanPrBody, /## Agent Review/);
  assert.doesNotMatch(humanPrBody, /## Explore Evidence/);
  assert.doesNotMatch(humanPrBody, /runtime: vibepro/);
  assert.match(prBody, /レビュー入口: Runtime \/ Contract Docs \/ Tests/);
  assert.match(prBody, /## レビュアー向け差分分類/);
  assert.match(prBody, /- Runtime: 1 files/);
  assert.match(prBody, /- Contract Docs: 5 files/);
  assert.match(prBody, /- Tests: 2 files/);
  assert.match(prBody, /## 明示的にやらないこと/);
  assert.match(prBody, /変更ファイル外の既存挙動は、このPRの完了保証対象外/);
  assert.match(prBody, /## 監査ログ/);
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
  assert.equal(prepare.gate_status.ready_for_pr_create, false);
  assert.equal(prepare.next_commands.some((command) => command.includes('vibepro pr create')), false);
  assert.equal(prepare.next_commands.some((command) => command.includes('vibepro review status')), true);
  assert.equal(prepare.next_commands.some((command) => command.includes('vibepro pr prepare')), true);

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
  assert.match(criticalWaiverStderrOutput, /parallel_subagent/);
  assert.doesNotMatch(criticalWaiverStderrOutput, /manual reviewers/);

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
import { expect, test } from '@playwright/test';
test('story-pr-prepare PR artifacts acceptance coverage', async () => {
  // story-pr-prepare ac:1
  // PR本文に背景が入る
  // story-pr-prepare ac:2
  // PR本文にADR判断が入る
  // story-pr-prepare ac:3
  // PR本文に検証候補が入る
  expect('PR本文に背景が入る').toContain('背景');
  expect('PR本文にADR判断が入る').toContain('ADR');
  expect('PR本文に検証候補が入る').toContain('検証');
});
`);
  await git(repo, ['add', 'tests/e2e/story-pr-prepare-pr-artifacts.spec.ts']);
  await git(repo, ['commit', '-m', 'test: add story acceptance e2e evidence']);
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
    'Story acceptance E2E coverage passed with flow_replay, artifact_replay, and scenario_clause_e2e coverage for PR artifact generation',
    '--target',
    'tests/e2e/story-pr-prepare-pr-artifacts.spec.ts',
    '--target',
    '.vibepro/pr/story-pr-prepare/pr-body.md',
    '--target',
    '.vibepro/pr/story-pr-prepare/gate-dag.json',
    '--scenario',
    'flow_replay: PR prepare regenerates the PR artifact pipeline before create',
    '--scenario',
    'artifact_replay: PR body and Gate DAG artifacts are replayed from current evidence',
    '--scenario',
    'scenario_clause_e2e: Story acceptance clauses are represented in the E2E fixture',
    '--observed',
    'flow_replay=true',
    '--observed',
    'artifact_replay=true',
    '--observed',
    'scenario_clause_e2e=true'
  ])).exitCode, 0);
  assert.equal((await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'integration',
    '--status',
    'pass',
    '--command',
    'node --test test/integration/story-pr-prepare-runtime-path.test.js',
    '--summary',
    'Integration runtime path evidence passed for PR artifact creation',
    '--target',
    'src/feature/pr-prepare.js',
    '--target',
    'test/integration/story-pr-prepare-runtime-path.test.js',
    '--scenario',
    'runtime_path_evidence: PR prepare artifact creation exercised through integration path',
    '--observed',
    'integration_runtime_path=true'
  ])).exitCode, 0);
  await recordRequiredAgentReviews(repo, 'story-pr-prepare');
  await recordAgentReviewStage(repo, 'story-pr-prepare', 'gate', ['gate_evidence', 'pr_split_scope', 'release_risk']);
  await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:split_resolution',
    '--summary',
    'The broad PR fixture intentionally keeps Story, docs, source, tests, and evidence together for end-to-end PR artifact coverage.',
    '--reason',
    'The test fixture validates the complete PR artifact pipeline and splitting it would remove the regression surface.',
    '--reviewer',
    'codex',
    '--json'
  ]);

  // critical gate 解消後、残る非critical gateだけを理由付きwaiverで通す
  let createStderr = '';
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
  ], {
    stderr: { write: (text) => { createStderr += text; } }
  });
  assert.equal(createResult.exitCode, 0, createStderr);
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
  assert.equal(prCreate.current_head_sha, createResult.result.preparation.git.head_sha);
  assert.equal(prCreate.artifact_freshness.status, 'current');
  assert.equal(prCreate.artifact_freshness.artifact_head_sha, createResult.result.preparation.git.head_sha);
  const prCreateHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-create.html'), 'utf8');
  assert.match(prCreateHtml, /data-vibepro-report="pr-create"/);
  assert.match(prCreateHtml, /VibePro PR Create/);
  assert.match(prCreateHtml, /Artifact Freshness/);
  assert.match(prCreateHtml, /Gate Override/);
  assert.match(prCreateHtml, /Critical Unresolved Gates/);
  assert.match(prCreateHtml, /Completion Quality Waiver Evidence/);
  assert.match(prCreateHtml, /VibePro Runtime/);
  assert.match(prCreateHtml, /Command Timeline/);
  const waivedPrBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(waivedPrBody, /## VibePro Gate Waiver/);
  assert.match(waivedPrBody, /UI影響のないPR本文生成テストのためE2Eは対象外/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.pr_creations['story-pr-prepare'].latest_create, '.vibepro/pr/story-pr-prepare/pr-create.json');
  assert.equal(manifest.pr_creations['story-pr-prepare'].latest_report, '.vibepro/pr/story-pr-prepare/pr-create.html');
  assert.equal(manifest.pr_preparations['story-pr-prepare'].latest_review_cockpit, '.vibepro/pr/story-pr-prepare/review-cockpit.html');
  assert.equal(manifest.pr_preparations['story-pr-prepare'].latest_human_review, '.vibepro/pr/story-pr-prepare/human-review.json');
  assert.equal(manifest.pr_preparations['story-pr-prepare'].latest_architecture_review, '.vibepro/pr/story-pr-prepare/architecture-review.json');

  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-remote-'));
  await git(remote, ['init', '--bare']);
  try {
    await git(repo, ['remote', 'set-url', 'origin', remote]);
  } catch {
    await git(repo, ['remote', 'add', 'origin', remote]);
  }
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

  const currentHeadSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(ghBin, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] !== 'pr') {
  console.error('unexpected gh args: ' + args.join(' '));
  process.exit(1);
}
if (args[1] === 'create') {
  console.error('a pull request for branch "feature/test-story" into branch "main" already exists: https://github.example.test/unson/vibepro/pull/123');
  process.exit(1);
}
if (args[1] === 'list') {
  console.log(JSON.stringify([{
    number: 123,
    url: 'https://github.example.test/unson/vibepro/pull/123',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'feature/test-story',
    headRefOid: ${JSON.stringify(currentHeadSha)},
    baseRefName: 'main',
    mergeStateStatus: 'CLEAN'
  }]));
  process.exit(0);
}
if (args[1] === 'edit') {
  if (!args.includes('--body-file')) {
    console.error('missing body file');
    process.exit(2);
  }
  console.log('https://github.example.test/unson/vibepro/pull/123');
  process.exit(0);
}
console.error('unexpected gh args: ' + args.join(' '));
process.exit(1);
`);
  await chmod(ghBin, 0o755);
  const refreshedExistingPrResult = await runCli([
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
    'fixtureでは既存PR refresh 経路だけを検証する'
  ], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });
  assert.equal(refreshedExistingPrResult.exitCode, 0);
  assert.equal(refreshedExistingPrResult.result.execution.status, 'updated_existing_pr');
  assert.equal(refreshedExistingPrResult.result.execution.pr_url, 'https://github.example.test/unson/vibepro/pull/123');
  assert.equal(refreshedExistingPrResult.result.execution.current_head_sha, currentHeadSha);
  assert.equal(refreshedExistingPrResult.result.execution.artifact_freshness.artifact_head_sha, currentHeadSha);
  assert.equal(refreshedExistingPrResult.result.execution.results.length, 4);
  assert.equal(refreshedExistingPrResult.result.execution.commands.some((command) => command.includes('gh pr list')), true);
  assert.equal(refreshedExistingPrResult.result.execution.commands.some((command) => command.includes('gh pr edit')), true);
  const refreshedPrCreate = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-create.json'));
  assert.equal(refreshedPrCreate.status, 'updated_existing_pr');
  assert.equal(refreshedPrCreate.current_head_sha, currentHeadSha);
  assert.equal(refreshedPrCreate.artifact_freshness.artifact_head_sha, currentHeadSha);
  assert.equal(refreshedPrCreate.existing_pr.url, 'https://github.example.test/unson/vibepro/pull/123');
  assert.equal(refreshedPrCreate.existing_pr.head_ref_oid, currentHeadSha);
  assert.equal(refreshedPrCreate.existing_pr.body_updated, true);
  assert.match(refreshedPrCreate.results[1].stderr, /already exists/);

  const mismatchedHeadSha = '0'.repeat(40);
  await writeFile(ghBin, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] !== 'pr') {
  console.error('unexpected gh args: ' + args.join(' '));
  process.exit(1);
}
if (args[1] === 'create') {
  console.error('a pull request for branch "feature/test-story" into branch "main" already exists: https://github.example.test/unson/vibepro/pull/123');
  process.exit(1);
}
if (args[1] === 'list') {
  console.log(JSON.stringify([{
    number: 123,
    url: 'https://github.example.test/unson/vibepro/pull/123',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'feature/test-story',
    headRefOid: ${JSON.stringify(mismatchedHeadSha)},
    baseRefName: 'main',
    mergeStateStatus: 'CLEAN'
  }]));
  process.exit(0);
}
if (args[1] === 'edit') {
  console.error('edit should not be reached on head mismatch');
  process.exit(99);
}
console.error('unexpected gh args: ' + args.join(' '));
process.exit(1);
`);
  await chmod(ghBin, 0o755);
  const mismatchedExistingPrResult = await runCli([
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
    'fixtureでは既存PR head mismatch 経路だけを検証する'
  ], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });
  assert.equal(mismatchedExistingPrResult.exitCode, 1);
  const mismatchedPrCreate = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-create.json'));
  assert.equal(mismatchedPrCreate.status, 'failed');
  assert.match(mismatchedPrCreate.error, /Existing PR head mismatch/);
  assert.equal(mismatchedPrCreate.existing_pr.head_ref_oid, mismatchedHeadSha);
  assert.equal(mismatchedPrCreate.existing_pr.body_updated, false);
  assert.equal(mismatchedPrCreate.results.length, 3);
  assert.equal(mismatchedPrCreate.commands.some((command) => command.includes('gh pr edit')), false);

  await writeFile(ghBin, `#!/usr/bin/env node
console.error('gh create failed');
process.exit(42);
`);
  await chmod(ghBin, 0o755);
  const failedCreateResult = await runCli([
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
    'fixtureではGitHub失敗経路だけを検証する'
  ], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });
  assert.equal(failedCreateResult.exitCode, 1);
  const failedPrCreate = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-create.json'));
  assert.equal(failedPrCreate.status, 'failed');
  assert.equal(failedPrCreate.results.length, 2);
  assert.equal(failedPrCreate.results[1].exit_code, 42);
  assert.match(failedPrCreate.results[1].stderr, /gh create failed/);
});

test('pr ship dry-run reruns prepare and stops with Agent Review commands instead of raw gh create', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'ship-target.js'), 'export const shipTarget = true;\n');
  await git(repo, ['add', 'src/ship-target.js']);
  await git(repo, ['commit', '-m', 'feat: add ship target']);

  let stdoutOutput = '';
  const result = await runCli([
    'pr',
    'ship',
    repo,
    '--base',
    'main',
    '--head',
    'feature/test-story',
    '--story-id',
    'story-pr-prepare',
    '--dry-run',
    '--json'
  ], {
    stdout: { write: (text) => { stdoutOutput += text; } }
  });

  assert.equal(result.exitCode, 0);
  const ship = JSON.parse(stdoutOutput);
  assert.equal(ship.status, 'blocked');
  assert.equal(ship.safe_operations.some((operation) => operation.id === 'pr_prepare' && operation.status === 'executed'), true);
  assert.equal(ship.raw_gh_pr_create_suggested, false);
  assert.equal(ship.next_commands.some((command) => /^gh pr create\b/.test(command)), false);
  assert.equal(ship.next_commands.some((command) => command.includes('vibepro pr prepare')), true);
  assert.equal(ship.next_commands.some((command) => command.includes('vibepro review prepare')), true);
  assert.equal(ship.next_commands.some((command) => command.includes('vibepro review start')), true);
  assert.equal(ship.next_commands.some((command) => command.includes('vibepro review record')), true);
  assert.equal(ship.next_commands.some((command) => command.includes('vibepro pr create')), false);
  assert.equal(ship.required_agent_review.length > 0, true);
  assert.equal(ship.required_agent_review.some((action) => action.prepare_command.includes('vibepro review prepare')), true);
  assert.equal(ship.required_agent_review.some((action) => action.start_command_template.includes('vibepro review start')), true);
  assert.equal(ship.required_agent_review.some((action) => action.record_command_template.includes('vibepro review record')), true);
  assert.equal(ship.required_agent_review.some((action) => action.record_command_template.includes('--inspection-summary')), true);
  assert.equal(ship.required_agent_review.some((action) => action.record_command_template.includes('--inspection-input')), true);
  assert.equal(ship.required_agent_review.some((action) => action.record_command_template.includes('--judgment-delta')), true);
  assert.equal(ship.required_agent_review.some((action) => action.record_command_template.includes('--agent-thread-id')), true);
  assert.equal(ship.required_agent_review.some((action) => action.record_command_template.includes('--agent-closed')), true);
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
  assert.equal(prepare.story.story_id, 'story-pr-prepare');
});

test('pr ship dry-run restores Agent Review commands from stale role gates', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'ship-stale-review.js'), 'export const version = 1;\n');
  await git(repo, ['add', 'src/ship-stale-review.js']);
  await git(repo, ['commit', '-m', 'feat: add stale review target']);

  await runCli([
    'review',
    'prepare',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence'
  ]);
  await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'current review before source change',
    '--inspection-summary',
    'reviewed current PR artifacts',
    '--inspection-evidence',
    '.vibepro/pr/story-pr-prepare/pr-prepare.json',
    '--inspection-input',
    '.vibepro/pr/story-pr-prepare/pr-prepare.json',
    '--judgment-delta',
    'current artifact review -> pass before source change',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'agent-stale-review',
    '--agent-thread-id',
    'thread-stale-review',
    '--agent-closed'
  ]);
  await writeFile(path.join(repo, 'src', 'ship-stale-review.js'), 'export const version = 2;\n');
  await git(repo, ['add', 'src/ship-stale-review.js']);
  await git(repo, ['commit', '-m', 'feat: update stale review target']);

  let stdoutOutput = '';
  const result = await runCli([
    'pr',
    'ship',
    repo,
    '--base',
    'main',
    '--head',
    'feature/test-story',
    '--story-id',
    'story-pr-prepare',
    '--dry-run',
    '--json'
  ], {
    stdout: { write: (text) => { stdoutOutput += text; } }
  });

  assert.equal(result.exitCode, 0);
  const ship = JSON.parse(stdoutOutput);
  assert.equal(ship.status, 'blocked');
  assert.equal(ship.required_agent_review.some((action) => action.stage === 'gate' && action.roles.includes('gate_evidence')), true);
  assert.equal(ship.required_agent_review.some((action) => action.record_command_template.includes('--inspection-summary')), true);
  assert.equal(ship.required_agent_review.some((action) => action.record_command_template.includes('--inspection-input')), true);
  assert.equal(ship.required_agent_review.some((action) => action.record_command_template.includes('--judgment-delta')), true);
  assert.equal(ship.required_agent_review.some((action) => action.record_command_template.includes('--agent-thread-id')), true);
  assert.equal(ship.required_agent_review.some((action) => action.record_command_template.includes('--agent-closed')), true);
  assert.equal(ship.next_commands.some((command) => command.includes('vibepro review prepare')), true);
  assert.equal(ship.next_commands.some((command) => command.includes('vibepro review start')), true);
  assert.equal(ship.next_commands.some((command) => command.includes('vibepro review record')), true);
  assert.equal(ship.raw_gh_pr_create_suggested, false);
});

test('pr prepare uses story source title and intro when explicit background heading is absent', async () => {
  const repo = await makeGitRepoWithStory();
  const storyId = 'story-oss-readiness';
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${storyId}.md`), `---
story_id: ${storyId}
title: Apache-2.0でVibeProをOSS公開できる状態にする
source:
  type: user_request
  id: oss-apache2-readiness
---

# Story

VibeProをOSSとして公開するために、Apache-2.0ライセンス、公開用package metadata、README、CI、GitHub運用テンプレート、配布物の安全確認を揃える。

Graphifyは任意の外部CLIとして扱い、VibeProの配布物には同梱しない。

## Acceptance Criteria

- Apache-2.0ライセンスで公開できる
- READMEが公開利用者向けになっている
`);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.brainbase.current_story_id = storyId;
  config.brainbase.stories.push({
    story_id: storyId,
    title: 'Story',
    ssot: 'local',
    status: 'active'
  });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(path.join(repo, 'README.md'), '# Public README\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'docs: add oss readiness story']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', storyId]);

  assert.equal(result.exitCode, 0);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', storyId, 'pr-body.md'), 'utf8');
  assert.match(prBody, /Story: story-oss-readiness - Apache-2\.0でVibeProをOSS公開できる状態にする/);
  assert.doesNotMatch(prBody, /Story: story-oss-readiness Story/);
  assert.doesNotMatch(prBody, /story-oss-readiness Story: present/);
  assert.doesNotMatch(prBody, /Story文書から抽出できませんでした/);
  assert.match(prBody, /VibeProをOSSとして公開するために/);
  const gateDag = await readJson(path.join(repo, '.vibepro', 'pr', storyId, 'gate-dag.json'));
  assert.equal(gateDag.nodes.find((node) => node.id === 'story')?.label, 'story-oss-readiness - Apache-2.0でVibeProをOSS公開できる状態にする');
  const splitPlan = await readJson(path.join(repo, '.vibepro', 'pr', storyId, 'split-plan.json'));
  assert.equal(splitPlan.lanes.find((lane) => lane.id === 'requirements-ssot')?.files.includes('README.md'), true);
  assert.equal(splitPlan.lanes.find((lane) => lane.id === 'misc-follow-up')?.files.includes('README.md') ?? false, false);
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

test('pr prepare json emits progress on stderr and records stage diagnostics', async () => {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'src.js'), 'export const changed = true;\n');
  await git(repo, ['add', 'src.js']);
  await git(repo, ['commit', '-m', 'feat: change source']);

  let stdoutOutput = '';
  let stderrOutput = '';
  const result = await runCli([
    'pr',
    'prepare',
    repo,
    '--base',
    'main',
    '--story-id',
    'story-pr-prepare',
    '--json'
  ], {
    stdout: { write: (text) => { stdoutOutput += text; } },
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 0, stderrOutput);
  assert.match(stderrOutput, /\[vibepro pr prepare\] start collect_runtime_info/);
  assert.match(stderrOutput, /\[vibepro pr prepare\] done build_pr_context/);
  const parsed = JSON.parse(stdoutOutput);
  assert.equal(parsed.story.story_id, 'story-pr-prepare');
  assert.equal(parsed.diagnostics.pr_prepare_stages.some((stage) => stage.name === 'collect_git_state' && stage.status === 'completed'), true);
  assert.equal(parsed.diagnostics.pr_prepare_stages.some((stage) => stage.name === 'write_pr_prepare_artifacts' && stage.status === 'completed'), true);
});

test('pr prepare fails clearly when a stage exceeds the configured timeout', async () => {
  const repo = await makeRepo();
  await assert.rejects(
    () => preparePullRequest(repo, {
      stageTimeoutMs: 5,
      __testStageDelayMs: {
        collect_runtime_info: 25
      }
    }),
    (error) => {
      assert.equal(error.code, 'VIBEPRO_PR_PREPARE_STAGE_TIMEOUT');
      assert.equal(error.stage, 'collect_runtime_info');
      assert.match(error.message, /timed out during stage "collect_runtime_info"/);
      assert.match(error.message, /--stage-timeout-ms/);
      return true;
    }
  );
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
  assert.equal(e2eGate.acceptance_e2e_coverage.required, false);
  assert.equal(e2eGate.acceptance_e2e_coverage.status, 'not_applicable');
  assert.deepEqual(e2eGate.acceptance_e2e_coverage.missing_acceptance_criteria, []);
  assert.equal(prepare.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:e2e'), false);
  assert.equal(prepare.pr_context.completion_quality.metrics.e2e_experience_reach_rate, null);
  assert.equal(prepare.split_plan.stacked_gate_plan.summary.requires_cumulative_e2e, false);
  assert.equal(prepare.split_plan.lanes.some((lane) => lane.id === 'e2e-gate'), false);
  const runtimeLanePlan = prepare.split_plan.stacked_gate_plan.lane_plans.find((lane) => lane.lane_id === 'runtime-behavior');
  assert.match(runtimeLanePlan.review_note, /E2E Gateが不要/);
  assert.doesNotMatch(runtimeLanePlan.review_note, /後続のe2e-gate/);
});

test('pr prepare uses node --test targeted command for node test runner', async () => {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: { test: 'node --test' }
  }, null, 2));
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await writeFile(path.join(repo, 'test', 'node-runner.test.js'), 'import test from "node:test";\ntest("ok", () => {});\n');
  await git(repo, ['add', 'package.json', 'test/node-runner.test.js']);
  await git(repo, ['commit', '-m', 'chore: add node test runner']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--json']);

  assert.equal(result.exitCode, 0);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /node --test test\/node-runner\.test\.js/);
  assert.doesNotMatch(prBody, /--runTestsByPath/);
});

test('review prepare generates stage role requests', async () => {
  const repo = await makeGitRepoWithStory();

  const result = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'test_plan', '--language', 'en', '--json']);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.result.plan.roles, ['unit_integration', 'e2e_ux', 'gate_coverage']);
  assert.equal(result.result.plan.parallel_dispatch.mode, 'policy_aware_parallel_reviews');
  assert.equal(result.result.plan.parallel_dispatch.subagent_count, 3);
  assert.equal(result.result.plan.mandatory_review_lenses.some((lens) => lens.id === 'regression_guard'), true);
  assert.equal(result.result.plan.parallel_dispatch.coordinator_behavior.expected, 'dispatch_parallel_subagents');
  assert.equal(result.result.plan.parallel_dispatch.coordinator_behavior.user_confirmation_required_by_vibepro, false);
  assert.equal(result.result.plan.parallel_dispatch.coordinator_behavior.runner_policy_may_require_user_delegation, false);
  assert.equal(result.result.plan.parallel_dispatch.coordinator_behavior.subagent_lifecycle, 'close_before_record');
  assert.equal(result.result.plan.parallel_dispatch.coordinator_behavior.closure_required_for_pass, true);
  assert.match(result.result.plan.parallel_dispatch.coordinator_behavior.fallback, /manual_review does not satisfy/);
  assert.match(result.result.plan.parallel_dispatch.record_commands.e2e_ux, /vibepro review record .*--role e2e_ux/);
  assert.match(result.result.plan.parallel_dispatch.record_commands.e2e_ux, /--agent-system <codex\|claude_code>/);
  assert.match(result.result.plan.parallel_dispatch.record_commands.e2e_ux, /--execution-mode parallel_subagent/);
  assert.match(result.result.plan.parallel_dispatch.record_commands.e2e_ux, /--agent-closed/);
  assert.doesNotMatch(result.result.plan.parallel_dispatch.record_commands.e2e_ux, /manual_review/);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'review-plan.json')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'parallel-dispatch.md')), true);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'permission-request.md')), false);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'review-request-e2e_ux.md')), true);
  const dispatch = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'parallel-dispatch.md'), 'utf8');
  assert.match(dispatch, /User dirty:/);
  assert.match(dispatch, /Raw dirty:/);
  assert.match(dispatch, /User fingerprint excludes:/);
  assert.doesNotMatch(dispatch, /^- Dirty:/m);
  assert.match(dispatch, /If your coordinator runtime supports subagents/);
  assert.doesNotMatch(dispatch, /permission-request\.md/);
  assert.match(dispatch, /manual_review as satisfying required subagent review/);
  assert.match(dispatch, /Subagent 2: test_plan:e2e_ux/);
  assert.match(dispatch, /regression_guard/);
  assert.match(dispatch, /path_surface_coverage/);
  assert.match(dispatch, /every mandatory review lens/);
  assert.match(dispatch, /vibepro review record .*--role e2e_ux/);
  assert.match(dispatch, /vibepro review start .*--role e2e_ux/);
  assert.match(dispatch, /vibepro review close .*--role e2e_ux/);
  assert.match(dispatch, /--close-reason timeout/);
  assert.match(dispatch, /Start replacement/);
  assert.match(dispatch, /Required provenance/);
  assert.match(dispatch, /--agent-system codex --execution-mode parallel_subagent/);
  assert.match(dispatch, /--agent-system claude_code --execution-mode parallel_subagent/);
  assert.match(dispatch, /close\/shutdown that subagent/i);
  assert.match(dispatch, /--agent-closed/);
  const request = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'test_plan', 'review-request-e2e_ux.md'), 'utf8');
  assert.match(request, /VibePro Agent Review Request/);
  assert.match(request, /Role: e2e_ux/);
  assert.match(request, /User dirty:/);
  assert.match(request, /Raw dirty:/);
  assert.match(request, /User fingerprint excludes:/);
  assert.doesNotMatch(request, /^- Dirty:/m);
  assert.match(request, /Mandatory Review Lenses/);
  assert.match(request, /regression_guard/);
  assert.match(request, /path_surface_coverage/);
  assert.match(request, /pre-fix/);
  assert.match(request, /silent/);
  assert.match(request, /Required Agent Review Gate pass requires `--agent-closed` evidence/);
  assert.match(request, /A `pass` must cover both the role focus and every mandatory review lens/);
  assert.match(request, /coordinator records it/);
  assert.match(request, /Codex coordinators must include/);
  assert.match(request, /Claude Code coordinators must include/);
	  assert.match(request, /review start/);
	  assert.match(request, /review close/);
	  assert.match(request, /does not return by the timeout/);

	  const subset = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--role', 'gate_evidence', '--role', 'release_risk', '--language', 'en', '--json']);
	  assert.equal(subset.exitCode, 0);
	  assert.deepEqual(subset.result.plan.roles, ['gate_evidence', 'release_risk']);
	  assert.deepEqual(subset.result.plan.review_policy.roles, ['gate_evidence', 'release_risk']);
	  assert.deepEqual(subset.result.summary.roles.map((role) => role.role), ['gate_evidence', 'release_risk']);

  const network = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'preview',
    '--role',
    'network_runtime',
    '--status',
    'pass',
    '--summary',
    'network runtime passed',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'agent-network',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(network.exitCode, 0);
  const usability = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'preview',
    '--role',
    'human_usability',
    '--status',
    'pass',
    '--summary',
    'human usability passed',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'agent-usability',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(usability.exitCode, 0);
  const replacement = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'preview', '--role', 'preview_smoke', '--language', 'en', '--json']);
  assert.equal(replacement.exitCode, 0);
  assert.deepEqual(replacement.result.plan.roles, ['preview_smoke']);
  assert.deepEqual(replacement.result.summary.roles.map((role) => role.role), ['preview_smoke']);
	});

test('review and explore human dispatch artifacts follow ja output language', async () => {
  const repo = await makeGitRepoWithStory({ language: 'ja' });

  const reviewResult = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--role', 'gate_evidence', '--json']);
  assert.equal(reviewResult.exitCode, 0);
  assert.equal(reviewResult.result.plan.output.language, 'ja');
  const reviewDispatch = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'parallel-dispatch.md'), 'utf8');
  const reviewRequest = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'review-request-gate_evidence.md'), 'utf8');
  assert.match(reviewDispatch, /## Coordinator指示/);
  assert.match(reviewDispatch, /## 証跡の扱い/);
  assert.match(reviewRequest, /## レビュー観点/);
  assert.match(reviewRequest, /## 調査ガイドライン/);
  assert.doesNotMatch(reviewDispatch, /## Coordinator Instructions/);
  assert.doesNotMatch(reviewRequest, /## Evidence Handling/);
  let reviewSummary = '';
  const reviewSummaryResult = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--role', 'gate_evidence'], {
    stdout: { write: (text) => { reviewSummary += text; } }
  });
  assert.equal(reviewSummaryResult.exitCode, 0);
  assert.match(reviewSummary, /# Agent Review準備/);
  assert.doesNotMatch(reviewSummary, /# Agent Review Prepare/);

  const exploreResult = await runCli([
    'explore',
    'prepare',
    repo,
    '--id',
    'story-pr-prepare',
    '--topic',
    '対象範囲を確認する',
    '--role',
    'codebase_context',
    '--json'
  ]);
  assert.equal(exploreResult.exitCode, 0);
  assert.equal(exploreResult.result.plan.output.language, 'ja');
  const exploreDispatch = await readFile(path.join(repo, '.vibepro', 'explore', 'story-pr-prepare', 'parallel-dispatch.md'), 'utf8');
  const exploreRequest = await readFile(path.join(repo, '.vibepro', 'explore', 'story-pr-prepare', 'requests', 'codebase_context.md'), 'utf8');
  assert.match(exploreDispatch, /read-only exploration requestをparallelでdispatchする/);
  assert.match(exploreRequest, /## ルール/);
  assert.match(exploreRequest, /## 出力/);
  assert.doesNotMatch(exploreDispatch, /Dispatch these read-only exploration requests/);
  assert.doesNotMatch(exploreRequest, /## Rules/);
});

test('review lifecycle tracks timed out subagents and replacement closure', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate']);

  const start = await runCli([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-stuck',
    '--timeout-ms',
    '1',
    '--json'
  ]);
  assert.equal(start.exitCode, 0);
  assert.equal(start.result.lifecycle.status, 'running');
  assert.equal(start.result.lifecycle.timeout_ms, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));

  const timedOut = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--json']);
  assert.equal(timedOut.exitCode, 0);
  const gateStage = timedOut.result.stages[0];
  assert.equal(gateStage.lifecycle.timed_out_count, 1);
  assert.equal(gateStage.roles.find((role) => role.role === 'gate_evidence').lifecycle.effective_status, 'timed_out');
  assert.equal(gateStage.next_actions.some((action) => action.includes('review close') && action.includes('agent-stuck')), true);
  assert.equal(gateStage.next_actions.some((action) => action.includes('review start') && action.includes('--replacement-for')), true);

  const close = await runCli([
    'review',
    'close',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-id',
    'agent-stuck',
    '--close-reason',
    'timeout',
    '--close-evidence',
    'shutdown',
    '--json'
  ]);
  assert.equal(close.exitCode, 0);
  assert.equal(close.result.lifecycle.effective_status, 'closed');
  assert.equal(close.result.lifecycle.close_reason, 'timeout');

  const replacement = await runCli([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-replacement',
    '--replacement-for',
    start.result.lifecycle.lifecycle_id,
    '--json'
  ]);
  assert.equal(replacement.exitCode, 0);
  assert.equal(replacement.result.lifecycle.replacement_for, start.result.lifecycle.lifecycle_id);

  const record = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'replacement passed',
    '--inspection-summary',
    'read lifecycle replacement evidence and verified shutdown record',
    '--inspection-input',
    '.vibepro/reviews/story-pr-prepare/gate/lifecycle.json',
    '--judgment-delta',
    'timed-out lifecycle -> pass after replacement closure evidence',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'agent-replacement',
    '--agent-thread-id',
    'thread-agent-replacement',
    '--agent-closed',
    '--agent-close-evidence',
    'shutdown',
    '--json'
  ]);
  assert.equal(record.exitCode, 0);
  const lifecycle = await readJson(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'lifecycle.json'));
  const replacementEntry = lifecycle.entries.find((entry) => entry.agent_id === 'agent-replacement');
  assert.equal(replacementEntry.status, 'closed');
  assert.equal(replacementEntry.close_reason, 'completed');

  await runCli([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-manual-stop'
  ]);
  const manualClose = await runCli([
    'review',
    'close',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-id',
    'agent-manual-stop',
    '--close-reason',
    'manual_shutdown',
    '--json'
  ]);
  assert.equal(manualClose.exitCode, 0);
  assert.equal(manualClose.result.lifecycle.close_reason, 'manual_shutdown');
  const manualStatus = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--json']);
  assert.equal(manualStatus.result.stages[0].next_actions.some((action) => action.includes('manually shut down') && action.includes('--replacement-for')), true);
});

test('review status and summary tell operators to close running subagents before recording', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--role', 'gate_evidence']);

  const start = await runCli([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-running',
    '--timeout-ms',
    '600000',
    '--json'
  ]);
  assert.equal(start.exitCode, 0);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.stages[0].lifecycle.running_count, 1);
  assert.equal(status.result.stages[0].next_actions.some((action) => action.includes('Wait for running gate:gate_evidence subagent agent-running')), true);
  assert.equal(status.result.stages[0].next_actions.some((action) => action.includes('review close') && action.includes('agent-running')), true);
  assert.equal(status.result.blocking_summary.next_commands.some((command) => command.includes('vibepro review close') && command.includes('agent-running')), true);
  assert.equal(status.result.blocking_summary.next_commands.some((command) => command.includes('vibepro review record')), false);

  const statusText = await runCliWithStdout(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'gate']);
  assert.equal(statusText.exitCode, 0);
  assert.match(statusText.stdout, /## Next Commands/);
  assert.match(statusText.stdout, /vibepro review close .*agent-running/);
  assert.doesNotMatch(statusText.stdout, /## Next Commands\n\n- vibepro review record/);

  const reviewSummary = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'review-summary.md'), 'utf8');
  assert.match(reviewSummary, /Wait for running gate:gate_evidence subagent agent-running/);
  assert.match(reviewSummary, /vibepro review close/);
});

test('review lifecycle preserves concurrent stage starts', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--role', 'gate_evidence', '--role', 'release_risk']);

  const previousDelay = process.env.VIBEPRO_TEST_LIFECYCLE_SUMMARY_DELAY_MS;
  process.env.VIBEPRO_TEST_LIFECYCLE_SUMMARY_DELAY_MS = '50';
  let evidence;
  let release;
  try {
    [evidence, release] = await Promise.all([
      runCli([
        'review',
        'start',
        repo,
        '--id',
        'story-pr-prepare',
        '--stage',
        'gate',
        '--role',
        'gate_evidence',
        '--agent-system',
        'codex',
        '--agent-id',
        'agent-evidence',
        '--json'
      ]),
      runCli([
        'review',
        'start',
        repo,
        '--id',
        'story-pr-prepare',
        '--stage',
        'gate',
        '--role',
        'release_risk',
        '--agent-system',
        'codex',
        '--agent-id',
        'agent-release',
        '--json'
      ])
    ]);
  } finally {
    if (previousDelay === undefined) {
      delete process.env.VIBEPRO_TEST_LIFECYCLE_SUMMARY_DELAY_MS;
    } else {
      process.env.VIBEPRO_TEST_LIFECYCLE_SUMMARY_DELAY_MS = previousDelay;
    }
  }

  assert.equal(evidence.exitCode, 0);
  assert.equal(release.exitCode, 0);
  const lifecycle = await readJson(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'lifecycle.json'));
  assert.equal(lifecycle.entries.some((entry) => entry.agent_id === 'agent-evidence'), true);
  assert.equal(lifecycle.entries.some((entry) => entry.agent_id === 'agent-release'), true);
  const summary = await readJson(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'review-summary.json'));
  assert.equal(summary.roles.find((role) => role.role === 'gate_evidence').lifecycle.effective_status, 'running');
  assert.equal(summary.roles.find((role) => role.role === 'release_risk').lifecycle.effective_status, 'running');
  assert.equal(summary.next_actions.some((action) => action.includes('agent-evidence')), true);
  assert.equal(summary.next_actions.some((action) => action.includes('agent-release')), true);
  const summaryMarkdown = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'review-summary.md'), 'utf8');
  assert.match(summaryMarkdown, /agent-evidence/);
  assert.match(summaryMarkdown, /agent-release/);
});

test('review status orders running close commands before stale record commands', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'test_plan', '--role', 'e2e_ux', '--role', 'gate_coverage']);
  await recordAgentReviewStage(repo, 'story-pr-prepare', 'test_plan', ['e2e_ux', 'gate_coverage']);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'mixed-review-order.js'), 'export const changed = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: stale one role while another runs']);
  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'test_plan', '--role', 'e2e_ux', '--role', 'gate_coverage']);
  await runCli([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'test_plan',
    '--role',
    'gate_coverage',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-running-mixed',
    '--json'
  ]);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'test_plan', '--json']);
  assert.equal(status.exitCode, 0);
  const closeIndex = status.result.blocking_summary.next_commands.findIndex((command) => command.includes('vibepro review close') && command.includes('agent-running-mixed'));
  const recordIndex = status.result.blocking_summary.next_commands.findIndex((command) => command.includes('vibepro review record'));
  assert.equal(closeIndex >= 0, true);
  assert.equal(recordIndex >= 0, true);
  assert.equal(closeIndex < recordIndex, true);

  const statusText = await runCliWithStdout(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'test_plan']);
  assert.equal(statusText.stdout.indexOf('vibepro review close') < statusText.stdout.indexOf('vibepro review record'), true);
});

test('review policy config customizes stage roles and role timeout', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    stages: {
      gate: {
        roles: ['gate_evidence', 'custom_security']
      }
    },
    roles: {
      custom_security: {
        timeout_ms: 12345
      }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const prepared = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--json']);
  assert.equal(prepared.exitCode, 0);
  assert.deepEqual(prepared.result.plan.roles, ['gate_evidence', 'custom_security']);
  assert.equal(prepared.result.plan.parallel_dispatch.subagent_count, 2);
  const request = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'review-request-custom_security.md'), 'utf8');
  assert.match(request, /--role custom_security/);
  assert.match(request, /--timeout-ms 12345/);

  const record = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'custom_security',
    '--status',
    'pass',
    '--summary',
    'custom security passed',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'agent-custom-security',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(record.exitCode, 0);
  assert.equal(record.result.review.role, 'custom_security');
});

test('review policy config publishes role model policy and records actual model provenance', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    defaults: {
      model_policy: {
        model: 'gpt-5.5',
        reasoning_effort: 'medium',
        cost_tier: 'medium'
      }
    },
    roles: {
      gate_evidence: {
        model_policy: {
          reasoning_effort: 'high',
          cost_tier: 'high'
        }
      }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const prepared = await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--json']);

  assert.equal(prepared.exitCode, 0);
  assert.deepEqual(prepared.result.plan.review_policy.defaults.model_policy, {
    model: 'gpt-5.5',
    reasoning_effort: 'medium',
    cost_tier: 'medium'
  });
  assert.deepEqual(prepared.result.plan.review_policy.role_policies.gate_evidence.model_policy, {
    model: 'gpt-5.5',
    reasoning_effort: 'high',
    cost_tier: 'high'
  });
  assert.deepEqual(prepared.result.plan.requests.find((request) => request.role === 'gate_evidence').model_policy, {
    model: 'gpt-5.5',
    reasoning_effort: 'high',
    cost_tier: 'high'
  });
  const dispatch = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'parallel-dispatch.md'), 'utf8');
  assert.match(dispatch, /Model policy:/);
  assert.match(dispatch, /model: gpt-5\.5/);
  assert.match(dispatch, /reasoning_effort: high/);
  assert.match(dispatch, /cost_tier: high/);
  assert.match(dispatch, /--agent-reasoning-effort "<reasoning-effort>"/);
  const request = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'review-request-gate_evidence.md'), 'utf8');
  assert.match(request, /## Model Policy/);
  assert.match(request, /reasoning_effort: high/);

  const started = await runCli([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-gate-evidence',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'high',
    '--agent-cost-tier',
    'high',
    '--json'
  ]);
  assert.equal(started.exitCode, 0);
  assert.equal(started.result.lifecycle.agent_model, 'gpt-5.5');
  assert.equal(started.result.lifecycle.agent_reasoning_effort, 'high');
  assert.equal(started.result.lifecycle.agent_cost_tier, 'high');

  const record = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence passed',
    '--inspection-summary',
    'read generated request and model policy guidance',
    '--inspection-input',
    '.vibepro/reviews/story-pr-prepare/gate/review-request-gate_evidence.md',
    '--judgment-delta',
    'model policy concern -> pass because actual provenance matches configured policy',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'agent-gate-evidence',
    '--agent-thread-id',
    'thread-agent-gate-evidence',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'high',
    '--agent-cost-tier',
    'high',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(record.exitCode, 0);
  assert.equal(record.result.review.agent_provenance.model, 'gpt-5.5');
  assert.equal(record.result.review.agent_provenance.reasoning_effort, 'high');
  assert.equal(record.result.review.agent_provenance.cost_tier, 'high');
});

test('SRA-CON-1 review record captures finding disposition and agent usage for subagent ROI audit', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--role', 'runtime_contract']);

  const record = await runCli([
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
    'needs_changes',
    '--summary',
    'runtime contract gap needs a follow-up commit',
    '--finding',
    'high:runtime-contract-gap:subagent found a runtime contract gap',
    '--finding-disposition',
    'runtime-contract-gap:accepted:confirmed by focused inspection',
    '--resolved-finding',
    'runtime-contract-gap:commit abc1234',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-runtime-roi',
    '--agent-thread-id',
    'thread-codex-runtime-roi',
    '--agent-input-tokens',
    '1200',
    '--agent-output-tokens',
    '345',
    '--agent-cost-usd',
    '0.123456',
    '--agent-closed',
    '--json'
  ]);

  assert.equal(record.exitCode, 0);
  assert.deepEqual(record.result.review.finding_dispositions, [{
    finding_id: 'runtime-contract-gap',
    disposition: 'accepted',
    resolved_by: ['commit abc1234'],
    reason: 'confirmed by focused inspection',
    inferred_from_resolution: false
  }]);
  assert.deepEqual(record.result.review.agent_usage, {
    input_tokens: 1200,
    output_tokens: 345,
    total_tokens: 1545,
    cost_usd: 0.123456
  });

  const summary = await readJson(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'implementation', 'review-summary.json'));
  const role = summary.roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.findings[0].id, 'runtime-contract-gap');
  assert.equal(role.finding_dispositions[0].disposition, 'accepted');
  assert.equal(role.agent_usage.total_tokens, 1545);
});

test('subagent ROI report classifies decision signal, waste signal, and missing usage evidence', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli([
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
    'needs_changes',
    '--summary',
    'runtime contract gap needs a follow-up commit',
    '--finding',
    'high:runtime-contract-gap:subagent found a runtime contract gap',
    '--finding-disposition',
    'runtime-contract-gap:accepted:confirmed by focused inspection',
    '--resolved-finding',
    'runtime-contract-gap:commit abc1234',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-runtime-roi',
    '--agent-thread-id',
    'thread-codex-runtime-roi',
    '--agent-input-tokens',
    '1200',
    '--agent-output-tokens',
    '345',
    '--agent-cost-usd',
    '0.123456',
    '--agent-closed',
    '--json'
  ]);
  await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'code_spec_alignment',
    '--status',
    'pass',
    '--summary',
    'pass-only confirmation',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-code-spec-smoke',
    '--agent-thread-id',
    'thread-codex-code-spec-smoke',
    '--agent-closed',
    '--json'
  ]);

  const report = await runCliWithStdout(['usage', 'report', repo, '--subagent-roi', '--json']);
  assert.equal(report.exitCode, 0);
  const parsed = JSON.parse(report.stdout);
  const valuable = parsed.subagent_roi.by_review.find((review) => review.role === 'runtime_contract');
  assert.equal(valuable.value_band, 'high');
  assert.equal(valuable.value_signals.includes('accepted_finding'), true);
  assert.equal(valuable.value_signals.includes('resolved_finding'), true);
  assert.equal(valuable.value_signals.includes('high_value_candidate'), true);
  const waste = parsed.subagent_roi.by_review.find((review) => review.role === 'code_spec_alignment');
  assert.equal(waste.waste_signals.includes('pass_only_no_decision_signal'), true);
  assert.equal(waste.waste_signals.includes('token_missing'), true);
  assert.equal(parsed.subagent_roi.summary.token_missing_review_count, 1);
  assert.deepEqual(parsed.subagent_roi.by_story[0].role_recommendations.continue, ['runtime_contract']);
  assert.deepEqual(parsed.subagent_roi.by_story[0].role_recommendations.reduce, ['code_spec_alignment']);
  assert.deepEqual(parsed.subagent_roi.by_story[0].role_recommendations.needs_evidence, ['code_spec_alignment']);
});

test('review start rejects model policy mismatch before lifecycle start unless override is justified', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    defaults: {
      model_policy: {
        model: 'gpt-5.5',
        reasoning_effort: 'low',
        cost_tier: 'low'
      }
    },
    roles: {
      release_risk: {
        model_policy: {
          reasoning_effort: 'medium',
          cost_tier: 'medium'
        }
      }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const rejected = await runCliWithStdout([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-high-cost',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'high',
    '--agent-cost-tier',
    'high',
    '--json'
  ]);

  assert.notEqual(rejected.exitCode, 0);
  assert.match(rejected.stderr, /model policy preflight failed/);
  assert.doesNotMatch(rejected.stderr, /gpt-5\.4/);
  assert.match(rejected.stderr, /agent_reasoning_effort expected low but got high/);
  assert.match(rejected.stderr, /agent_cost_tier expected low but got high/);

  const lifecyclePath = path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate', 'lifecycle.json');
  assert.equal(await pathExists(lifecyclePath), false, 'rejected preflight must not create a running lifecycle');

  const overrideWithoutReason = await runCliWithStdout([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-high-cost',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'high',
    '--agent-cost-tier',
    'high',
    '--allow-model-policy-override',
    '--json'
  ]);

  assert.notEqual(overrideWithoutReason.exitCode, 0);
  assert.match(overrideWithoutReason.stderr, /model policy override requires --model-policy-override-reason <text>/);
  assert.equal(await pathExists(lifecyclePath), false, 'reasonless override must not create a running lifecycle');

  const overridden = await runCli([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-high-cost',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'high',
    '--agent-cost-tier',
    'high',
    '--allow-model-policy-override',
    '--model-policy-override-reason',
    'release manager requested high-confidence rerun',
    '--json'
  ]);

  assert.equal(overridden.exitCode, 0);
  assert.equal(overridden.result.lifecycle.model_policy_preflight.status, 'overridden');
  assert.equal(overridden.result.lifecycle.model_policy_preflight.override_reason, 'release manager requested high-confidence rerun');
  assert.equal(overridden.result.lifecycle.model_policy_preflight.mismatches.length, 2);
});

test('agent review PR policy honors role mode and changed-file activation', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    roles: {
      gate_evidence: {
        when_changed: ['src/**']
      },
      pr_split_scope: {
        mode: 'optional'
      },
      release_risk: {
        mode: 'disabled'
      }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'cli-helper.js'), 'export const helper = true;\n');

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const required = result.result.preparation.pr_context.agent_reviews.required_reviews;
  assert.deepEqual(required.map((item) => `${item.stage}:${item.role}`), ['gate:gate_evidence']);
});

test('review status focuses required current blockers and moves optional history behind flags', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    roles: {
      gate_evidence: {
        when_changed: ['src/**']
      },
      pr_split_scope: {
        mode: 'optional'
      },
      release_risk: {
        mode: 'optional'
      }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'review-status-target.js'), 'export const reviewStatusTarget = true;\n');

  const prepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(prepare.exitCode, 0);
  assert.deepEqual(
    prepare.result.preparation.pr_context.agent_reviews.required_reviews.map((item) => `${item.stage}:${item.role}`),
    ['gate:gate_evidence']
  );

  await runCli([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'pr_split_scope',
    '--agent-system',
    'codex',
    '--agent-id',
    'optional-scope-agent',
    '--json'
  ]);
  await runCli([
    'review',
    'close',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'pr_split_scope',
    '--agent-id',
    'optional-scope-agent',
    '--close-reason',
    'completed',
    '--close-evidence',
    'optional review closed',
    '--json'
  ]);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--json']);
  assert.equal(status.exitCode, 0);
  assert.deepEqual(status.result.required_current.map((item) => `${item.stage}:${item.role}`), ['gate:gate_evidence']);
  assert.deepEqual(status.result.blocking_summary.items.map((item) => `${item.stage}:${item.role}`), ['gate:gate_evidence']);
  assert.equal(status.result.blocking_summary.next_commands.length > 0, true);
  assert.equal(status.result.blocking_summary.next_commands.length <= 3, true);
  assert.equal(status.result.blocking_summary.next_commands.some((command) => command.includes('vibepro review prepare')), true);
  assert.equal(status.result.blocking_summary.next_commands.some((command) => command.includes('vibepro review record')), true);
  assert.equal(status.result.blocking_summary.next_commands.some((command) => command.includes('vibepro pr prepare')), true);
  assert.equal(status.result.optional.some((item) => item.role === 'pr_split_scope'), true);
  assert.equal(status.result.history.some((item) => item.kind === 'lifecycle' && item.agent_id === 'optional-scope-agent' && item.blocking === false), true);

  let defaultOutput = '';
  const textStatus = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare'], {
    stdout: { write: (text) => { defaultOutput += text; } }
  });
  assert.equal(textStatus.exitCode, 0);
  assert.ok(defaultOutput.indexOf('## Next Commands') < defaultOutput.indexOf('## Blocking Required Reviews'));
  assert.match(defaultOutput, /gate:gate_evidence/);
  assert.doesNotMatch(defaultOutput, /pr_split_scope/);
  assert.match(defaultOutput, /hidden \(use --all\)/);
  assert.match(defaultOutput, /hidden \(use --history or --all\)/);

  let historyOutput = '';
  const allStatus = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--all', '--history'], {
    stdout: { write: (text) => { historyOutput += text; } }
  });
  assert.equal(allStatus.exitCode, 0);
  assert.match(historyOutput, /pr_split_scope/);
  assert.match(historyOutput, /optional-scope-agent/);
});

test('review status ignores stale pr prepare required reviews from an older HEAD', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    roles: {
      gate_evidence: {
        when_changed: ['src/**']
      },
      release_risk: {
        mode: 'optional'
      }
    }
  };
  await writeJson(configPath, config);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'review-status-stale.js'), 'export const firstHead = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add initial review target']);

  const prepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(prepare.exitCode, 0);
  assert.deepEqual(
    prepare.result.preparation.pr_context.agent_reviews.required_reviews.map((item) => `${item.stage}:${item.role}`),
    ['gate:gate_evidence']
  );

  const currentConfig = await readJson(configPath);
  currentConfig.agent_reviews.roles = {
    gate_evidence: {
      mode: 'optional'
    },
    release_risk: {
      when_changed: ['src/**']
    }
  };
  await writeJson(configPath, currentConfig);
  await writeFile(path.join(repo, 'src', 'review-status-stale.js'), 'export const secondHead = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: update review policy']);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.pr_prepare_freshness.status, 'stale');
  assert.notEqual(status.result.pr_prepare_freshness.artifact_head_sha, status.result.pr_prepare_freshness.current_head_sha);
  const requiredKeys = status.result.required_current.map((item) => `${item.stage}:${item.role}`);
  const blockingKeys = status.result.blocking_summary.items.map((item) => `${item.stage}:${item.role}`);
  assert.equal(requiredKeys.includes('gate:release_risk'), true);
  assert.equal(blockingKeys.includes('gate:release_risk'), true);
  assert.equal(requiredKeys.includes('gate:gate_evidence'), false);
  assert.equal(blockingKeys.includes('gate:gate_evidence'), false);
  assert.equal(status.result.blocking_summary.next_commands.some((command) => command.includes('vibepro pr prepare')), true);
});

test('review status marks pr prepare stale when newer review dispatch artifacts exist', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'review-artifact-drift.js'), 'export const value = 1;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add review artifact drift target']);

  const prepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(prepare.exitCode, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));

  const reviewPrepare = await runCli([
    'review',
    'prepare',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence'
  ]);
  assert.equal(reviewPrepare.exitCode, 0);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.pr_prepare_freshness.status, 'stale');
  assert.equal(status.result.pr_prepare_freshness.newest_review_artifact.stage, 'gate');
  assert.match(status.result.pr_prepare_freshness.reason, /predates newer review artifact/);
  assert.equal(status.result.blocking_summary.next_commands.some((command) => command.includes('vibepro pr prepare')), true);
});

test('review status keeps pr prepare current when dispatch artifact predates pr prepare', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'review-artifact-current.js'), 'export const value = 1;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add current review artifact target']);

  const reviewPrepare = await runCli([
    'review',
    'prepare',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence'
  ]);
  assert.equal(reviewPrepare.exitCode, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));

  const prepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(prepare.exitCode, 0);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.pr_prepare_freshness.status, 'current');
  assert.equal(status.result.pr_prepare_freshness.newest_review_artifact, null);
  assert.match(status.result.pr_prepare_freshness.reason, /matches the current git HEAD/);
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
    '--agent-closed',
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

test('review status reuses review after merge delta outside inspected inputs', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'merge-delta-target.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/merge-delta-target.js']);
  await git(repo, ['commit', '-m', 'feat: add reviewed merge delta target']);

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
    'runtime contract reviewed before base sync',
    '--inspection-summary',
    'inspected runtime source before base sync',
    '--inspection-input',
    'src/merge-delta-target.js',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-merge-delta-agent',
    '--agent-thread-id',
    'thread-merge-delta-agent',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'low',
    '--agent-cost-tier',
    'medium',
    '--judgment-delta',
    'recorded head review -> reused only if merge delta leaves inspected source untouched',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0, JSON.stringify(recordResult));
  const recordedHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();

  await writeFile(path.join(repo, 'docs', 'base-sync-note.md'), 'unrelated base sync note\n');
  await git(repo, ['add', 'docs/base-sync-note.md']);
  await git(repo, ['commit', '-m', 'chore: sync unrelated base docs']);
  const currentHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'pass');
  assert.equal(role.stale, false);
  assert.equal(role.binding_status, 'reused_merge_delta');
  assert.equal(role.merge_delta_reuse.recorded_head_sha, recordedHead);
  assert.equal(role.merge_delta_reuse.current_head_sha, currentHead);
  assert.deepEqual(role.merge_delta_reuse.impacted_files, []);
  assert.match(role.stale_reason, /reused/);
});

test('review status keeps stale review after merge delta touches inspected inputs', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'merge-delta-touch-target.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/merge-delta-touch-target.js']);
  await git(repo, ['commit', '-m', 'feat: add reviewed touch target']);

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
    'runtime contract reviewed before touched merge delta',
    '--inspection-summary',
    'inspected runtime source before merge delta',
    '--inspection-input',
    'src/merge-delta-touch-target.js',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-merge-delta-touch-agent',
    '--agent-thread-id',
    'thread-merge-delta-touch-agent',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'low',
    '--agent-cost-tier',
    'medium',
    '--judgment-delta',
    'recorded head review -> stale if merge delta touches inspected source',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0, JSON.stringify(recordResult));

  await writeFile(path.join(repo, 'src', 'merge-delta-touch-target.js'), 'export const value = 2;\n');
  await git(repo, ['add', 'src/merge-delta-touch-target.js']);
  await git(repo, ['commit', '-m', 'chore: sync touched reviewed source']);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'stale');
  assert.equal(role.binding_status, 'stale');
  assert.match(role.stale_reason, /merge delta touched reviewed file/);
  assert.deepEqual(role.merge_delta_reuse.impacted_files, ['src/merge-delta-touch-target.js']);
});

test('review status does not reuse merge delta review without inspected file inputs', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'merge-delta-no-input.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/merge-delta-no-input.js']);
  await git(repo, ['commit', '-m', 'feat: add no-input review target']);

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
    'runtime contract reviewed without file inputs',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-merge-delta-no-input-agent',
    '--agent-thread-id',
    'thread-merge-delta-no-input-agent',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'low',
    '--agent-cost-tier',
    'medium',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0, JSON.stringify(recordResult));

  await writeFile(path.join(repo, 'docs', 'base-sync-no-input.md'), 'unrelated base sync note\n');
  await git(repo, ['add', 'docs/base-sync-no-input.md']);
  await git(repo, ['commit', '-m', 'chore: sync unrelated docs after no-input review']);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'stale');
  assert.equal(role.binding_status, 'stale');
  assert.match(role.stale_reason, /no inspected file surface/);
});

test('review status keeps stale review when merge delta diff cannot be resolved', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'merge-delta-missing-head.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/merge-delta-missing-head.js']);
  await git(repo, ['commit', '-m', 'feat: add missing head target']);

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
    'runtime contract reviewed before missing-head merge delta',
    '--inspection-summary',
    'inspected runtime source before merge delta',
    '--inspection-input',
    'src/merge-delta-missing-head.js',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-merge-delta-missing-head-agent',
    '--agent-thread-id',
    'thread-merge-delta-missing-head-agent',
    '--agent-model',
    'gpt-5.5',
    '--agent-reasoning-effort',
    'low',
    '--agent-cost-tier',
    'medium',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0, JSON.stringify(recordResult));

  const reviewPath = path.join(
    repo,
    '.vibepro',
    'reviews',
    'story-pr-prepare',
    'implementation',
    'review-result-runtime_contract.json'
  );
  const reviewResult = await readJson(reviewPath);
  const missingHead = 'f'.repeat(40);
  reviewResult.git_context.head_sha = missingHead;
  await writeJson(reviewPath, reviewResult);

  await writeFile(path.join(repo, 'docs', 'base-sync-missing-head.md'), 'unrelated base sync note\n');
  await git(repo, ['add', 'docs/base-sync-missing-head.md']);
  await git(repo, ['commit', '-m', 'chore: sync docs after missing head']);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'stale');
  assert.equal(role.binding_status, 'stale');
  assert.match(role.stale_reason, /could not be resolved/);
  assert.equal(role.merge_delta_reuse.recorded_head_sha, missingHead);
  assert.equal(role.merge_delta_reuse.diff_status, 'unresolved');
  assert.equal(role.merge_delta_reuse.merge_delta_changed_files, null);
});

test('agent review PR section shows merge delta binding reasons', () => {
  const section = renderAgentReviewPrSection({
    status: 'passed',
    summary: {
      required_review_count: 1,
      unmet_required_review_count: 0,
      checkpoint_required_review_count: 0,
      unmet_checkpoint_review_count: 0
    },
    stages: [
      {
        stage: 'implementation',
        status: 'passed',
        stale_count: 0,
        block_count: 0,
        roles: [
          {
            role: 'runtime_contract',
            effective_status: 'pass',
            binding_status: 'reused_merge_delta',
            stale_reason: 'review was reused because merge delta changed files outside inspected review inputs',
            merge_delta_reuse: {
              recorded_head_sha: 'a'.repeat(40),
              current_head_sha: 'b'.repeat(40),
              merge_delta_changed_files: ['docs/base-sync.md'],
              impacted_files: []
            }
          }
        ]
      }
    ]
  });

  assert.match(section, /### Review Binding/);
  assert.match(section, /implementation:runtime_contract binding=reused_merge_delta/);
  assert.match(section, /changed=1/);
  assert.match(section, /impacted=0/);
  assert.match(section, /reason=review was reused/);
});

test('review status keeps current review when only tracked VibePro manifest changes', async () => {
  const repo = await makeGitRepoWithStory();
  await git(repo, ['add', '-f', '.vibepro/vibepro-manifest.json']);
  await git(repo, ['commit', '-m', 'test: track vibepro manifest fixture']);

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
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);

  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_internal_update_for_test = new Date().toISOString();
  await writeJson(manifestPath, manifest);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'pass');
  assert.equal(role.stale, false);
});

test('review status keeps legacy full-fingerprint review stale when tracked VibePro manifest changes', async () => {
  const repo = await makeGitRepoWithStory();
  await git(repo, ['add', '-f', '.vibepro/vibepro-manifest.json']);
  await git(repo, ['commit', '-m', 'test: track legacy vibepro manifest fixture']);

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
    'legacy runtime contract reviewed',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-legacy-runtime-contract-agent',
    '--agent-thread-id',
    'thread-legacy-runtime-contract',
    '--agent-model',
    'gpt-5.5',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);

  const resultPath = path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'implementation', 'review-result-runtime_contract.json');
  const review = await readJson(resultPath);
  delete review.git_context.user_status_fingerprint_hash;
  delete review.git_context.fingerprint_scope;
  await writeJson(resultPath, review);

  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_internal_update_for_test = new Date().toISOString();
  await writeJson(manifestPath, manifest);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'stale');
  assert.match(role.stale_reason, /dirty worktree fingerprint/);
});

test('review status keeps unchanged legacy source fingerprint current with tracked VibePro manifest dirt', async () => {
  const repo = await makeGitRepoWithStory();
  await git(repo, ['add', '-f', '.vibepro/vibepro-manifest.json']);
  await git(repo, ['commit', '-m', 'test: track source fingerprint manifest fixture']);

  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_internal_update_for_test = 'legacy-source-fingerprint';
  await writeJson(manifestPath, manifest);

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
    'legacy runtime contract reviewed with internal dirt',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-legacy-source-fingerprint-agent',
    '--agent-thread-id',
    'thread-legacy-source-fingerprint',
    '--agent-model',
    'gpt-5.5',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);

  const resultPath = path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'implementation', 'review-result-runtime_contract.json');
  const review = await readJson(resultPath);
  delete review.git_context.user_status_fingerprint_hash;
  delete review.git_context.fingerprint_scope;
  review.source_fingerprint = createHash('sha256').update(JSON.stringify({
    story_id: review.story_id,
    stage: review.stage,
    role: review.role,
    head_sha: review.git_context.head_sha,
    status_fingerprint_hash: review.git_context.status_fingerprint_hash
  })).digest('hex');
  await writeJson(resultPath, review);

  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  assert.equal(status.exitCode, 0);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.effective_status, 'pass');
  assert.equal(role.stale, false);
});

test('review record keeps append-only history for replaced review findings', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'agent-review-history.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src/agent-review-history.js']);
  await git(repo, ['commit', '-m', 'feat: add agent review history target']);

  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'architecture_spec', '--role', 'regression_risk']);
  const needsChanges = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'architecture_spec',
    '--role',
    'regression_risk',
    '--status',
    'needs_changes',
    '--summary',
    'execute readiness omits lifecycle gate history',
    '--finding',
    'medium:history-gap:previous needs_changes result must remain reconstructable',
    '--inspection-summary',
    'inspected review artifact overwrite behavior',
    '--inspection-evidence',
    '.vibepro/pr/story-pr-prepare/gate-dag.json',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-history-reviewer-1',
    '--agent-thread-id',
    'thread-codex-history-reviewer-1',
    '--agent-closed'
  ]);
  assert.equal(needsChanges.exitCode, 0);
  assert.match(needsChanges.result.history_artifact, /history\/review-result-regression_risk-/);

  const pass = await runCliWithStdout([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'architecture_spec',
    '--role',
    'regression_risk',
    '--status',
    'pass',
    '--summary',
    'history artifact retained previous needs_changes finding',
    '--inspection-summary',
    'inspected append-only review history',
    '--inspection-evidence',
    '.vibepro/reviews/story-pr-prepare/architecture_spec/history',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-history-reviewer-2',
    '--agent-thread-id',
    'thread-codex-history-reviewer-2',
    '--agent-closed'
  ]);
  assert.equal(pass.exitCode, 0);
  assert.match(pass.result.history_artifact, /history\/review-result-regression_risk-/);
  assert.match(pass.stdout, /history artifact: \.vibepro\/reviews\/story-pr-prepare\/architecture_spec\/history\/review-result-regression_risk-/);

  const latest = await readJson(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'architecture_spec', 'review-result-regression_risk.json'));
  assert.equal(latest.status, 'pass');
  const status = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'architecture_spec', '--json']);
  const role = status.result.stages[0].roles.find((item) => item.role === 'regression_risk');
  assert.equal(role.effective_status, 'pass');
  assert.equal(role.history_artifacts.length, 2);
  const historyResults = await Promise.all(role.history_artifacts.map((artifact) => readJson(path.join(repo, artifact))));
  assert.equal(historyResults.some((result) => result.status === 'needs_changes' && result.findings[0]?.id === 'history-gap'), true);
  assert.equal(historyResults.some((result) => result.status === 'pass'), true);

  const statusText = await runCliWithStdout(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'architecture_spec', '--history']);
  assert.equal(statusText.exitCode, 0);
  assert.match(statusText.stdout, /artifact: \.vibepro\/reviews\/story-pr-prepare\/architecture_spec\/review-result-regression_risk\.json/);
  assert.match(statusText.stdout, /history: \.vibepro\/reviews\/story-pr-prepare\/architecture_spec\/history\/review-result-regression_risk-/);

  const reviewSummary = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'architecture_spec', 'review-summary.md'), 'utf8');
  assert.match(reviewSummary, /artifact=\.vibepro\/reviews\/story-pr-prepare\/architecture_spec\/review-result-regression_risk\.json/);
  assert.match(reviewSummary, /history: \.vibepro\/reviews\/story-pr-prepare\/architecture_spec\/history\/review-result-regression_risk-/);

  const prepare = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(prepare.exitCode, 0);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /### Review Artifacts/);
  assert.match(prBody, /architecture_spec:regression_risk \(pass\) artifact: \.vibepro\/reviews\/story-pr-prepare\/architecture_spec\/review-result-regression_risk\.json/);
  assert.match(prBody, /history: \.vibepro\/reviews\/story-pr-prepare\/architecture_spec\/history\/review-result-regression_risk-/);
});

test('review summary lists next actions for missing prepared roles', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'agent-review-next-actions.js'), 'export const value = 1;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add agent review next action target']);

  const prepare = await runCli([
    'review',
    'prepare',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'preview',
    '--role',
    'human_usability'
  ]);
  assert.equal(prepare.exitCode, 0);

  const reviewSummary = await readFile(path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'preview', 'review-summary.md'), 'utf8');
  assert.doesNotMatch(reviewSummary, /## Next Actions\n\n- none/);
  assert.match(reviewSummary, /Run and record preview:human_usability/);
  assert.match(reviewSummary, /vibepro review record \. --id story-pr-prepare --stage preview --role human_usability/);
});

test('review pass requires verified subagent or explicit manual review provenance', async () => {
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

  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate']);
  const gateManualRecord = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'manual gate pass without subagent proof',
    '--inspection-summary',
    'read gate evidence but intentionally omitted subagent provenance',
    '--inspection-input',
    '.vibepro/reviews/story-pr-prepare/gate/review-request-gate_evidence.md',
    '--judgment-delta',
    'inspection exists -> still unverified because subagent provenance is omitted'
  ]);
  assert.equal(gateManualRecord.exitCode, 0);
  const prWithoutProvenance = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  const missingGateEvidence = prWithoutProvenance.result.preparation.pr_context.agent_reviews.unmet_required_reviews.find((item) => (
    item.stage === 'gate' && item.role === 'gate_evidence'
  ));
  assert.equal(missingGateEvidence.status, 'unverified_agent');
  assert.match(missingGateEvidence.detail, /not Codex\/Claude Code subagent review/);

  const anonymousManualRecord = await runCli([
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
    'Manual review without reviewer identity',
    '--agent-system',
    'human',
    '--execution-mode',
    'manual_review'
  ]);
  assert.equal(anonymousManualRecord.exitCode, 0);

  const statusWithAnonymousManualReview = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  const roleWithAnonymousManualReview = statusWithAnonymousManualReview.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(roleWithAnonymousManualReview.effective_status, 'unverified_agent');
  assert.equal(roleWithAnonymousManualReview.provenance_status, 'missing_manual_reviewer');
  assert.match(roleWithAnonymousManualReview.provenance_reason, /--recorded-by reviewer provenance/);

  const agentIdOnlyRecord = await runCli([
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
    'Codex subagent id only',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-agent-id-only',
    '--agent-closed'
  ]);
  assert.equal(agentIdOnlyRecord.exitCode, 0);
  assert.equal(agentIdOnlyRecord.result.review.agent_provenance.system, 'codex');
  assert.equal(agentIdOnlyRecord.result.review.agent_provenance.evidence_strength, 'declared');

  const statusWithAgentIdOnly = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  const roleWithAgentIdOnly = statusWithAgentIdOnly.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(roleWithAgentIdOnly.effective_status, 'unverified_agent');
  assert.equal(roleWithAgentIdOnly.provenance_status, 'weak_agent_provenance');
  assert.match(roleWithAgentIdOnly.provenance_reason, /thread\/session\/call id or transcript artifact/);

  const legacyStrongPath = path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'implementation', 'review-result-runtime_contract.json');
  const legacyStrongReview = await readJson(legacyStrongPath);
  legacyStrongReview.agent_provenance.evidence_strength = 'strong';
  await writeJson(legacyStrongPath, legacyStrongReview);

  const statusWithLegacyStrongAgentIdOnly = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  const roleWithLegacyStrongAgentIdOnly = statusWithLegacyStrongAgentIdOnly.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(roleWithLegacyStrongAgentIdOnly.effective_status, 'unverified_agent');
  assert.equal(roleWithLegacyStrongAgentIdOnly.provenance_status, 'weak_agent_provenance');
  assert.match(roleWithLegacyStrongAgentIdOnly.provenance_reason, /thread\/session\/call id or transcript artifact/);

  const humanRecord = await runCli([
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
    'Human manual review passed runtime contract',
    '--agent-system',
    'human',
    '--execution-mode',
    'manual_review',
    '--recorded-by',
    'reviewer@example.com'
  ]);
  assert.equal(humanRecord.exitCode, 0);
  assert.equal(humanRecord.result.review.agent_provenance.system, 'human');
  assert.equal(humanRecord.result.review.agent_provenance.execution_mode, 'manual_review');
  assert.equal(humanRecord.result.review.agent_provenance.evidence_strength, 'manual');

  const statusWithManualReview = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  const roleWithManualReview = statusWithManualReview.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(roleWithManualReview.effective_status, 'unverified_agent');
  assert.equal(roleWithManualReview.provenance_status, 'verified_manual');

  const openClaudeRecord = await runCli([
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
  assert.equal(openClaudeRecord.exitCode, 0);
  assert.equal(openClaudeRecord.result.review.agent_provenance.lifecycle.agent_closed, false);

  const statusWithOpenSubagent = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  const roleWithOpenSubagent = statusWithOpenSubagent.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(roleWithOpenSubagent.effective_status, 'unverified_agent');
  assert.equal(roleWithOpenSubagent.provenance_status, 'agent_not_closed');
  assert.match(roleWithOpenSubagent.provenance_reason, /--agent-closed/);

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
    'Claude Code subagent reviewed runtime contract and was closed',
    '--agent-system',
    'claude-code',
    '--execution-mode',
    'parallel-subagent',
    '--agent-id',
    'claude-task-runtime-contract',
    '--agent-session-id',
    'claude-session-123',
    '--agent-model',
    'claude-sonnet',
    '--agent-closed',
    '--agent-close-evidence',
    'subagent_notification:shutdown'
  ]);
  assert.equal(claudeRecord.exitCode, 0);
  assert.equal(claudeRecord.result.review.agent_provenance.system, 'claude_code');
  assert.equal(claudeRecord.result.review.agent_provenance.execution_mode, 'parallel_subagent');
  assert.equal(claudeRecord.result.review.agent_provenance.lifecycle.agent_closed, true);
  assert.equal(claudeRecord.result.review.agent_provenance.lifecycle.close_evidence, 'subagent_notification:shutdown');
  assert.equal(claudeRecord.result.review.agent_provenance.evidence_strength, 'strong');

  const statusWithProvenance = await runCli(['review', 'status', repo, '--id', 'story-pr-prepare', '--stage', 'implementation', '--json']);
  const roleWithProvenance = statusWithProvenance.result.stages[0].roles.find((role) => role.role === 'runtime_contract');
  assert.equal(roleWithProvenance.effective_status, 'pass');
  assert.equal(roleWithProvenance.provenance_status, 'verified_agent');
});

test('checkpoint lists available phase gates', async () => {
  const result = await runCli(['checkpoint', '--json']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.checkpoints.some((checkpoint) => checkpoint.stage === 'implementation-start'), true);
  assert.equal(result.result.checkpoints.some((checkpoint) => checkpoint.stage === 'test-plan'), true);
  assert.equal(result.result.checkpoints.some((checkpoint) => checkpoint.stage === 'implementation-complete'), true);
});

test('checkpoint blocks implementation start before design gates and staged reviews pass', async () => {
  const repo = await makeGitRepoWithStory();

  const result = await runCli([
    'checkpoint',
    'implementation-start',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--json'
  ]);

  assert.equal(result.exitCode, 2);
  assert.equal(result.result.status, 'blocked');
  assert.equal(result.result.findings.some((finding) => finding.gate_id === 'architecture'), true);
  assert.equal(result.result.findings.some((finding) => finding.gate_id === 'spec'), true);
  assert.equal(result.result.findings.some((finding) => finding.review_stage === 'planning_spec'), true);
  assert.equal(result.result.findings.some((finding) => finding.review_stage === 'architecture_spec'), true);
});

test('verification checkpoint includes PR route and split resolution gates', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
architecture_docs:
  reason: CLI-only utility change
---

# PR準備
`);
  await writeFile(path.join(repo, 'src', 'dirty-helper.js'), 'export const dirty = true;\n');

  const result = await runCli(['checkpoint', 'verification', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);

  assert.equal(result.exitCode, 2);
  assert.equal(result.result.findings.some((finding) => finding.gate_id === 'gate:pr_route_classification'), false);
  assert.equal(result.result.findings.some((finding) => finding.gate_id === 'gate:split_resolution'), true);
  assert.equal(result.result.next_actions.some((action) => action.includes('split/clean-branch')), true);
});

test('execute state tracks next action before and after pr prepare', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
architecture_docs:
  reason: CLI-only utility change
spec_docs:
  - ../../../specs/story-pr-prepare-spec.md
---

# PR準備

## 受け入れ基準

- CLIの補助関数が検証される
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'story-pr-prepare-spec.md'), `---
story_id: story-pr-prepare
title: PR準備 Spec
---

# Spec

- \`INV-EXEC-1\`: CLI helper changes must be covered by unit and typecheck evidence.
`);
  await writeFile(path.join(repo, 'src', 'cli-helper.js'), 'export function normalize(value) { return String(value).trim(); }\n');

  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(started.exitCode, 0);
  assert.equal(started.result.state.completion_status, 'not_prepared');
  assert.equal(started.result.state.current_phase, 'prepare_pr');
  assert.equal(started.result.state.managed_worktree.mode, 'preferred');
  assert.equal(started.result.state.managed_worktree.status, 'created');
  assert.equal(started.result.state.managed_worktree.branch.startsWith('vibepro/story-pr-prepare-'), true);
  assert.equal(await pathExists(started.result.state.managed_worktree.path), true);
  assert.equal(started.result.state.next_actions[0].startsWith(`cd ${started.result.state.managed_worktree.path} && `), true);
  assert.equal(
    started.result.state.next_actions[0].endsWith('vibepro pr prepare . --story-id story-pr-prepare --base main'),
    true
  );
  assert.equal(
    started.result.state.execution_dag.nodes.some((node) => node.id === 'worktree_created' && node.status === 'passed'),
    true
  );
  assert.equal(
    started.result.state.execution_dag.nodes.some((node) => node.id === 'branch_bound' && node.status === 'passed'),
    true
  );

  const statePath = path.join(repo, '.vibepro', 'executions', 'story-pr-prepare', 'state.json');
  assert.equal(await pathExists(statePath), true);

  const prepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(prepare.exitCode, 0);
  const blocked = await readJson(statePath);
  assert.equal(blocked.completion_status, 'blocked');
  assert.equal(blocked.current_phase, 'agent_review');
  assert.equal(blocked.blocking_gate.id, 'gate:agent_review');
  assert.equal(blocked.next_actions.some((action) => action.includes('vibepro review prepare')), true);
  assert.equal(blocked.next_actions.some((action) => action.includes(`cd ${started.result.state.managed_worktree.path} && vibepro review prepare`)), true);

  await recordAgentReviewStage(repo, 'story-pr-prepare', 'gate', ['gate_evidence', 'pr_split_scope', 'release_risk']);
  await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'node --test test/cli-helper-runtime.test.js',
    '--summary',
    'focused runtime path evidence for src/cli-helper.js passed'
  ]);
  await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'typecheck',
    '--status',
    'pass',
    '--command',
    'npm run typecheck',
    '--summary',
    'typecheck passed'
  ]);
  await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:split_resolution',
    '--summary',
    'Mixed story, spec, and source files are intentionally kept in one PR for this small CLI workflow change.',
    '--reason',
    'The changed files are one local workflow slice and splitting would reduce traceability for the story.',
    '--reviewer',
    'codex',
    '--json'
  ]);
  const passed = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(passed.exitCode, 0);
  const ready = await readJson(statePath);
  assert.equal(ready.completion_status, 'waiver_required');
  assert.equal(ready.current_phase, 'verification');
  assert.equal(Array.isArray(ready.next_actions) && ready.next_actions.length > 0, true);

  const next = await runCli(['execute', 'next', repo, '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(next.exitCode, 0);
  assert.equal(next.result.next.current_phase, 'verification');
  assert.equal(Array.isArray(next.result.next.next_actions) && next.result.next.next_actions.length > 0, true);

  const statusText = await runCliWithStdout(['execute', 'status', repo, '--story-id', 'story-pr-prepare']);
  assert.equal(statusText.exitCode, 0);
  assert.match(statusText.stdout, /managed_worktree: preferred\/created/);
  assert.match(statusText.stdout, /## Managed Worktree/);
  assert.match(statusText.stdout, new RegExp(`path: ${ready.managed_worktree.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(statusText.stdout, /worktree_created: passed/);
  assert.match(statusText.stdout, /branch_bound: passed/);

  const nextText = await runCliWithStdout(['execute', 'next', repo, '--story-id', 'story-pr-prepare']);
  assert.equal(nextText.exitCode, 0);
  assert.match(nextText.stdout, /managed_worktree: preferred\/created/);
  assert.match(nextText.stdout, /execution_dag: /);
});

test('execute start does not initialize or dirty an uninitialized repository', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  const result = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 1);
  assert.equal(await pathExists(path.join(repo, '.vibepro')), false);
});

test('execute state blocks ready_for_pr_create when Gate DAG overall status is not ready', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
---

# PR準備
`);

  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(started.exitCode, 0);

  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-prepare');
  await mkdir(prDir, { recursive: true });
  const gateDag = {
    schema_version: '0.1.0',
    overall_status: 'needs_verification',
    nodes: [
      {
        id: 'story',
        type: 'story',
        label: 'Story',
        status: 'present',
        required: true
      }
    ]
  };
  await writeFile(path.join(prDir, 'gate-dag.json'), `${JSON.stringify(gateDag, null, 2)}\n`);
  await writeFile(path.join(prDir, 'pr-prepare.json'), `${JSON.stringify({
    story_id: 'story-pr-prepare',
    pr_context: { gate_dag: gateDag }
  }, null, 2)}\n`);
  await writeFile(path.join(prDir, 'pr-create.json'), `${JSON.stringify({
    story_id: 'story-pr-prepare',
    pr_url: 'https://github.example.test/unson/vibepro/pull/171',
    dry_run: false
  }, null, 2)}\n`);

  const status = await runCli(['execute', 'status', repo, '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(status.exitCode, 0);
  assert.notEqual(status.result.state.completion_status, 'ready_for_pr_create');
  assert.equal(status.result.state.completion_status, 'waiver_required');
  assert.notEqual(status.result.state.current_phase, 'complete');
  assert.equal(status.result.state.blocking_gate, null);
  assert.equal(status.result.state.last_pr_prepare.overall_status, 'needs_verification');
  assert.equal(status.result.state.last_pr_prepare.ready_for_pr_create, false);
  assert.equal(
    status.result.state.next_actions.some((action) => action.includes('vibepro execute merge')),
    false
  );
  assert.equal(
    status.result.state.next_actions.some((action) => action.includes('Gate DAG overall_status=needs_verification')),
    true
  );
});

test('execute next guides fresh managed-worktree stories through execute start before PR preparation', async () => {
  for (const mode of ['preferred', 'required']) {
    const repo = await makeGitRepoWithStory();
    const configPath = path.join(repo, '.vibepro', 'config.json');
    const config = await readJson(configPath);
    config.execution = { managed_worktree: mode };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = await runCli(['execute', 'next', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
    assert.equal(result.exitCode, 0);
    assert.equal(result.result.next.managed_worktree.mode, mode);
    assert.equal(result.result.next.managed_worktree.status, 'missing');
    assert.equal(
      result.result.next.execution_dag.nodes.some((node) => (
        node.id === 'worktree_created'
        && node.status === (mode === 'required' ? 'blocked' : 'needs_evidence')
        && node.required === (mode === 'required')
      )),
      true
    );
    assert.equal(result.result.next.next_actions[0], 'vibepro execute start . --story-id story-pr-prepare --base main');
    assert.equal(await pathExists(path.join(repo, '.vibepro', 'executions', 'story-pr-prepare', 'state.json')), false);
  }
});

test('execute next keeps disabled managed-worktree fresh stories on direct PR preparation', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'disabled' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runCli(['execute', 'next', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.next.managed_worktree.mode, 'disabled');
  assert.equal(result.result.next.managed_worktree.status, 'disabled');
  assert.equal(result.result.next.next_actions[0], 'vibepro pr prepare . --story-id story-pr-prepare --base main');
});

test('execute start keeps fresh-init managed worktrees clean when generated ignore rules are uncommitted', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await git(repo, ['add', 'index.html']);
  await git(repo, ['commit', '-m', 'chore: init bare repo']);
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
    '2026-W18'
  ]);

  const sourceStatus = await git(repo, ['status', '--porcelain', '-uall']);
  assert.match(sourceStatus.stdout, /\?\? \.gitignore/);

  const result = await runCli([
    'execute',
    'start',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--json'
  ]);

  assert.equal(result.exitCode, 0);
  const managedWorktree = result.result.state.managed_worktree;
  assert.equal(managedWorktree.status, 'created');
  assert.equal(managedWorktree.dirty, false);
  assert.equal(managedWorktree.dirty_fingerprint, 'clean');
  const managedStatus = await git(managedWorktree.path, ['status', '--porcelain', '-uall']);
  assert.equal(managedStatus.stdout.trim(), '');
  const excludePath = (await git(managedWorktree.path, ['rev-parse', '--git-path', 'info/exclude'])).stdout.trim();
  const exclude = await readFile(path.isAbsolute(excludePath) ? excludePath : path.join(managedWorktree.path, excludePath), 'utf8');
  assert.match(exclude, /\/\.vibepro\/config\.json/);
  assert.match(exclude, /\/\.vibepro\/vibepro-manifest\.json/);
  assert.match(exclude, /\/\.vibepro\/executions\//);
});

test('execute status keeps managed worktree raw diagnostics when VibePro manifest is tracked', async () => {
  const repo = await makeGitRepoWithStory();
  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const trackedManifest = await readJson(manifestPath);
  trackedManifest.test_tracking_marker = 'managed-worktree-raw';
  await writeJson(manifestPath, trackedManifest);
  await git(repo, ['add', '-f', '.vibepro/vibepro-manifest.json']);
  await git(repo, ['commit', '-m', 'test: track manifest for managed worktree diagnostics']);

  const started = await runCli([
    'execute',
    'start',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'HEAD',
    '--json'
  ]);
  assert.equal(started.exitCode, 0);
  const worktreePath = started.result.state.managed_worktree.path;
  const managedManifestPath = path.join(worktreePath, '.vibepro', 'vibepro-manifest.json');
  const managedManifest = await readJson(managedManifestPath);
  managedManifest.latest_internal_update_for_test = 'raw-dirty-diagnostic';
  await writeJson(managedManifestPath, managedManifest);

  const rawStatus = await git(worktreePath, ['status', '--porcelain', '-uall']);
  assert.match(rawStatus.stdout, / \.vibepro\/vibepro-manifest\.json/);

  const status = await runCli([
    'execute',
    'status',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'HEAD',
    '--json'
  ]);
  assert.equal(status.exitCode, 0);
  const managedWorktree = status.result.state.managed_worktree;
  assert.equal(managedWorktree.dirty, false);
  assert.equal(managedWorktree.dirty_fingerprint, 'clean');
  assert.equal(managedWorktree.raw_dirty, true);
  assert.match(managedWorktree.raw_dirty_fingerprint, /\.vibepro\/vibepro-manifest\.json/);
  assert.deepEqual(managedWorktree.fingerprint_scope.user_excludes, ['.vibepro/', '.worktrees/vibepro/']);

  const sourceManifest = await readJson(manifestPath);
  sourceManifest.latest_internal_update_for_test = 'root-raw-dirty-diagnostic';
  await writeJson(manifestPath, sourceManifest);
  const rootFingerprints = await collectGitStatusFingerprints(repo);
  assert.equal(rootFingerprints.dirty, true);
  assert.equal(rootFingerprints.user_dirty, false);

  const prepare = await runCli([
    'pr',
    'prepare',
    repo,
    '--base',
    'HEAD',
    '--story-id',
    'story-pr-prepare',
    '--json'
  ]);
  assert.equal(prepare.exitCode, 0);
  const artifactCurrent = prepare.result.preparation.pr_context.gate_dag.nodes
    .find((node) => node.id === 'gate:artifact_consistency').current.managed_worktree;
  assert.equal(artifactCurrent.dirty, false);
  assert.equal(artifactCurrent.raw_dirty, true);
  assert.match(artifactCurrent.raw_dirty_fingerprint, /\.vibepro\/vibepro-manifest\.json/);
  const rootCurrent = prepare.result.preparation.pr_context.gate_dag.nodes
    .find((node) => node.id === 'gate:artifact_consistency').current;
  assert.equal(rootCurrent.raw_dirty, true);
  assert.equal(Array.isArray(rootCurrent.raw_dirty_files), true);
  assert.equal(Array.isArray(rootCurrent.vibepro_internal_dirty_files), true);
  assert.deepEqual(rootCurrent.fingerprint_scope.user_excludes, ['.vibepro/', '.worktrees/vibepro/']);

  const managedGate = prepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:managed_worktree');
  assert.equal(managedGate.managed_worktree.dirty, false);
  assert.equal(managedGate.managed_worktree.raw_dirty, true);

  const statusText = await runCliWithStdout([
    'execute',
    'status',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'HEAD'
  ]);
  assert.equal(statusText.exitCode, 0);
  assert.match(statusText.stdout, /dirty: false/);
  assert.match(statusText.stdout, /raw_dirty: true/);
  assert.match(statusText.stdout, /raw_dirty_fingerprint: .*\.vibepro\/vibepro-manifest\.json/);
});

test('execute start records preferred managed worktree creation failures without blocking the checkout', async () => {
  const repo = await makeGitRepoWithStory();

  const result = await runCli([
    'execute',
    'start',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'definitely-missing-ref',
    '--json'
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.state.managed_worktree.mode, 'preferred');
  assert.equal(result.result.state.managed_worktree.status, 'unavailable');
  assert.match(result.result.state.managed_worktree.failure_reason, /definitely-missing-ref/);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'executions', 'story-pr-prepare', 'state.json')), true);
  assert.equal(
    result.result.state.execution_dag.nodes.some((node) => (
      node.id === 'worktree_created'
      && node.status === 'needs_evidence'
      && node.required === false
    )),
    true
  );
  assert.equal(result.result.state.next_actions[0].startsWith('cd '), false);
});

test('execute start records required managed worktree creation failures as a blocked execution DAG', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'required' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runCli([
    'execute',
    'start',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'definitely-missing-ref',
    '--json'
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.state.completion_status, 'blocked');
  assert.equal(result.result.state.managed_worktree.mode, 'required');
  assert.equal(result.result.state.managed_worktree.required, true);
  assert.equal(result.result.state.managed_worktree.status, 'unavailable');
  assert.match(result.result.state.managed_worktree.failure_reason, /definitely-missing-ref/);
  assert.equal(result.result.state.blocking_gate.id, 'execution:worktree_created');
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'executions', 'story-pr-prepare', 'state.json')), true);
  assert.equal(
    result.result.state.execution_dag.nodes.some((node) => (
      node.id === 'worktree_created'
      && node.status === 'blocked'
      && node.required === true
    )),
    true
  );
});

test('execute start refuses to reuse an existing worktree on a foreign branch', async () => {
  const repo = await makeGitRepoWithStory();
  const worktreePath = path.join(repo, '.worktrees', 'vibepro', 'story-pr-prepare-foreign');
  await mkdir(path.dirname(worktreePath), { recursive: true });
  await git(repo, ['worktree', 'add', worktreePath, '-b', 'foreign', 'main']);

  const result = await runCliWithStdout([
    'execute',
    'start',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--worktree-path',
    worktreePath
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /managed worktree branch mismatch/);
});

test('execute start recognizes an existing managed worktree through a symlinked path', async () => {
  const repo = await makeGitRepoWithStory();
  const realWorktreePath = path.join(repo, '.worktrees', 'vibepro', 'story-pr-prepare-real');
  const aliasRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-worktree-alias-'));
  const aliasPath = path.join(aliasRoot, 'story-pr-prepare-real');

  const first = await runCli([
    'execute',
    'start',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--worktree-path',
    realWorktreePath
  ]);
  assert.equal(first.exitCode, 0);
  await symlink(realWorktreePath, aliasPath);

  const second = await runCli([
    'execute',
    'start',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--worktree-path',
    aliasPath,
    '--json'
  ]);

  assert.equal(second.exitCode, 0);
  assert.equal(second.result.state.managed_worktree.status, 'reused');
  assert.equal(second.result.state.managed_worktree.branch_match, true);
});

test('execute next blocks required managed worktree branch drift', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'required' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(started.exitCode, 0);
  const worktreePath = started.result.state.managed_worktree.path;
  await git(worktreePath, ['switch', '-c', 'foreign']);

  const status = await runCli(['execute', 'status', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.state.managed_worktree.status, 'branch_mismatch');
  assert.equal(status.result.state.managed_worktree.branch_match, false);
  assert.equal(status.result.state.completion_status, 'blocked');
  assert.equal(status.result.state.blocking_gate.id, 'execution:worktree_created');
  assert.equal(
    status.result.state.required_commands.pr_prepare.startsWith(`cd ${worktreePath} && `),
    false
  );

  const next = await runCli(['execute', 'next', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(next.exitCode, 0);
  assert.equal(next.result.next.blocking_gate.id, 'execution:worktree_created');
  assert.equal(next.result.next.managed_worktree.status, 'branch_mismatch');
  assert.equal(
    next.result.next.next_actions.some((action) => action.includes(`cd ${worktreePath} && vibepro pr prepare`)),
    false
  );
  assert.equal(next.result.next.next_actions.length > 0, true);
});

test('execute next does not route PR commands into a stale managed worktree head', async () => {
  const repo = await makeGitRepoWithStory();
  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(started.exitCode, 0);
  const worktreePath = started.result.state.managed_worktree.path;

  await writeFile(path.join(repo, 'src-stale-head.js'), 'export const staleHead = true;\n');
  await git(repo, ['add', 'src-stale-head.js']);
  await git(repo, ['commit', '-m', 'feat: advance review head']);
  const reviewHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();

  const next = await runCli(['execute', 'next', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(next.exitCode, 0);
  assert.equal(next.result.next.managed_worktree.current_head_sha === reviewHead, false);
  const headBound = next.result.next.execution_dag.nodes.find((node) => node.id === 'head_bound');
  assert.equal(headBound.status, 'needs_evidence');
  assert.match(headBound.reason, /does not match the current execution HEAD/);
  assert.equal(
    next.result.next.next_actions.some((action) => action.includes(`cd ${worktreePath} && vibepro pr prepare`)),
    false
  );

  const nextText = await runCliWithStdout(['execute', 'next', repo, '--story-id', 'story-pr-prepare', '--base', 'main']);
  assert.equal(nextText.exitCode, 0);
  assert.match(nextText.stdout, /head_bound: needs_evidence/);
  assert.match(nextText.stdout, /managed worktree HEAD does not match the current execution HEAD/);
  assert.match(nextText.stdout, /current_head_sha:/);
});

test('execute status treats a normally advanced managed worktree as the current execution head', async () => {
  const repo = await makeGitRepoWithStory();
  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(started.exitCode, 0);
  const worktreePath = started.result.state.managed_worktree.path;

  await writeFile(path.join(worktreePath, 'src-managed-advance.js'), 'export const managedAdvance = true;\n');
  await git(worktreePath, ['add', 'src-managed-advance.js']);
  await git(worktreePath, ['commit', '-m', 'feat: advance managed worktree']);
  const managedHead = (await git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim();

  const status = await runCli(['execute', 'status', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.state.managed_worktree.current_head_sha, managedHead);
  assert.notEqual(status.result.state.blocking_gate?.id, 'execution:head_bound');
  const headBound = status.result.state.execution_dag.nodes.find((node) => node.id === 'head_bound');
  assert.equal(headBound.status, 'passed');
  assert.equal(
    status.result.state.required_commands.pr_prepare.startsWith(`cd ${worktreePath} && `),
    true
  );

  const next = await runCli(['execute', 'next', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(next.exitCode, 0);
  assert.equal(
    next.result.next.next_actions.some((action) => action.includes(`cd ${worktreePath} && vibepro pr prepare`)),
    true
  );
});

test('execute status keeps merged execution state and review completion aligned with artifacts', async () => {
  const repo = await makeGitRepoWithStory();
  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-prepare');
  const reviewDir = path.join(repo, '.vibepro', 'reviews', 'story-pr-prepare', 'gate');
  await mkdir(prDir, { recursive: true });
  await mkdir(reviewDir, { recursive: true });

  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: 'story-pr-prepare', title: 'PR Prepare Test' },
    gate_status: {
      overall_status: 'ready_for_review',
      ready_for_pr_create: true,
      execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] }
    },
    pr_context: {
      gate_dag: {
        schema_version: '0.1.0',
        overall_status: 'ready_for_review',
        summary: { needs_evidence_count: 0 },
        nodes: []
      }
    },
    git: { head_sha: headSha }
  });
  await writeJson(path.join(prDir, 'pr-merge.json'), {
    status: 'merged',
    artifact_freshness: {
      kind: 'pr_merge',
      status: 'current',
      artifact_head_sha: headSha,
      current_head_sha: headSha
    },
    current_head_sha: headSha,
    merged_at: '2026-06-15T00:00:00.000Z',
    merge_commit_sha: headSha,
    pr: { url: 'https://github.example.test/unson/vibepro/pull/999' }
  });
  await writeJson(path.join(reviewDir, 'review-result-gate_evidence.json'), {
    schema_version: '0.1.0',
    story_id: 'story-pr-prepare',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'gate evidence passes at current head',
    findings: [],
    artifacts: [],
    inspection: { summary: 'read gate artifacts', evidence: null, inputs: [] },
    judgment_delta: [],
    recorded_at: '2026-06-15T00:00:00.000Z',
    git_context: {
      head_sha: headSha,
      current_branch: 'feature/test-story',
      dirty: false,
      raw_dirty: false,
      status_fingerprint_hash: 'clean',
      user_status_fingerprint_hash: 'clean'
    },
    agent_provenance: {
      schema_version: '0.1.0',
      system: 'codex',
      execution_mode: 'parallel_subagent',
      agent_id: 'gate-evidence-1',
      model: 'gpt-5.5',
      reasoning_effort: 'low',
      cost_tier: 'medium',
      transcript_artifact: '.vibepro/reviews/story-pr-prepare/gate/transcript-gate-evidence-1.json',
      request_artifact: '.vibepro/reviews/story-pr-prepare/gate/review-request-gate_evidence.md',
      lifecycle: { agent_closed: true, close_evidence: '.vibepro/reviews/story-pr-prepare/gate/transcript-gate-evidence-1.json' },
      evidence_strength: 'strong'
    }
  });
  await writeJson(path.join(reviewDir, 'lifecycle.json'), {
    schema_version: '0.1.0',
    story_id: 'story-pr-prepare',
    stage: 'gate',
    entries: [
      {
        lifecycle_id: 'gate-evidence-1',
        story_id: 'story-pr-prepare',
        stage: 'gate',
        role: 'gate_evidence',
        status: 'closed',
        agent_system: 'codex',
        agent_id: 'gate-evidence-1',
        started_at: '2026-06-15T00:00:00.000Z',
        closed_at: '2026-06-15T00:01:00.000Z',
        timeout_ms: 600000,
        close_reason: 'completed',
        close_evidence: '.vibepro/reviews/story-pr-prepare/gate/transcript-gate-evidence-1.json'
      }
    ]
  });

  const status = await runCli(['execute', 'status', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.state.completion_status, 'merged');
  assert.equal(status.result.state.pr_url, 'https://github.example.test/unson/vibepro/pull/999');
  assert.equal(status.result.state.completed_phases.includes('agent_review'), true);
  assert.equal(status.result.state.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded')?.status, 'passed');
  assert.equal(status.result.state.execution_dag.nodes.find((node) => node.id === 'pr_created')?.status, 'passed');
  assert.equal(status.result.state.execution_dag.nodes.find((node) => node.id === 'merged_or_closed')?.status, 'passed');
});

test('execute status does not advance from stale pr lifecycle artifacts', async () => {
  const repo = await makeGitRepoWithStory();
  const oldHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(path.join(repo, 'src-stale-lifecycle.js'), 'export const staleLifecycle = true;\n');
  await git(repo, ['add', 'src-stale-lifecycle.js']);
  await git(repo, ['commit', '-m', 'feat: advance past lifecycle artifacts']);
  const currentHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-prepare');
  await mkdir(prDir, { recursive: true });

  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: 'story-pr-prepare', title: 'PR Prepare Test' },
    gate_status: {
      overall_status: 'ready_for_review',
      ready_for_pr_create: true,
      execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] }
    },
    pr_context: {
      gate_dag: {
        schema_version: '0.1.0',
        overall_status: 'ready_for_review',
        summary: { needs_evidence_count: 0 },
        nodes: []
      }
    },
    git: { head_sha: currentHead }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    mode: 'pr_create',
    dry_run: false,
    pr_url: 'https://github.example.test/unson/vibepro/pull/999',
    current_head_sha: oldHead,
    artifact_freshness: {
      kind: 'pr_create',
      status: 'stale',
      artifact_head_sha: oldHead,
      current_head_sha: currentHead
    }
  });
  await writeJson(path.join(prDir, 'pr-merge.json'), {
    schema_version: '0.1.0',
    mode: 'execute_merge',
    status: 'merged',
    merged_at: '2026-06-15T00:00:00.000Z',
    merge_commit_sha: oldHead,
    current_head_sha: oldHead,
    pr: { url: 'https://github.example.test/unson/vibepro/pull/999' },
    artifact_freshness: {
      kind: 'pr_merge',
      status: 'stale',
      artifact_head_sha: oldHead,
      current_head_sha: currentHead
    }
  });

  const status = await runCli(['execute', 'status', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.state.completion_status, 'ready_for_pr_create');
  assert.equal(status.result.state.pr_url, null);
  assert.equal(status.result.state.next_actions.some((action) => action.includes('vibepro execute merge')), false);
  assert.equal(status.result.state.execution_dag.nodes.find((node) => node.id === 'pr_created')?.status, 'pending');
  assert.equal(status.result.state.execution_dag.nodes.find((node) => node.id === 'merge_ready')?.status, 'not_applicable');
  assert.equal(status.result.state.execution_dag.nodes.find((node) => node.id === 'merged_or_closed')?.status, 'not_applicable');
});

test('execute start keeps legacy and disabled worktree modes compatible', async () => {
  for (const mode of ['missing_execution_config', 'explicit_disabled']) {
    const repo = await makeGitRepoWithStory();
    const configPath = path.join(repo, '.vibepro', 'config.json');
    const config = await readJson(configPath);
    if (mode === 'missing_execution_config') {
      delete config.execution;
    } else {
      config.execution = { managed_worktree: 'disabled' };
    }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
    assert.equal(started.exitCode, 0);
    assert.equal(started.result.state.managed_worktree.mode, 'disabled');
    assert.equal(started.result.state.managed_worktree.status, 'disabled');
    assert.equal(started.result.state.managed_worktree.path, null);
    assert.equal(started.result.state.next_actions[0].startsWith('cd '), false);
    assert.equal(started.result.state.required_commands.pr_prepare.startsWith('cd '), false);
    assert.equal(
      started.result.state.execution_dag.nodes.some((node) => node.id === 'worktree_created' && node.status === 'not_applicable'),
      true
    );
  }
});

test('verify record rejects required managed worktree commands from the original checkout', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'required' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main']);
  assert.equal(started.exitCode, 0);

  const result = await runCliWithStdout([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'npm test',
    '--summary',
    'unit passed'
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /managed worktree required for verify record/);
});

test('required managed worktree guard blocks protected commands before execute start', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'required' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runCliWithStdout([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'npm test',
    '--summary',
    'unit passed'
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /managed worktree required for verify record/);
  assert.match(result.stderr, /no managed worktree execution state is recorded/);
});

test('required managed worktree guard covers review lifecycle, review record, task execute, and pr create', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'required' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main']);
  assert.equal(started.exitCode, 0);
  const executionStatePath = path.join(repo, '.vibepro', 'executions', 'story-pr-prepare', 'state.json');
  const executionStateBeforeReviewStatus = await readFile(executionStatePath, 'utf8');

  const reviewPrepare = await runCliWithStdout([
    'review',
    'prepare',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate'
  ]);
  assert.equal(reviewPrepare.exitCode, 1);
  assert.match(reviewPrepare.stderr, /managed worktree required for review prepare/);

  const reviewStart = await runCliWithStdout([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-1'
  ]);
  assert.equal(reviewStart.exitCode, 1);
  assert.match(reviewStart.stderr, /managed worktree required for review start/);

  const reviewClose = await runCliWithStdout([
    'review',
    'close',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-id',
    'agent-1',
    '--close-reason',
    'completed'
  ]);
  assert.equal(reviewClose.exitCode, 1);
  assert.match(reviewClose.stderr, /managed worktree required for review close/);

  const reviewRecord = await runCliWithStdout([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence passed'
  ]);
  assert.equal(reviewRecord.exitCode, 1);
  assert.match(reviewRecord.stderr, /managed worktree required for review record/);

  const verifyFlow = await runCliWithStdout([
    'verify',
    'flow',
    repo,
    '--id',
    'story-pr-prepare',
    '--base-url',
    'http://127.0.0.1:9',
    '--json'
  ]);
  assert.equal(verifyFlow.exitCode, 1);
  assert.match(verifyFlow.stderr, /managed worktree required for verify flow/);

  const reviewStatus = await runCliWithStdout([
    'review',
    'status',
    repo,
    '--id',
    'story-pr-prepare'
  ]);
  assert.equal(reviewStatus.exitCode, 0);
  assert.match(reviewStatus.stdout, /Agent Review Status/);
  assert.equal(await readFile(executionStatePath, 'utf8'), executionStateBeforeReviewStatus);

  const decisionRecord = await runCliWithStdout([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:split_resolution',
    '--source-status',
    'needs_review',
    '--status',
    'accepted',
    '--summary',
    'single PR scope accepted',
    '--reason',
    'scope remains cohesive'
  ]);
  assert.equal(decisionRecord.exitCode, 1);
  assert.match(decisionRecord.stderr, /managed worktree required for decision record/);

  const taskExecute = await runCliWithStdout([
    'task',
    'execute',
    repo,
    '--id',
    'story-pr-prepare',
    '--task',
    'TASK-001',
    '--group',
    'queue',
    '--dry-run-pr'
  ]);
  assert.equal(taskExecute.exitCode, 1);
  assert.match(taskExecute.stderr, /managed worktree required for task execute/);

  const taskExecuteSelectedStory = await runCliWithStdout([
    'task',
    'execute',
    repo,
    '--task',
    'TASK-001',
    '--group',
    'queue',
    '--dry-run-pr'
  ]);
  assert.equal(taskExecuteSelectedStory.exitCode, 1);
  assert.match(taskExecuteSelectedStory.stderr, /managed worktree required for task execute/);

  const prShip = await runCliWithStdout([
    'pr',
    'ship',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--dry-run'
  ]);
  assert.equal(prShip.exitCode, 1);
  assert.match(prShip.stderr, /managed worktree required for pr ship/);

  const prCreate = await runCliWithStdout([
    'pr',
    'create',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--dry-run'
  ]);
  assert.equal(prCreate.exitCode, 1);
  assert.match(prCreate.stderr, /managed worktree required for pr create/);

  const executeMerge = await runCliWithStdout([
    'execute',
    'merge',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--dry-run'
  ]);
  assert.equal(executeMerge.exitCode, 1);
  assert.match(executeMerge.stderr, /managed worktree required for execute merge/);
});

test('required managed worktree copies VibePro control files and allows record commands inside the managed worktree', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'required' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(started.exitCode, 0);
  const worktreePath = started.result.state.managed_worktree.path;
  assert.equal(await pathExists(path.join(worktreePath, '.vibepro', 'config.json')), true);
  assert.equal(await pathExists(path.join(worktreePath, '.vibepro', 'vibepro-manifest.json')), true);
  assert.equal(await pathExists(path.join(worktreePath, '.vibepro', 'executions', 'story-pr-prepare', 'state.json')), true);

  const verifyRecord = await runCli([
    'verify',
    'record',
    worktreePath,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'npm test',
    '--summary',
    'unit passed',
    '--json'
  ]);
  assert.equal(verifyRecord.exitCode, 0);
  assert.equal(verifyRecord.result.evidence.commands[0].kind, 'unit');

  const reviewPrepare = await runCli([
    'review',
    'prepare',
    worktreePath,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--json'
  ]);
  assert.equal(reviewPrepare.exitCode, 0);

  const reviewRecord = await runCli([
    'review',
    'record',
    worktreePath,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence passed',
    '--inspection-summary',
    'managed worktree record path inspected',
    '--inspection-input',
    '.vibepro/executions/story-pr-prepare/state.json',
    '--judgment-delta',
    'managed worktree locality concern -> pass from managed path',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'agent-managed',
    '--agent-thread-id',
    'thread-agent-managed',
    '--agent-closed',
    '--json'
  ]);
  assert.equal(reviewRecord.exitCode, 0);
  assert.equal(reviewRecord.result.review.status, 'pass');

  const prepareSelectedStory = await runCli([
    'pr',
    'prepare',
    worktreePath,
    '--base',
    'main',
    '--json'
  ]);
  assert.equal(prepareSelectedStory.exitCode, 0);
  assert.equal(prepareSelectedStory.result.preparation.story.story_id, 'story-pr-prepare');

  const createSelectedStory = await runCliWithStdout([
    'pr',
    'create',
    worktreePath,
    '--base',
    'main',
    '--dry-run',
    '--allow-needs-verification',
    '--verification-waiver',
    'selected story guard regression smoke',
    '--json'
  ]);
  assert.doesNotMatch(createSelectedStory.stderr, /story id is required to evaluate managed worktree locality/);
  assert.doesNotMatch(createSelectedStory.stderr, /managed worktree required for pr create/);
});

test('required managed worktree backfills VibePro control files when reusing an existing worktree', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'required' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const firstStart = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(firstStart.exitCode, 0);
  const worktreePath = firstStart.result.state.managed_worktree.path;

  await rm(path.join(worktreePath, '.vibepro', 'config.json'));
  await rm(path.join(worktreePath, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(await pathExists(path.join(worktreePath, '.vibepro', 'config.json')), false);
  assert.equal(await pathExists(path.join(worktreePath, '.vibepro', 'vibepro-manifest.json')), false);

  const secondStart = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(secondStart.exitCode, 0);
  assert.equal(secondStart.result.state.managed_worktree.status, 'reused');
  assert.equal(secondStart.result.state.managed_worktree.path, worktreePath);
  assert.equal(await pathExists(path.join(worktreePath, '.vibepro', 'config.json')), true);
  assert.equal(await pathExists(path.join(worktreePath, '.vibepro', 'vibepro-manifest.json')), true);

  const sourceManifestBeforeFlow = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  sourceManifestBeforeFlow.unrelated_source_marker = 'preserve-source-manifest-state';
  sourceManifestBeforeFlow.flow_verification_runs = [{
    run_id: 'source-only-flow',
    story_id: 'story-other',
    status: 'pass'
  }];
  await writeFile(path.join(repo, '.vibepro', 'vibepro-manifest.json'), `${JSON.stringify(sourceManifestBeforeFlow, null, 2)}\n`);

  const verifyRecord = await runCli([
    'verify',
    'record',
    worktreePath,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'npm test',
    '--summary',
    'unit passed after reused worktree control file backfill',
    '--json'
  ]);
  assert.equal(verifyRecord.exitCode, 0);
  assert.equal(verifyRecord.result.evidence.commands[0].kind, 'unit');

  const decisionRecord = await runCli([
    'decision',
    'record',
    worktreePath,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:split_resolution',
    '--source-status',
    'needs_review',
    '--status',
    'accepted',
    '--summary',
    'single PR scope accepted in managed worktree',
    '--reason',
    'scope remains cohesive',
    '--json'
  ]);
  assert.equal(decisionRecord.exitCode, 0);
  const sourceDecisionRecords = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'decision-records.json'));
  assert.equal(sourceDecisionRecords.decisions[0].summary, 'single PR scope accepted in managed worktree');

  const verifyFlow = await runCli([
    'verify',
    'flow',
    worktreePath,
    '--id',
    'story-pr-prepare',
    '--base-url',
    'http://127.0.0.1:9',
    '--run-id',
    'managed-flow-sync',
    '--json'
  ]);
  assert.equal(verifyFlow.exitCode, 0);
  const sourceManifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(sourceManifest.unrelated_source_marker, 'preserve-source-manifest-state');
  assert.equal(sourceManifest.latest_flow_verification_run, 'managed-flow-sync');
  assert.equal(sourceManifest.flow_verification_runs.some((run) => run.run_id === 'source-only-flow'), true);
  assert.equal(sourceManifest.flow_verification_runs.some((run) => run.run_id === 'managed-flow-sync'), true);
  assert.equal(
    await pathExists(path.join(repo, '.vibepro', 'verification', 'managed-flow-sync', 'flow-verification.json')),
    true
  );
});

test('execute merge dry-run plans external checks without executing them', async () => {
  const repo = await makeGitRepoWithStory();
  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-prepare');
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true },
    pr_context: { gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } } },
    git: { base_ref: 'main' }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-07T00:00:00.000Z',
    mode: 'pr_create',
    dry_run: false,
    workspace_initialized: true,
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    output: { language: 'ja' },
    gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } },
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    base: 'main',
    head: 'feature/test-story',
    pr_url: 'https://github.example.test/unson/vibepro/pull/123',
    current_head_sha: headSha,
    artifact_freshness: {
      kind: 'pr_create',
      status: 'current',
      artifact_head_sha: headSha,
      current_head_sha: headSha
    },
    toolchain: { source_git: { origin_url: 'https://github.com/unson/vibepro.git', commit: headSha } },
    results: []
  });
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gh-dry-run-bin-'));
  const ghCallLog = path.join(binDir, 'gh-called.log');
  await writeFile(path.join(binDir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(ghCallLog)}, process.argv.slice(2).join(' ') + '\\n');
process.stderr.write('gh must not be executed during execute merge --dry-run');
process.exit(99);
`);
  await chmod(path.join(binDir, 'gh'), 0o755);

  const result = await runCli([
    'execute',
    'merge',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--dry-run',
    '--json'
  ], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(await pathExists(ghCallLog), false);
  assert.equal(result.result.merge.status, 'dry_run_planned');
  assert.equal(result.result.merge.stop_reason, 'external_checks_skipped_dry_run');
  assert.equal(result.result.merge.results.length, 0);
  assert.equal(result.result.merge.preconditions.base_freshness.status, 'not_run');
  assert.equal(result.result.merge.preconditions.remote_head_match.status, 'not_run');
  assert.equal(result.result.merge.preconditions.checks_ready.status, 'not_run');
  assert.equal(result.result.merge.preconditions.review_policy.status, 'not_run');
  assert.equal(result.result.merge.preconditions.open_pull_request.status, 'not_run');
  assert.equal(result.result.merge.commands.some((command) => command.includes('gh pr merge')), true);
  assert.equal(result.result.merge.commands.some((command) => command.includes('gh pr view')), true);
  assert.equal(result.result.merge.commands.some((command) => command.includes('git fetch origin main')), true);
  assert.equal(result.result.merge.commands.some((command) => command.includes('--repo unson/vibepro')), true);
  assert.equal(result.result.merge.commands.some((command) => command.includes('--match-head-commit')), true);
  assert.equal(result.result.merge.warnings.some((warning) => warning.includes('Dry-run skipped external commands')), true);

  const artifact = await readJson(path.join(prDir, 'pr-merge.json'));
  assert.equal(artifact.status, 'dry_run_planned');
  assert.equal(artifact.dry_run, true);
  assert.equal(artifact.results.length, 0);
  assert.equal(
    await pathExists(path.join(repo, 'docs', 'management', 'audit-artifacts', 'story-pr-prepare', 'audit-bundle.json')),
    false
  );
  const html = await readFile(path.join(prDir, 'pr-merge.html'), 'utf8');
  assert.match(html, /data-vibepro-report="pr-merge"/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.pr_merges['story-pr-prepare'].latest_merge, '.vibepro/pr/story-pr-prepare/pr-merge.json');
  assert.equal(manifest.canonical_audit_artifacts?.['story-pr-prepare'], undefined);
});

test('execute merge dry-run ignores stale pr-create selectors', async () => {
  const repo = await makeGitRepoWithStory();
  const oldHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(path.join(repo, 'src-stale-merge-selector.js'), 'export const staleMergeSelector = true;\n');
  await git(repo, ['add', 'src-stale-merge-selector.js']);
  await git(repo, ['commit', '-m', 'feat: advance past stale pr create']);
  const currentHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-prepare');
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true },
    pr_context: { gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } } },
    git: { base_ref: 'main', head_sha: currentHead }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-07T00:00:00.000Z',
    mode: 'pr_create',
    dry_run: false,
    workspace_initialized: true,
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    base: 'main',
    head: 'feature/test-story',
    pr_url: 'https://github.example.test/unson/vibepro/pull/123',
    current_head_sha: oldHead,
    artifact_freshness: {
      kind: 'pr_create',
      status: 'stale',
      artifact_head_sha: oldHead,
      current_head_sha: currentHead
    },
    toolchain: { source_git: { origin_url: 'https://github.com/unson/vibepro.git', commit: oldHead } },
    results: []
  });
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gh-stale-pr-create-bin-'));
  const ghCallLog = path.join(binDir, 'gh-called.log');
  await writeFile(path.join(binDir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(ghCallLog)}, process.argv.slice(2).join(' ') + '\\n');
process.exit(99);
`);
  await chmod(path.join(binDir, 'gh'), 0o755);

  const result = await runCli([
    'execute',
    'merge',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--dry-run',
    '--json'
  ], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 2);
  assert.equal(await pathExists(ghCallLog), false);
  assert.equal(result.result.merge.status, 'blocked');
  assert.equal(result.result.merge.stop_reason, 'pr_selector_missing');
  assert.equal(result.result.merge.commands.length, 0);
  assert.equal(result.result.merge.warnings.some((warning) => warning.includes('Ignored stale pr-create artifact PR URL')), true);
  assert.equal(
    await pathExists(path.join(repo, 'docs', 'management', 'audit-artifacts', 'story-pr-prepare', 'audit-bundle.json')),
    false
  );
});

test('CAA-VERIFY-001 execute merge completes merge artifacts, execution state, and canonical audit bundle after a successful GitHub merge', async () => {
  const repo = await makeGitRepoWithStory();
  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-merge-remote-'));
  await git(remote, ['init', '--bare']);
  try {
    await git(repo, ['remote', 'set-url', 'origin', remote]);
  } catch {
    await git(repo, ['remote', 'add', 'origin', remote]);
  }
  await git(repo, ['push', '-u', 'origin', 'main']);
  await git(repo, ['push', '-u', 'origin', 'feature/test-story']);
  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-prepare');
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true },
    pr_context: { gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } } },
    git: { base_ref: 'main' }
  });
  await writeJson(path.join(prDir, 'gate-dag.json'), {
    story_id: 'story-pr-prepare',
    overall_status: 'ready_for_review',
    nodes: [],
    summary: { needs_evidence_count: 0 }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-07T00:00:00.000Z',
    mode: 'pr_create',
    dry_run: false,
    workspace_initialized: true,
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    output: { language: 'ja' },
    gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } },
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    base: 'main',
    head: 'feature/test-story',
    pr_url: 'https://github.example.test/unson/vibepro/pull/124',
    current_head_sha: headSha,
    artifact_freshness: {
      kind: 'pr_create',
      status: 'current',
      artifact_head_sha: headSha,
      current_head_sha: headSha
    },
    toolchain: { source_git: { commit: headSha } },
    results: []
  });
  await runCli(['execute', 'reconcile', repo, '--story-id', 'story-pr-prepare', '--base', 'main']);
  const next = await runCli(['execute', 'next', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(next.exitCode, 0);
  assert.match(next.result.next.next_actions[0], /vibepro execute merge/);

  const gh = await makeFakeGhMerge({
    url: 'https://github.example.test/unson/vibepro/pull/124',
    headRefName: 'feature/test-story',
    headRefOid: headSha,
    baseRefName: 'main',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    statusCheckRollup: [
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }
    ],
    mergeStdout: 'merged pull request',
    mergeCommit: headSha,
    mergedAt: '2026-06-07T00:32:55Z',
    remotePath: remote
  });

  const result = await runCli([
    'execute',
    'merge',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--json'
  ], {
    env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.merge.status, 'merged');
  assert.equal(result.result.merge.merge_commit_sha, headSha);
  assert.equal(result.result.merge.merged_at, '2026-06-07T00:32:55Z');
  assert.equal(result.result.merge.branch_cleanup.requested, false);
  assert.equal(result.result.merge.canonical_audit.artifact_count > 0, true);
  assert.equal(result.result.merge.canonical_audit.persistence.status, 'pushed');
  assert.equal(result.result.merge.canonical_audit.persistence.pushed, true);
  assert.match(result.result.merge.canonical_audit.persistence.commit_sha, /^[0-9a-f]{40}$/);

  const prMergeArtifact = await readJson(path.join(prDir, 'pr-merge.json'));
  assert.equal(prMergeArtifact.canonical_audit.persistence.status, 'pushed');
  assert.equal(prMergeArtifact.canonical_audit.persistence.pushed, true);
  assert.match(prMergeArtifact.canonical_audit.persistence.commit_sha, /^[0-9a-f]{40}$/);

  const auditDir = path.join(repo, 'docs', 'management', 'audit-artifacts', 'story-pr-prepare');
  const auditBundle = await readJson(path.join(auditDir, 'audit-bundle.json'));
  assert.equal(auditBundle.story_id, 'story-pr-prepare');
  assert.equal(auditBundle.source, 'execute_merge');
  assert.equal(auditBundle.merge.merge_commit_sha, headSha);
  assert.equal(auditBundle.artifacts.some((artifact) => artifact.kind === 'pr_merge'), true);
  assert.equal(await pathExists(path.join(auditDir, 'pr', 'pr-merge.json')), true);
  assert.equal(await pathExists(path.join(auditDir, 'pr', 'gate-dag.json')), true);
  const canonicalPrMergeArtifact = await readJson(path.join(auditDir, 'pr', 'pr-merge.json'));
  assert.equal(canonicalPrMergeArtifact.canonical_audit.persistence.status, 'pushed');
  assert.equal(canonicalPrMergeArtifact.canonical_audit.persistence.pushed, true);
  assert.match(canonicalPrMergeArtifact.canonical_audit.persistence.commit_sha, /^[0-9a-f]{40}$/);

  const executionState = await readJson(path.join(repo, '.vibepro', 'executions', 'story-pr-prepare', 'state.json'));
  assert.equal(executionState.completion_status, 'merged');
  assert.equal(executionState.execution_dag.nodes.find((node) => node.id === 'merge_ready')?.status, 'passed');
  assert.equal(executionState.execution_dag.nodes.find((node) => node.id === 'merged_or_closed')?.status, 'passed');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(
    manifest.canonical_audit_artifacts['story-pr-prepare'].latest_bundle,
    'docs/management/audit-artifacts/story-pr-prepare/audit-bundle.json'
  );
  const remoteMainTree = (await git(remote, ['ls-tree', '-r', 'main', '--name-only'])).stdout;
  assert.match(
    remoteMainTree,
    /docs\/management\/audit-artifacts\/story-pr-prepare\/audit-bundle\.json/
  );
  assert.match(
    remoteMainTree,
    /docs\/management\/audit-artifacts\/story-pr-prepare\/pr\/pr-merge\.json/
  );
  const remoteCanonicalPrMergeArtifact = JSON.parse((await git(remote, [
    'show',
    'main:docs/management/audit-artifacts/story-pr-prepare/pr/pr-merge.json'
  ])).stdout);
  assert.equal(remoteCanonicalPrMergeArtifact.canonical_audit.persistence.status, 'pushed');
  assert.equal(remoteCanonicalPrMergeArtifact.canonical_audit.persistence.pushed, true);
  assert.equal(
    remoteCanonicalPrMergeArtifact.canonical_audit.persistence.commit_sha,
    result.result.merge.canonical_audit.persistence.commit_sha
  );
  const remoteMain = (await git(remote, ['rev-parse', 'main'])).stdout.trim();
  const remoteMainParent = (await git(remote, ['rev-parse', 'main^'])).stdout.trim();
  const persistenceCommit = result.result.merge.canonical_audit.persistence.commit_sha;
  assert.notEqual(remoteMain, persistenceCommit);
  assert.equal(remoteMainParent, persistenceCommit);
  assert.equal((await git(remote, ['rev-parse', `${persistenceCommit}^`])).stdout.trim(), headSha);
});

test('CAA-VERIFY-001 execute merge does not persist canonical audit artifacts when merge commit evidence is missing', async () => {
  const repo = await makeGitRepoWithStory();
  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-merge-remote-'));
  await git(remote, ['init', '--bare']);
  try {
    await git(repo, ['remote', 'set-url', 'origin', remote]);
  } catch {
    await git(repo, ['remote', 'add', 'origin', remote]);
  }
  await git(repo, ['push', '-u', 'origin', 'main']);
  await git(repo, ['push', '-u', 'origin', 'feature/test-story']);
  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-prepare');
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true },
    pr_context: { gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } } },
    git: { base_ref: 'main' }
  });
  await writeJson(path.join(prDir, 'gate-dag.json'), {
    story_id: 'story-pr-prepare',
    overall_status: 'ready_for_review',
    nodes: [],
    summary: { needs_evidence_count: 0 }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-07T00:00:00.000Z',
    mode: 'pr_create',
    dry_run: false,
    workspace_initialized: true,
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    output: { language: 'ja' },
    gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } },
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    base: 'main',
    head: 'feature/test-story',
    pr_url: 'https://github.example.test/unson/vibepro/pull/125',
    current_head_sha: headSha,
    artifact_freshness: {
      kind: 'pr_create',
      status: 'current',
      artifact_head_sha: headSha,
      current_head_sha: headSha
    },
    toolchain: { source_git: { commit: headSha } },
    results: []
  });

  const gh = await makeFakeGhMerge({
    url: 'https://github.example.test/unson/vibepro/pull/125',
    headRefName: 'feature/test-story',
    headRefOid: headSha,
    baseRefName: 'main',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    statusCheckRollup: [
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }
    ],
    mergeStdout: 'merged pull request',
    mergedAt: '2026-06-07T00:32:55Z',
    omitMergeCommit: true,
    remotePath: remote
  });

  const result = await runCli([
    'execute',
    'merge',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--json'
  ], {
    env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.result.merge.status, 'failed');
  assert.equal(result.result.merge.stop_reason, 'canonical_audit_persistence_failed');
  assert.equal(result.result.merge.merge_commit_sha, null);
  assert.equal(result.result.merge.canonical_audit.persistence.status, 'failed');
  assert.equal(result.result.merge.canonical_audit.persistence.reason, 'canonical_audit_merge_commit_missing');
  assert.equal(result.result.merge.canonical_audit.persistence.pushed, false);

  const prMergeArtifact = await readJson(path.join(prDir, 'pr-merge.json'));
  assert.equal(prMergeArtifact.canonical_audit.persistence.status, 'failed');
  assert.equal(prMergeArtifact.canonical_audit.persistence.reason, 'canonical_audit_merge_commit_missing');
  const canonicalPrMergeArtifact = await readJson(path.join(
    repo,
    'docs',
    'management',
    'audit-artifacts',
    'story-pr-prepare',
    'pr',
    'pr-merge.json'
  ));
  assert.equal(canonicalPrMergeArtifact.canonical_audit.persistence.status, 'failed');
  assert.equal(canonicalPrMergeArtifact.canonical_audit.persistence.reason, 'canonical_audit_merge_commit_missing');

  const remoteMain = (await git(remote, ['rev-parse', 'main'])).stdout.trim();
  assert.equal(remoteMain, headSha);
  const remoteMainTree = (await git(remote, ['ls-tree', '-r', 'main', '--name-only'])).stdout;
  assert.doesNotMatch(
    remoteMainTree,
    /docs\/management\/audit-artifacts\/story-pr-prepare\/audit-bundle\.json/
  );
});

test('CAA-VERIFY-001 execute merge fails when final canonical audit artifact persistence is rejected', async () => {
  const repo = await makeGitRepoWithStory();
  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-merge-remote-'));
  await git(remote, ['init', '--bare']);
  try {
    await git(repo, ['remote', 'set-url', 'origin', remote]);
  } catch {
    await git(repo, ['remote', 'add', 'origin', remote]);
  }
  await git(repo, ['push', '-u', 'origin', 'main']);
  await git(repo, ['push', '-u', 'origin', 'feature/test-story']);
  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-prepare');
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true },
    pr_context: { gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } } },
    git: { base_ref: 'main' }
  });
  await writeJson(path.join(prDir, 'gate-dag.json'), {
    story_id: 'story-pr-prepare',
    overall_status: 'ready_for_review',
    nodes: [],
    summary: { needs_evidence_count: 0 }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-07T00:00:00.000Z',
    mode: 'pr_create',
    dry_run: false,
    workspace_initialized: true,
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    output: { language: 'ja' },
    gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } },
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    base: 'main',
    head: 'feature/test-story',
    pr_url: 'https://github.example.test/unson/vibepro/pull/126',
    current_head_sha: headSha,
    artifact_freshness: {
      kind: 'pr_create',
      status: 'current',
      artifact_head_sha: headSha,
      current_head_sha: headSha
    },
    toolchain: { source_git: { commit: headSha } },
    results: []
  });
  await writeFile(path.join(remote, 'hooks', 'pre-receive'), `#!/bin/sh
while read old new ref
do
  if [ "$ref" = "refs/heads/main" ] && [ "$old" != "${headSha}" ]; then
    echo "reject final canonical audit persistence" >&2
    exit 1
  fi
done
exit 0
`);
  await chmod(path.join(remote, 'hooks', 'pre-receive'), 0o755);

  const gh = await makeFakeGhMerge({
    url: 'https://github.example.test/unson/vibepro/pull/126',
    headRefName: 'feature/test-story',
    headRefOid: headSha,
    baseRefName: 'main',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    statusCheckRollup: [
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }
    ],
    mergeStdout: 'merged pull request',
    mergeCommit: headSha,
    mergedAt: '2026-06-07T00:32:55Z',
    remotePath: remote
  });

  const result = await runCli([
    'execute',
    'merge',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--json'
  ], {
    env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.result.merge.status, 'failed');
  assert.equal(result.result.merge.stop_reason, 'canonical_audit_final_persistence_failed');
  assert.equal(result.result.merge.merge_commit_sha, headSha);
  assert.equal(result.result.merge.canonical_audit.persistence.status, 'pushed');
  assert.equal(result.result.merge.canonical_audit.final_persistence.status, 'failed');
  assert.equal(result.result.merge.canonical_audit.final_persistence.reason, 'canonical_audit_push_failed');

  const prMergeArtifact = await readJson(path.join(prDir, 'pr-merge.json'));
  assert.equal(prMergeArtifact.status, 'failed');
  assert.equal(prMergeArtifact.stop_reason, 'canonical_audit_final_persistence_failed');
  assert.equal(prMergeArtifact.canonical_audit.persistence.status, 'pushed');
  assert.equal(prMergeArtifact.canonical_audit.final_persistence.status, 'failed');
  assert.equal(prMergeArtifact.canonical_audit.final_persistence.reason, 'canonical_audit_push_failed');

  const remoteMain = (await git(remote, ['rev-parse', 'main'])).stdout.trim();
  assert.equal(remoteMain, result.result.merge.canonical_audit.persistence.commit_sha);
  const remoteCanonicalPrMergeArtifact = JSON.parse((await git(remote, [
    'show',
    'main:docs/management/audit-artifacts/story-pr-prepare/pr/pr-merge.json'
  ])).stdout);
  assert.equal(remoteCanonicalPrMergeArtifact.canonical_audit?.persistence, undefined);
});

test('execute merge deletes the remote branch and records local cleanup skip when the merged branch is checked out', async () => {
  const repo = await makeGitRepoWithStory();
  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-merge-remote-'));
  await git(remote, ['init', '--bare']);
  try {
    await git(repo, ['remote', 'set-url', 'origin', remote]);
  } catch {
    await git(repo, ['remote', 'add', 'origin', remote]);
  }
  await git(repo, ['push', '-u', 'origin', 'main']);
  await git(repo, ['push', '-u', 'origin', 'feature/test-story']);
  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', 'story-pr-prepare');
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true },
    pr_context: { gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } } },
    git: { base_ref: 'main' }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-07T00:00:00.000Z',
    mode: 'pr_create',
    dry_run: false,
    workspace_initialized: true,
    story: { story_id: 'story-pr-prepare', title: 'PR準備' },
    output: { language: 'ja' },
    gate_dag: { overall_status: 'ready_for_review', nodes: [], summary: { needs_evidence_count: 0 } },
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    base: 'main',
    head: 'feature/test-story',
    pr_url: 'https://github.example.test/unson/vibepro/pull/125',
    current_head_sha: headSha,
    artifact_freshness: {
      kind: 'pr_create',
      status: 'current',
      artifact_head_sha: headSha,
      current_head_sha: headSha
    },
    toolchain: { source_git: { origin_url: 'https://github.com/unson/vibepro.git', commit: headSha } },
    results: []
  });

  const gh = await makeFakeGhMerge({
    url: 'https://github.example.test/unson/vibepro/pull/125',
    headRefName: 'feature/test-story',
    headRefOid: headSha,
    baseRefName: 'main',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    statusCheckRollup: [
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }
    ],
    mergeStdout: 'merged pull request',
    mergeCommit: headSha,
    mergedAt: '2026-06-07T00:32:55Z',
    remotePath: remote
  });

  const result = await runCli([
    'execute',
    'merge',
    repo,
    '--story-id',
    'story-pr-prepare',
    '--base',
    'main',
    '--delete-branch',
    '--json'
  ], {
    env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.merge.status, 'merged');
  assert.equal(result.result.merge.branch_cleanup.requested, true);
  assert.equal(result.result.merge.branch_cleanup.remote.deleted, true);
  assert.equal(result.result.merge.branch_cleanup.local.attempted, false);
  assert.equal(result.result.merge.warnings.some((warning) => warning.includes('Local branch deletion skipped')), true);
});

test('preferred managed worktree warning is recorded on non-PR evidence surfaces', async () => {
  const repo = await makeGitRepoWithStory();
  await writeMinimalTaskState(repo);
  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main']);
  assert.equal(started.exitCode, 0);

  const verifyRecord = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'npm test',
    '--summary',
    'unit passed',
    '--json'
  ]);
  assert.equal(verifyRecord.exitCode, 0);
  assert.equal(verifyRecord.result.evidence.warnings[0].id, 'managed_worktree_locality');
  assert.equal(verifyRecord.result.evidence.commands[0].warnings[0].command_name, 'verify record');
  assert.equal(verifyRecord.result.evidence.commands[0].managed_worktree_context.command_name, 'verify record');
  assert.equal(verifyRecord.result.evidence.commands[0].managed_worktree_context.managed_worktree.path, started.result.state.managed_worktree.path);

  const reviewRecord = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence passed',
    '--inspection-summary',
    'managed worktree preferred warning surface was inspected',
    '--inspection-input',
    '.vibepro/executions/story-pr-prepare/state.json',
    '--judgment-delta',
    'preferred worktree warning -> pass record keeps warning metadata',
    '--json'
  ]);
  assert.equal(reviewRecord.exitCode, 0);
  assert.equal(reviewRecord.result.review.warnings[0].id, 'managed_worktree_locality');
  assert.equal(reviewRecord.result.review.warnings[0].command_name, 'review record');
  assert.equal(reviewRecord.result.review.managed_worktree_context.command_name, 'review record');
  assert.equal(reviewRecord.result.review.managed_worktree_context.managed_worktree.path, started.result.state.managed_worktree.path);

  const decisionRecord = await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:split_resolution',
    '--source-status',
    'needs_review',
    '--status',
    'accepted',
    '--summary',
    'single PR scope accepted',
    '--reason',
    'scope remains cohesive',
    '--json'
  ]);
  assert.equal(decisionRecord.exitCode, 0);
  assert.equal(decisionRecord.result.decision.warnings[0].id, 'managed_worktree_locality');
  assert.equal(decisionRecord.result.decision.warnings[0].command_name, 'decision record');
  assert.equal(decisionRecord.result.records.warnings[0].id, 'managed_worktree_locality');

  const verifyFlow = await runCli([
    'verify',
    'flow',
    repo,
    '--id',
    'story-pr-prepare',
    '--base-url',
    'http://127.0.0.1:9',
    '--run-id',
    'preferred-managed-flow-warning',
    '--json'
  ]);
  assert.equal(verifyFlow.exitCode, 0);
  assert.equal(verifyFlow.result.verification.warnings[0].id, 'managed_worktree_locality');
  assert.equal(verifyFlow.result.verification.warnings[0].command_name, 'verify flow');
  const flowReport = await readFile(path.join(repo, '.vibepro', 'verification', 'preferred-managed-flow-warning', 'flow-verification.md'), 'utf8');
  assert.match(flowReport, /managed_worktree_locality/);

  const taskExecution = await runCli([
    'task',
    'execute',
    repo,
    '--id',
    'story-pr-prepare',
    '--task',
    'TASK-001',
    '--dry-run-pr',
    '--json'
  ]);
  assert.equal(taskExecution.exitCode, 0);
  assert.equal(taskExecution.result.execution.warnings[0].id, 'managed_worktree_locality');
  assert.equal(taskExecution.result.execution.warnings[0].command_name, 'task execute');
  const executionMarkdown = await readFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'execution.md'), 'utf8');
  assert.match(executionMarkdown, /managed_worktree_locality/);
});

test('pr prepare surfaces preferred managed worktree warning when run outside the managed worktree', async () => {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'src-managed-warning.js'), 'export const managedWarning = true;\n');
  await git(repo, ['add', 'src-managed-warning.js']);
  await git(repo, ['commit', '-m', 'feat: add managed warning fixture']);
  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main']);
  assert.equal(started.exitCode, 0);

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const gate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:managed_worktree');
  assert.equal(gate?.status, 'needs_review');
  assert.equal(gate?.required, false);
  assert.match(gate?.reason ?? '', /outside VibePro managed worktree/);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /リリース判断Warning: Managed Worktree Gate/);
  assert.match(prBody, /warning detail: Managed Worktree Gate: .*outside VibePro managed worktree/);
});

test('managed worktree gate keeps generated gate DAG acyclic around PR body contract', async () => {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'src-managed-dag.js'), 'export const managedDag = true;\n');
  await git(repo, ['add', 'src-managed-dag.js']);
  await git(repo, ['commit', '-m', 'feat: add managed dag fixture']);
  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main']);
  assert.equal(started.exitCode, 0);

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const gateDag = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'gate-dag.json'));
  assert.equal(gateDag.edges.some((edge) => edge.from === 'gate:pr_body_contract' && edge.to === 'gate:managed_worktree'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'gate:managed_worktree' && edge.to === 'gate:change_classification'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'gate:managed_worktree' && edge.to === 'gate:pr_body_contract'), false);
});

test('managed worktree command context uses current config mode after execution state exists', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'preferred' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(started.exitCode, 0);

  await writeFile(path.join(repo, 'src-mode-change.js'), 'export const managedModeChange = true;\n');
  await git(repo, ['add', 'src-mode-change.js']);
  await git(repo, ['commit', '-m', 'feat: add managed mode change fixture']);

  const requiredConfig = await readJson(configPath);
  requiredConfig.execution = { managed_worktree: 'required' };
  await writeFile(configPath, `${JSON.stringify(requiredConfig, null, 2)}\n`);

  const requiredPrepare = await runCliWithStdout(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(requiredPrepare.exitCode, 1);
  assert.match(requiredPrepare.stderr, /managed worktree required for pr prepare/);

  const disabledConfig = await readJson(configPath);
  disabledConfig.execution = { managed_worktree: 'disabled' };
  await writeFile(configPath, `${JSON.stringify(disabledConfig, null, 2)}\n`);

  const disabledPrepare = await runCli(['pr', 'prepare', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(disabledPrepare.exitCode, 0);
  const gate = disabledPrepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:managed_worktree');
  assert.equal(gate?.status, 'not_applicable');
  assert.equal(gate?.required, false);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /- 管理worktree: disabled/);
});

test('managed worktree command context uses source repo config from an existing managed worktree', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'preferred' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(started.exitCode, 0);
  const worktreePath = started.result.state.managed_worktree.path;

  await writeFile(path.join(worktreePath, 'src-source-config-authority.js'), 'export const sourceConfigAuthority = true;\n');
  await git(worktreePath, ['add', 'src-source-config-authority.js']);
  await git(worktreePath, ['commit', '-m', 'feat: add source config authority fixture']);

  const requiredConfig = await readJson(configPath);
  requiredConfig.execution = { managed_worktree: 'required' };
  await writeFile(configPath, `${JSON.stringify(requiredConfig, null, 2)}\n`);

  const requiredPrepare = await runCli(['pr', 'prepare', worktreePath, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(requiredPrepare.exitCode, 0);
  const requiredGate = requiredPrepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:managed_worktree');
  assert.equal(requiredGate?.status, 'passed');
  assert.equal(requiredGate?.required, true);

  const disabledConfig = await readJson(configPath);
  disabledConfig.execution = { managed_worktree: 'disabled' };
  await writeFile(configPath, `${JSON.stringify(disabledConfig, null, 2)}\n`);

  const disabledPrepare = await runCli(['pr', 'prepare', worktreePath, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(disabledPrepare.exitCode, 0);
  const disabledGate = disabledPrepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:managed_worktree');
  assert.equal(disabledGate?.status, 'not_applicable');
  assert.equal(disabledGate?.required, false);
});

test('generated managed worktree pr prepare path keeps execution binding', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'required' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(started.exitCode, 0);
  const worktreePath = started.result.state.managed_worktree.path;
  assert.equal(await pathExists(path.join(worktreePath, '.vibepro', 'executions', 'story-pr-prepare', 'state.json')), true);

  await writeFile(path.join(worktreePath, 'src-managed-bound.js'), 'export const managedBound = true;\n');
  await git(worktreePath, ['add', 'src-managed-bound.js']);
  await git(worktreePath, ['commit', '-m', 'feat: managed bound fixture']);

  const prepare = await runCli(['pr', 'prepare', worktreePath, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(prepare.exitCode, 0);
  const gate = prepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:managed_worktree');
  assert.equal(gate?.status, 'passed');
  assert.equal(gate?.required, true);

  const originalState = await readJson(path.join(repo, '.vibepro', 'executions', 'story-pr-prepare', 'state.json'));
  assert.equal(originalState.last_pr_prepare?.head_sha, prepare.result.preparation.git.head_sha);
  assert.equal(await pathExists(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json')), true);

  const originalStatus = await runCli(['execute', 'status', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(originalStatus.exitCode, 0);
  assert.equal(originalStatus.result.state.last_pr_prepare?.head_sha, prepare.result.preparation.git.head_sha);
  assert.equal(
    originalStatus.result.state.next_actions.some((action) => action === 'vibepro pr prepare . --story-id story-pr-prepare --base main'),
    false
  );
});

test('managed worktree pr prepare recovers execution binding from the source checkout state', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.execution = { managed_worktree: 'preferred' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const started = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(started.exitCode, 0);
  const worktreePath = started.result.state.managed_worktree.path;

  await writeFile(path.join(worktreePath, 'src-recovered-binding.js'), 'export const recoveredBinding = true;\n');
  await git(worktreePath, ['add', 'src-recovered-binding.js']);
  await git(worktreePath, ['commit', '-m', 'feat: recovered managed binding fixture']);

  const localStatePath = path.join(worktreePath, '.vibepro', 'executions', 'story-pr-prepare', 'state.json');
  await writeFile(localStatePath, `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: 'story-pr-prepare',
    target: 'pr_create',
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    current_phase: 'prepare_pr',
    completed_phases: [],
    completion_status: 'not_prepared',
    managed_worktree: null,
    execution_dag: null
  }, null, 2)}\n`);

  const prepare = await runCli(['pr', 'prepare', worktreePath, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(prepare.exitCode, 0);
  const gate = prepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:managed_worktree');
  assert.equal(gate?.status, 'passed');
  assert.equal(gate?.managed_worktree?.path, worktreePath);
  assert.equal(gate?.current_head_sha, prepare.result.preparation.git.head_sha);
  assert.equal(prepare.result.preparation.pr_context.managed_worktree.managed_worktree.path, worktreePath);

  const localState = await readJson(localStatePath);
  assert.equal(localState.managed_worktree.path, worktreePath);
  assert.equal(localState.managed_worktree.current_head_sha, prepare.result.preparation.git.head_sha);
  assert.equal(localState.execution_dag.nodes.some((node) => node.id === 'head_bound' && node.status === 'passed'), true);

  const sourceState = await readJson(path.join(repo, '.vibepro', 'executions', 'story-pr-prepare', 'state.json'));
  assert.equal(sourceState.managed_worktree.current_head_sha, prepare.result.preparation.git.head_sha);
});

test('execute start quarantines corrupt existing execution state before writing', async () => {
  const repo = await makeGitRepoWithStory();
  const stateDir = path.join(repo, '.vibepro', 'executions', 'story-pr-prepare');
  const statePath = path.join(stateDir, 'state.json');
  await mkdir(stateDir, { recursive: true });
  await writeFile(statePath, '{not json');

  const result = await runCli(['execute', 'start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 1);
  assert.equal(await pathExists(statePath), false);
  const files = await readdir(stateDir);
  assert.equal(files.some((file) => file.startsWith('state.json.corrupt-') && file.endsWith('.bak')), true);
});

test('execute state reads standalone gate dag with pr gate semantics', async () => {
  const repo = await makeGitRepoWithStory();
  const storyId = 'story-pr-prepare';
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${storyId}.md`), `---
story_id: ${storyId}
title: PR準備
architecture_docs:
  reason: CLI-only utility change
---

# PR準備
`);
  await writeFile(path.join(repo, 'src-gate.js'), 'export const value = 1;\n');
  await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', storyId, '--json']);

  const gateDagPath = path.join(repo, '.vibepro', 'pr', storyId, 'gate-dag.json');
  await writeFile(gateDagPath, `${JSON.stringify({
    nodes: [
      {
        id: 'ac:1',
        type: 'acceptance_criteria',
        label: 'Acceptance Criteria',
        required: true,
        status: 'missing',
        reason: 'Non-gate node should not block execution state'
      },
      {
        id: 'gate:e2e',
        type: 'verification_gate',
        label: 'E2E Gate',
        required: true,
        status: 'needs_evidence',
        reason: 'E2E evidence is missing'
      }
    ]
  }, null, 2)}\n`);

  const result = await runCli(['execute', 'reconcile', repo, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.state.blocking_gate.id, 'gate:e2e');
  assert.equal(result.result.state.blocking_gate.reason, 'E2E evidence is missing');
  assert.equal(result.result.state.completion_status, 'blocked');
  assert.deepEqual(result.result.state.next_actions, ['E2E evidence is missing']);

  await writeFile(gateDagPath, `${JSON.stringify({
    nodes: [
      {
        id: 'review:preflight:gate:gate_evidence',
        type: 'agent_review_dispatch_preflight_gate',
        label: 'Review Dispatch Preflight',
        required: true,
        status: 'failed',
        reason: 'stale review preflight blocks dispatch'
      }
    ]
  }, null, 2)}\n`);
  const preflightResult = await runCli(['execute', 'reconcile', repo, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(preflightResult.exitCode, 0);
  assert.equal(preflightResult.result.state.blocking_gate.id, 'review:preflight:gate:gate_evidence');
  assert.equal(preflightResult.result.state.completion_status, 'blocked');
  assert.deepEqual(preflightResult.result.state.next_actions, ['stale review preflight blocks dispatch']);

  await writeFile(gateDagPath, `${JSON.stringify({
    nodes: [
      {
        id: 'gate:judgment_agent_workflow_evidence_lifecycle',
        type: 'agent_evidence_lifecycle_gate',
        label: 'Evidence Lifecycle Gate',
        required: true,
        status: 'needs_evidence',
        reason: 'Agent workflow route requires current-bound recorded agent review evidence'
      }
    ]
  }, null, 2)}\n`);
  const lifecycleResult = await runCli(['execute', 'reconcile', repo, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(lifecycleResult.exitCode, 0);
  assert.equal(lifecycleResult.result.state.blocking_gate, null);
  assert.equal(lifecycleResult.result.state.completion_status, 'waiver_required');
  assert.equal(lifecycleResult.result.state.completed_phases.includes('ready_for_pr_create'), false);
  assert.equal(
    lifecycleResult.result.state.next_actions.some((action) => action.includes('current-bound recorded agent review evidence')),
    true
  );
});

test('execute state treats route contract gates as PR blockers', async () => {
  const repo = await makeGitRepoWithStory();
  const storyId = 'story-pr-prepare';
  await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', storyId, '--json']);

  const gateDagPath = path.join(repo, '.vibepro', 'pr', storyId, 'gate-dag.json');
  const assertBlocksGate = async (node, expectedReason) => {
    await writeFile(gateDagPath, `${JSON.stringify({ nodes: [node] }, null, 2)}\n`);
    const result = await runCli(['execute', 'reconcile', repo, '--story-id', storyId, '--base', 'main', '--json']);
    assert.equal(result.exitCode, 0);
    assert.equal(result.result.state.completion_status, 'blocked');
    assert.equal(result.result.state.blocking_gate.id, node.id);
    assert.equal(result.result.state.next_actions.some((action) => action.includes(expectedReason)), true);
  };

  await assertBlocksGate({
    id: 'gate:pr_body_contract',
    type: 'pr_body_contract_gate',
    label: 'PR Body Contract Gate',
    required: true,
    status: 'needs_review',
    reason: 'Route-specific PR body contract is missing'
  }, 'Route-specific PR body contract');
  await assertBlocksGate({
    id: 'gate:decision_record',
    type: 'decision_record_gate',
    label: 'Decision Record Gate',
    required: true,
    status: 'needs_review',
    reason: 'Open decision records remain unresolved'
  }, 'Open decision records');
  await assertBlocksGate({
    id: 'gate:pr_freshness',
    type: 'pr_freshness_gate',
    label: 'PR Freshness Gate',
    required: true,
    status: 'needs_rebase',
    reason: 'PR branch must be rebased before PR creation'
  }, 'rebased');
});

test('execute state preserves waiver-required semantics for noncritical unresolved gates', async () => {
  const repo = await makeGitRepoWithStory();
  const storyId = 'story-pr-prepare';
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${storyId}.md`), `---
story_id: ${storyId}
title: PR準備
architecture_docs:
  reason: CLI-only utility change
---

# PR準備
`);
  await writeFile(path.join(repo, 'src-gate.js'), 'export const value = 1;\n');
  await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', storyId, '--json']);

  const gateDagPath = path.join(repo, '.vibepro', 'pr', storyId, 'gate-dag.json');
  await writeFile(gateDagPath, `${JSON.stringify({
    nodes: [
      {
        id: 'architecture',
        type: 'architecture_gate',
        label: 'Architecture Gate',
        required: true,
        status: 'missing',
        reason: 'ADR evidence should be resolved or waived'
      }
    ]
  }, null, 2)}\n`);

  const result = await runCli(['execute', 'reconcile', repo, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.state.completion_status, 'waiver_required');
  assert.equal(result.result.state.current_phase, 'verification');
  assert.equal(result.result.state.completed_phases.includes('ready_for_pr_create'), false);
  assert.equal(result.result.state.next_actions.some((action) => action.includes('ADR evidence')), true);
});

test('execute reconcile --all-merged recalculates merged story state from artifacts', async () => {
  const repo = await makeGitRepoWithStory();
  const storyId = 'story-merged-reconcile';
  const head = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  await mkdir(path.join(repo, '.vibepro', 'pr', storyId), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'pr', storyId, 'pr-create.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-12T00:00:00.000Z',
    current_head_sha: head,
    story: { story_id: storyId },
    pr_url: 'https://github.com/example/repo/pull/123',
    status: 'created'
  });
  await writeJson(path.join(repo, '.vibepro', 'pr', storyId, 'pr-merge.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-12T00:05:00.000Z',
    current_head_sha: head,
    story: { story_id: storyId },
    pr: { url: 'https://github.com/example/repo/pull/123' },
    status: 'merged',
    merged_at: '2026-06-12T00:06:00.000Z',
    merge_commit_sha: head
  });
  await mkdir(path.join(repo, '.vibepro', 'executions', storyId), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'executions', storyId, 'state.json'), {
    schema_version: '0.1.0',
    story_id: storyId,
    completion_status: 'pr_created',
    managed_worktree: null
  });

  const result = await runCli(['execute', 'reconcile', repo, '--all-merged', '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.story_count, 1);
  assert.equal(result.result.updated_story_count, 1);
  assert.equal(result.result.stories[0].story_id, storyId);
  assert.equal(result.result.stories[0].before_status, 'pr_created');
  assert.equal(result.result.stories[0].after_status, 'merged');
  assert.equal(result.result.stories[0].evidence.some((item) => item.kind === 'pr_merge'), true);
  assert.deepEqual(result.result.stories[0].missing_evidence, []);

  const state = await readJson(path.join(repo, '.vibepro', 'executions', storyId, 'state.json'));
  assert.equal(state.completion_status, 'merged');
  assert.equal(state.execution_dag.nodes.find((node) => node.id === 'pr_created').status, 'passed');
});

test('execute state treats workflow-heavy gates as critical blockers', async () => {
  const repo = await makeGitRepoWithStory();
  const storyId = 'story-pr-prepare';
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${storyId}.md`), `---
story_id: ${storyId}
title: PR準備
architecture_docs:
  reason: CLI-only utility change
---

# PR準備
`);
  await writeFile(path.join(repo, 'src-gate.js'), 'export const value = 1;\n');
  await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', storyId, '--json']);

  const gateDagPath = path.join(repo, '.vibepro', 'pr', storyId, 'gate-dag.json');
  await writeFile(gateDagPath, `${JSON.stringify({
    nodes: [
      {
        id: 'gate:release_confidence',
        type: 'workflow_heavy_gate',
        label: 'Release Confidence Gate',
        required: true,
        status: 'needs_evidence',
        reason: 'workflow-heavy release evidence is missing'
      }
    ]
  }, null, 2)}\n`);

  const result = await runCli(['execute', 'reconcile', repo, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.state.completion_status, 'blocked');
  assert.equal(result.result.state.blocking_gate.id, 'gate:release_confidence');
  assert.equal(result.result.state.next_actions[0], 'workflow-heavy release evidence is missing');
});

test('execute state treats design quality gates as critical blockers', async () => {
  const repo = await makeGitRepoWithStory();
  const storyId = 'story-pr-prepare';
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${storyId}.md`), `---
story_id: ${storyId}
title: PR準備
architecture_docs:
  reason: CLI-only utility change
---

# PR準備
`);
  await writeFile(path.join(repo, 'src-gate.js'), 'export const value = 1;\n');
  await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', storyId, '--json']);

  const gateDagPath = path.join(repo, '.vibepro', 'pr', storyId, 'gate-dag.json');
  await writeFile(gateDagPath, `${JSON.stringify({
    nodes: [
      {
        id: 'gate:design_quality',
        type: 'design_quality_gate',
        label: 'Design Quality Gate',
        required: true,
        status: 'needs_evidence',
        reason: 'design quality evidence is missing'
      }
    ]
  }, null, 2)}\n`);

  const result = await runCli(['execute', 'reconcile', repo, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.state.completion_status, 'blocked');
  assert.equal(result.result.state.blocking_gate.id, 'gate:design_quality');
  assert.equal(result.result.state.next_actions[0], 'design quality evidence is missing');
});

test('pr prepare requires only final agent review gates; phase reviews are checkpoint-gated', async () => {
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
    ['gate']
  );
  assert.equal(missingResult.result.preparation.pr_context.agent_reviews.summary.required_review_count, 1);
  assert.match(missingGate.reason, /PR-final/);
  assert.equal(missingGate.required_actions.some((action) => action.includes('vibepro review prepare')), true);
  assert.equal(missingGate.required_actions.some((action) => action.includes('parallel-dispatch.md')), true);
  assert.equal(missingGate.required_actions.some((action) => action.includes('permission-request.md')), false);
  assert.equal(missingGate.required_actions.some((action) => action.includes('manual_review')), false);
  assert.equal(missingGate.dispatch_contract.expected, 'dispatch_parallel_subagents');
  assert.equal(missingGate.dispatch_contract.user_confirmation_required_by_vibepro, false);
  assert.equal(missingGate.dispatch_contract.runner_policy_may_require_user_delegation, false);
  assert.equal(missingGate.dispatch_contract.manual_review_fallback, false);
  assert.equal(missingResult.result.preparation.pr_context.agent_reviews.summary.checkpoint_required_review_count, 0);
  assert.equal(missingResult.result.preparation.pr_context.agent_reviews.summary.unmet_checkpoint_review_count, 0);
  const missingDag = missingResult.result.preparation.pr_context.gate_dag;
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:dispatch_batch:gate' && node.type === 'agent_review_dispatch_batch_gate'), true);
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:preflight:gate:gate_evidence' && node.type === 'agent_review_dispatch_preflight_gate' && node.preflight_kind === 'ready_for_dispatch'), true);
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:prepare:gate' && node.type === 'agent_review_prepare_gate'), true);
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:gate:gate_evidence' && node.type === 'agent_review_role_gate'), true);
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:record:gate:gate_evidence' && node.type === 'agent_review_record_gate'), true);
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:join:gate' && node.type === 'agent_review_stage_join_gate'), true);
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:gate:pr_split_scope' && node.type === 'agent_review_role_gate'), false);
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:prepare:planning_spec'), false);
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:prepare:test_plan'), false);
  assert.equal(missingDag.nodes.some((node) => node.id === 'review:prepare:implementation'), false);
  assert.equal(missingDag.edges.some((edge) => edge.to === 'review:dispatch_batch:gate'), true);
  assert.equal(missingDag.edges.some((edge) => edge.from === 'review:dispatch_batch:gate' && edge.to === 'review:preflight:gate:gate_evidence'), true);
  assert.equal(missingDag.edges.some((edge) => edge.from === 'review:preflight:gate:gate_evidence' && edge.to === 'review:prepare:gate'), true);
  assert.equal(missingDag.edges.some((edge) => edge.from === 'review:prepare:gate' && edge.to === 'review:gate:gate_evidence'), true);
  assert.equal(missingDag.edges.some((edge) => edge.from === 'review:gate:gate_evidence' && edge.to === 'review:record:gate:gate_evidence'), true);
  assert.equal(missingDag.edges.some((edge) => edge.from === 'review:record:gate:gate_evidence' && edge.to === 'review:join:gate'), true);
  assert.equal(missingDag.edges.some((edge) => edge.from === 'review:join:gate' && edge.to === 'gate:agent_review'), true);
  assert.match(missingResult.result.preparation.gate_status.agent_review_instruction, /dispatch that stage's Codex\/Claude Code subagent reviews in parallel/);
  assert.equal(missingResult.result.preparation.gate_status.agent_review_dispatch_required, true);
  assert.equal(missingResult.result.preparation.gate_status.agent_review_user_confirmation_required_by_vibepro, false);
  assert.equal(missingResult.result.preparation.gate_status.agent_review_runner_policy_may_require_user_delegation, false);
  assert.equal(missingResult.result.preparation.gate_status.next_required_actions.some((action) => action.includes('vibepro review prepare')), true);
  const gateDagHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'gate-dag.html'), 'utf8');
  assert.match(gateDagHtml, /data-node-id="review:dispatch_batch:gate"/);
  assert.match(gateDagHtml, /data-node-id="review:preflight:gate:gate_evidence"/);
  assert.match(gateDagHtml, /data-node-id="review:prepare:gate"/);
  assert.match(gateDagHtml, /data-node-id="review:gate:gate_evidence"/);
  assert.match(gateDagHtml, /data-node-id="review:record:gate:gate_evidence"/);
  assert.match(gateDagHtml, /data-node-id="review:join:gate"/);
  assert.equal(missingResult.result.preparation.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:agent_review'), true);
  let summaryStdout = '';
  const summaryOutput = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare'], {
    stdout: { write: (text) => { summaryStdout += text; } }
  });
  assert.equal(summaryOutput.exitCode, 0);
  assert.match(summaryStdout, /Agent Review Gate requires staged role reviews/);

  const implementationStart = await runCli(['checkpoint', 'implementation-start', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(implementationStart.exitCode, 2);
  assert.equal(implementationStart.result.findings.some((finding) => finding.review_stage === 'planning_spec'), true);
  assert.equal(implementationStart.result.findings.some((finding) => finding.review_stage === 'architecture_spec'), true);
  const testPlanCheckpoint = await runCli(['checkpoint', 'test-plan', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(testPlanCheckpoint.exitCode, 2);
  assert.equal(testPlanCheckpoint.result.findings.some((finding) => finding.review_stage === 'test_plan'), true);
  const implementationComplete = await runCli(['checkpoint', 'implementation-complete', repo, '--story-id', 'story-pr-prepare', '--base', 'main', '--json']);
  assert.equal(implementationComplete.exitCode, 2);
  assert.equal(implementationComplete.result.findings.some((finding) => finding.review_stage === 'implementation'), true);

  await recordAgentReviewStage(repo, 'story-pr-prepare', 'gate', ['gate_evidence']);
  const passedResult = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  const passedGate = passedResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:agent_review');
  const passedDag = passedResult.result.preparation.pr_context.gate_dag;
  assert.equal(passedGate.status, 'passed');
  assert.equal(passedDag.nodes.find((node) => node.id === 'review:prepare:gate').status, 'passed');
  assert.equal(passedDag.nodes.find((node) => node.id === 'review:dispatch_batch:gate').status, 'passed');
  assert.equal(passedDag.nodes.find((node) => node.id === 'review:preflight:gate:gate_evidence').preflight_kind, 'dedupe_current_pass');
  assert.equal(passedDag.nodes.find((node) => node.id === 'review:gate:gate_evidence').status, 'passed');
  assert.equal(passedDag.nodes.find((node) => node.id === 'review:record:gate:gate_evidence').status, 'passed');
  assert.equal(passedDag.nodes.find((node) => node.id === 'review:join:gate').status, 'passed');
  assert.equal(passedResult.result.preparation.pr_context.agent_reviews.summary.unmet_required_review_count, 0);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /## Agent Review/);
  assert.match(prBody, /status: pass/);

  await writeFile(path.join(repo, 'src', 'cli-helper.js'), 'export function normalize(value) { return String(value).trim().toLowerCase(); }\n');
  const staleResult = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  const staleBatchNode = staleResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'review:dispatch_batch:gate');
  assert.equal(staleBatchNode.status, 'failed');
  const stalePreflightNode = staleResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'review:preflight:gate:gate_evidence');
  assert.equal(stalePreflightNode.status, 'failed');
  assert.equal(stalePreflightNode.preflight_kind, 'git_stability');
  const staleRoleNode = staleResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'review:gate:gate_evidence');
  assert.equal(staleRoleNode.status, 'stale');
  assert.match(staleRoleNode.reason, /review was recorded for|dirty worktree fingerprint/);
  assert.doesNotMatch(staleRoleNode.reason, /passed/);
  const staleRecordNode = staleResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'review:record:gate:gate_evidence');
  assert.equal(staleRecordNode.status, 'needs_review');
  assert.match(staleRecordNode.reason, /review was recorded for|dirty worktree fingerprint/);
  assert.doesNotMatch(staleRecordNode.reason, /current git state/);
});

test('pr prepare blocks timed out required review lifecycle even when review result passed', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
architecture_docs:
  reason: CLI-only utility change
---

# PR準備
`);
  await writeFile(path.join(repo, 'src', 'cli-helper.js'), 'export function normalize(value) { return String(value).trim(); }\n');

  await recordAgentReviewStage(repo, 'story-pr-prepare', 'gate', ['gate_evidence', 'pr_split_scope', 'release_risk']);
  await runCli([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-stuck-after-pass',
    '--timeout-ms',
    '1'
  ]);
  await new Promise((resolve) => setTimeout(resolve, 5));

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const agentGate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:agent_review');
  assert.equal(agentGate.status, 'needs_review');
  assert.equal(agentGate.required_actions.some((action) => action.includes('agent-stuck-after-pass')), true);
  const batchNode = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'review:dispatch_batch:gate');
  assert.equal(batchNode.status, 'failed');
  const preflightNode = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'review:preflight:gate:gate_evidence');
  assert.equal(preflightNode.status, 'failed');
  assert.equal(preflightNode.preflight_kind, 'lifecycle_recovery');
  assert.equal(result.result.preparation.gate_status.ready_for_pr_create, false);
  assert.equal(result.result.preparation.pr_context.agent_reviews.summary.lifecycle_timed_out_count, 1);
});

test('pr prepare marks dispatch preflight for running manual shutdown and unverified review evidence', async () => {
  const makePreparedReviewRepo = async () => {
    const repo = await makeGitRepoWithStory();
    await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
    await mkdir(path.join(repo, 'src'), { recursive: true });
    await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
architecture_docs:
  reason: CLI-only utility change
---

# PR準備
`);
    await writeFile(path.join(repo, 'src', 'cli-helper.js'), 'export function normalize(value) { return String(value).trim(); }\n');
    return repo;
  };

  const runningRepo = await makePreparedReviewRepo();
  await recordAgentReviewStage(runningRepo, 'story-pr-prepare', 'gate', ['gate_evidence', 'pr_split_scope', 'release_risk']);
  await runCli([
    'review',
    'start',
    runningRepo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-running-after-pass'
  ]);
  const runningResult = await runCli(['pr', 'prepare', runningRepo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  const runningPreflight = runningResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'review:preflight:gate:gate_evidence');
  assert.equal(runningPreflight.status, 'failed');
  assert.equal(runningPreflight.preflight_kind, 'dedupe_running');
  assert.match(runningPreflight.reason, /already running/);

  const manualShutdownRepo = await makePreparedReviewRepo();
  await recordAgentReviewStage(manualShutdownRepo, 'story-pr-prepare', 'gate', ['gate_evidence', 'pr_split_scope', 'release_risk']);
  await runCli([
    'review',
    'start',
    manualShutdownRepo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-system',
    'codex',
    '--agent-id',
    'agent-manual-shutdown-after-pass'
  ]);
  await runCli([
    'review',
    'close',
    manualShutdownRepo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--agent-id',
    'agent-manual-shutdown-after-pass',
    '--close-reason',
    'manual_shutdown'
  ]);
  const manualShutdownResult = await runCli(['pr', 'prepare', manualShutdownRepo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  const manualShutdownPreflight = manualShutdownResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'review:preflight:gate:gate_evidence');
  assert.equal(manualShutdownPreflight.status, 'needs_review');
  assert.equal(manualShutdownPreflight.preflight_kind, 'lifecycle_recovery');
  assert.match(manualShutdownPreflight.reason, /manual_shutdown/);
  assert.equal(manualShutdownResult.result.preparation.gate_status.unresolved_gates.some((gate) => gate.id === 'review:preflight:gate:gate_evidence'), true);

  const unverifiedRepo = await makePreparedReviewRepo();
  await runCli(['review', 'prepare', unverifiedRepo, '--id', 'story-pr-prepare', '--stage', 'gate']);
  const manualRecord = await runCli([
    'review',
    'record',
    unverifiedRepo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'manual pass is audit context only',
    '--inspection-summary',
    'manual review intentionally lacks parallel subagent provenance',
    '--inspection-input',
    '.vibepro/reviews/story-pr-prepare/gate/review-request-gate_evidence.md',
    '--judgment-delta',
    'manual audit context -> still unverified for required agent gate',
    '--agent-system',
    'human',
    '--execution-mode',
    'manual_review',
    '--recorded-by',
    'reviewer@example.com',
    '--json'
  ]);
  assert.equal(manualRecord.exitCode, 0);
  const unverifiedResult = await runCli(['pr', 'prepare', unverifiedRepo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  const unverifiedPreflight = unverifiedResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'review:preflight:gate:gate_evidence');
  assert.equal(unverifiedPreflight.status, 'needs_review');
  assert.equal(unverifiedPreflight.preflight_kind, 'provenance_recovery');
  assert.match(unverifiedPreflight.reason, /human manual review provenance|parallel subagent provenance|manual_review/);
});

test('pr prepare marks recorded blocker dispatch preflight and pr ship excludes internal review gates from human judgments', async () => {
  const makePreparedReviewRepo = async () => {
    const repo = await makeGitRepoWithStory();
    await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
    await mkdir(path.join(repo, 'src'), { recursive: true });
    await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
architecture_docs:
  reason: CLI-only utility change
---

# PR準備
`);
    await writeFile(path.join(repo, 'src', 'cli-helper.js'), 'export function normalize(value) { return String(value).trim(); }\n');
    return repo;
  };

  const assertRecordedBlocker = async (status) => {
    const repo = await makePreparedReviewRepo();
    await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--role', 'gate_evidence']);
    const recordResult = await runCli([
      'review',
      'record',
      repo,
      '--id',
      'story-pr-prepare',
      '--stage',
      'gate',
      '--role',
      'gate_evidence',
      '--status',
      status,
      '--summary',
      `${status} recorded blocker`,
      '--agent-system',
      'codex',
      '--execution-mode',
      'parallel_subagent',
      '--agent-id',
      `agent-${status}`,
      '--agent-closed',
      '--json'
    ]);
    assert.equal(recordResult.exitCode, 0);

    const prepareResult = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
    assert.equal(prepareResult.exitCode, 0);
    const dag = prepareResult.result.preparation.pr_context.gate_dag;
    const batchNode = dag.nodes.find((node) => node.id === 'review:dispatch_batch:gate');
    const preflightNode = dag.nodes.find((node) => node.id === 'review:preflight:gate:gate_evidence');
    const roleNode = dag.nodes.find((node) => node.id === 'review:gate:gate_evidence');
    const recordNode = dag.nodes.find((node) => node.id === 'review:record:gate:gate_evidence');
    const joinNode = dag.nodes.find((node) => node.id === 'review:join:gate');
    assert.equal(batchNode.status, 'failed');
    assert.equal(preflightNode.status, 'failed');
    assert.equal(preflightNode.preflight_kind, 'recorded_blocker');
    assert.match(preflightNode.reason, new RegExp(status));
    assert.equal(roleNode.status, status === 'block' ? 'failed' : 'needs_review');
    assert.equal(recordNode.status, status === 'block' ? 'failed' : 'needs_review');
    assert.equal(joinNode.status, status === 'block' ? 'failed' : 'needs_review');

    let shipStdout = '';
    const shipResult = await runCli([
      'pr',
      'ship',
      repo,
      '--base',
      'main',
      '--head',
      'feature/test-story',
      '--story-id',
      'story-pr-prepare',
      '--dry-run',
      '--json'
    ], {
      stdout: { write: (text) => { shipStdout += text; } }
    });
    assert.equal(shipResult.exitCode, 0);
    const ship = JSON.parse(shipStdout);
    const judgmentText = JSON.stringify(ship.human_judgments_required);
    assert.doesNotMatch(judgmentText, /review:dispatch_batch:gate/);
    assert.doesNotMatch(judgmentText, /review:preflight:gate:gate_evidence/);
    assert.doesNotMatch(judgmentText, /review:prepare:gate/);
    assert.doesNotMatch(judgmentText, /review:gate:gate_evidence/);
    assert.doesNotMatch(judgmentText, /review:record:gate:gate_evidence/);
    assert.doesNotMatch(judgmentText, /review:join:gate/);
    assert.equal(ship.human_judgments_required.some((judgment) => judgment.kind === 'subagent_dispatch'), true);
    const prepareArtifact = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
    const isInternalReviewGate = (gate) => [
      'agent_review_gate',
      'agent_review_dispatch_batch_gate',
      'agent_review_dispatch_preflight_gate',
      'agent_review_prepare_gate',
      'agent_review_role_gate',
      'agent_review_record_gate',
      'agent_review_stage_join_gate'
    ].includes(gate.type);
    const criticalIds = new Set(prepareArtifact.gate_status.critical_unresolved_gates.map((gate) => gate.id));
    const nonCriticalNonReviewCount = prepareArtifact.gate_status.unresolved_gates
      .filter((gate) => !criticalIds.has(gate.id) && !isInternalReviewGate(gate)).length;
    const waiverJudgment = ship.human_judgments_required.find((judgment) => judgment.kind === 'waiver_or_evidence');
    if (nonCriticalNonReviewCount > 0) {
      assert.match(waiverJudgment.reason, new RegExp(`${nonCriticalNonReviewCount} non-critical unresolved gate`));
    } else {
      assert.equal(waiverJudgment, undefined);
    }
  };

  await assertRecordedBlocker('block');
  await assertRecordedBlocker('needs_changes');
});

test('pr prepare blocks timed out workflow checkpoint review lifecycle even when checkpoint result passed', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'components'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'batch-jobs', '[id]', 'generate-samples'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'workers'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Workflow checkpoint review
architecture_docs:
  reason: workflow-heavy fixture
---

# Workflow checkpoint review

## 背景

The workflow runs UI, API, service, worker, retry, and status transitions.
`);
  await writeFile(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'components', 'PlanTab.tsx'), 'export function PlanTab(){ return <button>Start</button>; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'batch-jobs', '[id]', 'generate-samples', 'route.ts'), 'export async function POST(){ return Response.json({ status: "queued" }); }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'formProjectStartService.ts'), 'export function startFormWorkflow(){ return "retry-status"; }\n');
  await writeFile(path.join(repo, 'src', 'workers', 'formDetectionWorker.ts'), 'export function enqueueFormDetectionJob(){ return "queued"; }\n');

  await recordAgentReviewStage(repo, 'story-pr-prepare', 'architecture_spec', ['regression_risk']);
  await recordAgentReviewStage(repo, 'story-pr-prepare', 'test_plan', ['e2e_ux', 'gate_coverage']);
  await recordAgentReviewStage(repo, 'story-pr-prepare', 'implementation', ['runtime_contract', 'ux_completion']);
  await recordAgentReviewStage(repo, 'story-pr-prepare', 'gate', ['gate_evidence', 'release_risk']);
  await recordAgentReviewStage(repo, 'story-pr-prepare', 'preview', ['preview_smoke', 'network_runtime', 'human_usability']);
  await runCli([
    'review',
    'start',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--agent-system',
    'codex',
    '--agent-id',
    'checkpoint-runtime-stuck-after-pass',
    '--timeout-ms',
    '1'
  ]);
  await new Promise((resolve) => setTimeout(resolve, 5));

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const agentReviews = result.result.preparation.pr_context.agent_reviews;
  assert.equal(agentReviews.summary.unmet_checkpoint_review_count, 1);
  assert.equal(agentReviews.unmet_checkpoint_reviews[0].role, 'runtime_contract');
  assert.equal(agentReviews.unmet_checkpoint_reviews[0].status, 'timed_out');
  assert.match(agentReviews.unmet_checkpoint_reviews[0].detail, /checkpoint-runtime-stuck-after-pass/);
  const agentGate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:agent_review');
  assert.equal(agentGate.status, 'needs_review');
  const topologyAxis = result.result.preparation.pr_context.engineering_judgment.judgment_axes.find((axis) => axis.axis === 'execution_topology');
  assert.equal(topologyAxis.matched_evidence.some((item) => item.kind === 'agent_review'), false, JSON.stringify(topologyAxis, null, 2));
  assert.equal(topologyAxis.activation_precision?.status, 'insufficient_signal');
  assert.equal((topologyAxis.activation_candidates?.length ?? 0) > 0, true);
  const topologyGate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:judgment_axis_execution_topology');
  assert.equal(topologyGate, undefined);
  assert.equal(
    result.result.preparation.pr_context.gate_dag.summary.suppressed_judgment_axes.some((axis) => axis.axis === 'execution_topology'),
    true
  );
});

test('pr prepare advances current review stage after required roles pass despite default missing roles', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'components'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'batch-jobs', '[id]', 'generate-samples'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'workers'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Workflow staged review current stage
architecture_docs:
  reason: workflow-heavy fixture
---

# Workflow staged review current stage

## 背景

The workflow runs UI, API, service, worker, retry, and status transitions.
`);
  await writeFile(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'components', 'PlanTab.tsx'), 'export function PlanTab(){ return <button>Start</button>; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'batch-jobs', '[id]', 'generate-samples', 'route.ts'), 'export async function POST(){ return Response.json({ status: "queued" }); }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'formProjectStartService.ts'), 'export function startFormWorkflow(){ return "retry-status"; }\n');
  await writeFile(path.join(repo, 'src', 'workers', 'formDetectionWorker.ts'), 'export function enqueueFormDetectionJob(){ return "queued"; }\n');

  await recordAgentReviewStage(repo, 'story-pr-prepare', 'architecture_spec', ['regression_risk']);
  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const dispatch = result.result.preparation.pr_context.agent_reviews.parallel_dispatch;
  assert.equal(dispatch.stage_execution.current_stage, 'test_plan');
  const archStage = dispatch.required_stages.find((stage) => stage.stage === 'architecture_spec');
  const testPlanStage = dispatch.required_stages.find((stage) => stage.stage === 'test_plan');
  assert.equal(archStage.status, 'pass');
  assert.equal(archStage.dispatch_state, 'complete');
  assert.equal(testPlanStage.dispatch_state, 'current');
  const architectureSummary = result.result.preparation.pr_context.agent_reviews.stages.find((stage) => stage.stage === 'architecture_spec');
  assert.equal(architectureSummary.status, 'pass');
  assert.deepEqual(architectureSummary.roles.map((role) => role.role), ['regression_risk']);
  assert.equal(architectureSummary.next_actions.some((action) => action.includes('architecture_boundary')), false);
  assert.equal(architectureSummary.next_actions.some((action) => action.includes('spec_consistency')), false);
  const agentGate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:agent_review');
  assert.equal(agentGate.required_actions.some((action) => action.includes('--stage test_plan')), true);
  assert.equal(agentGate.required_actions.some((action) => action.includes('--stage architecture_spec')), false);
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
    '--command', 'node --test tests/feature.test.js',
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
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /- \[ \] `npm test -- tests\/feature\.test\.js`.*gate: passed via `node --test tests\/feature\.test\.js`/);
  assert.match(prBody, /- \[x\] `node --test tests\/feature\.test\.js`/);
  assert.match(prBody, /- \[x\] `npm run typecheck`/);
  assert.match(prBody, /- \[ \] `npm run test:e2e`/);
  assert.match(prBody, /gate: failed/);
});

test('pr body verification checklist checks exact current evidence even when the integration gate uses another command', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'pr-body-typecheck.js'), 'export const prBodyTypecheck = true;\n');
  const integrationArtifact = path.join(repo, 'risk-adaptive-artifact.json');
  await writeJson(integrationArtifact, { status: 'pass', tests: 1 });
  await git(repo, ['add', 'src/pr-body-typecheck.js']);
  await git(repo, ['commit', '-m', 'feat: add pr body typecheck fixture']);

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'integration',
	    '--status', 'pass',
	    '--command', 'node --test test/risk-adaptive-gate.test.js',
	    '--summary', 'risk-adaptive gate regression passed',
	    '--artifact', integrationArtifact
	  ])).exitCode, 0);
  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'typecheck',
    '--status', 'pass',
    '--command', 'npm run typecheck',
    '--summary', 'typecheck passed'
  ])).exitCode, 0);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  assert.equal(result.exitCode, 0);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /- \[x\] `npm run typecheck`/);
  assert.doesNotMatch(prBody, /- \[ \] `npm run typecheck`.*gate: passed via `node --test test\/risk-adaptive-gate\.test\.js`/);
  assert.doesNotMatch(prBody, /- \[x\] `npm run typecheck`.*risk-adaptive-artifact\.json/);
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
import { expect, test } from '@playwright/test';
test('story-pr-prepare acceptance criteria', async () => {
  // story-pr-prepare ac:1
  // ユーザーが保存ボタンを押すと完了画面へ遷移する
  // story-pr-prepare ac:2
  // APIが失敗したらエラー表示から再試行できる
  expect('ユーザーが保存ボタンを押すと完了画面へ遷移する').toContain('保存');
  expect('APIが失敗したらエラー表示から再試行できる').toContain('再試行');
});
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

test('pr prepare reports AC coverage diagnostics and accepts multiline local binding assertions', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'tests', 'e2e'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
---

# PR準備

## 受け入れ基準

- [ ] ユーザーが保存ボタンを押すと完了画面へ遷移し、操作結果の通知が画面上に残る
`);
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), 'export default function Page() { return <button>Save</button>; }\n');
  await writeFile(path.join(repo, 'tests', 'e2e', 'story-pr-prepare-diagnostics.spec.ts'), `
import { expect, test } from '@playwright/test';

test('candidate block with criterion text but no AC marker', async () => {
  const criteria = [
    'ユーザーが保存ボタンを押すと完了画面へ遷移し、操作結果の通知が画面上に残る',
  ];
  await expect(
    criteria[0],
  ).toContain('保存ボタン');
});
`);

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npm run test:e2e tests/e2e/story-pr-prepare-diagnostics.spec.ts',
    '--summary', 'E2E command passed with candidate diagnostic fixture'
  ])).exitCode, 0);

  const missingResult = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(missingResult.exitCode, 0);
  const missingGate = missingResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(missingGate.acceptance_e2e_coverage.status, 'needs_evidence');
  assert.match(missingGate.reason, /coverage_diagnostics lists inspected files/);
  const diagnostics = missingGate.acceptance_e2e_coverage.coverage_diagnostics.missing_acceptance_criteria[0];
  assert.equal(diagnostics.id, 'ac:1');
  assert.equal(diagnostics.candidate_diagnostics[0].path, 'tests/e2e/story-pr-prepare-diagnostics.spec.ts');
  assert.equal(diagnostics.candidate_diagnostics[0].blocks[0].test_name, 'candidate block with criterion text but no AC marker');
  assert.deepEqual(diagnostics.candidate_diagnostics[0].blocks[0].reasons, [
    'missing AC marker (ac1 or ac-1 or acceptance1) in executable assertion message or nearby story-bound block marker'
  ]);
  assert.match(diagnostics.guidance, /local static string\/array binding/);

  await writeFile(path.join(repo, 'tests', 'e2e', 'story-pr-prepare-diagnostics.spec.ts'), `
import { expect, test } from '@playwright/test';

test('story-pr-prepare ac:1 multiline local binding assertion', async () => {
  const criteria = [
    'ユーザーが保存ボタンを押すと完了画面へ遷移し、操作結果の通知が画面上に残る',
  ];
  const markers = [
    'story-pr-prepare ac:1',
  ];
  await expect(
    criteria[0],
    markers[0],
  ).toContain('保存ボタン');
});
`);

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npm run test:e2e tests/e2e/story-pr-prepare-diagnostics.spec.ts',
    '--summary', 'E2E command passed with multiline local binding AC coverage'
  ])).exitCode, 0);

  const coveredResult = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(coveredResult.exitCode, 0);
  const coveredGate = coveredResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(coveredGate.acceptance_e2e_coverage.status, 'passed');
  assert.equal(coveredGate.acceptance_e2e_coverage.covered_acceptance_criteria_count, 1);
  assert.deepEqual(coveredGate.acceptance_e2e_coverage.covered_acceptance_criteria[0].files, [
    'tests/e2e/story-pr-prepare-diagnostics.spec.ts'
  ]);
});

test('pr prepare requires scenario clause coverage in E2E specs', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'checkout'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
architecture_docs:
  - ../../../architecture/story-pr-prepare.md
---

# PR準備

## 受け入れ基準

- [ ] 購入フローで確認画面から完了画面へ進める
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'story-pr-prepare.md'), `# Checkout IA

## UI Flow

Checkout moves from confirmation to completion after the user submits payment.
`);
  await writeFile(path.join(repo, 'src', 'app', 'checkout', 'page.tsx'), 'export default function Checkout() { return <button>Pay</button>; }\n');
  await writeInferredSpec(repo, 'story-pr-prepare', {
    schema_version: '0.1.0',
    story_id: 'story-pr-prepare',
    generated_at: '2026-06-03T00:00:00.000Z',
    clauses: [
      {
        id: 'S-001',
        type: 'scenario',
        statement: 'Given checkout confirmation is visible, when the user submits payment, then the completion screen is shown.',
        origin: {
          story_refs: [{ kind: 'acceptance_criteria', index: 0 }],
          architecture_refs: [{ file: 'docs/architecture/story-pr-prepare.md', section: 'UI Flow' }]
        }
      }
    ]
  });
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add checkout scenario spec']);

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
  assert.equal(missingCoverageGate.acceptance_e2e_coverage.scenario_e2e_coverage.status, 'needs_evidence');
  assert.deepEqual(missingCoverageGate.acceptance_e2e_coverage.missing_scenario_clauses.map((item) => item.id), ['S-001']);
  assert.match(missingCoverageGate.reason, /S-001/);

  await mkdir(path.join(repo, 'tests', 'e2e'), { recursive: true });
  await writeFile(path.join(repo, 'tests', 'e2e', 'story-pr-prepare-checkout.spec.ts'), `
import { expect, test } from '@playwright/test';
test('story-pr-prepare S-001 checkout completion scenario', async () => {
  // story-pr-prepare S-001
  // Given checkout confirmation is visible, when the user submits payment, then the completion screen is shown.
  expect('completion screen is shown').toContain('completion');
});
`);

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npm run test:e2e tests/e2e/story-pr-prepare-checkout.spec.ts',
    '--summary', 'E2E command passed with scenario coverage'
  ])).exitCode, 0);

  const coveredResult = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(coveredResult.exitCode, 0);
  const coveredGate = coveredResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:e2e');
  assert.equal(
    coveredGate.acceptance_e2e_coverage.scenario_e2e_coverage.status,
    'passed',
    JSON.stringify(coveredGate.acceptance_e2e_coverage.scenario_e2e_coverage)
  );
  assert.equal(coveredGate.acceptance_e2e_coverage.covered_scenario_clause_count, 1);
  assert.deepEqual(coveredGate.acceptance_e2e_coverage.missing_scenario_clauses, []);
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

  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_flow_verification_run = 'legacy-flow-pass-without-artifact';
  manifest.flow_verification_runs = [{
    run_id: 'legacy-flow-pass-without-artifact',
    story_id: 'story-pr-prepare',
    created_at: '2026-05-25T00:00:00.000Z',
    status: 'pass',
    artifacts: {}
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const staleFlowResult = await runCli(['pr', 'prepare', repo, '--base', 'HEAD', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(staleFlowResult.exitCode, 0);
	  const staleFlowNetworkGate = staleFlowResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:network_contract');
	  assert.equal(staleFlowNetworkGate.status, 'needs_evidence');

  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const currentFingerprintHash = await gitFingerprintHash(repo);
  await mkdir(path.join(repo, '.vibepro', 'verification', 'zero-probe-flow-pass'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'verification', 'zero-probe-flow-pass', 'flow-verification.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    run_id: 'zero-probe-flow-pass',
    story_id: 'story-pr-prepare',
    created_at: '2026-05-25T00:00:00.000Z',
    status: 'pass',
    git_context: {
      head_sha: headSha,
      dirty: false,
      status_fingerprint_hash: currentFingerprintHash,
      recorded_at: '2026-05-25T00:00:00.000Z'
    },
    summary: {
      total: 0,
      pass: 0,
      fail: 0,
      skipped: 0,
      needs_setup: 0
    },
    probes: []
  }, null, 2)}\n`);
  manifest.latest_flow_verification_run = 'zero-probe-flow-pass';
  manifest.flow_verification_runs = [{
    run_id: 'zero-probe-flow-pass',
    story_id: 'story-pr-prepare',
    created_at: '2026-05-25T00:00:00.000Z',
    status: 'pass',
    git_context: {
      head_sha: headSha,
      dirty: false,
      status_fingerprint_hash: currentFingerprintHash,
      recorded_at: '2026-05-25T00:00:00.000Z'
    },
    artifacts: {
      flow_verification_json: '.vibepro/verification/zero-probe-flow-pass/flow-verification.json'
    },
    summary: {
      total: 0,
      pass: 0,
      fail: 0,
      skipped: 0,
      needs_setup: 0
    }
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const zeroProbeFlowResult = await runCli(['pr', 'prepare', repo, '--base', 'HEAD', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(zeroProbeFlowResult.exitCode, 0);
  const zeroProbeNetworkGate = zeroProbeFlowResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:network_contract');
  assert.equal(zeroProbeNetworkGate.status, 'needs_evidence');

	  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npm test',
    '--summary', 'Generic E2E command passed'
  ])).exitCode, 0);
  const genericE2eResult = await runCli(['pr', 'prepare', repo, '--base', 'HEAD', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(genericE2eResult.exitCode, 0);
  const genericE2eNetworkGate = genericE2eResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:network_contract');
  assert.equal(genericE2eNetworkGate.status, 'needs_evidence');

  assert.equal((await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'npm run test:e2e -- /api/detail-search',
    '--summary', 'Network-aware E2E covered the /api/detail-search route contract'
  ])).exitCode, 0);
  const networkAwareResult = await runCli(['pr', 'prepare', repo, '--base', 'HEAD', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(networkAwareResult.exitCode, 0);
  const networkAwareGate = networkAwareResult.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:network_contract');
  assert.equal(networkAwareGate.status, 'passed');
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
vibepro_story_id: story-pr-prepare
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

test('pr prepare prefers explicit Spec docs over inferred spec clauses for Spec Gate binding', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'settings'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
architecture_docs:
  reason: CLI-only utility change
spec_docs:
  - docs/specs/story-pr-prepare-spec.md
---

# PR準備

## 受け入れ基準

- 設定画面の保存状態が明示Specで確認できる
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'story-pr-prepare-spec.md'), `---
story_id: story-pr-prepare
title: PR準備 Spec
---

# Spec

- 設定画面は保存中状態を表示する。
`);
  await writeFile(path.join(repo, 'src', 'app', 'settings', 'page.tsx'), `
export function SettingsPage({ saving }) {
  return saving ? 'saving' : 'ready';
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
        statement: 'The SettingsPage saving branch must remain visible while persistence is pending.'
      }
    ]
  });
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add settings state spec']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);

  assert.equal(result.exitCode, 0);
  const gateDag = result.result.preparation.pr_context.gate_dag;
  const specGate = gateDag.nodes.find((node) => node.id === 'spec');
  assert.equal(gateDag.summary.spec_status, 'present');
  assert.equal(specGate.status, 'present');
  assert.deepEqual(specGate.spec_docs, ['docs/specs/story-pr-prepare-spec.md']);
  assert.equal(specGate.inferred_spec.clauses, 1);
  assert.match(specGate.reason, /explicit Spec docs are present/);
});

test('pr prepare blocks unresolved story-relative Spec docs in Spec Gate binding', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'settings'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
spec_docs:
  - ../../specs/story-pr-prepare-spec.md
---

# PR準備

## 受け入れ基準

- 設定画面の保存状態が明示Specで確認できる
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'story-pr-prepare-spec.md'), `---
story_id: story-pr-prepare
title: PR準備 Spec
---

# Spec

- 設定画面は保存中状態を表示する。
`);
  await writeFile(path.join(repo, 'src', 'app', 'settings', 'page.tsx'), `
export function SettingsPage({ saving }) {
  return saving ? 'saving' : 'ready';
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
        statement: 'The SettingsPage saving branch must remain visible while persistence is pending.'
      }
    ]
  });
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add unresolved settings state spec ref']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);

  assert.equal(result.exitCode, 0);
  const gateDag = result.result.preparation.pr_context.gate_dag;
  const specGate = gateDag.nodes.find((node) => node.id === 'spec');
  assert.equal(gateDag.summary.spec_status, 'needs_evidence');
  assert.equal(specGate.status, 'needs_evidence');
  assert.deepEqual(specGate.spec_docs, ['docs/specs/story-pr-prepare-spec.md']);
  assert.deepEqual(specGate.missing_spec_docs, [
    {
      raw: '../../specs/story-pr-prepare-spec.md',
      resolved_path: 'docs/management/specs/story-pr-prepare-spec.md'
    }
  ]);
  assert.match(specGate.reason, /explicit Spec docs are missing or unresolved/);
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
  const scopeGate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:pr_scope_judgment');
  assert.equal(scopeGate.status, 'needs_split');
  assert.equal(scopeGate.classification, 'needs_split');
  assert.equal(
    result.result.preparation.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:pr_scope_judgment'),
    true
  );
  assert.equal(result.result.preparation.file_groups.repo_control.count, 1);
  assert.equal(result.result.preparation.split_plan.status, 'split_recommended');
  assert.equal(result.result.preparation.split_plan.graph_context.available, true);
  assert.equal(result.result.preparation.split_plan.graph_context.investigation_files.includes('src/shared/security.js'), true);
  assert.equal(result.result.preparation.split_plan.lanes.some((lane) => lane.id === 'runtime-behavior' && lane.graph_investigation_files.includes('src/shared/security.js')), true);
  assert.equal(result.result.preparation.split_plan.lanes.some((lane) => lane.id === 'repo-control' && lane.files.includes('.claude/commands/commit.md')), true);
  assert.match(result.result.preparation.next_commands.join('\n'), /git switch -c feat\/pr-prepare main/);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  const humanPrBody = prBody.slice(0, prBody.indexOf('## 監査ログ'));
  assert.match(humanPrBody, /Scope判断: 差分範囲の説明または分割判断が必要/);
  assert.match(humanPrBody, /scope:needs_clean_branch/);
  assert.match(prBody.slice(prBody.indexOf('## 監査ログ')), /VibePro scope: needs_clean_branch/);
  const splitPlan = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'split-plan.json'));
  assert.equal(splitPlan.model, 'story-pr-split-plan-v1');
  const splitPlanHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'split-plan.html'), 'utf8');
  assert.match(splitPlanHtml, /<!doctype html>/);
  assert.match(splitPlanHtml, /data-vibepro-report="split-plan"/);
  assert.match(splitPlanHtml, /class="lane-board"/);
  assert.match(splitPlanHtml, /data-lane-id="runtime-behavior"/);
  assert.match(splitPlanHtml, /Graphify Investigation Scope/);
});

test('pr prepare classifies docs-only PR route and renders the route contract', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'review-guide.md'), '# Review Guide\n\nDocs-only route evidence.\n');
  await git(repo, ['add', 'docs/review-guide.md']);
  await git(repo, ['commit', '-m', 'docs: add review guide']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);

  assert.equal(result.exitCode, 0);
  const prepare = result.result.preparation;
  assert.equal(prepare.pr_context.pr_route.route_type, 'docs_only');
  assert.equal(prepare.pr_context.pr_route.body_template, 'documentation_decision_review');
  const gateDag = prepare.pr_context.gate_dag;
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:pr_route_classification')?.status, 'passed');
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:pr_body_contract')?.status, 'passed');
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /PR Route: docs_only \/ body=documentation_decision_review/);
});

test('pr prepare emits Engineering Judgment route, route-specific gates, and DAG connectivity', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(
    path.join(repo, 'src', 'pr-manager.js'),
    'export function buildAgentGateDag() { return "agent workflow gate"; }\n'
  );
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await writeFile(
    path.join(repo, 'docs', 'architecture', 'agent-workflow-gate.md'),
    '# Agent Workflow Gate\n\nThis fixture records the agent workflow boundary for the route DAG test.\n'
  );
  await git(repo, ['add', 'src/pr-manager.js', 'docs/architecture/agent-workflow-gate.md']);
  await git(repo, ['commit', '-m', 'feat: add agent workflow gate']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);

  assert.equal(result.exitCode, 0);
  const prepare = result.result.preparation;
  assert.equal(prepare.pr_context.engineering_judgment.route_type, 'agent_workflow');
  assert.equal(prepare.pr_context.engineering_judgment.route_dag, 'agent_workflow_dag');
  const gateDag = prepare.pr_context.gate_dag;
  assert.equal(gateDag.summary.engineering_judgment_route, 'agent_workflow');
  assert.equal(gateDag.summary.engineering_judgment_dag, 'agent_workflow_dag');
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:engineering_judgment_route')?.status, 'passed');
  const spineGate = gateDag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  assert.equal(spineGate?.status, 'needs_evidence');
  assert.deepEqual(
    spineGate?.subchecks.map((check) => check.id),
    ['intent', 'current_reality', 'invariants', 'boundaries', 'failure_modes', 'done_evidence']
  );
  const currentReality = spineGate.subchecks.find((check) => check.id === 'current_reality');
  const doneEvidence = spineGate.subchecks.find((check) => check.id === 'done_evidence');
  assert.equal(currentReality.surface, 'workflow');
  assert.deepEqual(currentReality.required_evidence_kind, ['flow_replay', 'artifact_replay', 'scenario_clause_e2e']);
  assert.deepEqual(currentReality.missing_evidence, ['flow_replay', 'artifact_replay', 'scenario_clause_e2e']);
  assert.equal(doneEvidence.surface, 'workflow');
  assert.deepEqual(doneEvidence.required_evidence_kind, ['flow_replay', 'artifact_replay', 'scenario_clause_e2e']);
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:judgment_agent_workflow_context_acquisition')?.status, 'passed');
  const connectivityGate = gateDag.nodes.find((node) => node.id === 'gate:dag_connectivity');
  assert.equal(connectivityGate?.status, 'passed');
  assert.deepEqual(connectivityGate?.unreachable_nodes, []);
  assert.deepEqual(connectivityGate?.dead_end_nodes, []);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'story' && edge.to === 'gate:story_source_integrity'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'gate:story_source_integrity' && edge.to === 'gate:engineering_judgment_route'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'gate:common_judgment_spine' && edge.to === 'gate:judgment_axis_public_contract'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'gate:judgment_axis_public_contract' && edge.to === 'gate:pr_scope_judgment'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'gate:pr_scope_judgment' && edge.to === 'gate:bug_physics_triage'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'gate:bug_physics_triage' && edge.to === 'gate:judgment_agent_workflow_context_acquisition'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'gate:judgment_agent_workflow_context_acquisition' && edge.to === 'gate:pr_route_classification'), true);
  assert.equal(gateDag.summary.suppressed_judgment_axes.some((axis) => axis.axis === 'execution_topology'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'gate:dag_connectivity' && edge.to === 'pr'), true);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /Engineering Judgment: agent_workflow \/ dag=agent_workflow_dag/);
  assert.match(prBody, /#### 共通spineの確認/);
  assert.match(prBody, /- intent: passed \/ surface=story \/ required=story_intent \/ evidence=/);
  assert.match(prBody, /- done_evidence: needs_evidence \/ surface=workflow \/ required=flow_replay\|artifact_replay\|scenario_clause_e2e \/ evidence=/);
});

test('common judgment spine requires surface-specific evidence instead of generic tests', async () => {
  const runtimeRepo = await makeGitRepoWithStory();
  await mkdir(path.join(runtimeRepo, 'src'), { recursive: true });
  await writeFile(path.join(runtimeRepo, 'src', 'runtime-feature.js'), 'export function runtimeFeature() { return "runtime"; }\n');
  await git(runtimeRepo, ['add', 'src/runtime-feature.js']);
  await git(runtimeRepo, ['commit', '-m', 'feat: add runtime feature']);
  assert.equal((await runCli([
    'verify', 'record', runtimeRepo,
    '--id', 'story-pr-prepare',
    '--kind', 'unit',
    '--status', 'pass',
    '--command', 'npm test',
    '--summary', 'generic test suite passed'
  ])).exitCode, 0);

  const runtimePrepare = await runCli(['pr', 'prepare', runtimeRepo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  assert.equal(runtimePrepare.exitCode, 0);
  const runtimeSpine = runtimePrepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  const runtimeReality = runtimeSpine.subchecks.find((check) => check.id === 'current_reality');
  assert.equal(runtimeReality.surface, 'runtime');
  assert.equal(runtimeReality.status, 'needs_evidence');
  assert.deepEqual(runtimeReality.required_evidence_kind, ['focused_test', 'runtime_path_evidence', 'integration_runtime_path', 'e2e_runtime_path']);
  assert.deepEqual(runtimeReality.matched_evidence, []);
  assert.deepEqual(runtimeReality.optional_evidence_kind, ['graph_impact_scope']);

  const workflowRepo = await makeGitRepoWithStory();
  await mkdir(path.join(workflowRepo, 'src'), { recursive: true });
  await mkdir(path.join(workflowRepo, 'test'), { recursive: true });
  await writeFile(path.join(workflowRepo, 'src', 'agent-workflow.js'), 'export function runAgentWorkflow() { return "gate replay"; }\n');
  await writeFile(path.join(workflowRepo, 'test', 'agent-workflow.test.js'), 'export const staticTestMarker = "flow replay artifact replay scenario clause";\n');
  await git(workflowRepo, ['add', 'src/agent-workflow.js', 'test/agent-workflow.test.js']);
  await git(workflowRepo, ['commit', '-m', 'feat: add agent workflow replay path']);
  assert.equal((await runCli([
    'verify', 'record', workflowRepo,
    '--id', 'story-pr-prepare',
    '--kind', 'typecheck',
    '--status', 'pass',
    '--command', 'npm run typecheck',
    '--summary', 'flow replay and artifact replay scenario clause evidence passed'
  ])).exitCode, 0);

  const workflowPrepare = await runCli(['pr', 'prepare', workflowRepo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  assert.equal(workflowPrepare.exitCode, 0);
  const workflowSpine = workflowPrepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  const workflowReality = workflowSpine.subchecks.find((check) => check.id === 'current_reality');
  const workflowFailureModes = workflowSpine.subchecks.find((check) => check.id === 'failure_modes');
  const workflowDone = workflowSpine.subchecks.find((check) => check.id === 'done_evidence');
  assert.equal(workflowReality.surface, 'workflow');
  assert.equal(workflowReality.status, 'needs_evidence');
  assert.deepEqual(workflowReality.matched_evidence, []);
  assert.deepEqual(workflowReality.minimum_strength, {
    flow_replay: 'strong',
    artifact_replay: 'strong',
    scenario_clause_e2e: 'strong'
  });
  assert.equal(workflowFailureModes.status, 'needs_evidence');
  assert.deepEqual(workflowFailureModes.matched_evidence, []);
  assert.equal(workflowDone.status, 'needs_evidence');
  assert.deepEqual(workflowDone.matched_evidence, []);
  assert.equal((await runCli([
    'verify', 'record', workflowRepo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'node --test test/agent-workflow.test.js',
    '--summary', 'flow_replay and artifact_replay passed for the agent workflow path',
    '--target', 'src/agent-workflow.js',
    '--target', 'test/agent-workflow.test.js',
    '--scenario', 'flow_replay: agent workflow path replayed',
    '--scenario', 'artifact_replay: gate artifacts replayed',
    '--observed', 'flow_replay=true',
    '--observed', 'artifact_replay=true'
  ])).exitCode, 0);

  const partialWorkflowPrepare = await runCli(['pr', 'prepare', workflowRepo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  assert.equal(partialWorkflowPrepare.exitCode, 0);
  const partialWorkflowSpine = partialWorkflowPrepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  const partialWorkflowReality = partialWorkflowSpine.subchecks.find((check) => check.id === 'current_reality');
  const partialWorkflowFailureModes = partialWorkflowSpine.subchecks.find((check) => check.id === 'failure_modes');
  const partialWorkflowDone = partialWorkflowSpine.subchecks.find((check) => check.id === 'done_evidence');
  assert.equal(partialWorkflowSpine.status, 'needs_evidence');
  assert.equal(partialWorkflowReality.status, 'needs_evidence');
  assert.deepEqual(
    partialWorkflowReality.matched_evidence.map((item) => [item.kind, item.strength]),
    [['flow_replay', 'supporting'], ['artifact_replay', 'supporting']]
  );
  assert.deepEqual(partialWorkflowReality.missing_evidence, ['flow_replay', 'artifact_replay', 'scenario_clause_e2e']);
  assert.equal(partialWorkflowFailureModes.status, 'needs_evidence');
  assert.deepEqual(partialWorkflowFailureModes.missing_evidence, ['flow_replay', 'artifact_replay', 'scenario_clause_e2e']);
  assert.equal(partialWorkflowDone.status, 'needs_evidence');
  assert.deepEqual(partialWorkflowDone.missing_evidence, ['flow_replay', 'artifact_replay', 'scenario_clause_e2e']);

  const authRepo = await makeGitRepoWithStory();
  await mkdir(path.join(authRepo, 'src'), { recursive: true });
  await writeFile(path.join(authRepo, 'src', 'auth-permission.js'), 'export function checkPermission(token) { return token === "ok"; }\n');
  await git(authRepo, ['add', 'src/auth-permission.js']);
  await git(authRepo, ['commit', '-m', 'feat: add auth permission token check']);
  assert.equal((await runCli([
    'verify', 'record', authRepo,
    '--id', 'story-pr-prepare',
    '--kind', 'unit',
    '--status', 'pass',
    '--command', 'node --test test/auth-permission.test.js',
    '--summary', 'allowed auth path passes'
  ])).exitCode, 0);

  const authPrepare = await runCli(['pr', 'prepare', authRepo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  assert.equal(authPrepare.exitCode, 0);
  const authSpine = authPrepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  const authFailureModes = authSpine.subchecks.find((check) => check.id === 'failure_modes');
  assert.equal(authFailureModes.surface, 'auth_boundary');
  assert.equal(authFailureModes.status, 'needs_evidence');
  assert.deepEqual(authFailureModes.required_evidence_kind, ['auth_denied', 'permission_denied', 'boundary_condition', 'negative_path']);
  assert.deepEqual(authFailureModes.missing_evidence, ['auth_denied', 'permission_denied', 'boundary_condition', 'negative_path']);

  const docsRepo = await makeGitRepoWithStory();
  await mkdir(path.join(docsRepo, 'docs'), { recursive: true });
  await writeFile(path.join(docsRepo, 'docs', 'operator-note.md'), '# Operator Note\n\nDocuments impact scope only.\n');
  await git(docsRepo, ['add', 'docs/operator-note.md']);
  await git(docsRepo, ['commit', '-m', 'docs: add operator note']);
  const docsPrepare = await runCli(['pr', 'prepare', docsRepo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  assert.equal(docsPrepare.exitCode, 0);
  const docsSpine = docsPrepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  const docsReality = docsSpine.subchecks.find((check) => check.id === 'current_reality');
  assert.equal(docsSpine.status, 'passed');
  assert.equal(docsReality.surface, 'docs_only');
  assert.deepEqual(docsReality.required_evidence_kind, ['story_spec_traceability', 'doc_reference_integrity', 'impact_scope_explained']);
  assert.equal(docsReality.matched_evidence.some((item) => item.kind === 'story_spec_traceability'), true);
});

test('evidence strength distinguishes artifact-thin workflow claims from durable replay artifacts', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await mkdir(path.join(repo, 'artifacts'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'agent-workflow.js'), 'export function runAgentWorkflow() { return "gate replay"; }\n');
  await writeFile(path.join(repo, 'test', 'agent-workflow.test.js'), 'export const staticTestMarker = "flow replay artifact replay scenario clause";\n');
  await writeFile(path.join(repo, 'artifacts', 'workflow-replay-unrecognized.json'), JSON.stringify({ replay: true, note: 'artifact exists but status format is unknown' }, null, 2));
  await writeFile(path.join(repo, 'artifacts', 'workflow-replay-verified.json'), JSON.stringify({ status: 'pass', replay: true }, null, 2));
  await git(repo, ['add', 'src/agent-workflow.js', 'test/agent-workflow.test.js', 'artifacts/workflow-replay-unrecognized.json', 'artifacts/workflow-replay-verified.json']);
  await git(repo, ['commit', '-m', 'feat: add durable workflow replay artifact']);

  await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'node --test test/agent-workflow.test.js',
    '--summary', 'workflow replay verified',
    '--target', 'src/agent-workflow.js',
    '--scenario', 'flow replay for workflow path',
    '--scenario', 'artifact replay for gate artifact path',
    '--scenario', 'scenario clause e2e for workflow story'
  ]);
  const thinPrepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  const thinSpine = thinPrepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  const thinReality = thinSpine.subchecks.find((check) => check.id === 'current_reality');
  assert.equal(thinReality.status, 'needs_evidence');
  assert.deepEqual(
    thinReality.matched_evidence.map((item) => [item.kind, item.strength]),
    [['flow_replay', 'supporting'], ['artifact_replay', 'supporting'], ['scenario_clause_e2e', 'supporting']]
  );
  assert.equal(thinReality.matched_evidence.every((item) => typeof item.strength_reason === 'string'), true);

  await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'node --test test/agent-workflow.test.js',
    '--summary', 'workflow replay recorded with unrecognized artifact',
    '--artifact', 'artifacts/workflow-replay-unrecognized.json',
    '--target', 'src/agent-workflow.js',
    '--scenario', 'flow replay for workflow path',
    '--scenario', 'artifact replay for gate artifact path',
    '--scenario', 'scenario clause e2e for workflow story'
  ]);
  const unrecognizedPrepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  const unrecognizedSpine = unrecognizedPrepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  const unrecognizedReality = unrecognizedSpine.subchecks.find((check) => check.id === 'current_reality');
  assert.equal(unrecognizedReality.status, 'needs_evidence');
  assert.equal(
    unrecognizedReality.matched_evidence.some((item) => item.kind === 'flow_replay' && item.strength === 'supporting'),
    true
  );

  await runCli([
    'verify', 'record', repo,
    '--id', 'story-pr-prepare',
    '--kind', 'e2e',
    '--status', 'pass',
    '--command', 'node --test test/agent-workflow.test.js',
    '--summary', 'workflow replay verified with durable artifact',
    '--artifact', 'artifacts/workflow-replay-verified.json',
    '--target', 'src/agent-workflow.js',
    '--scenario', 'flow replay for workflow path',
    '--scenario', 'artifact replay for gate artifact path',
    '--scenario', 'scenario clause e2e for workflow story'
  ]);
  const strongPrepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  const strongSpine = strongPrepare.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  const strongReality = strongSpine.subchecks.find((check) => check.id === 'current_reality');
  assert.equal(strongReality.status, 'passed');
  assert.deepEqual(
    strongReality.matched_evidence.filter((item) => ['flow_replay', 'artifact_replay', 'scenario_clause_e2e'].includes(item.kind)).map((item) => [item.kind, item.strength]),
    [['flow_replay', 'strong'], ['artifact_replay', 'strong'], ['scenario_clause_e2e', 'strong']]
  );
});

test('common judgment spine uses optional Graphify impact evidence when available', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await git(repo, ['switch', 'main']);
  await writeFile(path.join(repo, 'src', 'shared-runtime.js'), 'export function sharedRuntime() { return "shared"; }\n');
  await git(repo, ['add', 'src/shared-runtime.js']);
  await git(repo, ['commit', '-m', 'chore: add shared runtime']);
  await git(repo, ['switch', 'feature/test-story']);
  await git(repo, ['merge', '--ff-only', 'main']);
  await writeFile(path.join(repo, 'src', 'runtime-feature.js'), 'export function runtimeFeature() { return "runtime"; }\n');
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'runtime-feature', source_file: 'src/runtime-feature.js' },
      { id: 'shared-runtime', source_file: 'src/shared-runtime.js' }
    ],
    links: [
      { source: 'runtime-feature', target: 'shared-runtime', relation: 'imports' }
    ]
  }, null, 2));
  await git(repo, ['add', 'src/runtime-feature.js']);
  await git(repo, ['commit', '-m', 'feat: add runtime feature']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);

  assert.equal(result.exitCode, 0);
  const prepare = result.result.preparation;
  assert.equal(prepare.pr_context.graph_context.available, true);
  assert.equal(prepare.pr_context.graph_context.matched_file_count, 1);
  assert.equal(prepare.pr_context.graph_context.related_file_count, 1);
  const spineGate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  const currentReality = spineGate.subchecks.find((check) => check.id === 'current_reality');
  const graphEvidence = currentReality.matched_evidence.find((item) => item.kind === 'graph_impact_scope');
  assert.equal(currentReality.status, 'needs_evidence');
  assert.deepEqual(currentReality.missing_evidence, ['focused_test', 'runtime_path_evidence', 'integration_runtime_path', 'e2e_runtime_path']);
  assert.equal(graphEvidence.optional, true);
  assert.equal(graphEvidence.matched_file_count, 1);
  assert.equal(graphEvidence.related_file_count, 1);
  assert.deepEqual(graphEvidence.investigation_files, ['src/shared-runtime.js']);
});

test('pr prepare emits Senior first scan multi-axis DAG with optional Graphify scope', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Senior Judgment Multi-Axis DAG
architecture_docs:
  - docs/architecture/senior-judgment-axis.md
spec_docs:
  - docs/specs/senior-judgment-axis.md
---

# Senior Judgment Multi-Axis DAG

## 背景

PR body output, Gate DAG, Graphify optional impact scope, agent workflow topology, and rollback reasoning must be reviewable as separate Senior first scan axes.

## 受け入れ基準

- [ ] public contract and execution topology axes are both active for Gate DAG output changes
- [ ] Graphify is optional impact scope evidence and is not required for correctness
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'senior-judgment-axis.md'), `# Senior Judgment Axis Architecture

Alternatives considered: keep route_type only, or add multi-axis judgment gates. The selected option keeps route_type for compatibility.
Compatibility impact: PR body and JSON keep existing fields while adding judgment_axes.
Rollback plan: consumers can ignore judgment_axes and continue using route_type.
Boundary: Graphify is an optional impact lens, not runtime correctness evidence.
Accepted followups: route-specific enforcement can deepen after the multi-axis artifact is stable.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'senior-judgment-axis.md'), '# Spec\n\njudgment_axes[] must include axis, status, reason, confidence, decision_question, required_evidence, blocking_criteria, and acceptable_followup.\n');
  await writeFile(path.join(repo, 'src', 'judgment-dag.js'), 'export function buildGateDag(){ return "agent workflow graphify pr body output rollback"; }\n');
  await writeFile(path.join(repo, 'test', 'judgment-dag.test.js'), 'import assert from "node:assert/strict";\nassert.match("PR body output remains compatible", /compatible/);\n');
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'judgment-dag', source_file: 'src/judgment-dag.js' },
      { id: 'review-owner', source_file: 'src/review-owner.js' }
    ],
    edges: [
      { source: 'judgment-dag', target: 'review-owner', relation: 'calls' }
    ]
  }, null, 2));
  await git(repo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'docs/architecture/senior-judgment-axis.md', 'docs/specs/senior-judgment-axis.md', 'src/judgment-dag.js', 'test/judgment-dag.test.js']);
  await git(repo, ['commit', '-m', 'feat: add senior judgment axis fixture']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);

  assert.equal(result.exitCode, 0);
  const prepare = result.result.preparation;
  const judgment = prepare.pr_context.engineering_judgment;
  const activeAxes = judgment.judgment_axes.filter((axis) => axis.status !== 'inactive');
  assert.equal(Array.isArray(judgment.judgment_axes), true);
  assert.deepEqual(activeAxes.map((axis) => axis.axis).sort(), [
    'public_contract',
    'scope_reviewability'
  ]);
  const suppressedExecutionTopology = judgment.judgment_axes.find((axis) => axis.axis === 'execution_topology');
  assert.equal(suppressedExecutionTopology.status, 'inactive');
  assert.equal(suppressedExecutionTopology.activation_precision?.status, 'insufficient_signal');
  assert.equal((suppressedExecutionTopology.activation_candidates?.length ?? 0) > 0, true);
  assert.equal(activeAxes.some((axis) => ['rollback_sensitive', 'security_boundary', 'data_state', 'ux_surface', 'performance_semantic', 'release_ops'].includes(axis.axis)), false);
  const publicContract = activeAxes.find((axis) => axis.axis === 'public_contract');
  assert.equal(publicContract.status, 'active_needs_evidence');
  assert.equal(publicContract.missing_evidence.includes('current_verification'), true);
  assert.equal(typeof publicContract.reason, 'string');
  assert.equal(typeof publicContract.confidence, 'number');
  assert.match(publicContract.decision_question, /CLI|API|設定|出力形式|PR本文契約/);
  assert.equal(publicContract.required_evidence.includes('contract_doc'), true);
  assert.equal(publicContract.blocking_criteria.length > 0, true);
  assert.equal(typeof publicContract.acceptable_followup, 'string');
  const scopeAxis = activeAxes.find((axis) => axis.axis === 'scope_reviewability');
  assert.equal(scopeAxis.status, 'active_needs_evidence');
  assert.equal(scopeAxis.matched_evidence.some((item) => item.kind === 'graph_impact_scope'), true);
  assert.equal(scopeAxis.optional_evidence.some((item) => item.kind === 'graph_impact_scope'), true);

  const gateDag = prepare.pr_context.gate_dag;
  assert.equal(gateDag.summary.judgment_axis_count >= 2, true);
  assert.equal(gateDag.summary.active_judgment_axes.includes('public_contract'), true);
  assert.equal(gateDag.summary.suppressed_judgment_axes.some((axis) => axis.axis === 'execution_topology'), true);
  const axisGate = gateDag.nodes.find((node) => node.id === 'gate:judgment_axis_public_contract');
  assert.equal(axisGate?.type, 'judgment_axis_gate');
  assert.equal(axisGate?.status, 'needs_evidence');
  assert.equal(axisGate?.axis_status, 'active_needs_evidence');
  assert.equal(gateDag.edges.some((edge) => edge.from === 'gate:common_judgment_spine' && edge.to === 'gate:judgment_axis_public_contract'), true);
  assert.equal(gateDag.edges.some((edge) => edge.from === 'gate:judgment_axis_public_contract' && edge.to === 'gate:pr_scope_judgment'), true);
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:dag_connectivity')?.status, 'passed');
  const architectureGate = gateDag.nodes.find((node) => node.id === 'architecture');
  assert.equal(architectureGate.axis_quality.status, 'covered');
  assert.equal(architectureGate.axis_quality.evaluations.some((item) => item.axis === 'public_contract'), true);

  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /#### Senior first scan axes/);
  assert.match(prBody, /public_contract: active_needs_evidence/);
  assert.match(prBody, /graph_impact_scope/);

  const noGraphRepo = await makeGitRepoWithStory();
  await mkdir(path.join(noGraphRepo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(noGraphRepo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(noGraphRepo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(noGraphRepo, 'src'), { recursive: true });
  await mkdir(path.join(noGraphRepo, 'test'), { recursive: true });
  await writeFile(path.join(noGraphRepo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Senior Judgment Multi-Axis DAG without Graphify
architecture_docs:
  - docs/architecture/senior-judgment-axis.md
spec_docs:
  - docs/specs/senior-judgment-axis.md
---

# Senior Judgment Multi-Axis DAG without Graphify

## 背景

PR body output and Gate DAG agent workflow topology must be reviewable even when local Graphify artifacts are absent.

## 受け入れ基準

- [ ] Graphify absence does not block Senior first scan or Gate DAG generation
`);
  await writeFile(path.join(noGraphRepo, 'docs', 'architecture', 'senior-judgment-axis.md'), `# Senior Judgment Axis Architecture

Alternatives considered: keep route_type only, or add multi-axis judgment gates.
Compatibility impact: PR body and JSON keep existing fields while adding judgment_axes.
Rollback plan: consumers can ignore judgment_axes and continue using route_type.
Boundary: Graphify is optional and missing Graphify cannot prove or disprove correctness.
Accepted followups: route-specific enforcement can deepen after the multi-axis artifact is stable.
`);
  await writeFile(path.join(noGraphRepo, 'docs', 'specs', 'senior-judgment-axis.md'), '# Spec\n\nGraphify missing must not block Gate DAG generation.\n');
  await writeFile(path.join(noGraphRepo, 'src', 'judgment-dag.js'), 'export function buildGateDag(){ return "agent workflow pr body output"; }\n');
  await writeFile(path.join(noGraphRepo, 'test', 'judgment-dag.test.js'), 'import assert from "node:assert/strict";\nassert.match("PR body output remains compatible", /compatible/);\n');
  await git(noGraphRepo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'docs/architecture/senior-judgment-axis.md', 'docs/specs/senior-judgment-axis.md', 'src/judgment-dag.js', 'test/judgment-dag.test.js']);
  await git(noGraphRepo, ['commit', '-m', 'feat: add senior judgment axis no graph fixture']);

  const noGraphResult = await runCli(['pr', 'prepare', noGraphRepo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  assert.equal(noGraphResult.exitCode, 0);
  const noGraphPrepare = noGraphResult.result.preparation;
  assert.equal(noGraphPrepare.pr_context.graph_context.available, false);
  assert.match(noGraphPrepare.pr_context.graph_context.reason, /graphify\/graph\.json/);
  const noGraphActiveAxes = noGraphPrepare.pr_context.engineering_judgment.judgment_axes
    .filter((axis) => axis.status !== 'inactive')
    .map((axis) => axis.axis)
    .sort();
  assert.deepEqual(noGraphActiveAxes, ['public_contract']);
  assert.equal(
    noGraphPrepare.pr_context.gate_dag.summary.suppressed_judgment_axes.some((axis) => axis.axis === 'execution_topology'),
    true
  );
  assert.equal(noGraphPrepare.pr_context.gate_dag.nodes.some((node) => node.id === 'gate:judgment_axis_scope_reviewability'), false);
  assert.equal(noGraphPrepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:dag_connectivity')?.status, 'passed');
});

test('judgment axis uses accepted followup instead of passed when evidence is still missing', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Accepted Followup Axis
architecture_docs:
  - docs/architecture/followup-axis.md
spec_docs:
  - docs/specs/followup-axis.md
---

# Story

- [ ] public contract evidence may defer current verification only with an accepted decision
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'followup-axis.md'), '# Architecture\n\nCompatibility impact: PR body output changes.\nBoundary: reviewable.\n');
  await writeFile(path.join(repo, 'docs', 'specs', 'followup-axis.md'), '# Spec\n\njudgment_axes[] remains visible.\n');
  await writeFile(path.join(repo, 'src', 'followup-axis.js'), 'export const followupAxis = "pr body output";\n');
  await git(repo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'docs/architecture/followup-axis.md', 'docs/specs/followup-axis.md', 'src/followup-axis.js']);
  await git(repo, ['commit', '-m', 'feat: add followup axis fixture']);

  const decision = await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--summary',
    'current public contract behavior is safe; defer remaining verification',
    '--source',
    'gate:judgment_axis_public_contract',
    '--reason',
    'bounded follow-up tracked',
    '--artifact',
    'docs/architecture/followup-axis.md',
    '--status',
    'accepted',
    '--json'
  ]);
  assert.equal(decision.exitCode, 0);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  assert.equal(result.exitCode, 0);
  const axis = result.result.preparation.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'public_contract');
  assert.equal(axis.status, 'active_accepted_followup');
  assert.equal(axis.missing_evidence.includes('current_verification'), true);
  const gate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:judgment_axis_public_contract');
  assert.equal(gate.status, 'accepted_followup');
  assert.equal(gate.axis_status, 'active_accepted_followup');
  assert.equal(gate.missing_evidence.includes('current_verification'), true);
  assert.equal(result.result.preparation.pr_context.gate_dag.summary.judgment_axis_accepted_followup_count >= 1, true);

  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  const gateDagHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'gate-dag.html'), 'utf8');
  const prPrepareHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.html'), 'utf8');
  const reviewCockpitHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'review-cockpit.html'), 'utf8');
  assert.match(prBody, /active_accepted_followup/);
  assert.match(gateDagHtml, /accepted_followup/);
  assert.match(gateDagHtml, /gate:judgment_axis_public_contract[\s\S]{0,500}accepted_followup/);
  assert.match(prPrepareHtml, /accepted_followup/);
  assert.match(reviewCockpitHtml, /accepted_followup/);
  assert.doesNotMatch(gateDagHtml, /gate:judgment_axis_public_contract[\s\S]{0,500}passed/);
});

test('execution topology judgment axis consumes current passed agent review evidence', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    stages: {
      gate: {
        roles: ['gate_evidence', 'release_risk']
      }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'test', 'e2e'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Agent workflow topology evidence
architecture_docs:
  - docs/architecture/agent-workflow-topology.md
spec_docs:
  - docs/specs/agent-workflow-topology.md
---

# Story

## 背景

Agent workflow gate DAG review artifact lifecycle must remain reconstructable.

## 受け入れ基準

- [ ] execution_topology axis uses current Agent Review evidence instead of staying missing
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'agent-workflow-topology.md'), `# Agent Workflow Topology

Alternatives considered: infer topology only from source, or require review evidence.
Compatibility impact: Gate DAG JSON keeps existing fields while adding stronger evidence matching.
Rollback plan: remove the agent_review evidence mapping and fall back to needs_evidence.
Boundary: Agent Review artifacts are evidence, not reviewer instructions.
Accepted followups: none for the current topology evidence path.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'agent-workflow-topology.md'), '# Spec\n\nexecution_topology requires flow_replay, artifact_replay, current_verification, and agent_review evidence.\n');
  await writeFile(path.join(repo, 'src', 'agent-workflow-topology.js'), 'export const topology = "agent workflow gate dag artifact lifecycle";\n');
  await writeFile(path.join(repo, 'test', 'e2e', 'agent-workflow-topology.spec.js'), 'import assert from "node:assert/strict";\nassert.match("flow replay artifact replay scenario clause e2e", /artifact replay/);\n');
  await git(repo, [
    'add',
    'docs/management/stories/active/story-pr-prepare.md',
    'docs/architecture/agent-workflow-topology.md',
    'docs/specs/agent-workflow-topology.md',
    'src/agent-workflow-topology.js',
    'test/e2e/agent-workflow-topology.spec.js'
  ]);
  await git(repo, ['commit', '-m', 'feat: add topology evidence fixture']);
  await runCli([
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
    'node --test test/e2e/agent-workflow-topology.spec.js',
    '--summary',
    'flow replay artifact replay scenario clause e2e covered agent workflow topology',
    '--target',
    'test/e2e/agent-workflow-topology.spec.js'
  ]);
  await recordAgentReviewStage(repo, 'story-pr-prepare', 'architecture_spec', ['regression_risk']);
  await recordAgentReviewStage(repo, 'story-pr-prepare', 'test_plan', ['e2e_ux', 'gate_coverage']);
  await recordAgentReviewStage(repo, 'story-pr-prepare', 'implementation', ['runtime_contract', 'ux_completion']);
  await recordAgentReviewStage(repo, 'story-pr-prepare', 'preview', ['preview_smoke', 'network_runtime', 'human_usability']);
  await recordAgentReviewStage(repo, 'story-pr-prepare', 'gate', ['gate_evidence', 'release_risk']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const axis = result.result.preparation.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'execution_topology');
  const debugEvidence = {
    axis,
    agent_reviews: result.result.preparation.pr_context.agent_reviews
  };
  assert.equal(axis.matched_evidence.some((item) => item.kind === 'agent_review'), true, JSON.stringify(debugEvidence, null, 2));
  assert.equal(axis.missing_evidence.includes('agent_review'), false);
  const gate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:judgment_axis_execution_topology');
  assert.equal(gate.matched_evidence.some((item) => item.kind === 'agent_review'), true, JSON.stringify(gate, null, 2));
  assert.equal(gate.missing_evidence.includes('agent_review'), false);
});

test('judgment axis accepted decision without artifact remains needs evidence', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Accepted Followup Axis without artifact
architecture_docs:
  - docs/architecture/followup-axis.md
spec_docs:
  - docs/specs/followup-axis.md
---

# Story

- [ ] public contract evidence may defer current verification only with an artifact-backed accepted decision
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'followup-axis.md'), '# Architecture\n\nCompatibility impact: PR body output changes.\nBoundary: reviewable.\n');
  await writeFile(path.join(repo, 'docs', 'specs', 'followup-axis.md'), '# Spec\n\njudgment_axes[] remains visible.\n');
  await writeFile(path.join(repo, 'src', 'followup-axis.js'), 'export const followupAxis = "pr body output";\n');
  await git(repo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'docs/architecture/followup-axis.md', 'docs/specs/followup-axis.md', 'src/followup-axis.js']);
  await git(repo, ['commit', '-m', 'feat: add followup axis fixture']);

  const decision = await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--summary',
    'current public contract behavior is safe; defer remaining verification',
    '--source',
    'gate:judgment_axis_public_contract',
    '--reason',
    'bounded follow-up tracked',
    '--status',
    'accepted',
    '--json'
  ]);
  assert.equal(decision.exitCode, 0);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare']);
  assert.equal(result.exitCode, 0);
  const axis = result.result.preparation.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'public_contract');
  assert.equal(axis.status, 'active_needs_evidence');
  assert.equal(axis.missing_evidence.includes('current_verification'), true);
  assert.equal(axis.ignored_accepted_decision.missing_fields.includes('artifact'), true);
  const gate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:judgment_axis_public_contract');
  assert.equal(gate.status, 'needs_evidence');
});

test('public contract judgment axis blocks generic verification without reviewable expectation evidence', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Public Contract Block
---

# Story

- [ ] CLI output contract remains compatible when formatter changes
`);
  await writeFile(path.join(repo, 'src', 'formatter.js'), 'export function renderConfig(){ return "cli output format"; }\n');
  await git(repo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'src/formatter.js']);
  await git(repo, ['commit', '-m', 'feat: change cli output format']);
  await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'node --test test/vibepro-cli.test.js',
    '--summary',
    'broad regression suite passed',
    '--target',
    'test/vibepro-cli.test.js'
  ]);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const axis = result.result.preparation.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'public_contract');
  assert.equal(axis.status, 'active_blocked');
  assert.equal(axis.matched_blockers.some((item) => item.id === 'public_contract_traceability_missing'), true);
  assert.equal(axis.matched_blockers.some((item) => item.id === 'public_contract_expectation_unreviewed'), true);
  const gate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:judgment_axis_public_contract');
  assert.equal(gate.status, 'block');
  assert.equal(gate.axis_status, 'active_blocked');
  assert.equal(result.result.preparation.gate_status.execution_gate.pr_create_allowed, false);

  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /public_contract: active_blocked/);
  assert.match(prBody, /public_contract_traceability_missing/);
});

test('security boundary judgment axis blocks auth changes without negative path evidence', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Security Boundary Block
---

# Story

- [ ] auth permission boundary still rejects unauthorized access
`);
  await writeFile(path.join(repo, 'src', 'auth.js'), 'export function authorize(token) { return token === "root"; }\n');
  await git(repo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'src/auth.js']);
  await git(repo, ['commit', '-m', 'feat: change auth boundary']);
  await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'node --test test/vibepro-cli.test.js',
    '--summary',
    'broad auth suite passed',
    '--target',
    'test/vibepro-cli.test.js'
  ]);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const axis = result.result.preparation.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'security_boundary');
  assert.equal(axis.status, 'active_blocked');
  assert.equal(axis.matched_blockers.some((item) => item.id === 'security_boundary_negative_path_missing'), true);
  const gate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:judgment_axis_security_boundary');
  assert.equal(gate.status, 'block');
  assert.equal(gate.reason.includes('negative_path_test'), true);
});

test('release ops judgment axis blocks operator-facing release changes without owner-visible evidence', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Release Ops Block
---

# Story

- [ ] operator release workflow remains safe during rollout and rollback
`);
  await writeFile(path.join(repo, 'src', 'release-workflow.js'), 'export const releaseWorkflow = "operator rollout rollback observability";\n');
  await git(repo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'src/release-workflow.js']);
  await git(repo, ['commit', '-m', 'feat: change operator rollout workflow']);
  await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'node --test test/vibepro-cli.test.js',
    '--summary',
    'broad release regression suite passed',
    '--target',
    'test/vibepro-cli.test.js'
  ]);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const axis = result.result.preparation.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'release_ops');
  assert.equal(axis.status, 'active_blocked');
  assert.equal(axis.matched_blockers.some((item) => item.id === 'release_ops_operator_path_missing'), true);
  assert.equal(axis.matched_blockers.some((item) => item.id === 'release_ops_owner_visible_evidence_missing'), true);
  const gate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:judgment_axis_release_ops');
  assert.equal(gate.status, 'block');
  assert.equal(result.result.preparation.gate_status.execution_gate.pr_create_allowed, false);
});

test('blocker waiver keeps axis blocked but downgrades the gate from block to accepted followup', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Public Contract Blocker Waiver
---

# Story

- [ ] CLI output contract remains compatible when formatter changes
`);
  await writeFile(path.join(repo, 'src', 'formatter.js'), 'export function renderConfig(){ return "cli output format"; }\n');
  await git(repo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'src/formatter.js']);
  await git(repo, ['commit', '-m', 'feat: change cli output format with blocker waiver']);
  await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'node --test test/vibepro-cli.test.js',
    '--summary',
    'broad regression suite passed',
    '--target',
    'test/vibepro-cli.test.js'
  ]);
  const decision = await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--summary',
    'public contract blocker is temporarily waived with owner signoff',
    '--source',
    'gate:judgment_axis_public_contract',
    '--reason',
    'temporary operator-controlled rollout with linked follow-up',
    '--artifact',
    'docs/management/stories/active/story-pr-prepare.md',
    '--status',
    'accepted',
    '--json'
  ]);
  assert.equal(decision.exitCode, 0);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const axis = result.result.preparation.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'public_contract');
  assert.equal(axis.status, 'active_blocked');
  assert.equal(axis.blocker_waiver.decision_id != null, true);
  const gate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:judgment_axis_public_contract');
  assert.equal(gate.status, 'accepted_followup');
  assert.equal(gate.axis_status, 'active_blocked');
  assert.equal(gate.reason.includes('explicitly waived'), true);
});

test('pr prepare treats missing required design diagrams as critical unresolved readiness gates', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'checkout'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: PR準備
---

# PR準備

## 受け入れ基準

- [ ] checkout flowの入力画面から確認画面へ進める
- [ ] checkout flowの確認画面から完了画面へ進める
- [ ] checkout flowの失敗時は再試行できる
`);
  await writeFile(path.join(repo, 'src', 'app', 'checkout', 'page.tsx'), 'export default function Checkout() { return <button>Pay</button>; }\n');
  await git(repo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'src/app/checkout/page.tsx']);
  await git(repo, ['commit', '-m', 'feat: add checkout flow without diagram']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const designGate = result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:design_diagrams');
  assert.equal(designGate.type, 'design_diagrams_gate');
  assert.equal(designGate.required, true);
  assert.equal(designGate.blocking, true);
  assert.equal(designGate.status, 'needs_evidence');
  assert.equal(
    result.result.preparation.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:design_diagrams'),
    true
  );
  assert.equal(
    result.result.preparation.gate_status.execution_gate.blocking_gates.some((gate) => gate.id === 'gate:design_diagrams'),
    true
  );
});

test('security_trust route enforces the security regression judgment gate with evidence or waiver', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(
    path.join(repo, 'src', 'auth.js'),
    'export function checkPermission(token) { return token; }\n'
  );
  await git(repo, ['add', 'src/auth.js']);
  await git(repo, ['commit', '-m', 'feat: add auth permission token check']);

  const unresolved = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  assert.equal(unresolved.exitCode, 0);
  const prepare = unresolved.result.preparation;
  assert.equal(prepare.pr_context.engineering_judgment.route_type, 'security_trust');
  const gateDag = prepare.pr_context.gate_dag;
  const regressionGate = gateDag.nodes.find((node) => node.id === 'gate:judgment_security_trust_security_regression');
  // The security regression judgment gate is promoted to an evidence-backed gate.
  assert.equal(regressionGate?.type, 'security_regression_gate');
  assert.equal(regressionGate?.status, 'needs_evidence');
  assert.equal(regressionGate?.required, true);
  // Other security-route judgment gates stay advisory (narrow first step).
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:judgment_security_trust_threat_model')?.type, 'route_specific_judgment_gate');
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:judgment_security_trust_threat_model')?.status, 'passed');
  // It blocks PR creation and shows up as an unresolved gate.
  assert.equal(prepare.gate_status.ready_for_pr_create, false);
  assert.equal(
    prepare.gate_status.unresolved_gates.some((gate) => gate.id === 'gate:judgment_security_trust_security_regression'),
    true
  );
  // DAG stays connected after the status change.
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:dag_connectivity')?.status, 'passed');

  // An explicit waiver decision resolves the gate.
  await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:judgment_security_trust_security_regression',
    '--summary',
    'No security-sensitive boundary changed; helper only echoes its argument.',
    '--reason',
    'Reviewed: not an auth/permission boundary change, no regression test required.',
    '--reviewer',
    'codex',
    '--json'
  ]);
  const waived = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  const waivedGate = waived.result.preparation.pr_context.gate_dag.nodes
    .find((node) => node.id === 'gate:judgment_security_trust_security_regression');
  assert.equal(waivedGate?.status, 'passed');
  assert.equal(
    waived.result.preparation.gate_status.unresolved_gates.some((gate) => gate.id === 'gate:judgment_security_trust_security_regression'),
    false
  );
});

test('high-risk review pass requires inspection evidence in PR gate', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(
    path.join(repo, 'src', 'auth.js'),
    'export function checkPermission(token) { return token; }\n'
  );
  await git(repo, ['add', 'src/auth.js']);
  await git(repo, ['commit', '-m', 'feat: add auth permission token review fixture']);

  await runCli(['review', 'prepare', repo, '--id', 'story-pr-prepare', '--stage', 'gate', '--role', 'gate_evidence']);
  const record = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'security review passed after reading auth fixture',
    '--inspection-summary',
    'read src/auth.js and checked the security route fixture',
    '--inspection-input',
    'src/auth.js',
    '--judgment-delta',
    'security concern -> pass record lacks inspection evidence artifact for gate test',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'security-review-without-inspection-evidence',
    '--agent-thread-id',
    'thread-security-review-without-inspection-evidence',
    '--agent-closed'
  ]);
  assert.equal(record.exitCode, 0);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const gateDag = result.result.preparation.pr_context.gate_dag;
  const inspectionGate = gateDag.nodes.find((node) => node.id === 'gate:review_inspection_required');
  assert.equal(inspectionGate.status, 'needs_inspection');
  assert.equal(inspectionGate.high_risk, true);
  assert.equal(inspectionGate.missing_inspections[0].missing.includes('inspection_evidence'), true);
  assert.equal(
    result.result.preparation.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:review_inspection_required'),
    true
  );
});

test('agent_workflow route enforces the evidence lifecycle judgment gate with evidence or waiver', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(
    path.join(repo, 'src', 'agent-review.js'),
    'export function buildAgentReviewGate() { return "mcp subagent codex review gate dag skill"; }\n'
  );
  await git(repo, ['add', 'src/agent-review.js']);
  await git(repo, ['commit', '-m', 'feat: add agent subagent review gate']);

  const unresolved = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  assert.equal(unresolved.exitCode, 0);
  const prepare = unresolved.result.preparation;
  assert.equal(prepare.pr_context.engineering_judgment.route_type, 'agent_workflow');
  const gateDag = prepare.pr_context.gate_dag;
  const lifecycleGate = gateDag.nodes.find((node) => node.id === 'gate:judgment_agent_workflow_evidence_lifecycle');
  // The agent evidence-lifecycle judgment gate is promoted to an evidence-backed gate.
  assert.equal(lifecycleGate?.type, 'agent_evidence_lifecycle_gate');
  assert.equal(lifecycleGate?.status, 'needs_evidence');
  assert.equal(lifecycleGate?.required, true);
  // Sibling agent_workflow judgment gates stay advisory (narrow, route-axis enforcement).
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:judgment_agent_workflow_tool_boundary')?.type, 'route_specific_judgment_gate');
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:judgment_agent_workflow_tool_boundary')?.status, 'passed');
  // It blocks PR creation and shows up as an unresolved gate.
  assert.equal(prepare.gate_status.ready_for_pr_create, false);
  assert.equal(
    prepare.gate_status.unresolved_gates.some((gate) => gate.id === 'gate:judgment_agent_workflow_evidence_lifecycle'),
    true
  );
  // DAG stays connected after the status change.
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:dag_connectivity')?.status, 'passed');

  // An explicit waiver decision resolves the gate.
  await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:judgment_agent_workflow_evidence_lifecycle',
    '--summary',
    'Agent skill doc tweak; no runtime agent behavior path changed.',
    '--reason',
    'Reviewed: no behavioral agent change, recorded agent review evidence not warranted.',
    '--reviewer',
    'codex',
    '--json'
  ]);
  const waived = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  const waivedGate = waived.result.preparation.pr_context.gate_dag.nodes
    .find((node) => node.id === 'gate:judgment_agent_workflow_evidence_lifecycle');
  assert.equal(waivedGate?.status, 'passed');
  assert.equal(
    waived.result.preparation.gate_status.unresolved_gates.some((gate) => gate.id === 'gate:judgment_agent_workflow_evidence_lifecycle'),
    false
  );
});

test('secret/credential surface change enforces the safety gate with a decision or waiver', async () => {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, '.env'), 'API_KEY=abc123\n');
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'config.js'), 'export const cfg = process.env.API_KEY;\n');
  await git(repo, ['add', '.env', 'src/config.js']);
  await git(repo, ['commit', '-m', 'chore: wire api key from env']);

  const unresolved = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  assert.equal(unresolved.exitCode, 0);
  const prepare = unresolved.result.preparation;
  const gateDag = prepare.pr_context.gate_dag;
  const safetyGate = gateDag.nodes.find((node) => node.id === 'gate:safety_secret_surface');
  assert.equal(safetyGate?.type, 'safety_surface_gate');
  assert.equal(safetyGate?.status, 'needs_evidence');
  assert.equal(safetyGate?.required, true);
  assert.equal(safetyGate?.surface_files.includes('.env'), true);
  assert.equal(prepare.gate_status.ready_for_pr_create, false);
  assert.equal(
    prepare.gate_status.unresolved_gates.some((gate) => gate.id === 'gate:safety_secret_surface'),
    true
  );
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:dag_connectivity')?.status, 'passed');

  // A secret_exposure decision resolves the gate.
  await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'secret_exposure',
    '--secret-location',
    '.env:API_KEY',
    '--secret-action',
    'rotated',
    '--summary',
    'Rotated the leaked API key and updated the secret store.',
    '--reason',
    'Key rotated; .env entry is local-only and gitignored going forward.',
    '--reviewer',
    'codex',
    '--json'
  ]);
  const resolved = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  const resolvedGate = resolved.result.preparation.pr_context.gate_dag.nodes
    .find((node) => node.id === 'gate:safety_secret_surface');
  assert.equal(resolvedGate?.status, 'passed');
  assert.equal(
    resolved.result.preparation.gate_status.unresolved_gates.some((gate) => gate.id === 'gate:safety_secret_surface'),
    false
  );
});

test('safety gate stays absent for non-secret changes and env templates', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'plain.js'), 'export const plain = 1;\n');
  await writeFile(path.join(repo, '.env.example'), 'API_KEY=\n');
  await git(repo, ['add', 'src/plain.js', '.env.example']);
  await git(repo, ['commit', '-m', 'feat: plain change with env template']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  const gateDag = result.result.preparation.pr_context.gate_dag;
  assert.equal(gateDag.nodes.some((node) => node.id === 'gate:safety_secret_surface'), false);
});

async function makeRiskBearingDeployRepo() {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '14', '@prisma/client': '5' } }));
  await writeFile(path.join(repo, 'vercel.json'), '{}');
  await writeFile(path.join(repo, 'fly.toml'), 'app="api"\nprimary_region="nrt"\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: deploy config']);
  await runCli(['env', 'graph', repo]); // derive Environment Graph so deploy targets exist
  for (const f of ['src/api/route.js', 'src/ui/page.jsx', 'src/workflow/state.js', 'src/deploy.js']) {
    await mkdir(path.join(repo, path.dirname(f)), { recursive: true });
    await writeFile(path.join(repo, f), 'export const x = 1;\n');
  }
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'feat: broad workflow change']);
  return repo;
}

test('deploy verification gate fires for risk-bearing changes with deploy targets and is waivable', async () => {
  const repo = await makeRiskBearingDeployRepo();
  const unresolved = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  assert.equal(unresolved.exitCode, 0);
  const prepare = unresolved.result.preparation;
  const gateDag = prepare.pr_context.gate_dag;
  const gate = gateDag.nodes.find((node) => node.id === 'gate:deploy_verification');
  assert.equal(gate?.type, 'deploy_verification_gate');
  assert.equal(gate?.status, 'needs_evidence');
  assert.equal(gate?.required, true);
  assert.equal(gate.deploy_targets.length >= 1, true);
  assert.equal(gate.deploy_targets.some((t) => t.provider === 'vercel'), true);
  assert.equal(prepare.gate_status.ready_for_pr_create, false);
  assert.equal(prepare.gate_status.unresolved_gates.some((g) => g.id === 'gate:deploy_verification'), true);
  // edges wired -> connectivity holds
  assert.equal(gateDag.edges.some((e) => e.from === 'gate:pr_route_classification' && e.to === 'gate:deploy_verification'), true);
  assert.equal(gateDag.edges.some((e) => e.from === 'gate:deploy_verification' && e.to === 'gate:pr_body_contract'), true);
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:dag_connectivity')?.status, 'passed');

  await runCli([
    'decision', 'record', repo,
    '--id', 'story-pr-prepare',
    '--type', 'waiver',
    '--source', 'gate:deploy_verification',
    '--summary', 'Staging smoke check passed; prod rollout tracked in release ticket.',
    '--reason', 'Deploy verified on staging for this change; production rollout tracked out-of-band.',
    '--reviewer', 'codex',
    '--json'
  ]);
  const waived = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  const waivedGate = waived.result.preparation.pr_context.gate_dag.nodes
    .find((node) => node.id === 'gate:deploy_verification');
  assert.equal(waivedGate?.status, 'passed');
  assert.equal(waived.result.preparation.gate_status.unresolved_gates.some((g) => g.id === 'gate:deploy_verification'), false);
});

test('deploy verification gate is absent without deploy targets or for low-risk changes', async () => {
  const noGraph = await makeGitRepoWithStory();
  for (const f of ['src/api/route.js', 'src/ui/page.jsx', 'src/workflow/state.js', 'src/deploy.js']) {
    await mkdir(path.join(noGraph, path.dirname(f)), { recursive: true });
    await writeFile(path.join(noGraph, f), 'export const x = 1;\n');
  }
  await git(noGraph, ['add', '-A']);
  await git(noGraph, ['commit', '-m', 'feat: broad change, no deploy config']);
  const a = await runCli(['pr', 'prepare', noGraph, '--base', 'main']);
  assert.equal(a.result.preparation.pr_context.gate_dag.nodes.some((n) => n.id === 'gate:deploy_verification'), false);

  const lowRisk = await makeGitRepoWithStory();
  await writeFile(path.join(lowRisk, 'package.json'), JSON.stringify({ dependencies: { next: '14' } }));
  await writeFile(path.join(lowRisk, 'vercel.json'), '{}');
  await git(lowRisk, ['add', '-A']);
  await git(lowRisk, ['commit', '-m', 'chore: deploy config']);
  await runCli(['env', 'graph', lowRisk]);
  await mkdir(path.join(lowRisk, 'src'), { recursive: true });
  await writeFile(path.join(lowRisk, 'src', 'tiny.js'), 'export const tiny = 1;\n');
  await git(lowRisk, ['add', '-A']);
  await git(lowRisk, ['commit', '-m', 'chore: tiny change']);
  const b = await runCli(['pr', 'prepare', lowRisk, '--base', 'main']);
  assert.equal(b.result.preparation.pr_context.gate_dag.nodes.some((n) => n.id === 'gate:deploy_verification'), false);
});

async function makeSchedulerStoryRepo() {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 't@e.com']);
  await git(repo, ['config', 'user.name', 'T']);
  // "Recurring ... workflow" trips the scheduler shape detector while NOT
  // containing any keyword that would mark scheduling_owner/job_infrastructure
  // as covered, so both dimensions are genuinely missing.
  await runCli(['init', repo, '--story-id', 'story-pr-prepare', '--title', 'Recurring batch sync workflow', '--view', 'dev', '--period', '2026-W18']);
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: init']);
  await git(repo, ['switch', '-c', 'feature/x']);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'sync.js'), 'export const sync = 1;\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'feat: sync']);
  return repo;
}

test('architecture blueprint gate blocks scheduler stories missing scheduling/infra dimensions (issue #128)', async () => {
  const repo = await makeSchedulerStoryRepo();
  const unresolved = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  assert.equal(unresolved.exitCode, 0);
  const gateDag = unresolved.result.preparation.pr_context.gate_dag;
  // The blueprint gate is independent of the Architecture Gate: it fires on
  // story shape regardless of the Architecture Gate's own status.
  const architectureStatus = gateDag.nodes.find((n) => n.id === 'architecture')?.status;
  const blueprint = gateDag.nodes.find((n) => n.id === 'gate:architecture_blueprint');
  assert.equal(blueprint?.type, 'architecture_blueprint_gate');
  assert.equal(blueprint?.status, 'needs_evidence');
  assert.deepEqual(blueprint.missing_dimensions.map((d) => d.id).sort(), ['job_infrastructure', 'scheduling_owner']);
  // Independence: the blueprint gate blocks even though the Architecture Gate
  // is not itself failing in a way that masks it (it is satisfied or needs_review).
  assert.ok(['satisfied', 'needs_review'].includes(architectureStatus));
  assert.equal(unresolved.result.preparation.gate_status.ready_for_pr_create, false);
  assert.equal(unresolved.result.preparation.gate_status.unresolved_gates.some((g) => g.id === 'gate:architecture_blueprint'), true);
  assert.equal(gateDag.nodes.find((n) => n.id === 'gate:dag_connectivity')?.status, 'passed');

  await runCli([
    'decision', 'record', repo, '--id', 'story-pr-prepare', '--type', 'waiver',
    '--source', 'gate:architecture_blueprint',
    '--summary', 'scheduling=launchd local; server jobs=fly worker',
    '--reason', 'documented out of band', '--reviewer', 'codex', '--json'
  ]);
  const waived = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  assert.equal(waived.result.preparation.pr_context.gate_dag.nodes.find((n) => n.id === 'gate:architecture_blueprint')?.status, 'passed');
});

test('architecture blueprint gate is satisfied when the architecture doc covers the dimensions, and absent for non-scheduler stories', async () => {
  const covered = await makeSchedulerStoryRepo();
  await mkdir(path.join(covered, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(covered, 'docs', 'architecture', 'runner.md'),
    '# Arch\nScheduling is run by launchd cron locally; server-side scheduled jobs run on Fly machine worker infrastructure.\n');
  await git(covered, ['add', '-A']);
  await git(covered, ['commit', '-m', 'docs: architecture']);
  const a = await runCli(['pr', 'prepare', covered, '--base', 'main']);
  assert.equal(a.result.preparation.pr_context.gate_dag.nodes.find((n) => n.id === 'gate:architecture_blueprint')?.status, 'passed');

  const plain = await makeGitRepoWithStory();
  await mkdir(path.join(plain, 'src'), { recursive: true });
  await writeFile(path.join(plain, 'src', 'profile.js'), 'export const p = 1;\n');
  await git(plain, ['add', '-A']);
  await git(plain, ['commit', '-m', 'feat: profile']);
  const b = await runCli(['pr', 'prepare', plain, '--base', 'main']);
  assert.equal(b.result.preparation.pr_context.gate_dag.nodes.some((n) => n.id === 'gate:architecture_blueprint'), false);
});

test('pr prepare adds mirror route traceability and CI gates before PR creation', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'mirror.js'), 'export const mirror = true;\n');
  await git(repo, ['add', 'src/mirror.js']);
  await git(repo, ['commit', '-m', 'sync: deploy mirror']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);

  assert.equal(result.exitCode, 0);
  const prepare = result.result.preparation;
  assert.equal(prepare.pr_context.pr_route.route_type, 'mirror_sync');
  const gateDag = prepare.pr_context.gate_dag;
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:mirror_source_traceability')?.status, 'needs_evidence');
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:ci_status_or_waiver')?.status, 'needs_evidence');
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:pr_body_contract')?.status, 'needs_review');
  assert.equal(prepare.gate_status.ready_for_pr_create, false);
  assert.equal(prepare.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:mirror_source_traceability'), true);
  assert.match(prepare.gate_status.next_required_actions.join('\n'), /source PR, source commit, or upstream ref/i);

  await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:mirror_source_traceability',
    '--summary',
    'Source PR is https://github.com/Unson-LLC/vibepro/pull/100.',
    '--reason',
    'This mirror sync is copied from the cited source PR.',
    '--reviewer',
    'codex',
    '--json'
  ]);
  await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:ci_status_or_waiver',
    '--summary',
    'Source CI passed on the upstream PR; target CI is inherited for this mirror sync.',
    '--reason',
    'The target branch mirrors the upstream checked commit without runtime edits.',
    '--reviewer',
    'codex',
    '--json'
  ]);
  const resolved = await runCli(['pr', 'prepare', repo, '--base', 'main']);
  const resolvedDag = resolved.result.preparation.pr_context.gate_dag;
  assert.equal(resolvedDag.nodes.find((node) => node.id === 'gate:mirror_source_traceability')?.status, 'passed');
  assert.equal(resolvedDag.nodes.find((node) => node.id === 'gate:ci_status_or_waiver')?.status, 'passed');
  assert.equal(resolvedDag.nodes.find((node) => node.id === 'gate:pr_body_contract')?.status, 'passed');

  const releaseRepo = await makeGitRepoWithStory();
  await mkdir(path.join(releaseRepo, 'src'), { recursive: true });
  await writeFile(path.join(releaseRepo, 'src', 'release.js'), 'export const release = true;\n');
  await git(releaseRepo, ['add', 'src/release.js']);
  await git(releaseRepo, ['commit', '-m', 'release: promote merge']);
  const release = await runCli(['pr', 'prepare', releaseRepo, '--base', 'main']);
  assert.equal(release.exitCode, 0);
  assert.equal(release.result.preparation.pr_context.pr_route.route_type, 'release_merge');
  const releaseDag = release.result.preparation.pr_context.gate_dag;
  assert.equal(releaseDag.nodes.find((node) => node.id === 'gate:mirror_source_traceability')?.status, 'needs_evidence');
  assert.equal(releaseDag.nodes.find((node) => node.id === 'gate:ci_status_or_waiver')?.status, 'needs_evidence');
});

test('pr prepare resolves committed VibePro artifact policy through decision records', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, '.vibepro', 'diagnostics'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'diagnostics', 'note.json'), '{"status":"sample"}\n');
  await git(repo, ['add', '-f', '.vibepro/diagnostics/note.json']);
  await git(repo, ['commit', '-m', 'docs: keep vibepro diagnostic artifact']);
  await writeFile(path.join(repo, '.vibepro', 'diagnostics', 'note.json'), '{"status":"dirty-local-edit"}\n');

  const blocked = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(blocked.exitCode, 0);
  assert.equal(blocked.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:vibepro_artifact_policy')?.status, 'needs_review');
  assert.equal(blocked.result.preparation.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:vibepro_artifact_policy'), true);
  assert.deepEqual(blocked.result.preparation.file_groups.vibepro_artifacts.files, ['.vibepro/diagnostics/note.json']);

  await runCli([
    'decision',
    'record',
    repo,
    '--id',
    'story-pr-prepare',
    '--type',
    'waiver',
    '--source',
    'gate:vibepro_artifact_policy',
    '--summary',
    'This diagnostic artifact is intentionally committed as review evidence.',
    '--reason',
    'The artifact is small, non-secret, and documents this Story gate behavior.',
    '--reviewer',
    'codex',
    '--json'
  ]);
  const resolved = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(resolved.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:vibepro_artifact_policy')?.status, 'passed');
});

test('pr create blocks non-workspace dirty files before creating push-only PR evidence', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'dirty.js'), 'export const dirty = true;\n');

  let stderrOutput = '';
  const result = await runCli([
    'pr',
    'create',
    repo,
    '--base',
    'main',
    '--story-id',
    'story-pr-prepare',
    '--dry-run',
    '--allow-needs-verification',
    '--verification-waiver',
    'dirty guard should run before PR creation'
  ], {
    stderr: { write: (text) => { stderrOutput += text; } }
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderrOutput, /Pre-create dirty worktree check failed/);
  assert.match(stderrOutput, /src\/dirty\.js/);
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

test('network contract scanner detects ExampleTravel-style API route regression and clears after route exists', async () => {
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
  assert.match(listOutput, /# Storyタスク/);
  assert.match(listOutput, /VP-TASK-API-001/);
  assert.match(listOutput, /queue\(2\)/);

  let showOutput = '';
  const showResult = await runCli(['task', 'show', repo, '--task', 'VP-TASK-API-001'], {
    stdout: { write: (text) => { showOutput += text; } }
  });
  assert.equal(showResult.exitCode, 0);
  assert.match(showOutput, /## 対象グループ/);
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
  assert.match(briefingMarkdown, /## Source整合性の検出事項/);
  assert.doesNotMatch(briefingMarkdown, /## Source Alignment Findings/);
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
  assert.equal(executionResult.result.execution.checkpoint_plan.model, 'progressive_gate_plan');
  assert.equal(executionResult.result.execution.checkpoint_plan.stages.some((stage) => stage.stage === 'implementation-start'), true);
  assert.equal(
    executionResult.result.execution.commands.checkpoints.implementation_start,
    'npx vibepro checkpoint implementation-start . --story-id story-vibepro-diagnosis-commercialization-roadmap --task VP-TASK-API-001 --group queue --base origin/develop'
  );
  assert.equal(
    executionResult.result.execution.commands.review_prepare.implementation_start.includes('npx vibepro review prepare . --id story-vibepro-diagnosis-commercialization-roadmap --stage planning_spec'),
    true
  );
  assert.equal(
    executionResult.result.execution.commands.review_prepare.implementation_complete.includes('npx vibepro review prepare . --id story-vibepro-diagnosis-commercialization-roadmap --stage implementation'),
    true
  );
  assert.equal(executionResult.result.execution.phases.some((phase) => phase.id === 'prepare_pr'), true);
  const phaseIds = executionResult.result.execution.phases.map((phase) => phase.id);
  assert.equal(phaseIds.indexOf('implementation_start_checkpoint') < phaseIds.indexOf('implement'), true);
  assert.equal(phaseIds.indexOf('test_plan_checkpoint') < phaseIds.indexOf('implement'), true);
  assert.equal(phaseIds.indexOf('implementation_complete_checkpoint') > phaseIds.indexOf('verify'), true);
  assert.equal(phaseIds.indexOf('verification_checkpoint') < phaseIds.indexOf('prepare_pr'), true);
  assert.equal(phaseIds.indexOf('pr_checkpoint') > phaseIds.indexOf('prepare_pr'), true);
  const executionJson = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'execution.json'));
  assert.equal(executionJson.references.handoff_json, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/handoff.json');
  assert.equal(executionJson.checkpoint_plan.principle.includes('最終整合性確認'), true);
  const executionMarkdown = await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'execution.md'), 'utf8');
  assert.match(executionMarkdown, /# 実行セッション/);
  assert.match(executionMarkdown, /## Progressive Gate Plan/);
  assert.match(executionMarkdown, /npx vibepro checkpoint implementation-start/);
  assert.match(executionMarkdown, /npx vibepro review prepare \. --id story-vibepro-diagnosis-commercialization-roadmap --stage planning_spec/);
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

test('SRA-SC-1 SRA-CON-4 SRA-SC-2 SRA-SC-3 SRA-INV-3 SRA-AP-2 SRA-SC-4 usage report aggregates subagent ROI with VibePro artifacts, optional logs, and localized text', async () => {
  const repo = await makeGitRepoWithStory();
  const storyId = 'story-pr-prepare';
  await mkdir(path.join(repo, '.vibepro', 'pr', storyId), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'reviews', storyId, 'gate'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'executions', storyId), { recursive: true });
  await mkdir(path.join(repo, 'logs'), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    story: { story_id: storyId },
    created_at: '2026-06-02T00:00:00.000Z',
    gate_status: {
      overall_status: 'needs_verification',
      ready_for_pr_create: false,
      execution_gate: { waiver_required: false },
      critical_unresolved_gates: [{ id: 'gate:agent_review' }]
    }
  });
  await writeJson(path.join(repo, '.vibepro', 'pr', storyId, 'pr-create.json'), {
    story: { story_id: storyId },
    created_at: '2026-06-02T00:10:00.000Z',
    pr_url: 'https://github.example.test/unson/vibepro/pull/1',
    gate_override: {
      allowed: true,
      unresolved_gates: [{ id: 'gate:decision_record' }]
    }
  });
  await writeJson(path.join(repo, '.vibepro', 'pr', storyId, 'gate-dag.json'), {
    story_id: storyId,
    generated_at: '2026-06-02T00:05:00.000Z',
    nodes: [
      { id: 'gate:agent_review', status: 'needs_review' },
      { id: 'gate:decision_record', status: 'bypassed' }
    ]
  });
  await writeJson(path.join(repo, '.vibepro', 'reviews', storyId, 'gate', 'review-summary.json'), {
    story_id: storyId,
    stage: 'gate',
    updated_at: '2026-06-02T00:06:00.000Z',
    roles: [{
      role: 'gate_evidence',
      status: 'block',
      effective_status: 'block',
      findings: [{
        severity: 'high',
        id: 'roi-risk',
        detail: 'subagent caught a merge-blocking risk'
      }],
      finding_dispositions: [{
        finding_id: 'roi-risk',
        disposition: 'accepted',
        resolved_by: ['commit abc1234'],
        reason: 'implemented before merge'
      }],
      agent_usage: {
        input_tokens: 1000,
        output_tokens: 500,
        total_tokens: 1500,
        cost_usd: 0.25
      },
      agent_provenance: {
        system: 'codex',
        execution_mode: 'parallel_subagent',
        agent_id: 'agent-roi',
        evidence_strength: 'strong',
        cost_tier: 'high',
        lifecycle: { agent_closed: true }
      },
      inspection: {
        inputs: ['src/usage-report.js']
      },
      judgment_delta: ['initial pass -> block because reviewed artifacts exposed a merge risk'],
      lifecycle: {
        effective_status: 'closed',
        closed_count: 1,
        timed_out_count: 0,
        replaced_count: 0,
        latest: {
          agent_id: 'agent-roi',
          status: 'closed',
          effective_status: 'closed',
          elapsed_ms: 120000
        }
      }
    }],
    pass_count: 0,
    block_count: 1,
    stale_count: 1,
    lifecycle: {
      timed_out_count: 1,
      replaced_count: 1,
      entries: [{
        role: 'gate_evidence',
        agent_id: 'agent-roi',
        status: 'closed',
        effective_status: 'closed',
        elapsed_ms: 120000
      }]
    }
  });
  await writeJson(path.join(repo, '.vibepro', 'reviews', storyId, 'gate', 'review-result-pr_split_scope.json'), {
    story_id: storyId,
    stage: 'gate',
    role: 'pr_split_scope',
    status: 'pass',
    effective_status: 'pass',
    recorded_at: '2026-06-02T00:06:30.000Z',
    findings: [],
    finding_dispositions: [],
    agent_usage: {
      input_tokens: 400,
      output_tokens: 100
    },
    agent_provenance: {
      system: 'codex',
      execution_mode: 'parallel_subagent',
      agent_id: 'agent-pass-only',
      evidence_strength: 'strong',
      lifecycle: { agent_closed: true }
    },
    inspection: {
      inputs: []
    },
    judgment_delta: []
  });
  await writeJson(path.join(repo, '.vibepro', 'reviews', storyId, 'gate', 'review-result-release_risk.json'), {
    story_id: storyId,
    stage: 'gate',
    role: 'release_risk',
    status: 'needs_changes',
    effective_status: 'needs_changes',
    recorded_at: '2026-06-02T00:06:40.000Z',
    findings: [{
      severity: 'medium',
      id: 'duplicate-risk',
      detail: 'same risk as another reviewer'
    }, {
      severity: 'low',
      id: 'false-positive-risk',
      detail: 'later judged noisy'
    }],
    finding_dispositions: [{
      finding_id: 'duplicate-risk',
      disposition: 'duplicate',
      reason: 'covered by gate_evidence'
    }, {
      finding_id: 'false-positive-risk',
      disposition: 'false_positive',
      reason: 'artifact was stale test fixture'
    }],
    agent_provenance: {
      system: 'claude_code',
      execution_mode: 'parallel_subagent',
      agent_id: 'agent-noisy-risk',
      evidence_strength: 'strong',
      lifecycle: { agent_closed: true }
    },
    inspection: {
      inputs: ['.vibepro/reviews/story-pr-prepare/gate/review-result-release_risk.json']
    },
    judgment_delta: ['initial risk -> needs_changes, then dispositions marked duplicate/noise'],
    lifecycle: {
      timed_out_count: 1,
      latest: {
        agent_id: 'agent-noisy-risk',
        status: 'running',
        effective_status: 'timed_out'
      }
    }
  });
  await writeJson(path.join(repo, '.vibepro', 'reviews', storyId, 'gate', 'review-result-human_manual.json'), {
    story_id: storyId,
    stage: 'gate',
    role: 'human_manual',
    status: 'pass',
    recorded_at: '2026-06-02T00:06:50.000Z',
    agent_provenance: {
      system: 'human',
      execution_mode: 'manual_review',
      agent_id: 'human-reviewer',
      evidence_strength: 'strong'
    },
    judgment_delta: ['manual note should not enter subagent ROI']
  });
  await writeJson(path.join(repo, '.vibepro', 'executions', storyId, 'state.json'), {
    story_id: storyId,
    updated_at: '2026-06-02T00:07:00.000Z',
    completion_status: 'blocked'
  });
  await writeFile(path.join(repo, 'logs', 'codex.log'), [
    'story-pr-prepare used vibepro pr prepare . --story-id story-pr-prepare',
    'story-pr-prepare ToolCall: multi_agent_v1spawn_agent {"agent_type":"explorer"} thread_id=coordinator-thread',
    'story-pr-prepare ToolCall: multi_agent_v1wait_agent {"targets":["agent-roi"]} thread_id=coordinator-thread',
    'story-pr-prepare ToolCall: multi_agent_v1close_agent {"target":"agent-roi"} thread_id=coordinator-thread',
    'story-other fallback mentioned raw `gh pr create` in notes',
    'story-other also mentioned `vibepro pr create` in notes',
    'story-pr-prepare manual fallback mentioned gh pr create --base main --head feature/test-story'
  ].join('\n'));

  const result = await runCli(['usage', 'report', repo, '--since', '2026-06-01', '--log', 'logs/codex.log', '--subagent-roi', '--json']);
  assert.equal(result.exitCode, 0);
  const story = result.result.stories.find((item) => item.story_id === storyId);
  assert.equal(story.prepared, true);
  assert.equal(story.blocked, true);
  assert.equal(story.ready_for_pr_create, false);
  assert.equal(story.pr_created, true);
  assert.equal(story.waiver_required, true);
  assert.equal(story.raw_pr_bypass_suspected, true);
  assert.equal(result.result.gate_metrics.find((gate) => gate.gate_id === 'gate:agent_review').block_count, 1);
  assert.equal(result.result.gate_metrics.find((gate) => gate.gate_id === 'gate:agent_review').critical_unresolved_count, 1);
  assert.equal(result.result.gate_metrics.find((gate) => gate.gate_id === 'gate:decision_record').waiver_count, 2);
  assert.equal(result.result.agent_review.totals.required_role_count, 1);
  assert.equal(result.result.agent_review.totals.pass_count, 0);
  assert.equal(result.result.agent_review.totals.block_count, 1);
  assert.equal(result.result.agent_review.totals.timeout_count, 1);
  assert.equal(result.result.agent_review.totals.replaced_count, 1);
  assert.equal(result.result.agent_review.totals.stale_count, 1);
  assert.equal(result.result.subagent_roi.summary.total_reviews, 3);
  assert.equal(result.result.subagent_roi.summary.high_value_review_count, 1);
  assert.equal(result.result.subagent_roi.summary.low_value_review_count, 2);
  assert.equal(result.result.subagent_roi.summary.accepted_finding_count, 1);
  assert.equal(result.result.subagent_roi.summary.resolved_finding_count, 1);
  assert.equal(result.result.subagent_roi.summary.duplicate_finding_count, 1);
  assert.equal(result.result.subagent_roi.summary.false_positive_finding_count, 1);
  assert.equal(result.result.subagent_roi.summary.pass_only_no_judgment_delta_count, 1);
  assert.equal(result.result.subagent_roi.summary.timed_out_review_count, 1);
  assert.equal(result.result.subagent_roi.summary.total_agent_minutes, 2);
  assert.equal(result.result.subagent_roi.summary.total_tokens, 2000);
  assert.equal(result.result.subagent_roi.summary.token_observed_review_count, 2);
  assert.equal(result.result.subagent_roi.summary.token_missing_review_count, 1);
  assert.equal(result.result.subagent_roi.by_review[0].value_band, 'high');
  const directResultReview = result.result.subagent_roi.by_review.find((review) => review.role === 'pr_split_scope');
  assert.equal(directResultReview.source_kind, 'review_result');
  assert.equal(directResultReview.artifact, '.vibepro/reviews/story-pr-prepare/gate/review-result-pr_split_scope.json');
  assert.equal(directResultReview.cost.total_tokens, 500);
  assert.equal(directResultReview.waste_signals.includes('pass_only_no_judgment_delta'), true);
  const noisyReview = result.result.subagent_roi.by_review.find((review) => review.role === 'release_risk');
  assert.equal(noisyReview.waste_signals.includes('duplicate_finding'), true);
  assert.equal(noisyReview.waste_signals.includes('false_positive_finding'), true);
  assert.equal(noisyReview.waste_signals.includes('timed_out_lifecycle'), true);
  assert.equal(result.result.subagent_roi.by_review.some((review) => review.role === 'human_manual'), false);
  assert.equal(result.result.log_signals.raw_pr_create_mentions.length, 2);
  assert.equal(result.result.log_signals.raw_pr_create_mentions.some((mention) => mention.story_id === 'story-other'), true);
  assert.equal(result.result.log_signals.vibepro_command_mentions.length, 2);
  assert.equal(result.result.log_signals.vibepro_command_mentions.some((mention) => mention.command === 'vibepro pr create'), true);
  assert.equal(result.result.log_signals.subagent_activity_mentions.length, 3);
  assert.equal(result.result.log_signals.subagent_activity_mentions.some((mention) => mention.kind === 'wait' && mention.agent_ids.includes('agent-roi')), true);
  assert.equal(result.result.log_signals.subagent_activity_mentions.some((mention) => mention.kind === 'close' && mention.agent_ids.includes('agent-roi')), true);

  let stdoutOutput = '';
  const textResult = await runCli(['usage', 'report', repo, '--log', 'logs/codex.log', '--subagent-roi'], {
    stdout: { write: (text) => { stdoutOutput += text; } }
  });
  assert.equal(textResult.exitCode, 0);
  assert.match(stdoutOutput, /# VibePro利用状況レポート/);
  assert.match(stdoutOutput, /raw_pr_bypass_suspected=true/);
  assert.match(stdoutOutput, /## Subagent ROI/);
});

test('usage report warns when an empty linked worktree may hide artifacts in another checkout', async () => {
  const repo = await makeGitRepoWithStory();
  const storyId = 'story-pr-prepare';
  await mkdir(path.join(repo, '.vibepro', 'pr', storyId), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'pr', storyId, 'pr-create.json'), {
    story: { story_id: storyId },
    created_at: '2026-06-02T00:10:00.000Z',
    pr_url: 'https://github.example.test/unson/vibepro/pull/1'
  });

  const linkedWorktree = await mkdtemp(path.join(os.tmpdir(), 'vibepro-empty-worktree-'));
  await rm(linkedWorktree, { recursive: true, force: true });
  await git(repo, ['worktree', 'add', '--detach', linkedWorktree, 'HEAD']);

  const result = await runCli(['usage', 'report', linkedWorktree, '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.artifact_counts.pr, 0);
  assert.equal(result.result.stories.length, 0);
  assert.equal(result.result.artifact_source_hints.status, 'possible_worktree_false_negative');
  const candidate = result.result.artifact_source_hints.candidates.find((item) => item.artifact_counts.pr === 1);
  assert.ok(candidate);
  assert.equal(candidate.artifact_counts.pr, 1);

  const textResult = await runCliWithStdout(['usage', 'report', linkedWorktree]);
  assert.equal(textResult.exitCode, 0);
  assert.match(textResult.stdout, /artifact source warning/);
  assert.match(textResult.stdout, /pr=1 review=0 execution=0/);
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
  assert.equal(evidence.output.language, 'ja');
  assert.equal(evidence.toolchain.package.name, 'vibepro');
  assert.match(summary, /VibePro Runtime/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_run, '2026-04-28T120000Z');
  assert.equal(manifest.runs[0].toolchain.package.name, 'vibepro');
  assert.equal(manifest.runs[0].artifacts.summary, '.vibepro/diagnostics/2026-04-28T120000Z/summary.md');
  assert.equal(manifest.runs[0].artifacts.requirement_consistency, '.vibepro/diagnostics/2026-04-28T120000Z/requirement-consistency.md');
});

test('diagnose scopes requirement consistency to inferred spec code refs for selected story', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-selected-scope', '--title', 'Selected story scope']);
  await mkdir(path.join(repo, 'src', 'lib', 'candidate'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'v1', 'hotels', 'search'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'candidate', 'value-parser.ts'), `
export function parseCandidateValue(candidate) {
  if (candidate.kind === 'room') {
    return { id: candidate.id, status: 'parsed-room' };
  }
  return { id: candidate.id, status: 'parsed' };
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'v1', 'hotels', 'search', 'route.ts'), `
export async function GET(auth) {
  if (!auth.authorized) {
    return Response.json({ message: 'unauthorized' }, { status: 401 });
  }
  return Response.json({ hotels: [] });
}
`);
  await writeInferredSpec(repo, 'story-selected-scope', {
    schema_version: '0.1.0',
    story_id: 'story-selected-scope',
    clauses: [
      {
        id: 'INV-001',
        type: 'invariant',
        statement: 'Selected story candidate value parsing is limited to the Candidate Layer parser file.',
        origin: {
          code_refs: [{ file: 'src/lib/candidate/value-parser.ts', anchor: 'parseCandidateValue' }]
        },
        verifiable_by: {
          code_pattern: [{ file_glob: 'src/lib/candidate/value-parser.ts', must_contain: 'parseCandidateValue' }]
        }
      }
    ],
    open_questions: []
  });
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'candidate-parser', file: 'src/lib/candidate/value-parser.ts' },
      { id: 'legacy-hotel-search', file: 'src/app/api/v1/hotels/search/route.ts' }
    ],
    links: []
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-04-28T130000Z']);

  assert.equal(result.exitCode, 0);
  const evidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T130000Z', 'evidence.json'));
  assert.equal(evidence.requirement_consistency.status, 'pass');
  assert.deepEqual(
    evidence.requirement_consistency.code_scenarios.map((scenario) => scenario.file),
    ['src/lib/candidate/value-parser.ts']
  );
  assert.equal(
    evidence.requirement_consistency.code_scenarios.some((scenario) => scenario.file.includes('hotels/search')),
    false
  );
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-REQ-002'), false);
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
export default function Page() { return <main>OutreachSuite</main>; }
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
  assert.match(await readFile(importSummaryPath, 'utf8'), /Portfolio Dashboard import state/);
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
        title: 'Portfolio dashboard import',
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
    'export default function Page() { return <main>OutreachSuite</main>; }\n');
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
  assert.doesNotMatch(serialized, /ExampleTravel|ホテル|旅行|hotel|shadow-call/i);
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
  await mkdir(path.join(repo, 'src', 'lib', 'services', 'profile'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'features'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'session_learning.py'), 'def load_session(): return None\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'profile', 'profile_score.py'), 'def score_profile(): return 0\n');
  await writeFile(path.join(repo, 'docs', 'features', 'auth.md'), `---
story_id: story-product-auth-account-access
---

# Auth Story

User-facing account access is an explicit product requirement.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'profile.md'), `---
story_id: story-product-profile-personalization
---

# Profile Story

Profile personalization is an explicit product requirement.
`);
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'session', source_file: 'src/session_learning.py', label: 'load_session' },
      { id: 'profile_code', source_file: 'src/lib/services/profile/profile_score.py', label: 'profile_score' },
      { id: 'auth_doc', source_file: 'docs/features/auth.md', label: 'Auth Story' },
      { id: 'profile_doc', source_file: 'docs/specs/profile.md', label: 'Profile Story' }
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

  const profileStory = catalog.stories.find((item) => item.story_id === 'story-product-profile-personalization');
  assert.ok(profileStory, `expected doc-promoted profile story, got ${catalog.stories.map((item) => item.story_id).join(', ')}`);
  assert.equal(profileStory.source.paths.includes('docs/specs/profile.md'), true);
  assert.equal(profileStory.source.paths.some((item) => item.startsWith('src/')), false);
  assert.equal(JSON.stringify(profileStory.derived?.story_definition ?? {}).includes('src/lib/services/profile/profile_score.py'), false);
  assert.equal(JSON.stringify(profileStory.derived?.story_definition ?? {}).includes('src/session_learning.py'), false);
});

test('story contract flags ambiguous internal authorization documents before product auth implementation', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'scripts'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'authorization_scoring.py'), 'def score_authorization(): return "advisory"\n');
  await writeFile(path.join(repo, 'scripts', 'run_authorization_audit.py'), 'print("audit")\n');
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-vibepro-pr-prepare-authorization-scoring.md'), `---
story_id: story-vibepro-pr-prepare-authorization-scoring
title: VibePro pr prepare should embed authorization scoring next to gate_status
---

# Story

VibePro should expose authorization scoring in pr prepare artifacts for reviewers.
This is internal developer tooling, not a user-facing account access feature.
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'vibepro-pr-prepare-authorization-scoring.md'), `---
story_id: story-vibepro-pr-prepare-authorization-scoring
---

# Spec

authorization_scoring is advisory metadata next to gate_status.
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'vibepro-pr-prepare-authorization-scoring.md'), `---
story_id: story-vibepro-pr-prepare-authorization-scoring
---

# Architecture

The authorization scoring module is called from pr prepare.
`);
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'authorization_scoring', source_file: 'src/authorization_scoring.py', label: 'score_authorization' },
      { id: 'authorization_story', source_file: 'docs/management/stories/active/story-vibepro-pr-prepare-authorization-scoring.md', label: 'authorization scoring story' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.repo_profile.product_surface_applicable, false);
  const authStory = catalog.stories.find((item) => item.story_id === 'story-product-auth-account-access');
  assert.ok(authStory, `expected doc-promoted auth story, got ${catalog.stories.map((item) => item.story_id).join(', ')}`);
  assert.equal(authStory.source.paths.some((item) => item.startsWith('src/')), false);
  assert.equal(authStory.derived.story_contract.status, 'needs_clarification');
  assert.equal(authStory.derived.story_contract.story_type, 'new_capability');
  const sourceRoleCheck = authStory.derived.story_contract.checks.find((check) => check.id === 'source_role_integrity');
  assert.equal(sourceRoleCheck.status, 'needs_clarification');
  assert.equal(sourceRoleCheck.evidence.doc_story_ids.includes('story-vibepro-pr-prepare-authorization-scoring'), true);
  assert.equal(authStory.derived.open_questions.some((item) => item.field === 'story_contract_source_role'), true);
  assert.equal(catalog.open_questions.some((item) => item.story_id === 'story-product-auth-account-access' && item.field === 'story_contract_source_role'), true);

  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /Story Contract/);
  assert.match(map, /contract_needs_clarification/);

  await runCli(['story', 'plan', repo, '--limit', '5']);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  assert.equal(plan.questions.some((question) => question.field === 'story_contract_source_role'), true);
  assert.equal(plan.source_alignment_findings.items.some((finding) => finding.type === 'story_contract_source_role_mismatch'), true);
  assert.equal(plan.task_candidates.some((task) => task.id === 'story-product-auth-account-access-story-contract-recovery'), true);
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

test('package metadata and README are ready for Apache-2.0 OSS publication', async () => {
  const packageJson = await readJson(path.resolve('package.json'));
  const readme = await readFile(path.resolve('README.md'), 'utf8');
  const readmeJa = await readFile(path.resolve('README.ja.md'), 'utf8');
  const license = await readFile(path.resolve('LICENSE'), 'utf8');
  const requiredOpsFiles = [
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md',
    'CHANGELOG.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml',
    '.github/ISSUE_TEMPLATE/false_positive.yml',
    '.github/workflows/ci.yml'
  ];

  assert.equal(packageJson.license, 'Apache-2.0');
  assert.equal(packageJson.version, '0.1.0-beta.0');
  assert.match(packageJson.description, /Product-intent gates/);
  assert.equal(packageJson.keywords.includes('ai-agents'), true);
  assert.equal(packageJson.keywords.includes('developer-tools'), true);
  assert.equal(packageJson.keywords.includes('software-quality'), true);
  assert.equal(packageJson.publishConfig.access, 'public');
  assert.equal(packageJson.files.includes('docs/releases'), false);
  assert.equal(packageJson.files.includes('docs/assets/vibepro-header.png'), true);
  assert.equal(packageJson.files.some((entry) => entry === 'docs' || (entry.startsWith('docs/') && entry !== 'docs/assets/vibepro-header.png')), false);
  assert.equal(packageJson.files.includes('.vibepro'), false);
  assert.equal(packageJson.files.includes('node_modules'), false);
  assert.match(license, /Apache License[\s\S]*Version 2\.0/);
  assert.match(readme, /Graphify is optional/);
  assert.match(readme, /does not bundle Graphify/);
  assert.match(readme, /Risk-adaptive Gate DAGs/);
  assert.match(readme, /workflow_heavy/);
  assert.match(readme, /vibepro pr create/);
  assert.match(readme, /Do not use raw `gh pr create`/);
  assert.match(readme, /design-modernize/);
  assert.match(readme, /derive-system/);
  assert.match(readme, /VibePro-derived Design System/);
  assert.match(readme, /preserving current routes, information architecture, CTAs, state behavior, and data dependencies/);
  assert.match(readme, /Apache License 2\.0/);
  assert.doesNotMatch(readme, /No license file is currently included/);
  assert.doesNotMatch(readme, /Internal beta release notes/);
  assert.match(readmeJa, /Graphify は任意/);
  assert.match(readmeJa, /Graphify 本体や Graphify のコードを同梱しません/);
  assert.match(readmeJa, /リスクに応じた Gate/);
  assert.match(readmeJa, /複数の導線をまたぐ重い変更/);
  assert.match(readmeJa, /vibepro pr create/);
  assert.match(readmeJa, /直接 `gh pr create` は使わない/);
  assert.match(readmeJa, /design-modernize/);
  assert.match(readmeJa, /derive-system/);
  assert.match(readmeJa, /派生デザインシステム/);
  assert.match(readmeJa, /既存のルート、情報構造、CTA、状態、データ依存を保ったまま/);
  assert.match(readmeJa, /Apache License 2\.0/);
  assert.doesNotMatch(readmeJa, /現在 license file は含まれていません/);
  assert.doesNotMatch(readmeJa, /社内βリリースノート/);
  for (const file of requiredOpsFiles) {
    assert.equal(await pathExists(path.resolve(file)), true, `${file} should exist for OSS operations`);
  }
});

test('npm dry-run package excludes VibePro workspace and internal artifacts', async () => {
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10
  });
  const pack = JSON.parse(stdout)[0];
  const files = pack.files.map((file) => file.path);

  assert.equal(files.includes('LICENSE'), true);
  assert.equal(files.includes('README.md'), true);
  assert.equal(files.includes('README.ja.md'), true);
  assert.equal(files.includes('docs/assets/vibepro-header.png'), true);
  assert.equal(files.includes('bin/vibepro.js'), true);
  assert.equal(files.some((file) => file === '.vibepro' || file.startsWith('.vibepro/')), false);
  assert.equal(files.some((file) => file === 'node_modules' || file.startsWith('node_modules/')), false);
  assert.equal(files.some((file) => file === 'docs/releases' || file.startsWith('docs/releases/')), false);
  assert.equal(files.some((file) => file.startsWith('docs/') && file !== 'docs/assets/vibepro-header.png'), false);
  assert.equal(files.some((file) => file.toLowerCase().includes('graphify') && !file.startsWith('src/') && !file.startsWith('README')), false);
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

test('env graph command runs end-to-end and derives an environment graph', async () => {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '14', '@prisma/client': '5' } }));
  await writeFile(path.join(repo, '.env.example'), 'DATABASE_URL=postgres://u:p@x.neon.tech/db\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: app deps and env']);
  const result = await runCli(['env', 'graph', repo, '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.nodes.some((n) => n.type === 'database'), true);
  assert.equal(result.result.nodes.some((n) => n.type === 'frontend'), true);
});
