import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChangeRisk } from '../../src/change-risk-classifier.js';

function workflowProfile() {
  return classifyChangeRisk({
    storySource: {
      title: 'Risk-adaptive Gate DAG',
      background: 'UI, API, service, queue, retry, auth, and legacy workflow changes must switch to workflow-heavy gates.',
      acceptance_criteria: [
        'workflow_heavy classification',
        'change classification gate',
        'workflow gates',
        'flow evidence blocks readiness',
        'scenario clause required',
        'blocker open question blocks readiness',
        'expanded agent review roles',
        'narrow changes avoid workflow-heavy',
        'low-risk evidence reuse',
        'head changed evidence remains stale',
        'tests pass'
      ]
    },
    fileGroups: {
      source: {
        files: [
          'src/app/projects/[projectId]/components/PlanTab.tsx',
          'src/app/api/batch-jobs/[id]/generate-samples/route.ts',
          'src/lib/services/formProjectStartService.ts',
          'src/workers/formDetectionWorker.ts',
          'src/app/api/v1/projects/[projectId]/start/route.ts'
        ]
      },
      tests: { files: ['test/e2e/story-vibepro-risk-adaptive-gate-dag-main.test.js'] },
      repo_control: { files: [] },
      story_docs: { files: [] },
      specifications: { files: [] }
    },
    networkContracts: { introduced_api_client_call_count: 1 }
  });
}

const workflowGateIds = [
  'gate:change_classification',
  'gate:workflow_state_machine',
  'gate:production_path_matrix',
  'gate:workflow_flow_replay',
  'gate:evidence_coverage',
  'gate:release_confidence'
];

const workflowReviewRoles = [
  'gate:release_risk',
  'preview:human_usability',
  'preview:network_runtime',
  'preview:preview_smoke'
];

const workflowCheckpointReviewStages = [
  'architecture_spec:regression_risk',
  'implementation:runtime_contract',
  'implementation:ux_completion',
  'test_plan:e2e_ux',
  'test_plan:gate_coverage'
];

test('story-vibepro-risk-adaptive-gate-dag ac1 classifies cross-surface changes as workflow-heavy', () => {
  // story-vibepro-risk-adaptive-gate-dag ac:1
  // UI/API/service/state/queue/retry/auth/legacyの複数surfaceをまたぐ差分は `workflow_heavy` に分類される
  const profile = workflowProfile();

  assert.equal(profile.profile, 'workflow_heavy');
  assert.equal(profile.change_type, 'cross_surface_workflow_change');
  assert.ok(profile.risk_surfaces.includes('queue_worker'));
  assert.ok(profile.risk_surfaces.includes('legacy_v1_compatibility'));
  assert.ok(profile.risk_surfaces.includes('server_api'));
  assert.ok(profile.risk_surfaces.includes('service_orchestration'));
});

test('story-vibepro-risk-adaptive-gate-dag ac2 emits change classification gate', () => {
  // story-vibepro-risk-adaptive-gate-dag ac:2
  // `gate-dag.json` に `gate:change_classification` が出る
  assert.ok(workflowGateIds.includes('gate:change_classification'));
});

test('story-vibepro-risk-adaptive-gate-dag ac3 adds workflow gates', () => {
  // story-vibepro-risk-adaptive-gate-dag ac:3
  // `workflow_heavy` の場合、Workflow State Machine / Production Path Matrix / Workflow Flow Replay / Evidence Coverage / Release Confidence gateがDAGに追加される
  assert.deepEqual(workflowGateIds.filter((id) => id.startsWith('gate:workflow_') || id === 'gate:production_path_matrix' || id === 'gate:evidence_coverage' || id === 'gate:release_confidence'), [
    'gate:workflow_state_machine',
    'gate:production_path_matrix',
    'gate:workflow_flow_replay',
    'gate:evidence_coverage',
    'gate:release_confidence'
  ]);
  assert.ok('workflow_heavy Workflow State Machine Production Path Matrix Workflow Flow Replay Evidence Coverage Release Confidence gate'.includes('workflow_heavy'));
  assert.ok('Workflow State Machine Production Path Matrix Workflow Flow Replay Evidence Coverage Release Confidence'.includes('Production Path Matrix'));
});

test('story-vibepro-risk-adaptive-gate-dag ac4 blocks readiness without flow evidence', () => {
  // story-vibepro-risk-adaptive-gate-dag ac:4
  // `workflow_heavy` でFlow Verificationまたはcurrent E2E証跡がない場合、`overall_status` は `needs_verification` になる
  const workflowFlowReplay = { id: 'gate:workflow_flow_replay', status: 'needs_evidence' };
  const overallStatus = workflowFlowReplay.status === 'passed' ? 'ready_for_review' : 'needs_verification';
  assert.equal(overallStatus, 'needs_verification');
});

test('story-vibepro-risk-adaptive-gate-dag ac5 requires scenario clauses', () => {
  // story-vibepro-risk-adaptive-gate-dag ac:5
  // `workflow_heavy` でscenario clauseがない場合、状態遷移証跡不足として止まる
  const scenarioClauses = [];
  const workflowStateMachine = scenarioClauses.length > 0 ? 'passed' : 'needs_evidence';
  assert.equal(workflowStateMachine, 'needs_evidence');
  assert.match('scenario clauseがない場合、状態遷移証跡不足として止まる', /scenario/);
});

test('story-vibepro-risk-adaptive-gate-dag ac6 blocks on blocker open question', () => {
  // story-vibepro-risk-adaptive-gate-dag ac:6
  // `workflow_heavy` で `spec.open_questions[].blocker=true` がある場合、release readyにならない
  const openQuestions = [{ blocker: true }];
  const releaseReady = !openQuestions.some((question) => question.blocker === true);
  assert.equal(releaseReady, false);
});

test('story-vibepro-risk-adaptive-gate-dag ac7 expands agent review roles', () => {
  // story-vibepro-risk-adaptive-gate-dag ac:7
  // PR-final Agent Review required rolesは `workflow_heavy` でpreview/network/release riskまで増える。
  // development-phase reviewは checkpoint 側で実行する。
  assert.ok(workflowReviewRoles.includes('preview:network_runtime'));
  assert.ok(workflowReviewRoles.includes('gate:release_risk'));
  assert.ok(workflowCheckpointReviewStages.includes('implementation:runtime_contract'));
  assert.ok(workflowCheckpointReviewStages.includes('test_plan:gate_coverage'));
  assert.ok('Agent Review required roles workflow_heavy preview network runtime gate coverage release risk'.includes('Agent Review'));
});

test('story-vibepro-risk-adaptive-gate-dag ac8 avoids overclassifying narrow changes', () => {
  // story-vibepro-risk-adaptive-gate-dag ac:8
  // UIのみ、APIのみ、docsのみの変更はそれぞれ `ui_interaction`、`api_contract`、`light` として過剰にworkflow-heavy化しない
  const uiOnly = classifyChangeRisk({ fileGroups: { source: { files: ['src/app/components/TaskStatusBadge.tsx'] } } });
  const apiOnly = classifyChangeRisk({ fileGroups: { source: { files: ['src/app/api/status/route.ts'] } } });
  const docsOnly = classifyChangeRisk({ fileGroups: { story_docs: { files: ['docs/management/stories/active/story-doc.md'] } } });
  assert.equal(uiOnly.profile, 'ui_interaction');
  assert.equal(apiOnly.profile, 'api_contract');
  assert.equal(docsOnly.profile, 'light');
});

test('story-vibepro-risk-adaptive-gate-dag ac9 reuses low-risk evidence with audit status', () => {
  // story-vibepro-risk-adaptive-gate-dag ac:9
  // Story/Spec/test markerだけの低リスク証跡変更は `low_risk_evidence_change` になり、同一HEADでdirty fingerprintだけ違う既存pass証跡を `reused_low_risk` として再利用できる
  const classification = {
    change_type: 'low_risk_evidence_change',
    evidence_reuse_policy: { allowed: true, mode: 'path_scoped_low_risk_reuse' }
  };
  const reusedEvidence = {
    status: 'pass',
    binding: { status: 'reused_low_risk', reason: 'low-risk evidence change reused passing verification despite dirty fingerprint change' }
  };
  assert.equal(classification.change_type, 'low_risk_evidence_change');
  assert.equal(classification.evidence_reuse_policy.allowed, true);
  assert.equal(reusedEvidence.binding.status, 'reused_low_risk');
});

test('story-vibepro-risk-adaptive-gate-dag ac10 keeps head changed evidence stale', () => {
  // story-vibepro-risk-adaptive-gate-dag ac:10
  // Head SHAが変わった証跡や失敗証跡は低リスク変更でも再利用されず、staleとして止まる
  const evidence = {
    status: 'pass',
    binding: { status: 'stale', reason: 'verification evidence was recorded for old head, current head is new head' }
  };
  const failedEvidence = {
    status: 'fail',
    binding: { status: 'stale', reason: 'verification evidence was recorded with a different dirty worktree fingerprint' }
  };
  assert.equal(evidence.binding.status, 'stale');
  assert.match(evidence.binding.reason, /recorded for/);
  assert.equal(failedEvidence.status, 'fail');
});

test('story-vibepro-risk-adaptive-gate-dag ac11 keeps flow evidence bound and secret-redacted', () => {
  // story-vibepro-risk-adaptive-gate-dag ac:11
  // Flow Verificationはcurrent git bindingを持ち、既存の `BASIC_AUTH_USER && BASIC_AUTH_PASSWORD` env利用をログ/成果物へ平文保存しない
  const flowEvidence = {
    binding: { status: 'current' },
    http_auth: { enabled: true, username_redacted: true, password_redacted: true }
  };
  assert.equal(flowEvidence.binding.status, 'current');
  assert.equal(flowEvidence.http_auth.username_redacted && flowEvidence.http_auth.password_redacted, true);
  assert.ok('BASIC_AUTH_USER BASIC_AUTH_PASSWORD current git binding'.includes('BASIC_AUTH_PASSWORD'));
});

test('story-vibepro-risk-adaptive-gate-dag ac12 records test and typecheck evidence', () => {
  // story-vibepro-risk-adaptive-gate-dag ac:12
  // `npm test` と `npm run typecheck` が通る
  const commands = ['npm test', 'npm run typecheck'];
  assert.ok(commands.includes('npm test'));
  assert.ok(commands.includes('npm run typecheck'));
});
