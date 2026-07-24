import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { resolveCandidateTargetFiles } from '../src/task-manager.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-scope-boundary-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  return root;
}

async function makeGitRepoWithStory() {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-scope-boundary',
    '--title',
    'Scope boundary test story',
    '--view',
    'dev'
  ]);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init test repo']);
  await git(repo, ['switch', '-c', 'feature/test-story']);
  return repo;
}

async function writeTasksFixture(repo, storyId, scopeBoundary) {
  const tasksDir = path.join(repo, '.vibepro', 'stories', storyId, 'tasks');
  await mkdir(tasksDir, { recursive: true });
  await writeJson(path.join(tasksDir, 'tasks.json'), {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    story: { story_id: storyId, title: 'Scope boundary test story' },
    source_run: { run_id: 'story-plan', gate_status: 'unknown' },
    scope_boundary: scopeBoundary,
    tasks: []
  });
}

function gateNode(prepare, id) {
  return prepare.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

test('scope boundary gate is absent when no tasks.json exists for the story', async () => {
  const repo = await makeGitRepoWithStory();
  await writeFile(path.join(repo, 'src.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src.js']);
  await git(repo, ['commit', '-m', 'feat: add source']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-scope-boundary', '--json']);
  assert.equal(result.exitCode, 0, JSON.stringify(result.result ?? result.error, null, 2));
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-scope-boundary', 'pr-prepare.json'));
  assert.equal(gateNode(prepare, 'gate:scope_boundary'), undefined);
  assert.equal(
    prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:dag_connectivity')?.status,
    'passed'
  );
});

test('scope boundary gate is informational only when the story never declared a boundary', async () => {
  const repo = await makeGitRepoWithStory();
  await writeTasksFixture(repo, 'story-scope-boundary', {
    schema_version: '0.1.0',
    declared: false,
    allowed_paths: ['src/allowed/**'],
    source: 'derived_from_target_files',
    recorded_at: new Date().toISOString()
  });
  await mkdir(path.join(repo, 'src', 'other'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'other', 'bar.js'), 'export const bar = 1;\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'feat: add out-of-scope-looking file']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-scope-boundary', '--json']);
  assert.equal(result.exitCode, 0, JSON.stringify(result.result ?? result.error, null, 2));
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-scope-boundary', 'pr-prepare.json'));
  const gate = gateNode(prepare, 'gate:scope_boundary');
  assert.equal(gate.status, 'not_declared');
  assert.equal(gate.required, false);
  assert.equal(prepare.gate_status.unresolved_gates.some((g) => g.id === 'gate:scope_boundary'), false);
  assert.equal(
    prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:dag_connectivity')?.status,
    'passed'
  );
});

test('scope boundary gate passes when every changed file matches the declared globs', async () => {
  const repo = await makeGitRepoWithStory();
  await writeTasksFixture(repo, 'story-scope-boundary', {
    schema_version: '0.1.0',
    declared: true,
    allowed_paths: ['src/allowed/**'],
    source: 'cli_declared',
    recorded_at: new Date().toISOString()
  });
  await mkdir(path.join(repo, 'src', 'allowed'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'allowed', 'foo.js'), 'export const foo = 1;\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'feat: add in-scope file']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-scope-boundary', '--json']);
  assert.equal(result.exitCode, 0, JSON.stringify(result.result ?? result.error, null, 2));
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-scope-boundary', 'pr-prepare.json'));
  const gate = gateNode(prepare, 'gate:scope_boundary');
  assert.equal(gate.status, 'passed');
  assert.equal(gate.required, true);
  assert.deepEqual(gate.out_of_scope_files, []);
  assert.equal(prepare.gate_status.unresolved_gates.some((g) => g.id === 'gate:scope_boundary'), false);
});

test('scope boundary gate blocks PR creation when a changed file falls outside the declared scope', async () => {
  const repo = await makeGitRepoWithStory();
  await writeTasksFixture(repo, 'story-scope-boundary', {
    schema_version: '0.1.0',
    declared: true,
    allowed_paths: ['src/allowed/**'],
    source: 'cli_declared',
    recorded_at: new Date().toISOString()
  });
  await mkdir(path.join(repo, 'src', 'allowed'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'other'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'allowed', 'foo.js'), 'export const foo = 1;\n');
  await writeFile(path.join(repo, 'src', 'other', 'bar.js'), 'export const bar = 1;\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'feat: mix in-scope and out-of-scope files']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-scope-boundary', '--json']);
  assert.equal(result.exitCode, 0, JSON.stringify(result.result ?? result.error, null, 2));
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-scope-boundary', 'pr-prepare.json'));
  const gate = gateNode(prepare, 'gate:scope_boundary');
  assert.equal(gate.status, 'needs_scope_correction');
  assert.equal(gate.required, true);
  assert.deepEqual(gate.out_of_scope_files, ['src/other/bar.js']);
  assert.equal(prepare.gate_status.ready_for_pr_create, false);
  assert.equal(prepare.gate_status.unresolved_gates.some((g) => g.id === 'gate:scope_boundary'), true);
  assert.equal(prepare.gate_status.critical_unresolved_gates.some((g) => g.id === 'gate:scope_boundary'), true);
  assert.equal(
    prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:dag_connectivity')?.status,
    'passed'
  );

  await runCli([
    'decision', 'record', repo,
    '--id', 'story-scope-boundary',
    '--type', 'waiver',
    '--source', 'gate:scope_boundary',
    '--summary', 'Bundled fix intentionally touches src/other/bar.js for this Story.',
    '--reason', 'The two files share a single atomic change; splitting would break the build mid-PR.',
    '--reviewer', 'codex',
    '--json'
  ]);
  const waived = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-scope-boundary', '--json']);
  assert.equal(waived.exitCode, 0, JSON.stringify(waived.result ?? waived.error, null, 2));
  const waivedPrepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-scope-boundary', 'pr-prepare.json'));
  const waivedGate = gateNode(waivedPrepare, 'gate:scope_boundary');
  assert.equal(waivedGate.status, 'passed_with_waiver');
  assert.equal(waivedPrepare.gate_status.unresolved_gates.some((g) => g.id === 'gate:scope_boundary'), false);
});

test('task create --allowed-paths persists a declared scope boundary; without it the boundary is derived and informational', async () => {
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

1. Harness \`docs/specs/agent-harness.md\` 診断パッケージ
   - \`docs/specs/agent-harness.md\`へcheck pack契約を追加する
`);

  await runCli(['story', 'derive', repo]);
  await runCli(['story', 'plan', repo, '--limit', '10']);

  const declaredResult = await runCli([
    'task', 'create', repo,
    '--from-plan',
    '--id', 'story-agent-harness',
    '--allowed-paths', ' src/agent-harness/**, docs/specs/agent-harness.md ,,',
    '--json'
  ]);
  assert.equal(declaredResult.exitCode, 0, JSON.stringify(declaredResult.result ?? declaredResult.error, null, 2));
  const declaredTasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-agent-harness', 'tasks', 'tasks.json'));
  assert.equal(declaredTasks.scope_boundary.declared, true);
  assert.equal(declaredTasks.scope_boundary.source, 'cli_declared');
  assert.deepEqual(declaredTasks.scope_boundary.allowed_paths, ['src/agent-harness/**', 'docs/specs/agent-harness.md']);
  const explicitTask = declaredTasks.tasks.find((task) => task.title.includes('docs/specs/agent-harness.md'));
  assert.deepEqual(explicitTask?.target_files, ['docs/specs/agent-harness.md']);
  assert.equal(explicitTask?.target_count, 1);

  const undeclaredResult = await runCli(['task', 'create', repo, '--from-plan', '--id', 'story-agent-harness', '--json']);
  assert.equal(undeclaredResult.exitCode, 0, JSON.stringify(undeclaredResult.result ?? undeclaredResult.error, null, 2));
  const undeclaredTasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-agent-harness', 'tasks', 'tasks.json'));
  assert.equal(undeclaredTasks.scope_boundary.declared, false);
  assert.equal(['derived_from_target_files', 'none'].includes(undeclaredTasks.scope_boundary.source), true);
});

test('task target inference is exact-path-safe and preserves explicit targets', () => {
  const allowedPaths = ['src/foo.js', 'src/cli.js', 'docs/reference.md'];
  assert.deepEqual(resolveCandidateTargetFiles({
    title: 'Update src/foo.js.bak but do not modify src/cli.js',
    purpose: 'Read docs/reference.md for context'
  }, allowedPaths), []);

  assert.deepEqual(resolveCandidateTargetFiles({
    title: 'Update src/foo.js but do not modify src/cli.js',
    purpose: 'src/cli.jsへの逆呼び出しを追加しない'
  }, allowedPaths), ['src/foo.js']);

  assert.deepEqual(resolveCandidateTargetFiles({
    title: 'Read docs/reference.md and update src/foo.js',
    purpose: 'src/foo.jsを更新する'
  }, allowedPaths), ['src/foo.js']);

  assert.deepEqual(resolveCandidateTargetFiles({
    title: 'Update src/foo.js',
    target_files: ['src/explicit.js']
  }, allowedPaths), ['src/explicit.js']);
});
