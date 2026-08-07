import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReviewDispatchDecision,
  planCompatibleFindingBatches,
  planLifecycleTerminalization,
  selectRiskAdaptiveReviewCoverage
} from '../src/delivery-efficiency-guardrail.js';

const binding = {
  story_id: 'story-efficiency',
  stage: 'gate',
  role: 'implementation',
  head_sha: 'abc123',
  surface_digest: 'surface-1'
};

test('final review waits for an exact frozen surface while preflight remains available', () => {
  const finalDecision = buildReviewDispatchDecision({
    ...binding,
    review_kind: 'final',
    closes_risks: ['contract regression'],
    expected_judgment_delta: 'Confirm the public contract remains fail closed.',
    reusable_evidence: ['targeted:test'],
    freeze: { source: true, spec: true, test: false, review_surface: true },
    lifecycles: [],
    budget: { status: 'within_budget' }
  });
  assert.equal(finalDecision.action, 'stop');
  assert.equal(finalDecision.stop_reason, 'finalization_incomplete');

  const preflight = buildReviewDispatchDecision({
    ...binding,
    review_kind: 'preflight',
    closes_risks: ['scope'],
    expected_judgment_delta: 'Identify boundary risk before freeze.',
    reusable_evidence: [],
    freeze: {},
    lifecycles: [],
    budget: { status: 'within_budget' }
  });
  assert.equal(preflight.action, 'dispatch');
});

test('risk-adaptive review coverage suppresses irrelevant roles and validation-sequence duplicates', () => {
  const internalWorkflow = selectRiskAdaptiveReviewCoverage({
    risk_profile: 'workflow_heavy',
    has_ui_surface: false,
    has_network_surface: false,
    validation_sequence_required: true,
    validation_sequence_checkpoint_ownership: true
  });
  assert.deepEqual(internalWorkflow.final_roles, {
    release_risk: true,
    human_usability: false,
    network_runtime: false
  });
  assert.equal(internalWorkflow.checkpoint_owner, 'validation_sequence');
  assert.deepEqual(internalWorkflow.duplicate_checkpoint_roles_suppressed, [
    'architecture_spec:regression_risk',
    'test_plan:e2e_ux',
    'test_plan:gate_coverage',
    'implementation:runtime_contract',
    'implementation:ux_completion'
  ]);
  assert.deepEqual(internalWorkflow.validation_sequence_review_roles, [
    'architecture_spec:architecture_boundary'
  ]);

  const productWorkflow = selectRiskAdaptiveReviewCoverage({
    risk_profile: 'workflow_heavy',
    has_ui_surface: true,
    has_network_surface: true,
    validation_sequence_required: false,
    validation_sequence_checkpoint_ownership: true
  });
  assert.deepEqual(productWorkflow.final_roles, {
    release_risk: true,
    human_usability: true,
    network_runtime: true
  });
  assert.equal(productWorkflow.checkpoint_owner, 'agent_review');
});

test('same binding dispatch is idempotent for running, uncollected, and completed pass lifecycles', () => {
  for (const status of ['running', 'result_uncollected', 'completed_pass']) {
    const decision = buildReviewDispatchDecision({
      ...binding,
      review_kind: 'final',
      closes_risks: ['contract'],
      expected_judgment_delta: 'Confirm current binding.',
      reusable_evidence: [],
      freeze: { source: true, spec: true, test: true, review_surface: true },
      lifecycles: [{ ...binding, status }],
      budget: { status: 'within_budget' }
    });
    assert.equal(decision.action, status === 'completed_pass' ? 'reuse' : 'await_result');
    assert.equal(decision.dispatch_required, false);
  }
});

test('HEAD mutation terminalizes obsolete work and fails closed when cancellation is unconfirmed', () => {
  const confirmed = planLifecycleTerminalization({ current_head_sha: 'new', lifecycles: [
    { lifecycle_id: 'old-1', status: 'running', head_sha: 'old', cancel_confirmed: true, cancellation_evidence: 'provider-confirmed' }
  ] });
  assert.equal(confirmed.actions[0].terminal_status, 'obsolete');
  assert.equal(confirmed.stop, null);

  const orphan = planLifecycleTerminalization({ current_head_sha: 'new', lifecycles: [
    { lifecycle_id: 'old-2', status: 'running', head_sha: 'old', cancel_confirmed: false }
  ] });
  assert.equal(orphan.actions[0].terminal_status, 'orphaned_agent');
  assert.equal(orphan.stop.reason, 'orphaned_agent');

  const parentOnlyClosure = planLifecycleTerminalization({ current_head_sha: 'new', lifecycles: [
    { lifecycle_id: 'old-3', status: 'running', head_sha: 'old', closed: true, cancel_confirmed: false }
  ] });
  assert.equal(parentOnlyClosure.actions[0].terminal_status, 'orphaned_agent');

  const confirmationWithoutEvidence = planLifecycleTerminalization({ current_head_sha: 'new', lifecycles: [
    { lifecycle_id: 'old-4', status: 'running', head_sha: 'old', cancel_confirmed: true, cancellation_evidence: '' }
  ] });
  assert.equal(confirmationWithoutEvidence.actions[0].terminal_status, 'orphaned_agent');
});

test('compatible repairable findings batch by role and surface while human/conflicting findings remain separate', () => {
  const findings = [
    { id: 'a', role: 'implementation', disposition: 'repairable', code_scope: ['src/a.js'], test_scope: ['test/a.test.js'], detail: 'fix a' },
    { id: 'b', role: 'implementation', disposition: 'repairable', code_scope: ['src/a.js'], test_scope: ['test/a.test.js'], detail: 'fix b' },
    { id: 'c', role: 'implementation', disposition: 'repairable', code_scope: ['src/a.js'], test_scope: ['test/a.test.js'], detail: 'conflicts with a', conflicts_with: ['a'] },
    { id: 'd', role: 'architecture', disposition: 'human_decision', code_scope: ['src/a.js'], test_scope: [], detail: 'owner boundary' }
  ];
  const batches = planCompatibleFindingBatches(findings);
  assert.deepEqual(batches.map((batch) => batch.finding_ids), [['a', 'b'], ['c'], ['d']]);
  assert.equal(batches[0].verification_count, 1);
  assert.equal(batches[0].rereview_count, 1);
});

