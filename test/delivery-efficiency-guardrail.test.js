import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateDeliveryMetrics,
  buildReviewDispatchDecision,
  evaluateDeliveryBudget,
  normalizeEfficiencyPolicy,
  planCompatibleFindingBatches,
  planLifecycleTerminalization,
  summarizeEfficiencyDebt
} from '../src/delivery-efficiency-guardrail.js';
import { buildAgentReviewEfficiencySummary } from '../src/pr-manager.js';

const binding = {
  story_id: 'story-efficiency',
  stage: 'gate',
  role: 'implementation',
  head_sha: 'abc123',
  surface_digest: 'surface-1'
};

test('policy keeps unspecified and unmeasured budgets unknown instead of zero', () => {
  const policy = normalizeEfficiencyPolicy({ max_review_dispatches_by_role: { implementation: 2 } });
  assert.equal(policy.max_total_tokens, null);
  assert.equal(policy.max_elapsed_ms, null);
  assert.equal(policy.max_review_dispatches_by_role.implementation, 2);

  const result = evaluateDeliveryBudget(policy, { total_tokens: null, review_dispatches_by_role: { implementation: 1 } });
  assert.equal(result.status, 'within_budget');
  assert.equal(result.dimensions.total_tokens.status, 'unknown');
  assert.equal(result.remaining.total_tokens, null);
});

test('budget exceed and required attribution unknown are typed stops', () => {
  const policy = normalizeEfficiencyPolicy({ max_total_tokens: 100, require_known_attribution: true });
  const exceeded = evaluateDeliveryBudget(policy, { total_tokens: 101, attribution_status: 'known' });
  assert.deepEqual(exceeded.stop, { type: 'stop', reason: 'budget_exceeded', dimensions: ['total_tokens'] });

  const unknown = evaluateDeliveryBudget(policy, { total_tokens: 20, attribution_status: 'unknown' });
  assert.deepEqual(unknown.stop, { type: 'stop', reason: 'attribution_unknown', dimensions: ['attribution_status'] });
});

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
    { lifecycle_id: 'old-1', status: 'running', head_sha: 'old', cancel_confirmed: true }
  ] });
  assert.equal(confirmed.actions[0].terminal_status, 'obsolete');
  assert.equal(confirmed.stop, null);

  const orphan = planLifecycleTerminalization({ current_head_sha: 'new', lifecycles: [
    { lifecycle_id: 'old-2', status: 'running', head_sha: 'old', cancel_confirmed: false }
  ] });
  assert.equal(orphan.actions[0].terminal_status, 'orphaned_agent');
  assert.equal(orphan.stop.reason, 'orphaned_agent');
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

test('metrics separate review union wall clock from parallel agent consumption and preserve unknown', () => {
  const metrics = aggregateDeliveryMetrics({
    run_started_at: '2026-07-21T00:00:00.000Z',
    trusted_pr_ready_at: '2026-07-21T00:10:00.000Z',
    observed_work_ms: 120_000,
    reviews: [
      { role: 'runtime', started_at: '2026-07-21T00:01:00.000Z', finished_at: '2026-07-21T00:06:00.000Z' },
      { role: 'runtime', started_at: '2026-07-21T00:03:00.000Z', finished_at: '2026-07-21T00:08:00.000Z' }
    ],
    total_tokens: 1_000,
    fresh_input_tokens: null,
    accepted_finding_count: 2,
    full_suite_count: 1
  });
  assert.equal(metrics.trusted_pr_ready_ms, 600_000);
  assert.equal(metrics.review_wait_ms, 420_000);
  assert.equal(metrics.subagent_wall_clock_ms, 420_000);
  assert.equal(metrics.agent_consumption_ms, 600_000);
  assert.equal(metrics.subagent_count, 2);
  assert.deepEqual(metrics.review_dispatches_by_role, { runtime: 2 });
  assert.equal(metrics.fresh_input_tokens, null);
  assert.equal(metrics.tokens_per_accepted_finding.total, 500);
  assert.equal(metrics.tokens_per_accepted_finding.fresh_input, null);
});

test('efficiency debt stays separate from correctness readiness', () => {
  const summary = summarizeEfficiencyDebt({
    correctness_ready: true,
    lifecycles: [{ status: 'timed_out' }, { status: 'obsolete' }, { status: 'orphaned_agent' }],
    duplicate_dispatch_count: 2,
    budget: { status: 'exceeded', exceeded: ['review_dispatch_count'] }
  });
  assert.equal(summary.correctness_ready, true);
  assert.equal(summary.has_efficiency_debt, true);
  assert.equal(summary.ready_for_pr_create, true);
  assert.deepEqual(summary.debt.map((item) => item.kind), ['timed_out', 'obsolete', 'orphaned_agent', 'duplicate_dispatch', 'budget_exceeded']);
});

test('pr gate summary exposes review lifecycle debt without changing correctness readiness', () => {
  const summary = buildAgentReviewEfficiencySummary({ stages: [{ roles: [
    { lifecycle: { effective_status: 'timed_out', timed_out_count: 1, running_count: 0 } },
    { lifecycle: { effective_status: 'running', timed_out_count: 0, running_count: 2 } }
  ] }], delivery_efficiency: {
    policy: { max_subagent_count: 1 },
    reviews: [
      { role: 'gate_evidence', started_at: '2026-07-21T00:00:00.000Z', finished_at: '2026-07-21T00:01:00.000Z' },
      { role: 'gate_evidence', started_at: '2026-07-21T00:00:30.000Z', finished_at: '2026-07-21T00:02:00.000Z' }
    ],
    measurements: { attribution_status: 'unknown', repair_batch_count: 1 },
    repair_batch_count: 1,
    repair_states: [{ stage: 'gate', role: 'gate_evidence', status: 'planned', repair_batch_count: 1 }]
  } }, true);
  assert.equal(summary.correctness_ready, true);
  assert.equal(summary.ready_for_pr_create, true);
  assert.deepEqual(summary.debt.map((item) => item.kind), ['timed_out', 'duplicate_dispatch', 'budget_exceeded']);
  assert.equal(summary.metrics.review_wait_ms, 120000);
  assert.equal(summary.budget.stop.reason, 'budget_exceeded');
  assert.equal(summary.attribution.status, 'unknown');
  assert.equal(summary.dispatch_decision.status, 'unknown');
  assert.equal(summary.repair.batch_count, 1);
});
