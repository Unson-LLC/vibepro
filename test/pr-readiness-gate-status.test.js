import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectPrPrepareForLlm
} from '../src/canonical-audit.js';

import {
  buildGateOverride,
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
  assert.equal(gateStatus.unresolved_gates[0].primary_next_command, 'vibepro pr prepare . --view blocking-gates');
  assert.deepEqual(gateStatus.unresolved_gates[0].next_commands, ['vibepro pr prepare . --view blocking-gates']);
  assert.match(gateStatus.agent_instruction, /Resolve Gate DAG evidence before pr create/);
});

test('pr readiness exposes primary next command extracted from blocking gate actions', () => {
  const gateDag = {
    schema_version: '0.1.0',
    overall_status: 'needs_verification',
    nodes: [
      {
        id: 'gate:agent_review',
        type: 'agent_review_gate',
        label: 'Agent Review Gate',
        status: 'needs_review',
        required: true,
        reason: 'required staged review is missing',
        required_actions: [
          'Run `vibepro review prepare . --id story-fast-readiness --stage gate` before PR creation.'
        ]
      }
    ]
  };

  const gateStatus = buildPrPrepareGateStatus(gateDag);
  assert.equal(gateStatus.ready_for_pr_create, false);
  assert.equal(gateStatus.unresolved_gates[0].id, 'gate:agent_review');
  assert.equal(gateStatus.unresolved_gates[0].primary_next_command, 'vibepro review prepare . --id story-fast-readiness --stage gate');
  assert.deepEqual(gateStatus.unresolved_gates[0].next_commands, ['vibepro review prepare . --id story-fast-readiness --stage gate']);
  assert.equal(gateStatus.execution_gate.blocking_gates[0].primary_next_command, 'vibepro review prepare . --id story-fast-readiness --stage gate');
});

test('readiness LLM projection keeps blocking gate next commands', () => {
  const gateDag = {
    schema_version: '0.1.0',
    overall_status: 'needs_verification',
    nodes: [
      {
        id: 'gate:agent_review',
        type: 'agent_review_gate',
        label: 'Agent Review Gate',
        status: 'needs_review',
        required: true,
        reason: 'required staged review is missing',
        required_actions: [
          'Run `vibepro review prepare . --id story-fast-readiness --stage gate` before PR creation.'
        ]
      }
    ]
  };
  const gateStatus = buildPrPrepareGateStatus(gateDag);

  const view = projectPrPrepareForLlm({
    story: { story_id: 'story-fast-readiness' },
    gate_status: gateStatus,
    pr_context: { gate_dag: gateDag }
  }, 'readiness');

  assert.equal(
    view.gate_status.execution_gate.blocking_gates[0].primary_next_command,
    'vibepro review prepare . --id story-fast-readiness --stage gate'
  );
  assert.deepEqual(
    view.gate_status.execution_gate.blocking_gates[0].next_commands,
    ['vibepro review prepare . --id story-fast-readiness --stage gate']
  );
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

test('gate override records synthetic overall status blocker for waiver audit', () => {
  const gateDag = {
    schema_version: '0.1.0',
    overall_status: 'needs_verification',
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

  const override = buildGateOverride(gateDag, {
    allowNeedsVerification: true,
    verificationWaiver: 'audit waiver reason'
  });
  assert.equal(override.allowed, true);
  assert.equal(override.unresolved_gates[0].id, 'gate:overall_status');
  assert.equal(override.unresolved_gates[0].status, 'needs_verification');
  assert.match(override.unresolved_gates[0].reason, /Gate DAG overall_status is not ready_for_review/);
});
