import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEvidenceDecisionIndex, buildEvidencePlan } from '../src/evidence-depth-planner.js';

function fileGroups(overrides = {}) {
  return {
    story_docs: { count: 0, files: [] },
    architecture_docs: { count: 0, files: [] },
    specifications: { count: 0, files: [] },
    policy_docs: { count: 0, files: [] },
    source: { count: 0, files: [] },
    tests: { count: 0, files: [] },
    repo_control: { count: 0, files: [] },
    vibepro_artifacts: { count: 0, files: [] },
    other: { count: 0, files: [] },
    ...overrides
  };
}

function context(overrides = {}) {
  return {
    change_classification: { profile: 'light', risk_surfaces: [] },
    pr_route: { route_type: 'docs_only', signals: [] },
    engineering_judgment: {
      route_type: 'knowledge_docs',
      route_dag: 'knowledge_docs_dag',
      confidence: 0.7,
      signals: ['risk_profile:light'],
      active_axis_count: 1,
      active_axes: ['intent'],
      judgment_axes: [{ axis: 'intent', status: 'passed', reason: 'Story intent exists' }]
    },
    gate_dag: { overall_status: 'ready_for_review', nodes: [] },
    decision_records: { decisions: [] },
    ...overrides
  };
}

test('low-risk changes default to summary and skip HTML/full dump artifacts', () => {
  const plan = buildEvidencePlan({
    story: { story_id: 'story-low-risk' },
    git: { base_ref: 'main', head_ref: 'HEAD', head_sha: 'abc', changed_files: [{ path: 'README.md' }] },
    fileGroups: fileGroups({ other: { count: 1, files: ['README.md'] } }),
    prContext: context(),
    gateStatus: { unresolved_gates: [] }
  });

  assert.equal(plan.evidence_depth, 'summary');
  assert.equal(plan.default_depth, 'summary');
  assert.equal(plan.artifact_policy.write_html_reports, false);
  assert.equal(plan.artifact_policy.write_full_gate_dag_dump, false);
  assert.ok(plan.skipped_artifacts.includes('gate-dag.json'));
  assert.ok(plan.skipped_artifacts.includes('review-cockpit.html'));
});

test('source/product changes default to standard', () => {
  const plan = buildEvidencePlan({
    story: { story_id: 'story-source' },
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: fileGroups({ source: { count: 1, files: ['src/app.js'] } }),
    prContext: context({
      change_classification: { profile: 'runtime_behavior', risk_surfaces: [] },
      pr_route: { route_type: 'runtime_change', signals: ['file_group:source'] }
    }),
    gateStatus: { unresolved_gates: [] }
  });

  assert.equal(plan.evidence_depth, 'standard');
  assert.equal(plan.artifact_policy.write_html_reports, true);
  assert.equal(plan.artifact_policy.write_full_gate_dag_dump, true);
});

test('high-risk surfaces and risk-bearing missing gates create targeted full surfaces', () => {
  const plan = buildEvidencePlan({
    story: { story_id: 'story-security' },
    git: { changed_files: [{ path: 'src/auth.js' }] },
    fileGroups: fileGroups({ source: { count: 1, files: ['src/auth.js'] } }),
    prContext: context({
      change_classification: { profile: 'security', risk_surfaces: ['auth_boundary'] },
      pr_route: { route_type: 'runtime_change', signals: ['file_group:source'] },
      engineering_judgment: {
        route_type: 'security_trust',
        route_dag: 'security_trust_dag',
        confidence: 0.82,
        signals: ['surface:auth_or_security'],
        active_axis_count: 1,
        active_axes: ['boundary'],
        judgment_axes: [{ axis: 'boundary', status: 'needs_evidence', reason: 'Auth boundary changed' }]
      },
      gate_dag: {
        overall_status: 'needs_verification',
        nodes: [
          { id: 'gate:network_contract', type: 'verification_gate', status: 'needs_evidence', required: true, reason: 'Need network evidence' }
        ]
      }
    }),
    gateStatus: {
      unresolved_gates: [
        { id: 'gate:network_contract', type: 'verification_gate', status: 'needs_evidence', required: true, reason: 'Need network evidence' }
      ]
    }
  });

  assert.equal(plan.evidence_depth, 'standard');
  assert.deepEqual(
    plan.targeted_full_surfaces.map((surface) => surface.surface).sort(),
    ['auth_boundary', 'gate:network_contract', 'security', 'security_trust']
  );
  assert.ok(plan.risk_signals.some((signal) => signal.kind === 'engineering_route' && signal.value === 'security_trust'));
});

test('operator override records manual full request with reason and consumer', () => {
  const plan = buildEvidencePlan({
    story: { story_id: 'story-full' },
    fileGroups: fileGroups(),
    prContext: context(),
    requestedDepth: 'full',
    requestedDepthReason: 'audit replay requested full evidence',
    requestedDepthConsumer: 'value-audit'
  });

  assert.equal(plan.evidence_depth, 'full');
  assert.equal(plan.manual_override.status, 'requested');
  assert.equal(plan.manual_override.reason, 'audit replay requested full evidence');
  assert.equal(plan.manual_override.consumer, 'value-audit');
});

test('decision index keeps Engineering Judgment signals in summary depth', () => {
  const prContext = context();
  const plan = buildEvidencePlan({
    story: { story_id: 'story-low-risk' },
    fileGroups: fileGroups({ other: { count: 1, files: ['README.md'] } }),
    prContext,
    gateStatus: { overall_status: 'ready_for_review', ready_for_pr_create: true, unresolved_gates: [], critical_unresolved_gates: [] }
  });
  const index = buildEvidenceDecisionIndex({
    story: { story_id: 'story-low-risk' },
    prContext,
    evidencePlan: plan,
    gateStatus: { overall_status: 'ready_for_review', ready_for_pr_create: true, unresolved_gates: [], critical_unresolved_gates: [] }
  });

  assert.equal(index.evidence_depth, 'summary');
  assert.equal(index.engineering_judgment.route_type, 'knowledge_docs');
  assert.deepEqual(index.engineering_judgment.active_axes, ['intent']);
});
