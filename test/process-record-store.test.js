import './support/scratch-tmpdir.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  hydrateProcessRecords,
  processRecordStoreStatus,
  resolveDurableStoreRoot,
  snapshotProcessRecords,
  snapshotProcessRecordsFailSoft
} from '../src/process-record-store.js';

const execFileAsync = promisify(execFile);
const STORY = 'story-x';

async function makeRepoWithWorktree() {
  // realpath: on macOS tmpdir lives behind a /var -> /private/var symlink and
  // git resolves worktree gitdirs to the real path.
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'vibepro-store-')));
  const main = path.join(base, 'main');
  await mkdir(main);
  const git = (cwd, args) => execFileAsync('git', args, { cwd, encoding: 'utf8' });
  await git(main, ['init', '-b', 'main']);
  await git(main, ['config', 'user.email', 't@e.com']);
  await git(main, ['config', 'user.name', 'T']);
  await writeFile(path.join(main, 'a.txt'), 'a\n');
  await git(main, ['add', '-A']);
  await git(main, ['commit', '-m', 'init']);
  const worktree = path.join(base, 'wt');
  await git(main, ['worktree', 'add', worktree, '-b', 'feature/x']);
  return { base, main, worktree };
}

async function writeRecord(repoRoot, relPath, content) {
  const abs = path.join(repoRoot, '.vibepro', relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
  return abs;
}

test('resolveDurableStoreRoot points a linked worktree at the main checkout', async () => {
  const { main, worktree } = await makeRepoWithWorktree();
  const fromWorktree = await resolveDurableStoreRoot(worktree);
  assert.equal(fromWorktree.is_linked_worktree, true);
  assert.equal(fromWorktree.durable_repo_root, main);
  assert.equal(fromWorktree.store_root, path.join(main, '.vibepro-store'));
  const fromMain = await resolveDurableStoreRoot(main);
  assert.equal(fromMain.is_linked_worktree, false);
  assert.equal(fromMain.store_root, path.join(main, '.vibepro-store'));
});

test('records survive worktree deletion via snapshot then hydrate into a regenerated worktree', async () => {
  const { main, worktree } = await makeRepoWithWorktree();
  // Paths mirror the real VibePro writers: agent-review (reviews/), adjudication.js
  // (adjudication/ singular), execution-state (verification/), spec store, executions
  // decisions, and artifact-routing's pr/<story>/ verification + decision ledgers.
  await writeRecord(worktree, `reviews/${STORY}/round-1/architect.json`, '{"status":"block"}\n');
  await writeRecord(worktree, `adjudication/${STORY}/adjudication.json`, '{"verdicts":20}\n');
  await writeRecord(worktree, `verification/${STORY}/unit.json`, '{"status":"pass"}\n');
  await writeRecord(worktree, `spec/${STORY}/spec.json`, '{"clauses":[]}\n');
  await writeRecord(worktree, `executions/${STORY}/runs/r1/decisions/d1.json`, '{"decision":"block"}\n');
  await writeRecord(worktree, `pr/${STORY}/verification-evidence.json`, '{"commands":[]}\n');
  await writeRecord(worktree, `pr/${STORY}/decision-outcome-ledger.json`, '{"entries":[]}\n');

  const snap = await snapshotProcessRecords({ repoRoot: worktree, storyId: STORY });
  assert.equal(snap.status, 'ok');
  assert.equal(snap.copied.length, 7);

  // Simulate the incident: the worktree (and everything under .vibepro) vanishes.
  await rm(path.join(worktree, '.vibepro'), { recursive: true, force: true });

  const hydrate = await hydrateProcessRecords({ repoRoot: worktree, storyId: STORY });
  assert.equal(hydrate.status, 'ok');
  assert.equal(hydrate.copied.length, 7);
  const restored = await readFile(path.join(worktree, '.vibepro', 'reviews', STORY, 'round-1', 'architect.json'), 'utf8');
  assert.equal(restored, '{"status":"block"}\n');
  const restoredEvidence = await readFile(path.join(worktree, '.vibepro', 'pr', STORY, 'verification-evidence.json'), 'utf8');
  assert.equal(restoredEvidence, '{"commands":[]}\n');
  assert.ok(hydrate.store_root.startsWith(path.join(main, '.vibepro-store')));
});

test('hydrate never overwrites a newer local record and never deletes local files', async () => {
  const { worktree } = await makeRepoWithWorktree();
  const rel = `reviews/${STORY}/round-1/architect.json`;
  const abs = await writeRecord(worktree, rel, 'old\n');
  await snapshotProcessRecords({ repoRoot: worktree, storyId: STORY });
  // Make the store copy strictly older, then advance the local record.
  await writeFile(abs, 'newer-local\n');
  const future = new Date(Date.now() + 5000);
  await utimes(abs, future, future);
  const localOnly = await writeRecord(worktree, `reviews/${STORY}/round-2/security.json`, 'local-only\n');

  const hydrate = await hydrateProcessRecords({ repoRoot: worktree, storyId: STORY });
  assert.deepEqual(hydrate.copied, []);
  assert.ok(hydrate.skipped_newer_destination.includes(path.join('reviews', STORY, 'round-1', 'architect.json')));
  assert.equal(await readFile(abs, 'utf8'), 'newer-local\n');
  assert.equal(await readFile(localOnly, 'utf8'), 'local-only\n');
});

test('gate-outcome ledger hydration unions entries so a cleared local ledger cannot erase a recorded trip', async () => {
  const { worktree } = await makeRepoWithWorktree();
  const ledger = (entries) => JSON.stringify({ schema_version: '0.1.0', model: 'vibepro-gate-outcome-ledger-v3', entries }, null, 2);
  const trip = { entry_key: 'trip-1', story_id: STORY, resolved_status: 'block' };
  await writeRecord(worktree, 'gate-outcomes/ledger.json', ledger([trip]));
  await snapshotProcessRecords({ repoRoot: worktree, storyId: STORY });

  // Regenerated worktree comes back with a fresh, clear ledger.
  const clear = { entry_key: 'other-1', story_id: STORY, resolved_status: 'pass' };
  await writeRecord(worktree, 'gate-outcomes/ledger.json', ledger([clear]));

  const hydrate = await hydrateProcessRecords({ repoRoot: worktree, storyId: STORY });
  assert.ok(hydrate.merged.includes(path.join('gate-outcomes', 'ledger.json')));
  const merged = JSON.parse(await readFile(path.join(worktree, '.vibepro', 'gate-outcomes', 'ledger.json'), 'utf8'));
  const keys = merged.entries.map((entry) => entry.entry_key).sort();
  assert.deepEqual(keys, ['other-1', 'trip-1']);
});

test('store status reports missing, stale, and conflict counts across local and store', async () => {
  const { main, worktree } = await makeRepoWithWorktree();
  await writeRecord(worktree, `reviews/${STORY}/a.json`, '1\n');
  await writeRecord(worktree, `reviews/${STORY}/stale-store.json`, 'v1\n');
  await writeRecord(worktree, `reviews/${STORY}/stale-local.json`, 'v1\n');
  await snapshotProcessRecords({ repoRoot: worktree, storyId: STORY });
  await writeRecord(worktree, `reviews/${STORY}/b.json`, '2\n');
  // Local advanced after snapshot -> store copy is stale.
  const staleStore = path.join(worktree, '.vibepro', 'reviews', STORY, 'stale-store.json');
  await writeFile(staleStore, 'v2\n');
  const future = new Date(Date.now() + 5000);
  await utimes(staleStore, future, future);
  // Store advanced after snapshot -> local copy is stale.
  const staleLocalStore = path.join(main, '.vibepro-store', STORY, 'reviews', STORY, 'stale-local.json');
  await writeFile(staleLocalStore, 'v2\n');
  await utimes(staleLocalStore, future, future);
  const status = await processRecordStoreStatus({ repoRoot: worktree, storyId: STORY });
  assert.equal(status.status, 'ok');
  assert.equal(status.in_sync, 1);
  assert.equal(status.missing_in_store, 1);
  assert.equal(status.missing_in_local, 0);
  assert.equal(status.stale_in_store, 1);
  assert.equal(status.stale_in_local, 1);
  assert.equal(status.conflicts, 0);
});

test('unmergeable gate-outcome ledgers surface as conflicts instead of silently keeping the clear local ledger', async () => {
  const { worktree } = await makeRepoWithWorktree();
  await writeRecord(worktree, 'gate-outcomes/ledger.json', JSON.stringify({
    schema_version: '0.1.0', model: 'vibepro-gate-outcome-ledger-v3',
    entries: [{ entry_key: 'trip-1', story_id: STORY, resolved_status: 'block' }]
  }));
  await snapshotProcessRecords({ repoRoot: worktree, storyId: STORY });
  // Regenerated worktree carries a ledger from a different schema generation.
  await writeRecord(worktree, 'gate-outcomes/ledger.json', JSON.stringify({
    schema_version: '0.2.0', model: 'vibepro-gate-outcome-ledger-v4', entries: []
  }));
  const hydrate = await hydrateProcessRecords({ repoRoot: worktree, storyId: STORY });
  assert.deepEqual(hydrate.conflicts, [path.join('gate-outcomes', 'ledger.json')]);
  const status = await processRecordStoreStatus({ repoRoot: worktree, storyId: STORY });
  assert.equal(status.conflicts, 1);
  const warnings = [];
  await snapshotProcessRecordsFailSoft({ repoRoot: worktree, storyId: STORY, logger: { warn: (m) => warnings.push(m) } });
  assert.ok(warnings.some((m) => m.includes('unmergeable ledger conflict')));
});

test('snapshot rejects unsafe story ids and the fail-soft wrapper never throws', async () => {
  const { worktree } = await makeRepoWithWorktree();
  const bad = await snapshotProcessRecords({ repoRoot: worktree, storyId: '../evil' });
  assert.equal(bad.status, 'failed');
  assert.equal(bad.reason, 'invalid_story_id');
  const warnings = [];
  const soft = await snapshotProcessRecordsFailSoft({ repoRoot: worktree, storyId: '../evil', logger: { warn: (m) => warnings.push(m) } });
  assert.equal(soft.status, 'failed');
  assert.equal(warnings.length, 1);
});

// issue #436 item 3: `story add`/`story select` accept any non-empty --id
// (no `story-` prefix requirement — the mana-runtime repro used
// `slack-split-surrogate-safe`), but this store previously validated with
// isSafeStoryId, which additionally requires a `story-` prefix. That
// mismatch made every command for a non-`story-`-prefixed story log a
// spurious `invalid_story_id` warning even though init/story add had
// already accepted the id. Only unsafe path segments (traversal,
// separators, percent-encoding) should be rejected here.
test('snapshot accepts a CLI-accepted story id without a story- prefix', async () => {
  const { worktree } = await makeRepoWithWorktree();
  const storyId = 'slack-split-surrogate-safe';
  await writeRecord(worktree, path.join('spec', storyId, 'spec.json'), '{}\n');
  const result = await snapshotProcessRecords({ repoRoot: worktree, storyId });
  assert.equal(result.status, 'ok');
  const warnings = [];
  const soft = await snapshotProcessRecordsFailSoft({ repoRoot: worktree, storyId, logger: { warn: (m) => warnings.push(m) } });
  assert.notEqual(soft.status, 'failed');
  assert.equal(warnings.length, 0);
});
