import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMergeGateAuthorization,
  resolveCurrentMergeGateStatus,
  validateMergeGateOverride
} from '../src/merge-gate-authorization.js';

const auditableOverride = {
  allowed: true,
  waiver_policy: 'cli_reason',
  reason: 'current HEADの非criticalなvalidation sequencing残差を受容する',
  critical_unresolved_gates: [],
  unresolved_gates: [{ id: 'gate:validation_sequencing', severity: 'warning' }]
};
const matchingGateStatus = {
  unresolved_gates: [{ id: 'gate:validation_sequencing', status: 'needs_evidence' }],
  critical_unresolved_gates: []
};

test('MWP-AC-1 ready Gate DAG remains merge-authorized without a waiver', () => {
  const result = buildMergeGateAuthorization({ overall_status: 'ready_for_review' }, null);
  assert.equal(result.allowed, true);
  assert.equal(result.source, 'gate_dag');
  assert.equal(result.gate_override, null);
});

test('MWP-AC-2 current PR create auditable noncritical waiver authorizes merge', () => {
  const result = buildMergeGateAuthorization(
    { overall_status: 'needs_verification' },
    { gate_override: auditableOverride },
    matchingGateStatus
  );
  assert.equal(result.allowed, true);
  assert.equal(result.source, 'pr_create_gate_override');
  assert.deepEqual(result.gate_override, auditableOverride);
});

test('MWP-AC-3 malformed or critical waivers fail closed', () => {
  const cases = [
    [null, 'gate_override_not_allowed'],
    [{ ...auditableOverride, reason: ' ' }, 'gate_override_reason_missing'],
    [{ ...auditableOverride, waiver_policy: '' }, 'gate_override_policy_missing'],
    [{ ...auditableOverride, unresolved_gates: undefined }, 'gate_override_targets_missing'],
    [{ ...auditableOverride, unresolved_gates: [{ id: '' }] }, 'gate_override_targets_invalid'],
    [{ ...auditableOverride, critical_unresolved_gates: undefined }, 'gate_override_critical_gates_unknown'],
    [{ ...auditableOverride, critical_unresolved_gates: [{ id: 'gate:critical' }] }, 'gate_override_contains_critical_gates']
  ];
  for (const [gateOverride, reason] of cases) {
    assert.deepEqual(validateMergeGateOverride(gateOverride), { allowed: false, reason });
  }
});

test('MWP-AC-3 nested execution override remains compatible with persisted PR create shape', () => {
  const result = buildMergeGateAuthorization(
    { overall_status: 'needs_verification' },
    { execution: { gate_override: auditableOverride } },
    matchingGateStatus
  );
  assert.equal(result.allowed, true);
  assert.equal(result.source, 'pr_create_gate_override');
});

test('MWP-AC-3 waiver targets must exactly match the current Gate status', () => {
  const omittedTargets = buildMergeGateAuthorization(
    { overall_status: 'needs_verification' },
    { gate_override: { ...auditableOverride, unresolved_gates: [] } },
    matchingGateStatus
  );
  assert.equal(omittedTargets.allowed, false);
  assert.equal(omittedTargets.reason, 'gate_override_targets_missing');

  const mismatchedTargets = buildMergeGateAuthorization(
    { overall_status: 'needs_verification' },
    { gate_override: auditableOverride },
    {
      unresolved_gates: [{ id: 'gate:different' }],
      critical_unresolved_gates: []
    }
  );
  assert.equal(mismatchedTargets.allowed, false);
  assert.equal(mismatchedTargets.reason, 'gate_override_targets_mismatch');
});

test('MWP-AC-3 current critical Gate status cannot be suppressed by waiver authority', () => {
  const result = buildMergeGateAuthorization(
    { overall_status: 'needs_verification' },
    { gate_override: auditableOverride },
    {
      unresolved_gates: [
        { id: 'gate:validation_sequencing' },
        { id: 'gate:e2e' }
      ],
      critical_unresolved_gates: [{ id: 'gate:e2e' }]
    }
  );
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'current_gate_status_contains_critical_gates');
});

test('MWP-AC-8 waiver reconciliation rejects stale or inconsistently routed pr-prepare authority', () => {
  const currentHead = 'a'.repeat(40);
  const currentDag = {
    overall_status: 'needs_verification',
    nodes: [{ id: 'gate:validation_sequencing', type: 'validation', status: 'needs_evidence', required: true }]
  };
  const prPrepare = {
    git: { head_sha: currentHead },
    gate_status: matchingGateStatus,
    pr_context: { gate_dag: currentDag }
  };
  assert.equal(resolveCurrentMergeGateStatus(prPrepare, currentHead, currentDag), matchingGateStatus);
  assert.equal(resolveCurrentMergeGateStatus(prPrepare, 'b'.repeat(40), currentDag), null);
  assert.equal(resolveCurrentMergeGateStatus(
    prPrepare,
    currentHead,
    { overall_status: 'blocked' }
  ), null);
  assert.equal(resolveCurrentMergeGateStatus(
    prPrepare,
    currentHead,
    {
      overall_status: 'needs_verification',
      nodes: [{ id: 'gate:e2e', type: 'e2e', status: 'needs_evidence', required: true, critical: true }]
    }
  ), null);
  assert.equal(resolveCurrentMergeGateStatus(
    { ...prPrepare, pr_context: {} },
    currentHead,
    currentDag
  ), null);
  const stale = buildMergeGateAuthorization(
    currentDag,
    { gate_override: auditableOverride },
    resolveCurrentMergeGateStatus(prPrepare, 'b'.repeat(40), currentDag)
  );
  assert.equal(stale.allowed, false);
  assert.equal(stale.reason, 'current_gate_status_unknown');
});
