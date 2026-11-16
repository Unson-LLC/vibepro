import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { closeWorktree, inspectProcessesWithLsof, inspectWorktreeLifecycle } from '../src/worktree-lifecycle.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'vibepro-worktree-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test']);
  await writeFile(path.join(root, 'README.md'), 'initial\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'initial']);
  const linked = `${root}-linked 日本語`;
  t.after(() => rm(linked, { recursive: true, force: true }));
  await git(root, ['worktree', 'add', '-b', 'feature/done', linked]);
  return { root, linked };
}

const noProcesses = async () => [];

test('inspect marks a clean merged linked worktree safe to close', async (t) => {
  const { root, linked } = await fixture(t);
  const result = await inspectWorktreeLifecycle(root, {
    worktreePath: linked,
    baseRef: 'main',
    processInspector: noProcesses,
    currentCwd: root
  });
  assert.equal(result.status, 'safe_to_close');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.checks.registered, true);
  assert.equal(result.checks.clean, true);
  assert.equal(result.checks.head_integrated, true);
});

test('inspect blocks dirty and unmerged worktrees without guessing', async (t) => {
  const dirty = await fixture(t);
  await writeFile(path.join(dirty.linked, 'untracked.txt'), 'keep me\n');
  const dirtyResult = await inspectWorktreeLifecycle(dirty.root, {
    worktreePath: dirty.linked,
    baseRef: 'main', processInspector: noProcesses, currentCwd: dirty.root
  });
  assert.equal(dirtyResult.status, 'needs_attention');
  assert.ok(dirtyResult.reasons.includes('worktree_dirty'));

  const unmerged = await fixture(t);
  await writeFile(path.join(unmerged.linked, 'feature.txt'), 'new\n');
  await git(unmerged.linked, ['add', 'feature.txt']);
  await git(unmerged.linked, ['commit', '-m', 'feature']);
  const unmergedResult = await inspectWorktreeLifecycle(unmerged.root, {
    worktreePath: unmerged.linked,
    baseRef: 'main', processInspector: noProcesses, currentCwd: unmerged.root
  });
  assert.equal(unmergedResult.status, 'needs_attention');
  assert.ok(unmergedResult.reasons.includes('head_not_integrated_into_base'));
});

test('inspect accepts commits integrated by squash merge', async (t) => {
  const { root, linked } = await fixture(t);
  await writeFile(path.join(linked, 'feature.txt'), 'squashed\n');
  await git(linked, ['add', 'feature.txt']);
  await git(linked, ['commit', '-m', 'feature']);
  await git(root, ['merge', '--squash', 'feature/done']);
  await git(root, ['commit', '-m', 'squash feature']);

  const result = await inspectWorktreeLifecycle(root, {
    worktreePath: linked,
    baseRef: 'main', processInspector: noProcesses, currentCwd: root
  });
  assert.equal(result.status, 'safe_to_close');
  assert.equal(result.checks.head_integrated, true);
});

test('inspect refuses canonical, current, unregistered, and unknown process states', async (t) => {
  const { root, linked } = await fixture(t);
  const canonical = await inspectWorktreeLifecycle(root, {
    worktreePath: root, baseRef: 'main', processInspector: noProcesses, currentCwd: linked
  });
  assert.equal(canonical.status, 'active');
  assert.ok(canonical.reasons.includes('canonical_worktree'));

  const current = await inspectWorktreeLifecycle(root, {
    worktreePath: linked, baseRef: 'main', processInspector: noProcesses, currentCwd: linked
  });
  assert.equal(current.status, 'active');
  assert.ok(current.reasons.includes('current_process_inside'));

  const unregistered = await inspectWorktreeLifecycle(root, {
    worktreePath: path.join(root, 'not-registered'), baseRef: 'main', processInspector: noProcesses, currentCwd: root
  });
  assert.equal(unregistered.status, 'unknown');
  assert.ok(unregistered.reasons.includes('worktree_not_registered'));

  const processUnknown = await inspectWorktreeLifecycle(root, {
    worktreePath: linked,
    baseRef: 'main',
    processInspector: async () => { throw new Error('inspection unavailable'); },
    currentCwd: root
  });
  assert.equal(processUnknown.status, 'unknown');
  assert.ok(processUnknown.reasons.includes('process_state_unknown'));
});

test('close removes only a freshly re-inspected safe worktree and reads it back', async (t) => {
  const { root, linked } = await fixture(t);
  const result = await closeWorktree(root, {
    worktreePath: linked,
    baseRef: 'main',
    processInspector: noProcesses,
    currentCwd: root
  });
  assert.equal(result.status, 'closed');
  await assert.rejects(access(linked));
  const listed = (await git(root, ['worktree', 'list', '--porcelain'])).stdout;
  assert.doesNotMatch(listed, new RegExp(linked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('close leaves an unsafe worktree untouched', async (t) => {
  const { root, linked } = await fixture(t);
  await writeFile(path.join(linked, 'untracked.txt'), 'keep me\n');
  const result = await closeWorktree(root, {
    worktreePath: linked,
    baseRef: 'main',
    processInspector: noProcesses,
    currentCwd: root
  });
  assert.equal(result.status, 'needs_attention');
  await access(path.join(linked, 'untracked.txt'));
});

test('lsof stderr means process inspection is unknown, not empty', async () => {
  const error = Object.assign(new Error('lsof denied'), {
    code: 1,
    stdout: '',
    stderr: 'permission denied'
  });
  await assert.rejects(
    inspectProcessesWithLsof('/tmp/example', async () => { throw error; }),
    /lsof denied/
  );
});

test('close re-inspects mutable state immediately before removal', async (t) => {
  const { root, linked } = await fixture(t);
  let inspections = 0;
  const processInspector = async () => {
    inspections += 1;
    return inspections === 1 ? [] : ['new process'];
  };
  const result = await closeWorktree(root, {
    worktreePath: linked,
    baseRef: 'main',
    processInspector,
    currentCwd: root
  });
  assert.equal(result.status, 'active');
  assert.ok(result.reasons.includes('other_processes_inside'));
  await access(linked);
});

test('an unresolved base ref remains unknown and cannot be closed', async (t) => {
  const { root, linked } = await fixture(t);
  const result = await closeWorktree(root, {
    worktreePath: linked,
    baseRef: 'missing/base',
    processInspector: noProcesses,
    currentCwd: root
  });
  assert.equal(result.status, 'unknown');
  assert.ok(result.reasons.includes('base_ref_unresolved'));
  await access(linked);
});
