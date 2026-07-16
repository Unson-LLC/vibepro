import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function captureRunCli(args) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } }
  });
  return { ...result, stdout, stderr };
}

async function makeGitRepoWithStory() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-content-binding-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-content-binding',
    '--title',
    'Content scoped evidence freshness',
    '--view',
    'dev',
    '--period',
    '2026-W27'
  ]);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'content-binding-target.js'), 'export const value = 1;\n');
  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init content binding fixture']);
  await git(repo, ['switch', '-c', 'feature/content-binding']);
  return repo;
}

function findGate(result, id) {
  return result.result.preparation.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

test('CEF-S-1/2/5 verification evidence stays current for docs-only commits and stales on bound surface changes', async () => {
  const repo = await makeGitRepoWithStory();
  const recordResult = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'node --test test/content-binding.test.js',
    '--summary',
    'content binding unit coverage passed',
    '--target',
    'src/content-binding-target.js'
  ]);
  assert.equal(recordResult.exitCode, 0);
  assert.equal(recordResult.result.evidence.commands[0].content_binding.mode, 'content_surface');

  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n\nDocs-only continuation.\n');
  await git(repo, ['add', 'docs/notes.md']);
  await git(repo, ['commit', '-m', 'docs: continue after evidence']);

  const docsOnly = await runCli(['pr', 'prepare', repo, '--story-id', 'story-content-binding', '--base', 'main', '--json']);
  assert.equal(docsOnly.exitCode, 0);
  const docsGate = findGate(docsOnly, 'gate:artifact_consistency');
  const docsVerification = docsGate.artifacts.find((artifact) => artifact.artifact_type === 'verification_command');
  assert.equal(docsVerification.status, 'current');
  assert.deepEqual(docsVerification.content_binding.surface_files, ['src/content-binding-target.js']);
  const freshnessGate = findGate(docsOnly, 'gate:pr_freshness');
  const freshnessBinding = freshnessGate.content_binding_details.bindings.find((binding) => binding.artifact_type === 'verification_command');
  assert.equal(freshnessBinding.status, 'current');
  assert.deepEqual(freshnessBinding.surface_files, ['src/content-binding-target.js']);
  assert.deepEqual(freshnessBinding.changed_files, []);

  await writeFile(path.join(repo, 'src', 'content-binding-target.js'), 'export const value = 2;\n');
  await git(repo, ['add', 'src/content-binding-target.js']);
  await git(repo, ['commit', '-m', 'feat: change bound evidence surface']);

  const sourceChanged = await runCli(['pr', 'prepare', repo, '--story-id', 'story-content-binding', '--base', 'main', '--json']);
  assert.equal(sourceChanged.exitCode, 0);
  const staleGate = findGate(sourceChanged, 'gate:artifact_consistency');
  const staleVerification = staleGate.inconsistent_artifacts.find((artifact) => artifact.artifact_type === 'verification_command');
  assert.equal(staleVerification.status, 'stale');
  assert.match(staleVerification.reason, /content-bound evidence surface changed/);
  assert.deepEqual(staleVerification.content_binding.changed_files, ['src/content-binding-target.js']);
  const staleDetail = staleGate.stale_artifact_details.find((detail) => detail.artifact_type === 'verification_command');
  assert.deepEqual(staleDetail.content_binding.changed_files, ['src/content-binding-target.js']);
});

test('CEF-S-3 review evidence uses inspected input content binding across docs-only commits', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'implementation']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'runtime contract reviewed',
    '--inspection-summary',
    'read the runtime surface',
    '--inspection-input',
    'src/content-binding-target.js',
    '--judgment-delta',
    'generic pass -> accepted after inspected input review',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-content-binding-review',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);
  assert.equal(recordResult.result.review.content_binding.mode, 'content_surface');
  assert.equal(recordResult.result.review.freshness_policy.effective_mode, 'content_surface');
  assert.equal(recordResult.result.review.freshness_policy.source, 'content_surface_default');

  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n\nReview still current.\n');
  await git(repo, ['add', 'docs/notes.md']);
  await git(repo, ['commit', '-m', 'docs: update review-adjacent notes']);

  const status = await runCli(['review', 'status', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--json']);
  const role = status.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(role.binding_status, 'current');
  assert.deepEqual(role.content_binding.surface_files, ['src/content-binding-target.js']);

  await writeFile(path.join(repo, 'src', 'content-binding-target.js'), 'export const value = 3;\n');
  const staleStatus = await runCli(['review', 'status', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--json']);
  const staleRole = staleStatus.result.stages[0].roles.find((item) => item.role === 'runtime_contract');
  assert.equal(staleRole.binding_status, 'stale');
  assert.match(staleRole.stale_reason, /content-bound evidence surface changed/);
  assert.deepEqual(staleRole.content_binding.changed_files, ['src/content-binding-target.js']);
});

test('review freshness policy keeps high-risk gate roles strict by default while preserving inspected files', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'gate', '--role', 'gate_evidence']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence reviewed',
    '--inspection-summary',
    'read the implementation surface and gate inputs',
    '--inspection-input',
    'src/content-binding-target.js',
    '--judgment-delta',
    'generic pass -> accepted after inspecting the implementation surface',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-gate-freshness-review',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);
  assert.equal(recordResult.result.review.freshness_policy.effective_mode, 'strict_head');
  assert.equal(recordResult.result.review.freshness_policy.source, 'built_in_exception');
  assert.match(recordResult.result.review.freshness_policy.reason, /gate evidence reviews/);
  assert.equal(recordResult.result.review.content_binding.mode, 'strict_head');
  assert.deepEqual(
    recordResult.result.review.content_binding.surface_files.map((file) => file.path),
    ['src/content-binding-target.js']
  );
});

test('role policy can explicitly narrow a built-in strict exception to content surface', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.agent_reviews = {
    roles: {
      gate_evidence: {
        freshness_mode: 'content_surface'
      }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'gate', '--role', 'gate_evidence']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence reviewed against an explicit surface',
    '--inspection-summary',
    'read the implementation surface',
    '--inspection-input',
    'src/content-binding-target.js',
    '--judgment-delta',
    'built-in strict default -> content scoped because the role policy names a complete file surface',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-gate-content-policy-review',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);
  assert.equal(recordResult.result.review.freshness_policy.effective_mode, 'content_surface');
  assert.equal(recordResult.result.review.freshness_policy.source, 'role_policy');
  assert.equal(recordResult.result.review.content_binding.mode, 'content_surface');
});

test('global content-surface default cannot weaken a built-in strict role', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.agent_reviews = {
    defaults: {
      freshness_mode: 'content_surface'
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'gate', '--role', 'gate_evidence']);
  const recordResult = await runCli([
    'review',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'gate evidence keeps its built-in strict policy',
    '--inspection-summary',
    'read the implementation surface',
    '--inspection-input',
    'src/content-binding-target.js',
    '--judgment-delta',
    'global content default -> built-in strict policy retained',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-gate-global-default-review',
    '--agent-closed'
  ]);
  assert.equal(recordResult.exitCode, 0);
  assert.equal(recordResult.result.review.freshness_policy.effective_mode, 'strict_head');
  assert.equal(recordResult.result.review.freshness_policy.source, 'built_in_exception');
});

test('review strict HEAD CLI override requires and records an explicit reason', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--role', 'runtime_contract']);
  const baseArgs = [
    'review',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'runtime contract reviewed',
    '--inspection-summary',
    'read the runtime implementation',
    '--inspection-input',
    'src/content-binding-target.js',
    '--judgment-delta',
    'content-scoped default -> strict because the complete release head is the review subject',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-cli-strict-review',
    '--agent-closed',
    '--strict-head-binding'
  ];
  const missingReason = await captureRunCli(baseArgs);
  assert.equal(missingReason.exitCode, 1);
  assert.match(missingReason.stderr, /requires --strict-head-reason/);

  const recorded = await runCli([
    ...baseArgs,
    '--strict-head-reason',
    'the complete release candidate head is the inspected contract'
  ]);
  assert.equal(recorded.exitCode, 0);
  assert.equal(recorded.result.review.freshness_policy.effective_mode, 'strict_head');
  assert.equal(recorded.result.review.freshness_policy.source, 'cli_override');
  assert.equal(
    recorded.result.review.freshness_policy.reason,
    'the complete release candidate head is the inspected contract'
  );
});

test('custom strict HEAD role policy requires and persists its rationale', async () => {
  const repo = await makeGitRepoWithStory();
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.agent_reviews = {
    roles: {
      runtime_contract: { freshness_mode: 'strict_head' }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--role', 'runtime_contract']);
  const args = [
    'review', 'record', repo,
    '--id', 'story-content-binding',
    '--stage', 'implementation',
    '--role', 'runtime_contract',
    '--status', 'pass',
    '--summary', 'runtime contract reviewed as a full-head exception',
    '--inspection-summary', 'read the runtime implementation',
    '--inspection-input', 'src/content-binding-target.js',
    '--judgment-delta', 'content surface default -> strict because the runtime contract spans the release head',
    '--agent-system', 'codex',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', 'codex-config-strict-review',
    '--agent-closed'
  ];
  const missingReason = await captureRunCli(args);
  assert.equal(missingReason.exitCode, 1);
  assert.match(missingReason.stderr, /configures strict_head freshness without freshness_reason/);

  config.agent_reviews.roles.runtime_contract.freshness_reason = 'runtime compatibility spans the complete release head';
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const recorded = await runCli(args);
  assert.equal(recorded.exitCode, 0);
  assert.equal(recorded.result.review.freshness_policy.source, 'role_policy');
  assert.equal(recorded.result.review.freshness_policy.reason, 'runtime compatibility spans the complete release head');
});

test('content-scoped pass rejects generated workspace artifacts as the only inspection input', async () => {
  const repo = await makeGitRepoWithStory();
  await runCli(['review', 'prepare', repo, '--id', 'story-content-binding', '--stage', 'implementation', '--role', 'runtime_contract']);
  const result = await captureRunCli([
    'review',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--stage',
    'implementation',
    '--role',
    'runtime_contract',
    '--status',
    'pass',
    '--summary',
    'generated request only',
    '--inspection-summary',
    'read only the generated review request',
    '--inspection-input',
    '.vibepro/reviews/story-content-binding/implementation/review-request-runtime_contract.md',
    '--artifact',
    'src/content-binding-target.js',
    '--judgment-delta',
    'generic pass -> unsupported because no implementation input was inspected',
    '--agent-system',
    'codex',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'codex-generated-only-review',
    '--agent-closed'
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /actual inspected surface is captured/);
});

test('CEF-S-4 strict HEAD binding still invalidates docs-only commits', async () => {
  const repo = await makeGitRepoWithStory();
  const recordResult = await runCli([
    'verify',
    'record',
    repo,
    '--id',
    'story-content-binding',
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'node --test test/content-binding.test.js',
    '--summary',
    'strict evidence passed',
    '--target',
    'src/content-binding-target.js',
    '--strict-head-binding'
  ]);
  assert.equal(recordResult.exitCode, 0);
  assert.equal(recordResult.result.evidence.commands[0].content_binding.mode, 'strict_head');

  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n\nStrict evidence should stale.\n');
  await git(repo, ['add', 'docs/notes.md']);
  await git(repo, ['commit', '-m', 'docs: advance strict head']);

  const result = await runCli(['pr', 'prepare', repo, '--story-id', 'story-content-binding', '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const gate = findGate(result, 'gate:artifact_consistency');
  const artifact = gate.inconsistent_artifacts.find((item) => item.artifact_type === 'verification_command');
  assert.equal(artifact.status, 'stale');
  assert.match(artifact.reason, /recorded for .*current head/);
});
