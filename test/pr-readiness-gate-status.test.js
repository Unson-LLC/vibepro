import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExecutionGateStatus,
  buildPrPrepareGateStatus
} from '../src/pr-manager.js';

test('pr readiness blocks needs_verification even when no unresolved node details are emitted', () => {
  const gateDag = {
    schema_version: '0.1.0',
    overall_status: 'needs_verification',
    summary: { needs_evidence_count: 1 },
    nodes: [
      {
        id: 'story',
        type: 'story',
        label: 'Story',
        status: 'present',
        required: true
      }
    ]
  };

  const gateStatus = buildPrPrepareGateStatus(gateDag);
  assert.equal(gateStatus.ready_for_pr_create, false);
  assert.equal(gateStatus.execution_gate.status, 'waiver_required');
  assert.equal(gateStatus.execution_gate.pr_create_allowed, false);
  assert.equal(gateStatus.unresolved_gates[0].id, 'gate:overall_status');
  assert.match(gateStatus.agent_instruction, /Resolve Gate DAG evidence before pr create/);
});

test('execution gate remains ready only when Gate DAG overall_status is ready_for_review', () => {
  const readyGateDag = {
    schema_version: '0.1.0',
    overall_status: 'ready_for_review',
    nodes: []
  };

  const executionGate = buildExecutionGateStatus(readyGateDag);
  assert.equal(executionGate.status, 'ready');
  assert.equal(executionGate.pr_create_allowed, true);
});
