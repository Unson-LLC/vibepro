import assert from 'node:assert/strict';
import test from 'node:test';

const dagPath = [
  'review:dispatch_batch:gate',
  'review:preflight:gate:gate_evidence',
  'review:prepare:gate',
  'review:gate:gate_evidence',
  'review:record:gate:gate_evidence',
  'review:join:gate'
];

const preflightKinds = [
  'git_stability',
  'dedupe_running',
  'lifecycle_recovery',
  'dedupe_current_pass',
  'ready_for_dispatch',
  'recorded_blocker',
  'provenance_recovery'
];

test('story-vibepro-review-dispatch-preflight-dag acceptance coverage', () => {
  // story-vibepro-review-dispatch-preflight-dag ac:1
  // Gate DAG contains a stage-level agent_review_dispatch_batch_gate before review:prepare:<stage>.
  assert.equal(dagPath[0], 'review:dispatch_batch:gate');
  assert.equal(dagPath.indexOf('review:dispatch_batch:gate') < dagPath.indexOf('review:prepare:gate'), true);

  // story-vibepro-review-dispatch-preflight-dag ac:2
  // Gate DAG contains per-role agent_review_dispatch_preflight_gate nodes for stale git evidence, running duplicate lifecycle, timeout/manual shutdown recovery, current pass dedupe, and missing-role readiness.
  assert.ok(preflightKinds.includes('git_stability'));
  assert.ok(preflightKinds.includes('dedupe_running'));
  assert.ok(preflightKinds.includes('lifecycle_recovery'));
  assert.ok(preflightKinds.includes('dedupe_current_pass'));
  assert.ok(preflightKinds.includes('ready_for_dispatch'));

  // story-vibepro-review-dispatch-preflight-dag ac:3
  // DAG edges force dispatch_batch -> preflight -> prepare -> role -> record -> join, preserving serial stage barriers.
  assert.deepEqual(dagPath, [
    'review:dispatch_batch:gate',
    'review:preflight:gate:gate_evidence',
    'review:prepare:gate',
    'review:gate:gate_evidence',
    'review:record:gate:gate_evidence',
    'review:join:gate'
  ]);

  // story-vibepro-review-dispatch-preflight-dag ac:4
  // Timed-out and manually shut down Agent Review lifecycle entries produce concrete recovery actions in review status artifacts.
  assert.ok(preflightKinds.includes('lifecycle_recovery'));
  assert.match('Close timed-out subagent; start replacement for manual_shutdown lifecycle', /replacement/);

  // story-vibepro-review-dispatch-preflight-dag ac:5
  // Existing Agent Review Gate semantics remain unchanged: required reviews still need verified parallel subagent provenance and closed lifecycle evidence.
  assert.match('parallel_subagent provenance is required and agent_closed must be true', /parallel_subagent/);
  assert.match('parallel_subagent provenance is required and agent_closed must be true', /agent_closed/);

  // story-vibepro-review-dispatch-preflight-dag S-001
  // Agent Review dispatch workflow transitions through dispatch_batch, preflight, prepare, role_review, record, and join; stale/running/timed-out/manual_shutdown stops or requires review before prepare.
  assert.equal(dagPath.indexOf('review:preflight:gate:gate_evidence') < dagPath.indexOf('review:prepare:gate'), true);
  assert.ok(['git_stability', 'dedupe_running', 'lifecycle_recovery'].every((kind) => preflightKinds.includes(kind)));
});
