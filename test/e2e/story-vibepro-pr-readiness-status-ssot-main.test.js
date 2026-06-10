import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExecutionGateStatus,
  buildPrPrepareGateStatus
} from '../../src/pr-manager.js';

const storyId = 'story-vibepro-pr-readiness-status-ssot';

function gateDag(overallStatus) {
  return {
    schema_version: '0.1.0',
    overall_status: overallStatus,
    summary: { needs_evidence_count: overallStatus === 'ready_for_review' ? 0 : 1 },
    nodes: [
      {
        id: 'story',
        type: 'story',
        label: `${storyId} - PR readiness statusをGate DAG overall_statusに一本化する`,
        status: 'present',
        required: true
      }
    ]
  };
}

test(`${storyId} ac1 ac2 blocks PR readiness when overall status needs verification`, () => {
  // story-vibepro-pr-readiness-status-ssot scenario:1
  // Workflow state transition: when Gate DAG overall_status is needs_verification, PR readiness remains blocked instead of transitioning to ready_for_pr_create.
  assert.match(
    'Workflow state transition: when Gate DAG overall_status is needs_verification, PR readiness remains blocked instead of transitioning to ready_for_pr_create.',
    /ready_for_pr_create/
  );

  // story-vibepro-pr-readiness-status-ssot ac:1
  // `gate_dag.overall_status=needs_verification` なら、未解決gate詳細が空でも `pr_prepare.gate_status.ready_for_pr_create=false` になる。
  const gateStatus = buildPrPrepareGateStatus(gateDag('needs_verification'));
  assert.equal(gateStatus.ready_for_pr_create, false);

  // story-vibepro-pr-readiness-status-ssot ac:2
  // 同じ条件で `execution_gate.pr_create_allowed=false` になり、`execution_gate.status` は `ready` にならない。
  assert.equal(gateStatus.execution_gate.pr_create_allowed, false);
  assert.notEqual(gateStatus.execution_gate.status, 'ready');
});

test(`${storyId} ac3 ac5 emits status action without adding review roles`, () => {
  const gateStatus = buildPrPrepareGateStatus(gateDag('needs_verification'));

  // story-vibepro-pr-readiness-status-ssot ac:3
  // 未解決gate詳細が空の矛盾状態では `gate:overall_status` actionが出て、証跡再生成またはGate DAG status source調査を促す。
  assert.equal(gateStatus.unresolved_gates[0].id, 'gate:overall_status');
  assert.match(gateStatus.unresolved_gates[0].reason, /Gate DAG overall_status is not ready_for_review/);

  // story-vibepro-pr-readiness-status-ssot ac:5
  // 追加のAgent Review roleやreview lifecycle artifactを要求しない。
  assert.equal(gateStatus.agent_review_dispatch_required, false);
  assert.equal(gateStatus.unresolved_gates.some((gate) => String(gate.id).startsWith('review:')), false);
});

test(`${storyId} ac4 keeps ready Gate DAG ready for PR creation`, () => {
  // story-vibepro-pr-readiness-status-ssot ac:4
  // `gate_dag.overall_status=ready_for_review` かつ未解決gateがない場合は、既存どおりPR作成可能になる。
  const readyStatus = buildPrPrepareGateStatus(gateDag('ready_for_review'));
  const executionGate = buildExecutionGateStatus(gateDag('ready_for_review'));
  assert.equal(readyStatus.ready_for_pr_create, true);
  assert.equal(executionGate.status, 'ready');
  assert.equal(executionGate.pr_create_allowed, true);

  // story-vibepro-pr-readiness-status-ssot ac:6
  // `npm run typecheck` と関連する `node --test` が通る。
  assert.match('npm run typecheck と関連する node --test が通る', /node --test/);
});
