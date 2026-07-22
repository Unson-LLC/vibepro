import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMergeGateAuthorization, validateMergeGateOverride } from '../src/merge-gate-authorization.js';

const auditableOverride = {
  allowed: true,
  waiver_policy: 'cli_reason',
  reason: 'current HEADの非criticalなvalidation sequencing残差を受容する',
  critical_unresolved_gates: [],
  unresolved_gates: [{ id: 'gate:validation_sequencing', severity: 'warning' }]
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
    { gate_override: auditableOverride }
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
    { execution: { gate_override: auditableOverride } }
  );
  assert.equal(result.allowed, true);
  assert.equal(result.source, 'pr_create_gate_override');
});
