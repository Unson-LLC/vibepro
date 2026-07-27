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

test('story-vibepro-review-surface-violation-ledger RSV-5 C-001 pr prepare blocks and only a decision record clears it', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /RSV-5 pr prepare blocks on gate:review_surface_integrity and keeps it on the DAG path/);
  assert.match(stdout, /RSV-5 the gate fails while unacknowledged, is not cleared by a re-run, and clears only by decision record/);
});

test('story-vibepro-review-surface-violation-ledger RSV-6 S-002 INV-004 stale stays separate from violation and the review workflow state machine is unchanged', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /RSV-6 stale and violation are typed apart: a later unrelated commit records no violation/);
  assert.match(stdout, /RSV-6 a non-completed close is not a violation, and cannot smuggle a review result through/);
  assert.match(stdout, /RSV-6 failure mode timeout: a timed-out review close records no violation and still terminalizes/);
  // S-002: the workflow state machine gains no new states; every close transition
  // still records the close-time snapshot.
  assert.match(stdout, /RSV-7 evidence_lifecycle_regression: recorded review results and lifecycle statuses keep their prior shape/);
});

test('story-vibepro-review-surface-violation-ledger RSV-7 legacy artifacts read clean, a corrupt ledger fails closed, and the evidence lifecycle is unchanged', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /RSV-7 legacy lifecycle entries and a missing ledger read as zero violations/);
  assert.match(stdout, /RSV-7 failure mode parse_failure: a malformed ledger is rejected and fails closed, never read as empty/);
  assert.match(stdout, /RSV-7 evidence_lifecycle_regression: recorded review results and lifecycle statuses keep their prior shape/);
});

test('story-vibepro-review-surface-violation-ledger RSV-8 RSV-9 the erase paths are recorded, not silently allowed', async () => {
  const { stdout } = await contractRun;
  assert.match(stdout, /RSV-8 replacing the ledger with a well-formed empty one does not clear the violation/);
  assert.match(stdout, /RSV-9 concurrent appends of distinct violations both survive/);
  assert.match(stdout, /RSV-9 an unrecognized close reason is rejected instead of coerced to completed/);
  assert.match(stdout, /RSV-9 an unreadable ledger is acknowledgeable rather than a dead end/);
  assert.match(stdout, /RSV-9 review violations CLI reports the unreadable reason and exits non-zero/);
});

test('story-vibepro-review-surface-violation-ledger acceptance suite is fully green', async () => {
  const { stdout } = await contractRun;
  // Assert on the failure count, not the pass count: pinning an exact total
  // turns every future test added to the suite into an unrelated red.
  assert.match(stdout, /ℹ fail 0/);
  assert.doesNotMatch(stdout, /^not ok/m);
  const passed = Number(/ℹ pass (\d+)/.exec(stdout)?.[1] ?? 0);
  assert.ok(passed >= 23, `expected at least 23 acceptance tests, saw ${passed}`);
});
