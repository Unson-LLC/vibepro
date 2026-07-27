import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

// Replays the acceptance suite as a real child process so the recorded evidence
// is an actual run of the review lifecycle against a real git working tree,
// not an in-process assertion about it.
const contractRun = execFileAsync(process.execPath, [
  '--test',
  'test/review-surface-violation-ledger.test.js'
], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: childEnv,
  maxBuffer: 10 * 1024 * 1024
});

test('story-vibepro-review-surface-violation-ledger RSV-1 close records the close-time head and surface digest', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /RSV-1 review close records the close-time head and surface digest even when nothing moved/);
  assert.doesNotMatch(stdout, /^not ok/m);
});

test('story-vibepro-review-surface-violation-ledger RSV-2 S-001 a mid-review surface change becomes a violation entry', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /RSV-2 a review surface change between start and close is recorded as an append-only violation/);
  assert.match(stdout, /RSV-2 a commit landed mid-review is recorded with head_sha among the changed fields/);
});

test('story-vibepro-review-surface-violation-ledger RSV-3 INV-002 a later clean round never removes the earlier violation', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /RSV-3 a later clean review round never removes or rewrites an earlier violation/);
});

test('story-vibepro-review-surface-violation-ledger RSV-4 replayed closes do not duplicate the record', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /RSV-4 replaying the same close does not duplicate the violation/);
  assert.match(stdout, /RSV-4 violation_id is deterministic, so a direct append of the same fact is a no-op/);
});

test('story-vibepro-review-surface-violation-ledger RSV-5 CON-001 pr prepare blocks and only a decision record clears it', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /RSV-5 pr prepare blocks on gate:review_surface_integrity and keeps it on the DAG path/);
  assert.match(stdout, /RSV-5 the gate fails while unacknowledged, is not cleared by a re-run, and clears only by decision record/);
});

test('story-vibepro-review-surface-violation-ledger RSV-6 INV-003 stale stays separate from violation', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /RSV-6 stale and violation are typed apart: a later unrelated commit records no violation/);
  assert.match(stdout, /RSV-6 a non-completed close is not a violation, and cannot smuggle a review result through/);
  assert.match(stdout, /RSV-6 failure mode timeout: a timed-out review close records no violation and still terminalizes/);
});

test('story-vibepro-review-surface-violation-ledger RSV-7 legacy artifacts, parse failures, and evidence lifecycle are unaffected', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /RSV-7 legacy lifecycle entries and a missing ledger read as zero violations/);
  assert.match(stdout, /RSV-7 failure mode parse_failure: an unreadable ledger reads as zero violations instead of throwing/);
  assert.match(stdout, /RSV-7 evidence_lifecycle_regression: recorded review results and lifecycle statuses keep their prior shape/);
});

test('story-vibepro-review-surface-violation-ledger acceptance suite is fully green', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /ℹ pass 16/);
  assert.match(stdout, /ℹ fail 0/);
});
