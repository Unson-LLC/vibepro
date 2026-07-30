import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

async function runNodeTests(files) {
  const { NODE_TEST_CONTEXT: _ctx, ...childEnv } = process.env;
  return execFileAsync(process.execPath, ['--test', ...files], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 8 * 1024 * 1024
  });
}

// story-vibepro-process-record-worktree-durability S-001:
// snapshot mirrors story-scoped durable record classes to the store, and hydrate restores them into a regenerated worktree.
test('story-vibepro-process-record-worktree-durability S-001 snapshot mirrors story-scoped durable record classes to the store, and hydrate restores them into a regenerated worktree. (AC-1 AC-2 AC-3 AC-4 AC-5)', async () => {
  const result = await runNodeTests([
    'test/process-record-store.test.js',
    'test/e2e/process-record-store-worktree-loss.e2e.test.js'
  ]);
  const S001 = 'snapshot mirrors story-scoped durable record classes to the store, and hydrate restores them into a regenerated worktree.';
  assert.match(result.stdout, /(?:#|ℹ) fail 0\b/, `S-001 ${S001}`);
  for (const scenario of [
    { clause: 'AC-1', pattern: /resolveDurableStoreRoot points a linked worktree at the main checkout/ },
    { clause: 'AC-2', pattern: /records survive worktree deletion via snapshot then hydrate into a regenerated worktree/ },
    { clause: 'AC-3', pattern: /hydrate never overwrites a newer local record and never deletes local files/ },
    { clause: 'AC-4', pattern: /gate-outcome ledger hydration unions entries so a cleared local ledger cannot erase a recorded trip/ },
    { clause: 'AC-5', pattern: /store status reports missing and stale counts across local and store/ },
    { clause: 'AC-2 full CLI incident replay', pattern: /worktree loss e2e: CLI snapshot, worktree wipe, hydrate restores records and trip state/ }
  ]) assert.match(result.stdout, scenario.pattern, `${scenario.clause} executable replay`);
});

// story-vibepro-process-record-worktree-durability S-002:
// Mutating CLI commands (verify, review, adjudicate record, spec write, pr prepare, decision record) trigger a fail-soft auto-snapshot that never fails the producing command.
test('story-vibepro-process-record-worktree-durability S-002 Mutating CLI commands (verify, review, adjudicate record, spec write, pr prepare, decision record) trigger a fail-soft auto-snapshot that never fails the producing command. (AC-6 AC-7)', async () => {
  const result = await runNodeTests([
    'test/process-record-store.integration.test.js',
    'test/process-record-store.test.js'
  ]);
  const S002 = 'Mutating CLI commands (verify, review, adjudicate record, spec write, pr prepare, decision record) trigger a fail-soft auto-snapshot that never fails the producing command.';
  assert.match(result.stdout, /(?:#|ℹ) fail 0\b/, `S-002 ${S002}`);
  for (const scenario of [
    { clause: 'AC-6', pattern: /mutating CLI commands auto-snapshot durable records into the store/ },
    { clause: 'AC-7 fail-soft fallback', pattern: /snapshot rejects unsafe story ids and the fail-soft wrapper never throws/ }
  ]) assert.match(result.stdout, scenario.pattern, `${scenario.clause} executable replay`);
});
