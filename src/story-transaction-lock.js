import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getWorkspaceDir } from './workspace.js';

const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_HEARTBEAT_MS = 10_000;
const OWNER_FILE = 'owner.json';
const TRANSITION_DIR = '.transition';
const GENERATION_PREFIX = '.generation-';

export async function withStoryTransactionLocks(repoRoots, storyId, action, options = {}) {
  const lockPaths = [...new Set(repoRoots.map((root) => path.join(
    getWorkspaceDir(path.resolve(root)),
    'locks',
    `${sanitizeStoryId(storyId)}.delivery-reconciliation.lock`
  )))].sort();
  const acquired = [];
  try {
    for (const lockPath of lockPaths) {
      acquired.push(await acquireDirectoryLock(lockPath, options));
    }
    return await action();
  } finally {
    for (const ownership of acquired.reverse()) {
      await releaseDirectoryLock(ownership);
    }
  }
}

async function acquireDirectoryLock(lockPath, options = {}) {
  const timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const heartbeatMs = options.heartbeatMs ?? LOCK_HEARTBEAT_MS;
  const processAlive = options.processAlive ?? isProcessAlive;
  await mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const token = randomUUID();
    const stagingPath = `${lockPath}.prepare-${token}`;
    const ownership = {
      lockPath,
      token,
      generationPath: path.join(lockPath, generationName(token)),
      mutationTimeoutMs: options.mutationTimeoutMs ?? Math.min(timeoutMs, 1_000),
      staleMs,
      processAlive,
      beforeReleaseOwnerCheck: options.beforeReleaseOwnerCheck,
      beforeQuarantineOwnerRead: options.beforeQuarantineOwnerRead,
      heartbeat: null,
      heartbeatInFlight: null
    };
    try {
      await prepareLockGeneration(stagingPath, token);
      await options.beforeAcquireRename?.({ lockPath, stagingPath, token });
      if (Date.now() - startedAt >= timeoutMs) break;
      await assertPathAbsent(lockPath);
      await rename(stagingPath, lockPath);
      startLockHeartbeat(ownership, heartbeatMs);
      return ownership;
    } catch (error) {
      if (!isPathConflict(error)) throw error;
      const transition = await acquireMutationGuard(lockPath, {
        timeoutMs: Math.min(remainingMs(startedAt, timeoutMs), 250),
        staleMs,
        processAlive
      });
      if (transition) {
        let quarantined = false;
        try {
          const observation = await observeOwner(lockPath, { kind: 'lock', staleMs, processAlive });
          if (observation.takeover_eligible) {
            quarantined = await quarantineOwnedGeneration(
              lockPath,
              observation.metadata.token,
              'stale'
            );
            if (quarantined) continue;
          }
        } finally {
          if (!quarantined) await releaseMutationGuard(transition);
        }
      }
      await sleep(Math.min(25, Math.max(1, remainingMs(startedAt, timeoutMs))));
    } finally {
      await rm(stagingPath, { recursive: true, force: true });
    }
  }
  throw await createLockTimeoutError(lockPath, { staleMs, processAlive });
}

function startLockHeartbeat(ownership, heartbeatMs) {
  ownership.heartbeat = setInterval(() => {
    if (ownership.heartbeatInFlight) return;
    ownership.heartbeatInFlight = refreshLockHeartbeat(ownership)
      .catch(() => null)
      .finally(() => {
        ownership.heartbeatInFlight = null;
      });
  }, heartbeatMs);
  ownership.heartbeat.unref?.();
}

async function releaseDirectoryLock(ownership) {
  if (ownership.heartbeat) clearInterval(ownership.heartbeat);
  await ownership.heartbeatInFlight;
  const transition = await acquireMutationGuard(ownership.lockPath, {
    timeoutMs: ownership.mutationTimeoutMs,
    staleMs: ownership.staleMs,
    processAlive: ownership.processAlive
  });
  if (!transition) return;
  let removed = false;
  try {
    await ownership.beforeReleaseOwnerCheck?.({
      lockPath: ownership.lockPath,
      token: ownership.token
    });
    const currentOwner = await readOwner(ownership.lockPath);
    if (currentOwner?.token !== ownership.token) return;
    removed = await quarantineOwnedGeneration(ownership.lockPath, ownership.token, 'release', {
      beforeOwnerRead: ownership.beforeQuarantineOwnerRead
    });
  } finally {
    if (!removed) await releaseMutationGuard(transition);
  }
}

async function refreshLockHeartbeat(ownership) {
  const now = new Date();
  try {
    await utimes(ownership.generationPath, now, now);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function acquireMutationGuard(lockPath, {
  timeoutMs = 250,
  staleMs = LOCK_STALE_MS,
  processAlive = isProcessAlive
} = {}) {
  const transitionPath = path.join(lockPath, TRANSITION_DIR);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const token = randomUUID();
    const stagingPath = path.join(lockPath, `${TRANSITION_DIR}.prepare-${token}`);
    try {
      await prepareTransitionGeneration(stagingPath, token);
      await assertPathAbsent(transitionPath);
      await rename(stagingPath, transitionPath);
      return { path: transitionPath, token };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (!isPathConflict(error)) throw error;
      const observation = await observeOwner(transitionPath, {
        kind: 'transition',
        staleMs,
        processAlive
      });
      if (observation.takeover_eligible) {
        const quarantined = await quarantineOwnedGeneration(
          transitionPath,
          observation.metadata.token,
          'stale'
        );
        if (quarantined) continue;
      }
      await sleep(Math.min(5, Math.max(1, remainingMs(startedAt, timeoutMs))));
    } finally {
      await rm(stagingPath, { recursive: true, force: true });
    }
  }
  return null;
}

async function releaseMutationGuard(guard) {
  await quarantineOwnedGeneration(guard.path, guard.token, 'release');
}

async function prepareLockGeneration(stagingPath, token) {
  const now = new Date().toISOString();
  await mkdir(stagingPath);
  await mkdir(path.join(stagingPath, generationName(token)));
  await writeOwner(stagingPath, {
    token,
    generation: token,
    pid: process.pid,
    hostname: os.hostname(),
    created_at: now,
    heartbeat_at: now
  });
}

async function prepareTransitionGeneration(stagingPath, token) {
  await mkdir(stagingPath);
  await writeOwner(stagingPath, {
    token,
    generation: token,
    pid: process.pid,
    hostname: os.hostname(),
    created_at: new Date().toISOString()
  });
}

async function writeOwner(directoryPath, owner) {
  await writeFile(path.join(directoryPath, OWNER_FILE), `${JSON.stringify(owner, null, 2)}\n`);
}

async function readOwner(directoryPath) {
  try {
    return JSON.parse(await readFile(path.join(directoryPath, OWNER_FILE), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function observeOwner(directoryPath, { kind, staleMs, processAlive }) {
  const ownerPath = path.join(directoryPath, OWNER_FILE);
  const [metadata, ownerStat] = await Promise.all([
    readOwner(directoryPath),
    stat(ownerPath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    })
  ]);
  const metadataValid = isOwnerMetadataValid(metadata);
  let activityStat = ownerStat;
  if (kind === 'lock' && metadataValid) {
    activityStat = await stat(path.join(directoryPath, generationName(metadata.generation ?? metadata.token)))
      .catch((error) => {
        if (error.code === 'ENOENT') return ownerStat;
        throw error;
      });
  }
  const activityMs = newestOwnerTimestamp(metadata, activityStat);
  const ageMs = Number.isFinite(activityMs) ? Math.max(0, Date.now() - activityMs) : null;
  const stale = metadataValid && ageMs !== null && ageMs > staleMs;
  let liveness = 'unknown';
  if (metadataValid && metadata.hostname === os.hostname()) {
    try {
      liveness = await processAlive(metadata.pid) ? 'live' : 'dead';
    } catch {
      liveness = 'unknown';
    }
  }
  return {
    path: directoryPath,
    metadata,
    metadata_valid: metadataValid,
    hostname_matches: metadataValid ? metadata.hostname === os.hostname() : null,
    age_ms: ageMs,
    stale,
    liveness,
    takeover_eligible: metadataValid && stale && liveness === 'dead'
  };
}

function isOwnerMetadataValid(owner) {
  return Boolean(
    owner
    && typeof owner.token === 'string'
    && owner.token.length > 0
    && (owner.generation === undefined || owner.generation === owner.token)
    && Number.isSafeInteger(owner.pid)
    && owner.pid > 0
    && typeof owner.hostname === 'string'
    && owner.hostname.length > 0
    && Number.isFinite(Date.parse(owner.created_at))
  );
}

function newestOwnerTimestamp(owner, activityStat) {
  const timestamps = [activityStat?.mtimeMs];
  for (const key of ['created_at', 'heartbeat_at']) {
    const parsed = Date.parse(owner?.[key]);
    if (Number.isFinite(parsed)) timestamps.push(parsed);
  }
  const finite = timestamps.filter(Number.isFinite);
  return finite.length > 0 ? Math.max(...finite) : null;
}

async function quarantineOwnedGeneration(directoryPath, expectedToken, label, options = {}) {
  const quarantinePath = `${directoryPath}.${label}-${randomUUID()}`;
  try {
    await rename(directoryPath, quarantinePath);
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
  await options.beforeOwnerRead?.({ directoryPath, quarantinePath, expectedToken, label });
  const movedOwner = await readOwner(quarantinePath);
  if (movedOwner?.token !== expectedToken) {
    await restoreMovedGeneration(quarantinePath, directoryPath);
    return false;
  }
  await rm(quarantinePath, { recursive: true, force: true });
  return true;
}

async function restoreMovedGeneration(quarantinePath, directoryPath) {
  try {
    await assertPathAbsent(directoryPath);
    await rename(quarantinePath, directoryPath);
  } catch (error) {
    if (!isPathConflict(error) && error.code !== 'ENOENT') throw error;
  }
}

async function createLockTimeoutError(lockPath, { staleMs, processAlive }) {
  const transitionPath = path.join(lockPath, TRANSITION_DIR);
  const [lockOwner, transitionOwner] = await Promise.all([
    observeOwner(lockPath, { kind: 'lock', staleMs, processAlive }),
    observeOwner(transitionPath, { kind: 'transition', staleMs, processAlive })
  ]);
  const observedOwner = { lock: lockOwner, transition: transitionOwner };
  const recoveryGuidance = {
    inspection: `Inspect owner metadata at ${path.join(lockPath, OWNER_FILE)} and ${path.join(transitionPath, OWNER_FILE)}.`,
    automatic_recovery: 'Retry after a live owner exits; dead local owners are quarantined automatically only after the stale threshold.',
    manual_recovery: 'Do not remove either path unconditionally. Only quarantine a generation after its hostname and pid are verified locally as confirmed dead and stale; treat remote-host or invalid metadata as unknown and fail closed.'
  };
  const error = new Error(
    `timed out waiting for delivery reconciliation transaction lock: ${lockPath}; `
    + `transition: ${transitionPath}; observed owners: ${summarizeOwner(observedOwner)}`
  );
  error.code = 'delivery_reconciliation_lock_timeout';
  error.artifact_path = lockPath;
  error.lock_path = lockPath;
  error.transition_path = transitionPath;
  error.observed_owner = observedOwner;
  error.recovery_guidance = recoveryGuidance;
  error.details = {
    lock_path: lockPath,
    transition_path: transitionPath,
    observed_owner: observedOwner,
    recovery_guidance: recoveryGuidance
  };
  return error;
}

function summarizeOwner(observedOwner) {
  return JSON.stringify({
    lock: summarizeOwnerObservation(observedOwner.lock),
    transition: summarizeOwnerObservation(observedOwner.transition)
  });
}

function summarizeOwnerObservation(observation) {
  return {
    token: observation.metadata?.token ?? null,
    pid: observation.metadata?.pid ?? null,
    hostname: observation.metadata?.hostname ?? null,
    age_ms: observation.age_ms,
    stale: observation.stale,
    liveness: observation.liveness
  };
}

async function assertPathAbsent(targetPath) {
  try {
    await lstat(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const error = new Error(`path already exists: ${targetPath}`);
  error.code = 'EEXIST';
  throw error;
}

function isPathConflict(error) {
  return ['EEXIST', 'ENOTEMPTY', 'EISDIR'].includes(error.code);
}

function generationName(token) {
  return `${GENERATION_PREFIX}${token}`;
}

function remainingMs(startedAt, timeoutMs) {
  return Math.max(0, timeoutMs - (Date.now() - startedAt));
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function sanitizeStoryId(storyId) {
  return String(storyId).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
