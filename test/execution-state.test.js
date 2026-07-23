import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  __testing__ as executionStateTesting,
  getExecutionNext,
  getExecutionStatus,
  reconcileExecutionState,
  renderExecutionNextSummary,
  renderExecutionStateSummary,
  updateExecutionStateFromPrMerge
} from '../src/execution-state.js';
import { buildCliErrorPayload } from '../src/cli.js';
import { buildExecutionDag } from '../src/managed-worktree.js';
import { executeMerge, persistMergeFollowupState, persistMergeRecoveryState } from '../src/merge-manager.js';
import { withStoryTransactionLocks } from '../src/story-transaction-lock.js';

const execFileAsync = promisify(execFile);

const state = {
  story_id: 'story-delivery',
  target: 'pr_create',
  completion_status: 'merged_reconciliation_required',
  current_phase: 'reconcile_delivery',
  delivery: { status: 'merged_externally' },
  reconciliation: { status: 'reconciliation_required', reasons: ['gate_not_ready'] },
  blocking_gate: { id: 'delivery_reconciliation' },
  next_actions: ['refresh evidence'],
  managed_worktree: null,
  execution_dag: { nodes: [] }
};

test('DRS-CONTRACT-008 live story lock cannot be stolen solely because its timestamp is old', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-story-lock-live-'));
  const storyId = 'story-live-lock-owner';
  const lockPath = path.join(repoRoot, '.vibepro', 'locks', `${storyId}.delivery-reconciliation.lock`);
  const ownerPath = path.join(lockPath, 'owner.json');
  let enterFirst;
  const entered = new Promise((resolve) => { enterFirst = resolve; });
  let releaseFirst;
  const release = new Promise((resolve) => { releaseFirst = resolve; });
  const first = withStoryTransactionLocks([repoRoot], storyId, async () => {
    const old = new Date(Date.now() - 60_000);
    await utimes(ownerPath, old, old);
    enterFirst();
    await release;
  }, { heartbeatMs: 60_000 });
  await entered;

  await assert.rejects(withStoryTransactionLocks([repoRoot], storyId, async () => {}, {
    timeoutMs: 75,
    staleMs: 5,
    heartbeatMs: 60_000
  }), (error) => {
    assert.equal(error.code, 'delivery_reconciliation_lock_timeout');
    return true;
  });

  releaseFirst();
  await first;
});

test('DRS-CONTRACT-008 story lock release preserves a replacement owner token', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-story-lock-release-'));
  const storyId = 'story-owner-safe-release';
  const lockPath = path.join(repoRoot, '.vibepro', 'locks', `${storyId}.delivery-reconciliation.lock`);
  const ownerPath = path.join(lockPath, 'owner.json');
  await withStoryTransactionLocks([repoRoot], storyId, async () => {
    const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
    await writeFile(ownerPath, `${JSON.stringify({ ...owner, token: 'replacement-owner' })}\n`);
  }, { heartbeatMs: 60_000 });

  assert.equal(JSON.parse(await readFile(ownerPath, 'utf8')).token, 'replacement-owner');
  await rm(lockPath, { recursive: true, force: true });
});

test('DRS-CONTRACT-008 abandoned story lock is quarantined before takeover', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-story-lock-stale-'));
  const storyId = 'story-stale-lock-owner';
  const lockPath = path.join(repoRoot, '.vibepro', 'locks', `${storyId}.delivery-reconciliation.lock`);
  const ownerPath = path.join(lockPath, 'owner.json');
  await mkdir(lockPath, { recursive: true });
  await writeFile(ownerPath, `${JSON.stringify({
    token: 'abandoned-owner',
    pid: 999_999_999,
    hostname: os.hostname(),
    created_at: new Date(0).toISOString(),
    heartbeat_at: new Date(0).toISOString()
  })}\n`);
  const old = new Date(Date.now() - 60_000);
  await utimes(ownerPath, old, old);
  let acquired = false;

  await withStoryTransactionLocks([repoRoot], storyId, async () => {
    acquired = true;
    assert.notEqual(JSON.parse(await readFile(ownerPath, 'utf8')).token, 'abandoned-owner');
  }, {
    timeoutMs: 500,
    staleMs: 5,
    heartbeatMs: 60_000,
    processAlive: () => false
  });

  assert.equal(acquired, true);
});

test('DRS-CONTRACT-008 concurrent stale-lock contenders serialize behind one takeover', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-story-lock-contenders-'));
  const storyId = 'story-stale-lock-contenders';
  const lockPath = path.join(repoRoot, '.vibepro', 'locks', `${storyId}.delivery-reconciliation.lock`);
  const ownerPath = path.join(lockPath, 'owner.json');
  const abandonedPid = 999_999_999;
  await mkdir(lockPath, { recursive: true });
  await writeFile(ownerPath, `${JSON.stringify({
    token: 'abandoned-owner',
    pid: abandonedPid,
    hostname: os.hostname(),
    created_at: new Date(0).toISOString(),
    heartbeat_at: new Date(0).toISOString()
  })}\n`);
  const old = new Date(Date.now() - 60_000);
  await utimes(ownerPath, old, old);
  let active = 0;
  let maxActive = 0;
  const entries = [];
  const contend = (label) => withStoryTransactionLocks([repoRoot], storyId, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    entries.push(label);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
  }, {
    timeoutMs: 1_000,
    staleMs: 5,
    heartbeatMs: 60_000,
    processAlive: (pid) => pid !== abandonedPid
  });

  await Promise.all([contend('A'), contend('B')]);

  assert.equal(maxActive, 1);
  assert.deepEqual(new Set(entries), new Set(['A', 'B']));
});

test('DRS-CONTRACT-008 an abandoned mutation guard fails closed instead of evicting unknown ownership', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-story-lock-transition-'));
  const storyId = 'story-stuck-transition';
  const lockPath = path.join(repoRoot, '.vibepro', 'locks', `${storyId}.delivery-reconciliation.lock`);
  const ownerPath = path.join(lockPath, 'owner.json');
  await mkdir(path.join(lockPath, '.transition'), { recursive: true });
  await writeFile(ownerPath, `${JSON.stringify({
    token: 'abandoned-owner',
    pid: 999_999_999,
    hostname: os.hostname()
  })}\n`);
  const old = new Date(Date.now() - 60_000);
  await utimes(ownerPath, old, old);

  await assert.rejects(withStoryTransactionLocks([repoRoot], storyId, async () => {
    assert.fail('stuck mutation ownership must not be entered');
  }, {
    timeoutMs: 80,
    staleMs: 5,
    heartbeatMs: 60_000,
    processAlive: () => false
  }), (error) => {
    assert.equal(error.code, 'delivery_reconciliation_lock_timeout');
    return true;
  });

  assert.equal(JSON.parse(await readFile(ownerPath, 'utf8')).token, 'abandoned-owner');
});

test('DRS-CONTRACT-008 execute merge participates in the shared story transaction lock', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execute-shared-lock-'));
  const storyId = 'story-execute-shared-lock';
  await mkdir(path.join(repoRoot, '.vibepro'), { recursive: true });
  await writeFile(path.join(repoRoot, '.vibepro', 'config.json'), '{}\n');
  let enterFirst;
  const entered = new Promise((resolve) => { enterFirst = resolve; });
  let releaseFirst;
  const release = new Promise((resolve) => { releaseFirst = resolve; });
  const first = withStoryTransactionLocks([repoRoot], storyId, async () => {
    enterFirst();
    await release;
  }, { heartbeatMs: 60_000 });
  await entered;

  await assert.rejects(executeMerge(repoRoot, {
    storyId,
    dryRun: true,
    storyTransactionLock: { timeoutMs: 75, heartbeatMs: 60_000 }
  }), (error) => {
    assert.equal(error.code, 'delivery_reconciliation_lock_timeout');
    return true;
  });

  releaseFirst();
  await first;
});

test('DRS-CONTRACT-009 linked execution-state writes roll back every authority when commit-last fails', async () => {
  const currentRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-transaction-current-'));
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-transaction-source-'));
  const storyId = 'story-transaction-rollback';
  const oldState = { story_id: storyId, completion_status: 'merged_reconciliation_required', revision: 'old' };
  const nextState = {
    ...oldState,
    completion_status: 'merged',
    revision: 'new',
    managed_worktree: { mode: 'managed', path: currentRoot, source_repo: sourceRoot }
  };
  const statePaths = [currentRoot, sourceRoot].map((root) => path.join(root, '.vibepro', 'executions', storyId, 'state.json'));
  for (const statePath of statePaths) {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(oldState, null, 2)}\n`);
  }
  let writes = 0;

  await assert.rejects(executionStateTesting.writeExecutionStateWithLinkedCopies(currentRoot, nextState, {
    syncManagedWorktreeArtifactsToSource: async () => {},
    writeExecutionStateAtomic: async (filePath, value) => {
      writes += 1;
      if (writes === 2) throw new Error('injected current authority write failure');
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
    }
  }), /injected current authority write failure/);

  assert.equal(writes, 2);
  for (const statePath of statePaths) {
    assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), oldState);
  }
});

test('DRS-CONTRACT-009 real artifact sync and commit-last failure roll back state and source output authorities together', async () => {
  const currentRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-compound-current-'));
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-compound-source-'));
  const storyId = 'story-compound-rollback';
  const oldState = { story_id: storyId, completion_status: 'merged_reconciliation_required', revision: 'old' };
  const nextState = {
    ...oldState,
    completion_status: 'merged',
    revision: 'new',
    managed_worktree: { mode: 'managed', path: currentRoot, source_repo: sourceRoot }
  };
  const statePaths = [currentRoot, sourceRoot].map((root) => path.join(root, '.vibepro', 'executions', storyId, 'state.json'));
  for (const statePath of statePaths) {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(oldState, null, 2)}\n`);
  }
  const managedWorkspace = path.join(currentRoot, '.vibepro');
  const sourceWorkspace = path.join(sourceRoot, '.vibepro');
  const artifactFixtures = [
    ['pr', storyId, 'pr-merge.json'],
    ['reviews', storyId, 'review.json'],
    ['verification', storyId, 'verification-evidence.json']
  ];
  for (const segments of artifactFixtures) {
    const managedPath = path.join(managedWorkspace, ...segments);
    const sourcePath = path.join(sourceWorkspace, ...segments);
    await mkdir(path.dirname(managedPath), { recursive: true });
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(managedPath, `${JSON.stringify({ revision: 'new' })}\n`);
    await writeFile(sourcePath, `${JSON.stringify({ revision: 'old' })}\n`);
  }
  await writeFile(path.join(managedWorkspace, 'vibepro-manifest.json'), `${JSON.stringify({ artifacts: { current: 'new' } })}\n`);
  await writeFile(path.join(sourceWorkspace, 'vibepro-manifest.json'), `${JSON.stringify({ artifacts: { current: 'old', retained: true } })}\n`);
  let writes = 0;

  await assert.rejects(executionStateTesting.writeExecutionStateWithLinkedCopies(currentRoot, nextState, {
    writeExecutionStateAtomic: async (filePath, value) => {
      writes += 1;
      if (writes === 2) throw new Error('injected commit-last failure after real artifact sync');
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
    }
  }), /injected commit-last failure after real artifact sync/);

  for (const statePath of statePaths) {
    assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), oldState);
  }
  for (const segments of artifactFixtures) {
    assert.deepEqual(JSON.parse(await readFile(path.join(sourceWorkspace, ...segments), 'utf8')), { revision: 'old' });
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(sourceWorkspace, 'vibepro-manifest.json'), 'utf8')), {
    artifacts: { current: 'old', retained: true }
  });
});

test('DRS-CONTRACT-009 linked artifact sync and rollback honor the configured PR route without consuming legacy authority', async () => {
  const currentRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-routed-current-'));
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-routed-source-'));
  const storyId = 'story-routed-linked-rollback';
  const routingConfig = {
    artifact_routing: {
      artifacts: {
        pr: { canonical: '.vibepro/routed-pr/{story_id}-pr-prepare.json' }
      }
    }
  };
  for (const root of [currentRoot, sourceRoot]) {
    await mkdir(path.join(root, '.vibepro'), { recursive: true });
    await writeFile(path.join(root, '.vibepro', 'config.json'), `${JSON.stringify(routingConfig, null, 2)}\n`);
  }
  const oldState = { story_id: storyId, completion_status: 'merged_reconciliation_required', revision: 'old' };
  const nextState = {
    ...oldState,
    completion_status: 'merged',
    revision: 'new',
    managed_worktree: { mode: 'managed', path: currentRoot, source_repo: sourceRoot }
  };
  const statePaths = [currentRoot, sourceRoot].map((root) => path.join(root, '.vibepro', 'executions', storyId, 'state.json'));
  for (const statePath of statePaths) {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(oldState, null, 2)}\n`);
  }
  const managedRouted = path.join(currentRoot, '.vibepro', 'routed-pr', `${storyId}-pr-merge.json`);
  const sourceRouted = path.join(sourceRoot, '.vibepro', 'routed-pr', `${storyId}-pr-merge.json`);
  const foreignStoryId = 'story-routed-foreign-authority';
  const managedForeignRouted = path.join(currentRoot, '.vibepro', 'routed-pr', `${foreignStoryId}-pr-merge.json`);
  const sourceForeignRouted = path.join(sourceRoot, '.vibepro', 'routed-pr', `${foreignStoryId}-pr-merge.json`);
  const managedLegacy = path.join(currentRoot, '.vibepro', 'pr', storyId, 'pr-merge.json');
  const sourceLegacy = path.join(sourceRoot, '.vibepro', 'pr', storyId, 'pr-merge.json');
  const managedForeignVerification = path.join(currentRoot, '.vibepro', 'verification', foreignStoryId, 'results.json');
  const sourceForeignVerification = path.join(sourceRoot, '.vibepro', 'verification', foreignStoryId, 'results.json');
  for (const [filePath, revision] of [
    [managedRouted, 'transaction-routed'],
    [sourceRouted, 'original-routed'],
    [managedForeignRouted, 'managed-foreign-decoy'],
    [sourceForeignRouted, 'source-foreign-authority'],
    [managedLegacy, 'managed-legacy-decoy'],
    [sourceLegacy, 'source-legacy-authority'],
    [managedForeignVerification, 'managed-foreign-verification-decoy'],
    [sourceForeignVerification, 'source-foreign-verification-authority']
  ]) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({ revision })}\n`);
  }
  let writes = 0;

  await assert.rejects(executionStateTesting.writeExecutionStateWithLinkedCopies(currentRoot, nextState, {
    writeExecutionStateAtomic: async (filePath, value) => {
      writes += 1;
      if (writes === 1) {
        assert.deepEqual(JSON.parse(await readFile(sourceRouted, 'utf8')), { revision: 'transaction-routed' });
        assert.deepEqual(JSON.parse(await readFile(sourceForeignRouted, 'utf8')), { revision: 'source-foreign-authority' });
        assert.deepEqual(JSON.parse(await readFile(sourceLegacy, 'utf8')), { revision: 'source-legacy-authority' });
        assert.deepEqual(JSON.parse(await readFile(sourceForeignVerification, 'utf8')), { revision: 'source-foreign-verification-authority' });
      }
      if (writes === 2) throw new Error('injected routed commit-last failure');
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
    }
  }), /injected routed commit-last failure/);

  assert.equal(writes, 2);
  assert.deepEqual(JSON.parse(await readFile(sourceRouted, 'utf8')), { revision: 'original-routed' });
  assert.deepEqual(JSON.parse(await readFile(sourceForeignRouted, 'utf8')), { revision: 'source-foreign-authority' });
  assert.deepEqual(JSON.parse(await readFile(sourceLegacy, 'utf8')), { revision: 'source-legacy-authority' });
  assert.deepEqual(JSON.parse(await readFile(sourceForeignVerification, 'utf8')), { revision: 'source-foreign-verification-authority' });
  for (const statePath of statePaths) {
    assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), oldState);
  }
});

test('ROLLBACK-OWNERSHIP-002 linked artifact rollback preserves unrelated and replacement files in shared directories', async () => {
  const currentRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-linked-file-owner-current-'));
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-linked-file-owner-source-'));
  const storyId = 'story-linked-file-owner';
  const oldState = { story_id: storyId, revision: 'old' };
  const nextState = {
    story_id: storyId,
    revision: 'transaction-A',
    managed_worktree: { mode: 'managed', path: currentRoot, source_repo: sourceRoot }
  };
  const statePaths = [currentRoot, sourceRoot].map((root) => path.join(root, '.vibepro', 'executions', storyId, 'state.json'));
  for (const statePath of statePaths) {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(oldState, null, 2)}\n`);
  }

  const managedWorkspace = path.join(currentRoot, '.vibepro');
  const sourceWorkspace = path.join(sourceRoot, '.vibepro');
  const ownedFiles = [
    ['pr', storyId, 'pr-merge.json'],
    ['reviews', storyId, 'review.json'],
    ['verification', storyId, 'verification-evidence.json']
  ];
  const unrelatedFiles = [
    ['pr', storyId, 'operator-note.json'],
    ['reviews', storyId, 'operator-note.json'],
    ['verification', storyId, 'operator-note.json']
  ];
  for (const segments of ownedFiles) {
    const managedPath = path.join(managedWorkspace, ...segments);
    const sourcePath = path.join(sourceWorkspace, ...segments);
    await mkdir(path.dirname(managedPath), { recursive: true });
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(managedPath, `${JSON.stringify({ revision: 'transaction-A' })}\n`);
    await writeFile(sourcePath, `${JSON.stringify({ revision: 'original' })}\n`);
  }
  for (const segments of unrelatedFiles) {
    const sourcePath = path.join(sourceWorkspace, ...segments);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, `${JSON.stringify({ revision: 'operator-unrelated' })}\n`);
  }
  let writes = 0;

  await assert.rejects(executionStateTesting.writeExecutionStateWithLinkedCopies(currentRoot, nextState, {
    writeExecutionStateAtomic: async (filePath, value) => {
      writes += 1;
      if (writes === 2) throw new Error('injected commit-last failure after replacement writers');
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
      for (const segments of ownedFiles) {
        await writeFile(
          path.join(sourceWorkspace, ...segments),
          `${JSON.stringify({ revision: 'operator-B' })}\n`
        );
      }
    }
  }), (error) => {
    assert.equal(error.code, 'execution_state_transaction_restore_failed');
    assert.equal(error.cause?.message, 'injected commit-last failure after replacement writers');
    for (const segments of ownedFiles) {
      assert.ok(error.restore_errors.some((item) => item.path === path.join(sourceWorkspace, ...segments)));
    }
    return true;
  });

  assert.equal(writes, 2);
  for (const segments of ownedFiles) {
    assert.deepEqual(JSON.parse(await readFile(path.join(sourceWorkspace, ...segments), 'utf8')), {
      revision: 'operator-B'
    });
  }
  for (const segments of unrelatedFiles) {
    assert.deepEqual(JSON.parse(await readFile(path.join(sourceWorkspace, ...segments), 'utf8')), {
      revision: 'operator-unrelated'
    });
  }
});

test('DRS-CONTRACT-009 artifact sync failure cannot advance any execution-state authority', async () => {
  const currentRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-sync-current-'));
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-sync-source-'));
  const storyId = 'story-artifact-sync-rollback';
  const oldState = { story_id: storyId, completion_status: 'merged_reconciliation_required', revision: 'old' };
  const nextState = {
    ...oldState,
    completion_status: 'merged',
    revision: 'new',
    managed_worktree: { mode: 'managed', path: currentRoot, source_repo: sourceRoot }
  };
  const statePaths = [currentRoot, sourceRoot].map((root) => path.join(root, '.vibepro', 'executions', storyId, 'state.json'));
  for (const statePath of statePaths) {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(oldState, null, 2)}\n`);
  }
  let writes = 0;

  await assert.rejects(executionStateTesting.writeExecutionStateWithLinkedCopies(currentRoot, nextState, {
    syncManagedWorktreeArtifactsToSource: async () => {
      throw new Error('injected artifact sync failure');
    },
    writeExecutionStateAtomic: async () => {
      writes += 1;
    }
  }), /injected artifact sync failure/);

  assert.equal(writes, 0);
  for (const statePath of statePaths) {
    assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), oldState);
  }
});

test('DRS-CONTRACT-008 source artifact rollback preserves an interleaved writer and reports ownership conflict', async () => {
  const currentRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-artifact-owner-current-'));
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-artifact-owner-source-'));
  const storyId = 'story-artifact-owner-conflict';
  const sourcePrDir = path.join(sourceRoot, '.vibepro', 'pr', storyId);
  const sourceMergePath = path.join(sourcePrDir, 'pr-merge.json');
  await mkdir(sourcePrDir, { recursive: true });
  await writeFile(sourceMergePath, `${JSON.stringify({ revision: 'old' })}\n`);
  const nextState = {
    story_id: storyId,
    revision: 'transaction-A',
    managed_worktree: { mode: 'managed', path: currentRoot, source_repo: sourceRoot }
  };

  await assert.rejects(executionStateTesting.writeExecutionStateWithLinkedCopies(currentRoot, nextState, {
    syncManagedWorktreeArtifactsToSource: async (_root, _state, options) => {
      await options.onArtifactWillWrite(sourceMergePath);
      await writeFile(sourceMergePath, `${JSON.stringify({ revision: 'transaction-A' })}\n`);
      await options.onArtifactWritten(sourceMergePath);
      await writeFile(sourceMergePath, `${JSON.stringify({ revision: 'concurrent-B' })}\n`);
      throw new Error('injected failure after concurrent source artifact update');
    }
  }), (error) => {
    assert.equal(error.code, 'execution_state_transaction_restore_failed');
    assert.equal(error.cause?.message, 'injected failure after concurrent source artifact update');
    assert.match(error.restore_errors[0].message, /changed concurrently/);
    return true;
  });

  assert.deepEqual(JSON.parse(await readFile(sourceMergePath, 'utf8')), { revision: 'concurrent-B' });
});

test('DRS-CONTRACT-008 rollback never clobbers a concurrent state update made before this transaction writes', async () => {
  const currentRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-concurrent-current-'));
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-concurrent-source-'));
  const storyId = 'story-concurrent-preservation';
  const oldState = { story_id: storyId, revision: 'old' };
  const concurrentState = { story_id: storyId, revision: 'concurrent-B' };
  const nextState = {
    story_id: storyId,
    revision: 'transaction-A',
    managed_worktree: { mode: 'managed', path: currentRoot, source_repo: sourceRoot }
  };
  const statePaths = [currentRoot, sourceRoot].map((root) => path.join(root, '.vibepro', 'executions', storyId, 'state.json'));
  for (const statePath of statePaths) {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(oldState, null, 2)}\n`);
  }

  await assert.rejects(executionStateTesting.writeExecutionStateWithLinkedCopies(currentRoot, nextState, {
    syncManagedWorktreeArtifactsToSource: async () => {
      for (const statePath of statePaths) {
        await writeFile(statePath, `${JSON.stringify(concurrentState, null, 2)}\n`);
      }
      throw new Error('injected synchronization failure after concurrent commit');
    }
  }), /injected synchronization failure after concurrent commit/);

  for (const statePath of statePaths) {
    assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), concurrentState);
  }
});

test('DRS-CONTRACT-008 rollback reports a conflict instead of clobbering a concurrent update after a transaction write', async () => {
  const currentRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-interleave-current-'));
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-interleave-source-'));
  const storyId = 'story-interleave-preservation';
  const oldState = { story_id: storyId, revision: 'old' };
  const concurrentState = { story_id: storyId, revision: 'concurrent-B' };
  const nextState = {
    story_id: storyId,
    revision: 'transaction-A',
    managed_worktree: { mode: 'managed', path: currentRoot, source_repo: sourceRoot }
  };
  const statePaths = [currentRoot, sourceRoot].map((root) => path.join(root, '.vibepro', 'executions', storyId, 'state.json'));
  for (const statePath of statePaths) {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(oldState, null, 2)}\n`);
  }
  let writes = 0;

  await assert.rejects(executionStateTesting.writeExecutionStateWithLinkedCopies(currentRoot, nextState, {
    syncManagedWorktreeArtifactsToSource: async () => {},
    writeExecutionStateAtomic: async (filePath, value) => {
      writes += 1;
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
      if (writes === 1) {
        await writeFile(filePath, `${JSON.stringify(concurrentState, null, 2)}\n`);
        return;
      }
      throw new Error('injected commit-last failure');
    }
  }), (error) => {
    assert.equal(error.code, 'execution_state_transaction_restore_failed');
    assert.equal(error.cause?.message, 'injected commit-last failure');
    assert.match(error.restore_errors[0].message, /changed concurrently/);
    return true;
  });

  assert.deepEqual(JSON.parse(await readFile(statePaths[0], 'utf8')), oldState);
  assert.deepEqual(JSON.parse(await readFile(statePaths[1], 'utf8')), concurrentState);
});

test('DRS-CONTRACT-008 rollback failure is explicit and preserves the original transaction error as cause', async () => {
  const currentRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-restore-current-'));
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-restore-source-'));
  const storyId = 'story-transaction-restore-failure';
  const nextState = {
    story_id: storyId,
    completion_status: 'merged',
    managed_worktree: { mode: 'managed', path: currentRoot, source_repo: sourceRoot }
  };
  let writes = 0;

  await assert.rejects(executionStateTesting.writeExecutionStateWithLinkedCopies(currentRoot, nextState, {
    syncManagedWorktreeArtifactsToSource: async () => {},
    writeExecutionStateAtomic: async (filePath, value) => {
      writes += 1;
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
      if (writes === 2) throw new Error('injected transaction failure');
    },
    restoreExecutionStateSnapshot: async () => {
      throw new Error('injected rollback failure');
    }
  }), (error) => {
    assert.equal(error.code, 'execution_state_transaction_restore_failed');
    assert.equal(error.cause?.message, 'injected transaction failure');
    assert.equal(error.restore_errors.length, 2);
    assert.match(error.message, /rollback was incomplete/);
    return true;
  });
});

test('DRS-CONTRACT-007 merge follow-up restoration failure is never swallowed', async () => {
  const originalError = new Error('injected reconciled state write failure');
  await assert.rejects(executionStateTesting.restoreMergeFollowupStateOrThrow('/tmp/repo', {
    storyId: 'story-merge-followup-restore',
    merge: { status: 'merged', reconciliation: { status: 'reconciliation_required' } },
    originalError,
    persist: async () => {
      throw new Error('injected merge artifact restore failure');
    }
  }), (error) => {
    assert.equal(error.code, 'execution_reconciliation_restore_failed');
    assert.equal(error.cause, originalError);
    assert.match(error.message, /original merge follow-up artifact could not be restored/);
    assert.equal(error.restore_error, 'injected merge artifact restore failure');
    return true;
  });
});

test('DRS-CONTRACT-007 reconciliation caller restores the original follow-up after final state persistence fails', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-caller-'));
  const storyId = 'story-reconciliation-caller';
  await mkdir(path.join(repoRoot, '.vibepro'), { recursive: true });
  await writeFile(path.join(repoRoot, '.vibepro', 'config.json'), '{}\n');
  const originalMerge = {
    status: 'failed',
    delivery: { status: 'merged' },
    reconciliation: { status: 'reconciliation_required', reasons: ['execution_state_sync_failed'] }
  };
  let buildCalls = 0;
  let writeCalls = 0;
  let restoredMerge = null;

  await assert.rejects(reconcileExecutionState(repoRoot, {
    storyId,
    baseRef: 'origin/main',
    pr: '123',
    readManagedExecutionState: async () => ({ target: 'pr_create', managed_worktree: null }),
    refreshManagedWorktree: async () => null,
    buildExecutionState: async () => ({ story_id: storyId, revision: ++buildCalls }),
    writeExecutionStateWithLinkedCopies: async (_root, value) => {
      writeCalls += 1;
      if (writeCalls === 2) throw new Error('injected final reconciled-state persistence failure');
      return { state: value, found: true };
    },
    consumeExecutionStateSyncFailure: async () => ({ original: originalMerge }),
    persistMergeFollowupState: async (_root, { merge }) => {
      restoredMerge = merge;
    }
  }), /injected final reconciled-state persistence failure/);

  assert.equal(buildCalls, 2);
  assert.equal(writeCalls, 2);
  assert.deepEqual(restoredMerge, originalMerge);
});

test('DRS-CONTRACT-008 reconciliation initial write rejects a concurrent operator state', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-initial-cas-'));
  const storyId = 'story-reconciliation-initial-cas';
  const statePath = path.join(repoRoot, '.vibepro', 'executions', storyId, 'state.json');
  const observedState = { story_id: storyId, target: 'pr_create', revision: 'observed-A' };
  const operatorState = { ...observedState, revision: 'operator-B' };
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(path.join(repoRoot, '.vibepro', 'config.json'), '{}\n');
  await writeFile(statePath, `${JSON.stringify(observedState, null, 2)}\n`);

  await assert.rejects(reconcileExecutionState(repoRoot, {
    storyId,
    readManagedExecutionState: async () => observedState,
    refreshManagedWorktree: async () => null,
    buildExecutionState: async () => {
      await writeFile(statePath, `${JSON.stringify(operatorState, null, 2)}\n`);
      return { ...observedState, revision: 'transaction-C' };
    },
    consumeExecutionStateSyncFailure: async () => null
  }), (error) => {
    assert.equal(error.code, 'execution_state_transaction_conflict');
    return true;
  });

  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), operatorState);
});

test('DRS-CONTRACT-008 reconciliation initial write rejects a concurrent state creation', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-initial-create-cas-'));
  const storyId = 'story-reconciliation-initial-create-cas';
  const statePath = path.join(repoRoot, '.vibepro', 'executions', storyId, 'state.json');
  const operatorState = { story_id: storyId, target: 'pr_create', revision: 'operator-B' };
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(path.join(repoRoot, '.vibepro', 'config.json'), '{}\n');

  await assert.rejects(reconcileExecutionState(repoRoot, {
    storyId,
    readManagedExecutionState: async () => null,
    refreshManagedWorktree: async () => null,
    buildExecutionState: async () => {
      await writeFile(statePath, `${JSON.stringify(operatorState, null, 2)}\n`);
      return { story_id: storyId, target: 'pr_create', revision: 'transaction-C' };
    },
    consumeExecutionStateSyncFailure: async () => null
  }), (error) => {
    assert.equal(error.code, 'execution_state_transaction_conflict');
    return true;
  });

  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), operatorState);
});

test('DRS-CONTRACT-009 linked-only observed authority is a valid compare-and-swap baseline', async () => {
  const currentRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-linked-only-current-'));
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-linked-only-source-'));
  const storyId = 'story-linked-only-cas';
  const observedState = {
    story_id: storyId,
    target: 'pr_create',
    revision: 'observed-A',
    managed_worktree: { mode: 'managed', path: currentRoot, source_repo: sourceRoot }
  };
  const nextState = { ...observedState, revision: 'transaction-B' };
  const currentPath = path.join(currentRoot, '.vibepro', 'executions', storyId, 'state.json');
  const sourcePath = path.join(sourceRoot, '.vibepro', 'executions', storyId, 'state.json');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, `${JSON.stringify(observedState, null, 2)}\n`);

  await executionStateTesting.writeExecutionStateWithLinkedCopies(currentRoot, nextState, {
    expectedCurrentState: observedState,
    syncManagedWorktreeArtifactsToSource: async () => {}
  });

  assert.deepEqual(JSON.parse(await readFile(currentPath, 'utf8')), nextState);
  assert.deepEqual(JSON.parse(await readFile(sourcePath, 'utf8')), nextState);
});

test('DRS-CONTRACT-009 compare-and-swap rejects a concurrent linked-authority update', async () => {
  const currentRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-linked-cas-current-'));
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-linked-cas-source-'));
  const storyId = 'story-linked-authority-cas';
  const observedState = {
    story_id: storyId,
    target: 'pr_create',
    revision: 'observed-A',
    managed_worktree: { mode: 'managed', path: currentRoot, source_repo: sourceRoot }
  };
  const operatorState = { ...observedState, revision: 'operator-B' };
  const nextState = { ...observedState, revision: 'transaction-C' };
  const currentPath = path.join(currentRoot, '.vibepro', 'executions', storyId, 'state.json');
  const sourcePath = path.join(sourceRoot, '.vibepro', 'executions', storyId, 'state.json');
  for (const [statePath, value] of [[currentPath, observedState], [sourcePath, operatorState]]) {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  await assert.rejects(executionStateTesting.writeExecutionStateWithLinkedCopies(currentRoot, nextState, {
    expectedCurrentState: observedState,
    syncManagedWorktreeArtifactsToSource: async () => {}
  }), (error) => {
    assert.equal(error.code, 'execution_state_transaction_conflict');
    assert.equal(error.artifact_path, sourcePath);
    return true;
  });

  assert.deepEqual(JSON.parse(await readFile(currentPath, 'utf8')), observedState);
  assert.deepEqual(JSON.parse(await readFile(sourcePath, 'utf8')), operatorState);
});

test('DRS-CONTRACT-008 merge follow-up compare-and-swap refuses to restore over newer operator guidance', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-followup-cas-'));
  const storyId = 'story-followup-cas';
  const mergePath = path.join(repoRoot, '.vibepro', 'pr', storyId, 'pr-merge.json');
  await mkdir(path.dirname(mergePath), { recursive: true });
  const expectedRecovered = { status: 'merged', revision: 'recovered-A' };
  const concurrent = { status: 'merged', revision: 'operator-B' };
  await writeFile(mergePath, `${JSON.stringify(concurrent, null, 2)}\n`);

  await assert.rejects(persistMergeFollowupState(repoRoot, {
    storyId,
    merge: { status: 'failed', revision: 'original' },
    expectedMerge: expectedRecovered
  }), (error) => {
    assert.equal(error.code, 'merge_followup_transaction_conflict');
    assert.match(error.message, /changed concurrently/);
    return true;
  });

  assert.deepEqual(JSON.parse(await readFile(mergePath, 'utf8')), concurrent);
});

test('DRS-CONTRACT-007 local recovery persistence keeps synchronization guidance after canonical follow-up rollback', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-followup-recovery-'));
  const storyId = 'story-followup-recovery';
  const mergePath = path.join(repoRoot, '.vibepro', 'pr', storyId, 'pr-merge.json');
  await mkdir(path.dirname(mergePath), { recursive: true });
  const expectedMerge = { status: 'merged', reconciliation: { status: 'reconciled', reasons: [] } };
  await writeFile(mergePath, `${JSON.stringify(expectedMerge, null, 2)}\n`);
  const failedMerge = {
    ...expectedMerge,
    stop_reason: 'execution_state_sync_failed',
    execution_state_sync: {
      status: 'failed',
      recovery_command: `vibepro execute reconcile . --story-id ${storyId} --base main`
    },
    reconciliation: { status: 'reconciliation_required', reasons: ['execution_state_sync_failed'] }
  };

  await persistMergeRecoveryState(repoRoot, { storyId, merge: failedMerge, expectedMerge });

  const persisted = JSON.parse(await readFile(mergePath, 'utf8'));
  assert.equal(persisted.execution_state_sync.status, 'failed');
  assert.equal(persisted.reconciliation.status, 'reconciliation_required');
  assert.match(persisted.execution_state_sync.recovery_command, /execute reconcile/);
});

test('DRS-CONTRACT-008 local recovery CAS preserves newer operator guidance', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-recovery-cas-'));
  const storyId = 'story-recovery-cas';
  const mergePath = path.join(repoRoot, '.vibepro', 'pr', storyId, 'pr-merge.json');
  await mkdir(path.dirname(mergePath), { recursive: true });
  const observed = { status: 'merged', revision: 'observed-A' };
  const operator = { status: 'merged', revision: 'operator-B' };
  await writeFile(mergePath, `${JSON.stringify(operator, null, 2)}\n`);

  await assert.rejects(persistMergeRecoveryState(repoRoot, {
    storyId,
    merge: { ...observed, stop_reason: 'execution_state_sync_failed' },
    expectedMerge: observed
  }), (error) => {
    assert.equal(error.code, 'merge_recovery_state_conflict');
    return true;
  });

  assert.deepEqual(JSON.parse(await readFile(mergePath, 'utf8')), operator);
});

test('DRS-CONTRACT-008 merge follow-up CAS protects canonical and manifest authority surfaces', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-followup-all-authority-cas-'));
  const storyId = 'story-followup-all-authority-cas';
  const prDir = path.join(repoRoot, '.vibepro', 'pr', storyId);
  const canonicalDir = path.join(repoRoot, 'docs', 'management', 'audit-artifacts', storyId);
  const canonicalIndexPath = path.join(canonicalDir, 'audit-index.json');
  const manifestPath = path.join(repoRoot, '.vibepro', 'vibepro-manifest.json');
  await mkdir(prDir, { recursive: true });
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-merge.json'), `${JSON.stringify({ revision: 'observed-A' })}\n`);
  await writeFile(canonicalIndexPath, `${JSON.stringify({ revision: 'canonical-A' })}\n`);
  await writeFile(manifestPath, `${JSON.stringify({ revision: 'manifest-A' })}\n`);

  await assert.rejects(persistMergeFollowupState(repoRoot, {
    storyId,
    merge: { status: 'merged', revision: 'transaction-A' }
  }, {
    promoteCanonicalAuditArtifacts: async (_root, { onArtifactWritten }) => {
      await writeFile(canonicalIndexPath, `${JSON.stringify({ revision: 'transaction-A' })}\n`);
      await onArtifactWritten(canonicalIndexPath);
      await writeFile(manifestPath, `${JSON.stringify({ revision: 'operator-B' })}\n`);
      return {
        bundle_path: path.join(canonicalDir, 'audit-bundle.json'),
        canonical_dir: canonicalDir,
        bundle: { artifacts: [], missing_artifacts: [] }
      };
    }
  }), (error) => {
    assert.equal(error.code, 'merge_followup_transaction_restore_failed');
    assert.equal(error.cause?.code, 'merge_followup_transaction_conflict');
    assert.equal(error.cause?.artifact_path, manifestPath);
    return true;
  });

  assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), { revision: 'operator-B' });
  assert.deepEqual(JSON.parse(await readFile(canonicalIndexPath, 'utf8')), { revision: 'canonical-A' });
});

test('DRS-CONTRACT-008 merge follow-up rollback restores only proven transaction-owned files', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-followup-owned-files-'));
  const storyId = 'story-followup-owned-files';
  const prDir = path.join(repoRoot, '.vibepro', 'pr', storyId);
  const mergePath = path.join(prDir, 'pr-merge.json');
  const mergeReportPath = path.join(prDir, 'pr-merge.html');
  const manifestPath = path.join(repoRoot, '.vibepro', 'vibepro-manifest.json');
  const unrelatedPrPath = path.join(prDir, 'operator-note.json');
  const canonicalDir = path.join(repoRoot, 'docs', 'management', 'audit-artifacts', storyId);
  const canonicalIndexPath = path.join(canonicalDir, 'audit-index.json');
  const unrelatedCanonicalPath = path.join(canonicalDir, 'operator-note.json');
  const partialUnknownPath = path.join(canonicalDir, 'partial-unowned.json');
  await mkdir(prDir, { recursive: true });
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(mergePath, `${JSON.stringify({ revision: 'original' })}\n`);
  await writeFile(mergeReportPath, 'original report');
  await writeFile(manifestPath, `${JSON.stringify({ revision: 'manifest-original' })}\n`);
  await writeFile(unrelatedPrPath, `${JSON.stringify({ revision: 'operator-original' })}\n`);
  await writeFile(canonicalIndexPath, `${JSON.stringify({ revision: 'canonical-original' })}\n`);
  await writeFile(unrelatedCanonicalPath, `${JSON.stringify({ revision: 'operator-original' })}\n`);

  await assert.rejects(persistMergeFollowupState(repoRoot, {
    storyId,
    merge: { status: 'merged', revision: 'transaction-A' }
  }, {
    promoteCanonicalAuditArtifacts: async () => {
      await writeFile(canonicalIndexPath, `${JSON.stringify({ revision: 'transaction-A' })}\n`);
      await writeFile(unrelatedCanonicalPath, `${JSON.stringify({ revision: 'operator-B' })}\n`);
      await writeFile(partialUnknownPath, `${JSON.stringify({ revision: 'unknown-partial' })}\n`);
      throw new Error('injected canonical promotion failure before ownership result');
    }
  }), /injected canonical promotion failure before ownership result/);

  assert.deepEqual(JSON.parse(await readFile(mergePath, 'utf8')), { revision: 'original' });
  assert.equal(await readFile(mergeReportPath, 'utf8'), 'original report');
  assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), { revision: 'manifest-original' });
  assert.deepEqual(JSON.parse(await readFile(canonicalIndexPath, 'utf8')), { revision: 'transaction-A' });
  assert.deepEqual(JSON.parse(await readFile(unrelatedPrPath, 'utf8')), { revision: 'operator-original' });
  assert.deepEqual(JSON.parse(await readFile(unrelatedCanonicalPath, 'utf8')), { revision: 'operator-B' });
  assert.deepEqual(JSON.parse(await readFile(partialUnknownPath, 'utf8')), { revision: 'unknown-partial' });
});

test('ROLLBACK-OWNERSHIP-002 merge follow-up preserves a replacement writer after owned fingerprint capture', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-followup-replacement-writer-'));
  const storyId = 'story-followup-replacement-writer';
  const prDir = path.join(repoRoot, '.vibepro', 'pr', storyId);
  const mergePath = path.join(prDir, 'pr-merge.json');
  const canonicalDir = path.join(repoRoot, 'docs', 'management', 'audit-artifacts', storyId);
  const canonicalIndexPath = path.join(canonicalDir, 'audit-index.json');
  await mkdir(prDir, { recursive: true });
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(mergePath, `${JSON.stringify({ revision: 'original' })}\n`);
  await writeFile(canonicalIndexPath, `${JSON.stringify({ revision: 'canonical-original' })}\n`);

  await assert.rejects(persistMergeFollowupState(repoRoot, {
    storyId,
    merge: { status: 'merged', revision: 'transaction-A' }
  }, {
    promoteCanonicalAuditArtifacts: async (_root, { onArtifactWritten }) => {
      await writeFile(canonicalIndexPath, `${JSON.stringify({ revision: 'transaction-A' })}\n`);
      await onArtifactWritten(canonicalIndexPath);
      await writeFile(canonicalIndexPath, `${JSON.stringify({ revision: 'operator-B' })}\n`);
      throw new Error('injected promotion failure after replacement writer');
    }
  }), (error) => {
    assert.equal(error.code, 'merge_followup_transaction_restore_failed');
    assert.equal(error.cause?.message, 'injected promotion failure after replacement writer');
    assert.ok(error.restore_errors.some((item) => item.artifact_path === canonicalIndexPath));
    return true;
  });

  assert.deepEqual(JSON.parse(await readFile(mergePath, 'utf8')), { revision: 'original' });
  assert.deepEqual(JSON.parse(await readFile(canonicalIndexPath, 'utf8')), { revision: 'operator-B' });
});

test('DRS-CONTRACT-007 JSON CLI diagnostics preserve the original failure and rollback damage separately', () => {
  const originalError = new Error('injected final persistence failure');
  const error = new Error('rollback was incomplete', { cause: originalError });
  error.code = 'execution_state_transaction_restore_failed';
  error.restore_error = 'merge artifact restore failed';
  error.restore_errors = [{ path: '/tmp/state.json', message: 'concurrent change' }];

  assert.deepEqual(buildCliErrorPayload(error), {
    ok: false,
    error: {
      message: 'rollback was incomplete',
      code: 'execution_state_transaction_restore_failed',
      cause: 'injected final persistence failure',
      cause_details: {
        message: 'injected final persistence failure',
        code: null,
        cause: null,
        cause_details: null,
        restore_error: null,
        restore_errors: []
      },
      restore_error: 'merge artifact restore failed',
      restore_errors: [{ path: '/tmp/state.json', message: 'concurrent change' }]
    }
  });
});

test('execution summaries preserve delivery reconciliation handoff state', () => {
  const status = renderExecutionStateSummary({ state, artifact: '.vibepro/executions/story-delivery/state.json' });
  const next = renderExecutionNextSummary({ state, next: state });
  for (const output of [status, next]) {
    assert.match(output, /delivery: merged_externally/);
    assert.match(output, /reconciliation: reconciliation_required/);
    assert.match(output, /reconciliation_reasons: gate_not_ready/);
    assert.match(output, /blocking_gate: delivery_reconciliation/);
  }
});

test('execution DAG preserves external delivery without inventing historical merge readiness', () => {
  const dag = buildExecutionDag({
    managedWorktree: { mode: 'disabled' },
    completedPhases: ['verify', 'agent_review', 'ready_for_pr_create', 'merge'],
    completionStatus: 'merged_reconciliation_required',
    prMerge: {
      status: 'merged_externally',
      delivery: { status: 'merged_externally' },
      reconciliation: { status: 'blocked', reasons: ['delivery_not_verified'] }
    }
  });
  assert.equal(dag.nodes.find((node) => node.id === 'pr_created')?.status, 'passed');
  assert.equal(dag.nodes.find((node) => node.id === 'merge_ready')?.status, 'not_applicable');
  assert.match(dag.nodes.find((node) => node.id === 'merge_ready')?.reason, /External delivery/);
  assert.equal(dag.nodes.find((node) => node.id === 'merged_or_closed')?.status, 'passed');
  assert.equal(dag.nodes.find((node) => node.id === 'delivery_reconciliation')?.status, 'blocked');
  assert.equal(dag.nodes.find((node) => node.id === 'delivery_reconciliation')?.required, true);
  assert.equal(dag.nodes.find((node) => node.id === 'pr_prepare_ready')?.status, 'passed');
});

test('execution DAG preserves delivered fact when canonical persistence fails', () => {
  const dag = buildExecutionDag({
    managedWorktree: { mode: 'disabled' },
    completedPhases: ['merge'],
    completionStatus: 'failed',
    prMerge: {
      status: 'failed',
      stop_reason: 'canonical_audit_persistence_failed',
      delivery: { status: 'merged' }
    }
  });
  assert.equal(dag.nodes.find((node) => node.id === 'pr_created')?.status, 'passed');
  assert.equal(dag.nodes.find((node) => node.id === 'merged_or_closed')?.status, 'passed');
  assert.equal(dag.nodes.find((node) => node.id === 'delivery_reconciliation')?.status, 'blocked');
  assert.equal(dag.nodes.find((node) => node.id === 'agent_review_recorded')?.status, 'pending');
  assert.equal(dag.nodes.find((node) => node.id === 'pr_prepare_ready')?.status, 'not_applicable');
  assert.equal(dag.nodes.find((node) => node.id === 'implementation_complete')?.status, 'passed');
});

test('DRS-S-2 execution DAG does not revive explicitly unverified delivery through legacy merge fields', () => {
  const dag = buildExecutionDag({
    managedWorktree: { mode: 'disabled' },
    completedPhases: ['merge'],
    completionStatus: 'failed',
    prMerge: {
      status: 'failed',
      merge_commit_sha: 'legacy-sha-must-not-win',
      merged_at: '2026-07-17T00:00:00.000Z',
      delivery: { status: 'unverified' },
      reconciliation: { status: 'blocked', reasons: ['delivery_not_verified'] }
    }
  });
  assert.equal(dag.nodes.find((node) => node.id === 'merge_ready')?.status, 'blocked');
  assert.equal(dag.nodes.find((node) => node.id === 'merged_or_closed')?.status, 'blocked');
  assert.equal(dag.nodes.find((node) => node.id === 'delivery_reconciliation')?.status, 'blocked');
  assert.equal(dag.nodes.find((node) => node.id === 'delivery_reconciliation')?.required, true);
});

test('DRS-S-5 CLI merge-state update cannot overwrite canonical persistence failure with merged', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-update-failure-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), '{}\n');

  const result = await updateExecutionStateFromPrMerge(root, {
    merge: {
      story: { story_id: 'story-delivery' },
      status: 'failed',
      stop_reason: 'canonical_audit_persistence_failed',
      base: 'main',
      delivery: { status: 'merged', merge_commit_sha: headSha },
      reconciliation: { status: 'reconciled', reasons: [] },
      pr: { url: 'https://example.test/pr/1' }
    }
  }, { storyId: 'story-delivery', baseRef: 'main' });

  assert.equal(result.state.completion_status, 'failed');
  assert.equal(result.state.current_phase, 'persist_canonical_audit');
  assert.equal(result.state.blocking_gate.id, 'merge_failure');
  assert.equal(result.state.delivery.status, 'merged');
  assert.match(result.state.next_actions[0], /canonical_audit_persistence_failed/);
  assert.match(result.state.next_actions[0], /--base main --pr https:\/\/example\.test\/pr\/1/);
});

test('DRS-CONTRACT-008 merge-state update rejects a stale successful result after concurrent state advance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-merge-cas-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), '{}\n');
  const statePath = path.join(root, '.vibepro', 'executions', 'story-delivery', 'state.json');
  let newerState;

  await assert.rejects(updateExecutionStateFromPrMerge(root, {
    merge: {
      story: { story_id: 'story-delivery' },
      status: 'merged',
      base: 'main',
      delivery: { status: 'merged', merge_commit_sha: headSha },
      reconciliation: { status: 'reconciled', reasons: [] },
      pr: { url: 'https://example.test/pr/1' }
    }
  }, {
    storyId: 'story-delivery',
    baseRef: 'main',
    beforeMergeStateCommit: async ({ observedState }) => {
      newerState = {
        ...observedState,
        completion_status: 'merged_reconciliation_required',
        current_phase: 'reconcile_delivery',
        reconciliation: { status: 'reconciliation_required', reasons: ['newer_operator_state'] },
        updated_at: '2026-07-19T00:00:00.000Z'
      };
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(statePath, `${JSON.stringify(newerState, null, 2)}\n`);
    }
  }), (error) => {
    assert.equal(error.code, 'execution_state_transaction_conflict');
    return true;
  });

  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), newerState);
});

test('DRS-S-5 final canonical persistence failure remains in the canonical persistence phase', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-final-persistence-failure-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), '{}\n');

  const result = await updateExecutionStateFromPrMerge(root, {
    merge: {
      story: { story_id: 'story-delivery' },
      status: 'failed',
      stop_reason: 'canonical_audit_final_persistence_failed',
      base: 'main',
      delivery: { status: 'merged', merge_commit_sha: headSha },
      reconciliation: { status: 'reconciled', reasons: [] }
    }
  }, { storyId: 'story-delivery', baseRef: 'main' });

  assert.equal(result.state.completion_status, 'failed');
  assert.equal(result.state.current_phase, 'persist_canonical_audit');
  assert.equal(result.state.blocking_gate.reason, 'canonical_audit_final_persistence_failed');
});

test('execution status keeps canonical persistence failure actionable after delivery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-failure-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-delivery');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-merge.json'), JSON.stringify({
    schema_version: '0.1.0',
    story: { story_id: 'story-delivery' },
    status: 'failed',
    stop_reason: 'canonical_audit_persistence_failed',
    current_head_sha: headSha,
    delivery: { status: 'merged', merge_commit_sha: headSha },
    reconciliation: { status: 'reconciled', reasons: [] },
    pr: { url: 'https://example.test/pr/1' }
  }));

  const result = await getExecutionStatus(root, { storyId: 'story-delivery', baseRef: 'main' });
  assert.equal(result.state.completion_status, 'failed');
  assert.equal(result.state.current_phase, 'persist_canonical_audit');
  assert.equal(result.state.blocking_gate.id, 'merge_failure');
  assert.equal(result.state.delivery.status, 'merged');
  assert.match(result.state.next_actions[0], /canonical_audit_persistence_failed/);
  assert.match(result.state.next_actions[0], /--base main --pr https:\/\/example\.test\/pr\/1/);
});

test('DRS-S-3 external delivery reconstruction does not invent historical merge readiness', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-external-delivery-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-delivery');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-merge.json'), JSON.stringify({
    story: { story_id: 'story-delivery' },
    status: 'merged_externally',
    current_head_sha: headSha,
    delivery: { status: 'merged_externally', merge_commit_sha: headSha },
    reconciliation: { status: 'reconciled', reasons: [] }
  }));

  const result = await getExecutionStatus(root, { storyId: 'story-delivery', baseRef: 'main' });
  assert.equal(result.state.completion_status, 'merged');
  assert.equal(result.state.completed_phases.includes('merge'), true);
  assert.equal(result.state.completed_phases.includes('merge_ready'), false);
  assert.equal(result.state.execution_dag.nodes.find((node) => node.id === 'merge_ready')?.status, 'not_applicable');
});

test('DRS-S-2 execution status does not revive production-shape unverified delivery through legacy merge fields', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-unverified-delivery-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-delivery');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-merge.json'), JSON.stringify({
    schema_version: '0.1.0',
    story: { story_id: 'story-delivery' },
    current_head_sha: headSha,
    status: 'merged',
    stop_reason: 'delivery_not_verified',
    merge_commit_sha: 'legacy-sha-must-not-win',
    merged_at: '2026-07-17T00:00:00.000Z',
    delivery: { status: 'unverified' },
    reconciliation: { status: 'blocked', reasons: ['delivery_not_verified'] }
  }));

  const result = await getExecutionStatus(root, { storyId: 'story-delivery', baseRef: 'main' });
  assert.equal(result.state.completion_status, 'blocked');
  assert.equal(result.state.current_phase, 'reconcile_delivery');
  assert.equal(result.state.blocking_gate.id, 'delivery_reconciliation');
  assert.equal(result.state.delivery.status, 'unverified');
  assert.equal(result.state.completed_phases.includes('merge_ready'), false);
  assert.equal(result.state.execution_dag.nodes.find((node) => node.id === 'merged_or_closed')?.status, 'blocked');
});

test('DRS-CONTRACT-007 current-head legacy local merge remains a compatibility fallback', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-legacy-local-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-delivery');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-merge.json'), JSON.stringify({
    schema_version: '0.1.0',
    story: { story_id: 'story-delivery' },
    current_head_sha: headSha,
    status: 'merged',
    merge_commit_sha: headSha,
    merged_at: '2026-07-17T00:00:00.000Z'
  }));

  const result = await getExecutionStatus(root, { storyId: 'story-delivery', baseRef: 'main' });
  assert.equal(result.state.completion_status, 'merged_reconciliation_required');
  assert.equal(result.state.completed_phases.includes('merge'), true);
  assert.equal(result.state.blocking_gate.id, 'delivery_reconciliation');
});

test('DRS-S-5 canonical-only delivery without trusted PR identity fails closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-canonical-delivery-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const auditDir = path.join(root, 'docs', 'management', 'audit-artifacts', 'story-canonical-delivery');
  await mkdir(auditDir, { recursive: true });
  await writeFile(path.join(auditDir, 'audit-bundle.json'), JSON.stringify({
    story_id: 'story-canonical-delivery',
    merge: {
      status: 'merged',
      delivery: { status: 'merged', observed: true },
      reconciliation: { status: 'reconciled', reasons: [] }
    }
  }));

  const result = await getExecutionStatus(root, { storyId: 'story-canonical-delivery', baseRef: 'main' });
  assert.equal(result.state.completion_status, 'not_prepared');
  assert.equal(result.state.delivery, null);
  assert.equal(result.state.completed_phases.includes('agent_review'), false);
  assert.equal(result.state.execution_dag.nodes.find((node) => node.id === 'agent_review_recorded')?.status, 'pending');
});

test('DRS-S-5 canonical delivery reconstructs state only when current PR identity matches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-canonical-identity-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-canonical-delivery');
  const auditDir = path.join(root, 'docs', 'management', 'audit-artifacts', 'story-canonical-delivery');
  await mkdir(prDir, { recursive: true });
  await mkdir(auditDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-create.json'), JSON.stringify({
    story: { story_id: 'story-canonical-delivery' },
    current_head_sha: headSha,
    base: 'main',
    pr_url: 'https://github.example.test/unson/vibepro/pull/444'
  }));
  await writeFile(path.join(auditDir, 'audit-bundle.json'), JSON.stringify({
    story_id: 'story-canonical-delivery',
    merge: {
      status: 'merged',
      base: 'main',
      pr: { selector: 'https://github.example.test/unson/vibepro/pull/444' },
      delivery: { status: 'merged', observed: true, pr_url: 'https://github.example.test/unson/vibepro/pull/444' },
      reconciliation: { status: 'reconciled', reasons: [] }
    }
  }));

  const result = await getExecutionStatus(root, { storyId: 'story-canonical-delivery', baseRef: 'main' });
  assert.equal(result.state.completion_status, 'merged');
  assert.equal(result.state.delivery.status, 'merged');
});

test('DRS-CONTRACT-007 delivered state without reconciliation fails closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-missing-reconciliation-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-delivery');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-merge.json'), JSON.stringify({
    story: { story_id: 'story-delivery' },
    status: 'merged',
    base: 'develop',
    current_head_sha: headSha,
    delivery: { status: 'merged', merge_commit_sha: headSha },
    pr: { url: 'https://github.com/Unson-LLC/vibepro/pull/901' }
  }));

  const result = await getExecutionStatus(root, { storyId: 'story-delivery' });
  assert.equal(result.state.completion_status, 'merged_reconciliation_required');
  assert.equal(result.state.current_phase, 'reconcile_delivery');
  assert.equal(result.state.blocking_gate.id, 'delivery_reconciliation');
  assert.match(result.state.next_actions[0], /vibepro pr prepare/);
  assert.match(result.state.next_actions[1], /--base develop --pr https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/901/);
});

test('DRS-CONTRACT-007 execution status preserves the authoritative synchronization recovery command', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-sync-recovery-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const storyId = 'story-sync-recovery';
  const prUrl = 'https://github.com/Unson-LLC/vibepro/pull/902';
  const recoveryCommand = `vibepro execute reconcile . --story-id ${storyId} --base develop --pr ${prUrl}`;
  const prDir = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-merge.json'), JSON.stringify({
    story: { story_id: storyId },
    status: 'merged',
    stop_reason: 'execution_state_sync_failed',
    base: 'develop',
    current_head_sha: headSha,
    delivery: { status: 'merged', merge_commit_sha: headSha, pr_url: prUrl },
    reconciliation: { status: 'reconciliation_required', reasons: ['execution_state_sync_failed'] },
    reconciliation_action: {
      status: 'required',
      reason: 'execution_state_sync_failed',
      commands: [recoveryCommand]
    },
    execution_state_sync: { status: 'failed', recovery_command: recoveryCommand },
    pr: { url: prUrl }
  }));

  const result = await getExecutionStatus(root, { storyId });
  assert.deepEqual(result.state.next_actions, [recoveryCommand]);
  assert.doesNotMatch(result.state.next_actions.join('\n'), /vibepro pr prepare|vibepro execute merge/);
  const next = await getExecutionNext(root, { storyId });
  assert.deepEqual(next.next.next_actions, [recoveryCommand]);
});

test('DRS-CONTRACT-007 current-head local delivery outranks stale canonical conflict', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-source-priority-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-delivery');
  const auditDir = path.join(root, 'docs', 'management', 'audit-artifacts', 'story-delivery', 'pr');
  await mkdir(prDir, { recursive: true });
  await mkdir(auditDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-merge.json'), JSON.stringify({
    story: { story_id: 'story-delivery' },
    status: 'merged',
    current_head_sha: headSha,
    delivery: { status: 'merged', merge_commit_sha: headSha },
    reconciliation: { status: 'reconciled', reasons: [] }
  }));
  await writeFile(path.join(auditDir, 'pr-merge.json'), JSON.stringify({
    story: { story_id: 'story-delivery' },
    status: 'blocked',
    delivery: { status: 'unverified' },
    reconciliation: { status: 'blocked', reasons: ['delivery_not_verified'] }
  }));

  const result = await getExecutionStatus(root, { storyId: 'story-delivery', baseRef: 'main' });
  assert.equal(result.state.completion_status, 'merged');
  assert.equal(result.state.delivery.status, 'merged');
  assert.equal(result.state.reconciliation.status, 'reconciled');
});

test('DRS-S-5 current provider failure cannot erase canonical observed delivery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-provider-retry-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-delivery');
  const auditDir = path.join(root, 'docs', 'management', 'audit-artifacts', 'story-delivery', 'pr');
  await mkdir(prDir, { recursive: true });
  await mkdir(auditDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-merge.json'), JSON.stringify({
    story: { story_id: 'story-delivery' },
    status: 'blocked',
    current_head_sha: headSha,
    base: 'main',
    pr: { selector: 'https://github.example.test/unson/vibepro/pull/111' },
    delivery: { status: 'unverified', pr_url: 'https://github.example.test/unson/vibepro/pull/111' },
    reconciliation: { status: 'blocked', reasons: ['provider_command_failed'] }
  }));
  await writeFile(path.join(auditDir, 'pr-merge.json'), JSON.stringify({
    story: { story_id: 'story-delivery' },
    status: 'merged_externally',
    base: 'main',
    pr: { selector: 'https://github.example.test/unson/vibepro/pull/111' },
    delivery: { status: 'merged_externally', merge_commit_sha: 'canonical-merge-sha', pr_url: 'https://github.example.test/unson/vibepro/pull/111' },
    reconciliation: { status: 'reconciled', reasons: [] }
  }));

  const result = await getExecutionStatus(root, { storyId: 'story-delivery', baseRef: 'main' });
  assert.equal(result.state.completion_status, 'merged_reconciliation_required');
  assert.equal(result.state.delivery.status, 'merged_externally');
  assert.equal(result.state.delivery.merge_commit_sha, 'canonical-merge-sha');
  assert.equal(result.state.reconciliation.status, 'blocked');
  assert.deepEqual(result.state.reconciliation.reasons, ['provider_command_failed']);
  assert.match(result.state.next_actions.join('\n'), /--pr https:\/\/github\.example\.test\/unson\/vibepro\/pull\/111/);
});

test('DRS-CONTRACT-007 canonical delivery fallback rejects a different PR or base identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-cross-pr-fallback-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-delivery');
  const auditDir = path.join(root, 'docs', 'management', 'audit-artifacts', 'story-delivery', 'pr');
  await mkdir(prDir, { recursive: true });
  await mkdir(auditDir, { recursive: true });
  await writeFile(path.join(prDir, 'pr-merge.json'), JSON.stringify({
    story: { story_id: 'story-delivery' },
    status: 'blocked',
    current_head_sha: headSha,
    base: 'develop',
    pr: { selector: 'https://github.example.test/unson/vibepro/pull/222' },
    delivery: { status: 'unverified', pr_url: 'https://github.example.test/unson/vibepro/pull/222' },
    reconciliation: { status: 'blocked', reasons: ['provider_command_failed'] }
  }));
  await writeFile(path.join(auditDir, 'pr-merge.json'), JSON.stringify({
    story: { story_id: 'story-delivery' },
    status: 'merged_externally',
    base: 'main',
    pr: { selector: 'https://github.example.test/unson/vibepro/pull/111' },
    delivery: { status: 'merged_externally', merge_commit_sha: 'other-merge-sha', pr_url: 'https://github.example.test/unson/vibepro/pull/111' },
    reconciliation: { status: 'reconciled', reasons: [] }
  }));

  const result = await getExecutionStatus(root, { storyId: 'story-delivery', baseRef: 'develop' });
  assert.equal(result.state.completion_status, 'blocked');
  assert.equal(result.state.delivery.status, 'unverified');
  assert.equal(result.state.reconciliation.status, 'blocked');
  assert.match(result.state.next_actions.join('\n'), /--pr https:\/\/github\.example\.test\/unson\/vibepro\/pull\/222/);
});

test('DRS-CONTRACT-007 nested base identity preserves branch paths and normalizes explicit origin refs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-nested-base-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-delivery');
  const auditDir = path.join(root, 'docs', 'management', 'audit-artifacts', 'story-delivery', 'pr');
  await mkdir(prDir, { recursive: true });
  await mkdir(auditDir, { recursive: true });
  const prSelector = 'https://github.example.test/unson/vibepro/pull/333';
  await writeFile(path.join(prDir, 'pr-merge.json'), JSON.stringify({
    story: { story_id: 'story-delivery' },
    status: 'blocked',
    current_head_sha: headSha,
    base: 'release/2026',
    pr: { selector: prSelector },
    delivery: { status: 'unverified', pr_url: prSelector },
    reconciliation: { status: 'blocked', reasons: ['provider_command_failed'] }
  }));
  const canonical = {
    story: { story_id: 'story-delivery' },
    status: 'merged_externally',
    base: 'hotfix/2026',
    pr: { selector: prSelector },
    delivery: { status: 'merged_externally', merge_commit_sha: 'canonical-merge-sha', pr_url: prSelector },
    reconciliation: { status: 'reconciled', reasons: [] }
  };
  await writeFile(path.join(auditDir, 'pr-merge.json'), JSON.stringify(canonical));

  const mismatch = await getExecutionStatus(root, { storyId: 'story-delivery', baseRef: 'release/2026' });
  assert.equal(mismatch.state.completion_status, 'blocked');
  assert.equal(mismatch.state.delivery.status, 'unverified');

  canonical.base = 'origin/release/2026';
  await writeFile(path.join(auditDir, 'pr-merge.json'), JSON.stringify(canonical));
  const equivalent = await getExecutionStatus(root, { storyId: 'story-delivery', baseRef: 'release/2026' });
  assert.equal(equivalent.state.completion_status, 'merged_reconciliation_required');
  assert.equal(equivalent.state.delivery.status, 'merged_externally');
  assert.equal(equivalent.state.delivery.merge_commit_sha, 'canonical-merge-sha');
});

test('DRS-CONTRACT-003 execution status prefers same-head pr-prepare over standalone ready Gate DAG', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-gate-authority-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-delivery');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), '{}\n');
  await writeFile(path.join(prDir, 'pr-prepare.json'), JSON.stringify({
    story: { story_id: 'story-delivery' },
    git: { head_sha: headSha },
    toolchain: { source_git: { commit: headSha } },
    gate_status: { ready_for_pr_create: false },
    pr_context: {
      gate_dag: {
        overall_status: 'blocked',
        nodes: [{ id: 'gate:verification', required: true, status: 'needs_evidence' }]
      }
    }
  }));
  await writeFile(path.join(prDir, 'gate-dag.json'), JSON.stringify({
    overall_status: 'ready_for_review',
    nodes: [],
    artifact_freshness: { status: 'current', artifact_head_sha: headSha }
  }));

  const result = await getExecutionStatus(root, { storyId: 'story-delivery', baseRef: 'main' });
  assert.equal(result.state.completion_status, 'waiver_required');
  assert.equal(result.state.last_pr_prepare.overall_status, 'blocked');
  assert.notEqual(result.state.completion_status, 'ready_for_pr_create');
});

test('CAA-VERIFY-001 current created PR remains merge-ready when its same-head pr-prepare is unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-execution-current-pr-create-'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'test: initialize fixture'], { cwd: root });
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const headSha = stdout.trim();
  const prDir = path.join(root, '.vibepro', 'pr', 'story-delivery');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), '{}\n');
  await writeFile(path.join(prDir, 'pr-create.json'), JSON.stringify({
    story: { story_id: 'story-delivery' },
    base: 'main',
    pr_url: 'https://github.com/Unson-LLC/vibepro/pull/901',
    dry_run: false,
    current_head_sha: headSha,
    artifact_freshness: { status: 'current', artifact_head_sha: headSha },
    gate_dag: { overall_status: 'ready_for_review', nodes: [] }
  }));

  const result = await getExecutionStatus(root, { storyId: 'story-delivery', baseRef: 'main' });
  assert.equal(result.state.completion_status, 'pr_created');
  assert.equal(result.state.current_phase, 'complete');
  assert.match(result.state.next_actions[0], /vibepro execute merge/);
});
