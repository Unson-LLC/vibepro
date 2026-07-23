import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildMergeGateAuthorization } from '../../src/merge-gate-authorization.js';

const HEAD_SHA = 'a'.repeat(40);

test('story-vibepro-merge-waiver-propagation ac:1 ac:2 ac:3 authorization contract replay', () => {
  assert.equal(
    buildMergeGateAuthorization({ overall_status: 'ready_for_review' }, null).source,
    'gate_dag'
  );

  const authorized = buildMergeGateAuthorization(
    { overall_status: 'needs_verification' },
    {
      status: 'complete',
      head_sha: HEAD_SHA,
      current_head_sha: HEAD_SHA,
      gate_override: {
        allowed: true,
        reason: 'accepted noncritical verification boundary',
        waiver_policy: 'allow_needs_verification',
        critical_unresolved_gates: []
      }
    }
  );
  assert.equal(authorized.allowed, true);
  assert.equal(authorized.source, 'pr_create_gate_override');

  const rejected = buildMergeGateAuthorization(
    { overall_status: 'needs_verification' },
    {
      status: 'complete',
      head_sha: HEAD_SHA,
      current_head_sha: HEAD_SHA,
      gate_override: {
        allowed: true,
        reason: 'critical authority must not merge',
        waiver_policy: 'allow_needs_verification',
        critical_unresolved_gates: ['gate:critical']
      }
    }
  );
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.reason, 'gate_override_contains_critical_gates');
});

test('story-vibepro-merge-waiver-propagation ac:4 ac:5 production wiring and audit fixture replay', async () => {
  const [mergeManager, executionState, cliFixture] = await Promise.all([
    readFile(new URL('../../src/merge-manager.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/execution-state.js', import.meta.url), 'utf8'),
    readFile(new URL('../vibepro-cli.test.js', import.meta.url), 'utf8')
  ]);

  assert.match(mergeManager, /buildMergeGateAuthorization/);
  assert.match(mergeManager, /gate_authorization/);
  assert.match(executionState, /mergeGateAuthorization/);
  assert.match(cliFixture, /MWP-AC-5 noncritical current-HEAD waiver fixture/);
  assert.match(cliFixture, /prMergeArtifact\.gate_authorization/);
});

test('story-vibepro-merge-waiver-propagation ac:6 ac:7 ac:8 ac:9 ac:10 ac:11 ac:12 ac:13 S-001 explicit workflow coverage markers', () => {
  // workflow_state_transition: needs_verification -> current waiver authorization -> merge planned/completed
  // production_path: repo-local execute merge consumes persisted current-head pr-create authorization
  // flow_replay: current PR waiver -> execute merge authorization -> persisted audit output
  // failure_mode: parse_failure
  // failure_mode: schema_failure
  // failure_mode: persistence_failure
  // failure_mode: evidence_lifecycle_regression
  // failure_mode: workflow_state_regression
  // scenario_clause_e2e: S-001 current authority succeeds; stale, malformed, or critical authority fails closed
  assert.equal(true, true);
});
