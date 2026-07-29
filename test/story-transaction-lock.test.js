import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { withStoryTransactionLocks } from '../src/story-transaction-lock.js';

function lockPaths(repoRoot, storyId) {
  const lockPath = path.join(
    repoRoot,
    '.vibepro',
    'locks',
    `${storyId}.delivery-reconciliation.lock`
  );
  return {
    lockPath,
    ownerPath: path.join(lockPath, 'owner.json'),
    transitionPath: path.join(lockPath, '.transition'),
    transitionOwnerPath: path.join(lockPath, '.transition', 'owner.json')
  };
}

function ownerMetadata(token, pid, createdAt = new Date(0).toISOString()) {
  return {
    token,
    pid,
    hostname: os.hostname(),
    created_at: createdAt,
    heartbeat_at: createdAt
  };
}

async function writeOwner(ownerPath, owner) {
  await writeFile(ownerPath, `${JSON.stringify(owner, null, 2)}\n`);
}

async function agePath(targetPath) {
  const old = new Date(Date.now() - 60_000);
  await utimes(targetPath, old, old);
}

test('DRS-CONTRACT-008 LOCK-TOCTOU-001 paused initializer cannot overwrite a successor owner after resuming', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-lock-paused-init-'));
  const storyId = 'story-paused-initializer';
  const { ownerPath } = lockPaths(repoRoot, storyId);
  let resumeInitializer;
  const resume = new Promise((resolve) => { resumeInitializer = resolve; });
  let preparedInitializer;
  const prepared = new Promise((resolve) => { preparedInitializer = resolve; });
  let pausedToken = null;
  let shouldPause = true;

  const initializer = withStoryTransactionLocks([repoRoot], storyId, async () => {
    assert.fail('the superseded initializer must not enter the critical section');
  }, {
    timeoutMs: 150,
    heartbeatMs: 60_000,
    beforeAcquireRename: async ({ stagingPath, token }) => {
      if (!shouldPause) return;
      shouldPause = false;
      pausedToken = token;
      assert.equal(JSON.parse(await readFile(path.join(stagingPath, 'owner.json'), 'utf8')).token, token);
      preparedInitializer();
      await resume;
    }
  });

  await Promise.race([
    prepared,
    new Promise((_, reject) => setTimeout(() => reject(new Error('initializer was not staged before lock publication')), 1_000))
  ]);

  let releaseSuccessor;
  const holdSuccessor = new Promise((resolve) => { releaseSuccessor = resolve; });
  let successorEntered;
  const successorReady = new Promise((resolve) => { successorEntered = resolve; });
  const successor = withStoryTransactionLocks([repoRoot], storyId, async () => {
    successorEntered();
    await holdSuccessor;
  }, { timeoutMs: 500, heartbeatMs: 60_000 });
  await successorReady;

  const successorToken = JSON.parse(await readFile(ownerPath, 'utf8')).token;
  assert.notEqual(successorToken, pausedToken);
  resumeInitializer();

  await assert.rejects(initializer, (error) => {
    assert.equal(error.code, 'delivery_reconciliation_lock_timeout');
    return true;
  });
  assert.equal(JSON.parse(await readFile(ownerPath, 'utf8')).token, successorToken);

  releaseSuccessor();
  await successor;
});

test('DRS-CONTRACT-008 LOCK-TOCTOU-001 retiring owner never quarantines a successor generation', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-lock-release-successor-'));
  const storyId = 'story-release-successor';
  const { lockPath, ownerPath } = lockPaths(repoRoot, storyId);
  const successorToken = 'successor-generation';
  let observeRelease = true;
  let canonicalGenerationDisappeared = false;
  let releaseObserver = null;

  try {
    await withStoryTransactionLocks([repoRoot], storyId, async () => {
      // Model a successor generation becoming canonical before the retiring
      // owner's release path runs. The padding makes a post-rename owner read
      // observable without relying on implementation-only hooks.
      await writeOwner(ownerPath, {
        ...ownerMetadata(successorToken, process.pid, new Date().toISOString()),
        padding: 'x'.repeat(8 * 1024 * 1024)
      });
      releaseObserver = (async () => {
        while (observeRelease) {
          try {
            await stat(lockPath);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            canonicalGenerationDisappeared = true;
          }
          await new Promise((resolve) => setImmediate(resolve));
        }
      })();
      await new Promise((resolve) => setImmediate(resolve));
    }, {
      timeoutMs: 200,
      heartbeatMs: 60_000
    });
  } finally {
    observeRelease = false;
    await releaseObserver;
  }

  assert.equal(canonicalGenerationDisappeared, false);
  assert.equal(JSON.parse(await readFile(ownerPath, 'utf8')).token, successorToken);
});

test('DRS-CONTRACT-008 dead and stale transition ownership is quarantined before lock takeover', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-lock-dead-transition-'));
  const storyId = 'story-dead-transition';
  const { lockPath, ownerPath, transitionPath, transitionOwnerPath } = lockPaths(repoRoot, storyId);
  const abandonedLockPid = 900_000_001;
  const abandonedTransitionPid = 900_000_002;
  await mkdir(transitionPath, { recursive: true });
  await writeOwner(ownerPath, ownerMetadata('abandoned-lock', abandonedLockPid));
  await writeOwner(transitionOwnerPath, ownerMetadata('abandoned-transition', abandonedTransitionPid));
  await Promise.all([agePath(ownerPath), agePath(transitionOwnerPath)]);

  await withStoryTransactionLocks([repoRoot], storyId, async () => {
    const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
    assert.notEqual(owner.token, 'abandoned-lock');
    await assert.rejects(stat(transitionPath), { code: 'ENOENT' });
  }, {
    timeoutMs: 500,
    staleMs: 5,
    heartbeatMs: 60_000,
    processAlive: () => false
  });

  await assert.rejects(stat(lockPath), { code: 'ENOENT' });
});

test('live stale-looking transition ownership fails closed with structured recovery context', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-lock-live-transition-'));
  const storyId = 'story-live-transition';
  const { lockPath, ownerPath, transitionPath, transitionOwnerPath } = lockPaths(repoRoot, storyId);
  const abandonedLockPid = 900_000_003;
  const liveTransitionPid = process.pid;
  await mkdir(transitionPath, { recursive: true });
  await writeOwner(ownerPath, ownerMetadata('abandoned-lock', abandonedLockPid));
  await writeOwner(transitionOwnerPath, ownerMetadata('live-transition', liveTransitionPid));
  await Promise.all([agePath(ownerPath), agePath(transitionOwnerPath)]);

  await assert.rejects(withStoryTransactionLocks([repoRoot], storyId, async () => {
    assert.fail('live transition ownership must not be evicted');
  }, {
    timeoutMs: 80,
    staleMs: 5,
    heartbeatMs: 60_000,
    processAlive: (pid) => pid === liveTransitionPid
  }), (error) => {
    assert.equal(error.code, 'delivery_reconciliation_lock_timeout');
    assert.equal(error.lock_path, lockPath);
    assert.equal(error.transition_path, transitionPath);
    assert.equal(error.observed_owner.lock.metadata.token, 'abandoned-lock');
    assert.equal(error.observed_owner.transition.metadata.token, 'live-transition');
    assert.equal(error.observed_owner.transition.liveness, 'live');
    assert.match(error.recovery_guidance.manual_recovery, /do not remove/i);
    assert.match(error.recovery_guidance.manual_recovery, /confirmed dead and stale/i);
    return true;
  });

  assert.equal(JSON.parse(await readFile(transitionOwnerPath, 'utf8')).token, 'live-transition');
});
