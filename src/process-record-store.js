import { copyFile, mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir } from './workspace.js';
import { isSafeStoryId } from './story-id.js';

// Process records whose loss caused the 2026-07-30 fail-open incidents:
// reviews, adjudications, verification evidence, spec, decision records under
// executions, evidence observations, and the gate-outcome ledger (trip state).
// Class names must match the directories real VibePro writers use:
// reviews/<story> (agent-review), adjudication/<story> (adjudication.js),
// verification/<story> (execution-state), spec/<story> (spec-store),
// evidence/<story>, executions/<story> (runs + decisions), and
// pr/<story> (verification-evidence.json, verification-runs/,
// decision-outcome-ledger.json via artifact-routing).
export const STORY_SCOPED_RECORD_CLASSES = Object.freeze([
  'reviews',
  'adjudication',
  'verification',
  'spec',
  'evidence',
  'executions',
  'pr'
]);
export const REPO_SCOPED_RECORD_FILES = Object.freeze([
  path.join('gate-outcomes', 'ledger.json')
]);

export const DURABLE_STORE_DIR = '.vibepro-store';
const GATE_OUTCOME_LEDGER_RELATIVE = path.join('gate-outcomes', 'ledger.json');

// utimes() on some filesystems truncates sub-millisecond precision, so a
// mirrored copy can differ from its source by a fraction of a millisecond.
const MTIME_TOLERANCE_MS = 2;
const isNewer = (a, b) => a.mtimeMs - b.mtimeMs > MTIME_TOLERANCE_MS;

/**
 * Resolve a store root that survives worktree deletion. In a linked worktree,
 * `<repoRoot>/.git` is a file pointing at `<main>/.git/worktrees/<name>`; the
 * durable root is the main checkout. In a primary checkout the repo root
 * itself is durable.
 */
export async function resolveDurableStoreRoot(repoRoot) {
  const root = path.resolve(repoRoot);
  const gitPath = path.join(root, '.git');
  let durableRepoRoot = root;
  try {
    const info = await stat(gitPath);
    if (info.isFile()) {
      const text = await readFile(gitPath, 'utf8');
      const match = text.match(/^gitdir:\s*(.+)\s*$/m);
      if (match) {
        const gitDir = path.resolve(root, match[1].trim());
        const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
        const idx = gitDir.indexOf(marker);
        if (idx !== -1) durableRepoRoot = gitDir.slice(0, idx);
      }
    }
  } catch {
    // No .git: fall back to the repo root itself.
  }
  return {
    durable_repo_root: durableRepoRoot,
    store_root: path.join(durableRepoRoot, DURABLE_STORE_DIR),
    is_linked_worktree: durableRepoRoot !== root
  };
}

export async function isDurabilityEnabled(repoRoot) {
  try {
    const config = JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'config.json'), 'utf8'));
    return config?.durability?.enabled !== false;
  } catch {
    return true;
  }
}

/** Mirror the story's durable process records into the worktree-independent store. */
export async function snapshotProcessRecords({ repoRoot, storyId }) {
  return await transferProcessRecords({ repoRoot, storyId, direction: 'snapshot' });
}

/**
 * Restore records into a (possibly regenerated) worktree. Non-destructive:
 * never deletes, never overwrites a local file that is newer than the stored
 * copy. A record that exists only in the store is always restored, so trip /
 * block records reappear even when the local workspace looks clear (fail-closed).
 */
export async function hydrateProcessRecords({ repoRoot, storyId }) {
  return await transferProcessRecords({ repoRoot, storyId, direction: 'hydrate' });
}

export async function processRecordStoreStatus({ repoRoot, storyId }) {
  const context = await resolveTransferContext({ repoRoot, storyId });
  if (context.error) return { status: 'failed', reason: context.error };
  const { localFiles, storeFiles } = context;
  const summary = {
    status: 'ok',
    store_root: context.storeRoot,
    is_linked_worktree: context.resolution.is_linked_worktree,
    missing_in_store: 0,
    missing_in_local: 0,
    stale_in_store: 0,
    stale_in_local: 0,
    conflicts: 0,
    in_sync: 0
  };
  const all = new Set([...localFiles.keys(), ...storeFiles.keys()]);
  for (const rel of all) {
    const local = localFiles.get(rel);
    const stored = storeFiles.get(rel);
    if (!stored) summary.missing_in_store += 1;
    else if (!local) summary.missing_in_local += 1;
    else if (rel === GATE_OUTCOME_LEDGER_RELATIVE
      && !(await ledgersAreMergeable(path.join(context.localRoot, rel), path.join(context.storeRoot, rel)))) {
      summary.conflicts += 1;
    } else if (isNewer(local, stored)) summary.stale_in_store += 1;
    else if (isNewer(stored, local)) summary.stale_in_local += 1;
    else summary.in_sync += 1;
  }
  return summary;
}

/**
 * Fail-soft wrapper for mutating CLI commands: a snapshot failure must never
 * fail the command that produced the record, only surface a warning.
 */
export async function snapshotProcessRecordsFailSoft({ repoRoot, storyId, logger = console }) {
  try {
    if (!(await isDurabilityEnabled(repoRoot))) return { status: 'disabled' };
    const result = await snapshotProcessRecords({ repoRoot, storyId });
    if (result.status === 'failed') {
      logger.warn?.(`[vibepro] process-record snapshot failed (records remain local only): ${result.reason}`);
    } else if (result.conflicts?.length) {
      logger.warn?.(`[vibepro] process-record snapshot left unmergeable ledger conflict(s): ${result.conflicts.join(', ')} — resolve with vibepro store status/hydrate`);
    }
    return result;
  } catch (error) {
    logger.warn?.(`[vibepro] process-record snapshot failed (records remain local only): ${error.message}`);
    return { status: 'failed', reason: error.message };
  }
}

async function resolveTransferContext({ repoRoot, storyId }) {
  if (!isSafeStoryId(storyId)) return { error: 'invalid_story_id' };
  const root = path.resolve(repoRoot);
  const resolution = await resolveDurableStoreRoot(root);
  const storeRoot = path.join(resolution.store_root, storyId);
  const localRoot = getWorkspaceDir(root);
  const localFiles = await collectDurableFiles(localRoot, storyId);
  const storeFiles = await collectDurableFiles(storeRoot, storyId);
  return { root, resolution, storeRoot, localRoot, localFiles, storeFiles };
}

async function transferProcessRecords({ repoRoot, storyId, direction }) {
  const context = await resolveTransferContext({ repoRoot, storyId });
  if (context.error) return { status: 'failed', reason: context.error };
  const fromFiles = direction === 'snapshot' ? context.localFiles : context.storeFiles;
  const toFiles = direction === 'snapshot' ? context.storeFiles : context.localFiles;
  const fromRoot = direction === 'snapshot' ? context.localRoot : context.storeRoot;
  const toRoot = direction === 'snapshot' ? context.storeRoot : context.localRoot;
  const summary = {
    status: 'ok',
    direction,
    store_root: context.storeRoot,
    is_linked_worktree: context.resolution.is_linked_worktree,
    copied: [],
    skipped_newer_destination: [],
    merged: [],
    conflicts: [],
    unchanged: 0
  };
  for (const [rel, sourceInfo] of fromFiles) {
    const destInfo = toFiles.get(rel);
    const sourcePath = path.join(fromRoot, rel);
    const destPath = path.join(toRoot, rel);
    if (destInfo && rel === GATE_OUTCOME_LEDGER_RELATIVE) {
      const merged = await mergeGateOutcomeLedgerFiles(sourcePath, destPath);
      if (merged === 'merged') summary.merged.push(rel);
      else if (merged === 'unmergeable') summary.conflicts.push(rel);
      else summary.unchanged += 1;
      continue;
    }
    if (destInfo && isNewer(destInfo, sourceInfo)) {
      summary.skipped_newer_destination.push(rel);
      continue;
    }
    if (destInfo && !isNewer(sourceInfo, destInfo) && destInfo.size === sourceInfo.size) {
      summary.unchanged += 1;
      continue;
    }
    await mkdir(path.dirname(destPath), { recursive: true });
    await copyFile(sourcePath, destPath);
    // Preserve the source mtime so later mirror/status comparisons can tell
    // "already synced" apart from "changed on one side".
    const sourceStat = await stat(sourcePath);
    await utimes(destPath, sourceStat.atime, sourceStat.mtime);
    summary.copied.push(rel);
  }
  return summary;
}

/**
 * The gate-outcome ledger holds trip / block resolution history. When both
 * sides exist we union entries by entry_key instead of letting either file
 * clobber the other, so a regenerated worktree can never erase a recorded
 * trip (fail-closed). The union is written to the destination side.
 */
async function mergeGateOutcomeLedgerFiles(sourcePath, destPath) {
  let source, dest;
  try {
    source = JSON.parse(await readFile(sourcePath, 'utf8'));
    dest = JSON.parse(await readFile(destPath, 'utf8'));
  } catch {
    // A ledger that cannot be parsed cannot be safely unioned; surface it as a
    // conflict instead of silently keeping the destination (which would turn
    // fail-closed into fail-open exactly on the state this store protects).
    return 'unmergeable';
  }
  if (!Array.isArray(source?.entries) || !Array.isArray(dest?.entries)) return 'unmergeable';
  if (source.schema_version !== dest.schema_version || source.model !== dest.model) return 'unmergeable';
  const byKey = new Map();
  for (const entry of [...dest.entries, ...source.entries]) {
    const key = typeof entry?.entry_key === 'string' ? entry.entry_key : JSON.stringify(entry);
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  if (byKey.size === dest.entries.length) return 'unchanged';
  const merged = { ...dest, entries: [...byKey.values()] };
  await writeFile(destPath, `${JSON.stringify(merged, null, 2)}\n`);
  return 'merged';
}

async function ledgersAreMergeable(localPath, storePath) {
  let local, stored;
  try {
    local = JSON.parse(await readFile(localPath, 'utf8'));
    stored = JSON.parse(await readFile(storePath, 'utf8'));
  } catch {
    return false;
  }
  return Array.isArray(local?.entries) && Array.isArray(stored?.entries)
    && local.schema_version === stored.schema_version && local.model === stored.model;
}

async function collectDurableFiles(baseRoot, storyId) {
  const files = new Map();
  for (const recordClass of STORY_SCOPED_RECORD_CLASSES) {
    await collectFiles(path.join(baseRoot, recordClass, storyId), path.join(recordClass, storyId), files);
  }
  for (const rel of REPO_SCOPED_RECORD_FILES) {
    try {
      const info = await stat(path.join(baseRoot, rel));
      if (info.isFile()) files.set(rel, { mtimeMs: info.mtimeMs, size: info.size });
    } catch {
      // absent is fine
    }
  }
  return files;
}

async function collectFiles(dir, relBase, files) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = path.join(relBase, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(path.join(dir, entry.name), rel, files);
    } else if (entry.isFile()) {
      const info = await stat(path.join(dir, entry.name));
      files.set(rel, { mtimeMs: info.mtimeMs, size: info.size });
    }
  }
}
