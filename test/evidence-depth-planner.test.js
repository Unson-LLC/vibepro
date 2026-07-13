import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendEvidenceDrilldownEntry,
  buildEvidenceDecisionIndex,
  buildEvidenceDrilldownEntry,
  buildEvidencePlan
} from '../src/evidence-depth-planner.js';

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

test('source/product changes default to summary while retaining risk analysis', () => {
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

  assert.equal(plan.evidence_depth, 'summary');
  assert.equal(plan.artifact_policy.write_html_reports, false);
  assert.equal(plan.artifact_policy.write_full_gate_dag_dump, false);
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

  assert.equal(plan.evidence_depth, 'summary');
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
    prContext: context({
      gate_dag: { nodes: [{ id: 'gate:network_contract' }] }
    }),
    requestedDepth: 'full',
    requestedDepthReason: 'audit replay requested full evidence',
    requestedDepthConsumer: 'value-audit',
    requestedDepthTargets: ['gate:network_contract', '.vibepro/pr/story-full/gate-dag.json']
  });

  assert.equal(plan.evidence_depth, 'full');
  assert.equal(plan.manual_override.status, 'requested');
  assert.equal(plan.manual_override.reason, 'audit replay requested full evidence');
  assert.equal(plan.manual_override.consumer, 'value-audit');
  assert.deepEqual(plan.manual_override.targets, ['gate:network_contract', '.vibepro/pr/story-full/gate-dag.json']);
  assert.equal(plan.artifact_policy.write_full_gate_dag_dump, true);
  assert.equal(plan.artifact_policy.write_html_reports, false);
  assert.ok(plan.generated_artifacts.includes('gate-dag.json'));
  assert.ok(!plan.generated_artifacts.includes('review-cockpit.html'));
});

test('explicit HTML target enables only the selected report writer', () => {
  const plan = buildEvidencePlan({
    story: { story_id: 'story-report' },
    git: { head_sha: 'abc' },
    prContext: context(),
    gateStatus: { unresolved_gates: [] },
    requestedDepth: 'standard',
    requestedDepthReason: 'inspect the reviewer surface',
    requestedDepthConsumer: 'agent-review',
    requestedDepthTargets: ['review-cockpit.html']
  });

  assert.equal(plan.artifact_policy.write_html_reports, true);
  assert.equal(plan.artifact_policy.write_review_cockpit_html, true);
  assert.equal(plan.artifact_policy.write_pr_prepare_html, false);
  assert.equal(plan.artifact_policy.write_gate_dag_html, false);
  assert.equal(plan.artifact_policy.write_split_plan_html, false);
  assert.equal(plan.artifact_policy.write_full_gate_dag_dump, false);
});

test('every accepted drill-down artifact target has an enabled writer', () => {
  const targets = [
    'pr-prepare.html',
    'review-cockpit.html',
    'gate-dag.html',
    'gate-dag.json',
    'split-plan.html'
  ];
  const plan = buildEvidencePlan({
    story: { story_id: 'story-writer-catalog' },
    prContext: context(),
    requestedDepth: 'full',
    requestedDepthReason: 'verify the writer-backed artifact catalog',
    requestedDepthConsumer: 'gate-review',
    requestedDepthTargets: targets
  });

  assert.deepEqual(
    targets.filter((target) => !plan.generated_artifacts.includes(target)),
    []
  );
  assert.equal(plan.artifact_policy.write_pr_prepare_html, true);
  assert.equal(plan.artifact_policy.write_review_cockpit_html, true);
  assert.equal(plan.artifact_policy.write_gate_dag_html, true);
  assert.equal(plan.artifact_policy.write_full_gate_dag_dump, true);
  assert.equal(plan.artifact_policy.write_split_plan_html, true);
});

test('standard/full drill-down fails closed without reason, consumer, and targets', () => {
  assert.throws(() => buildEvidencePlan({
    story: { story_id: 'story-unbounded' },
    fileGroups: fileGroups(),
    prContext: context(),
    requestedDepth: 'full'
  }), /requires --evidence-depth-reason, --evidence-depth-consumer, --evidence-depth-target/);
});

test('standard/full drill-down rejects unknown artifact and unresolved gate targets', () => {
  const request = {
    story: { story_id: 'story-unresolved-target' },
    fileGroups: fileGroups(),
    prContext: context(),
    requestedDepth: 'standard',
    requestedDepthReason: 'inspect a bounded surface',
    requestedDepthConsumer: 'agent-review'
  };

  assert.throws(
    () => buildEvidencePlan({ ...request, requestedDepthTargets: ['typo-report.json'] }),
    /unresolved --evidence-depth-target value\(s\): typo-report\.json/
  );
  assert.throws(
    () => buildEvidencePlan({ ...request, requestedDepthTargets: ['gate:not_in_current_dag'] }),
    /unresolved --evidence-depth-target value\(s\): gate:not_in_current_dag/
  );
  for (const target of ['raw-transcript-log', 'raw-provider-log', 'full-review-lifecycle-dump']) {
    assert.throws(
      () => buildEvidencePlan({ ...request, requestedDepthTargets: [target] }),
      new RegExp(`unresolved --evidence-depth-target value\\(s\\): ${target}`)
    );
  }
});

test('drill-down ledger preserves prior entries and records bounded targets at HEAD', () => {
  const plan = buildEvidencePlan({
    story: { story_id: 'story-ledger' },
    fileGroups: fileGroups(),
    prContext: context({
      gate_dag: { nodes: [{ id: 'gate:traceability_clause_coverage' }] }
    }),
    requestedDepth: 'standard',
    requestedDepthReason: 'inspect unresolved traceability',
    requestedDepthConsumer: 'agent-review',
    requestedDepthTargets: ['gate:traceability_clause_coverage', 'traceability.json']
  });
  const entry = buildEvidenceDrilldownEntry({
    evidencePlan: plan,
    git: { head_sha: 'abc123', base_ref: 'main', head_ref: 'HEAD' },
    createdAt: '2026-07-13T00:00:00.000Z'
  });
  const log = appendEvidenceDrilldownEntry({ entries: [{ depth: 'full' }] }, entry, 'story-ledger');

  assert.equal(log.entries.length, 2);
  assert.equal(log.entries[1].head_sha, 'abc123');
  assert.deepEqual(log.entries[1].targets, ['gate:traceability_clause_coverage', 'traceability.json']);
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
