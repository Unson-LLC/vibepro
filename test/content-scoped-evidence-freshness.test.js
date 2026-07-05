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
