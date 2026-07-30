import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY = 'story-x';

// Full replay of the 2026-07-30 incident class: records written in a linked
// worktree, the worktree's .vibepro vanishes, and hydrate brings the records
// back from the main checkout's durable store.
test('worktree loss e2e: CLI snapshot, worktree wipe, hydrate restores records and trip state', async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'vibepro-e2e-store-')));
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
  await runCli(['init', worktree, '--story-id', STORY, '--title', 'T', '--view', 'dev', '--period', '2026-W18']);

  // Durable records exist in the worktree, including a tripped ledger.
  const ledgerPath = path.join(worktree, '.vibepro', 'gate-outcomes', 'ledger.json');
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-gate-outcome-ledger-v3',
    entries: [{ entry_key: 'trip-1', story_id: STORY, resolved_status: 'block' }]
  }, null, 2));
  const reviewPath = path.join(worktree, '.vibepro', 'reviews', STORY, 'round-1', 'architect.json');
  await mkdir(path.dirname(reviewPath), { recursive: true });
  await writeFile(reviewPath, '{"status":"block"}\n');

  const snapshot = await runCli(['store', 'snapshot', worktree, '--story-id', STORY, '--json']);
  assert.equal(snapshot.exitCode, 0);

  // Incident: the worktree's .vibepro is wiped and regenerated clean.
  await rm(path.join(worktree, '.vibepro'), { recursive: true, force: true });
  await runCli(['init', worktree, '--story-id', STORY, '--title', 'T', '--view', 'dev', '--period', '2026-W18']);

  const status = await runCli(['store', 'status', worktree, '--story-id', STORY, '--json']);
  assert.equal(status.exitCode, 0);
  assert.ok(status.result.missing_in_local >= 2);

  const hydrate = await runCli(['store', 'hydrate', worktree, '--story-id', STORY, '--json']);
  assert.equal(hydrate.exitCode, 0);

  const restoredReview = await readFile(reviewPath, 'utf8');
  assert.equal(restoredReview, '{"status":"block"}\n');
  const restoredLedger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  assert.ok(restoredLedger.entries.some((entry) => entry.entry_key === 'trip-1' && entry.resolved_status === 'block'));
  assert.ok(await readFile(path.join(main, '.vibepro-store', STORY, 'reviews', STORY, 'round-1', 'architect.json'), 'utf8'));
});
