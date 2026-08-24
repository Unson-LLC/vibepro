import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  advanceReviewConvergenceState,
  buildReviewConvergenceSnapshot,
  buildReviewDeltaClosure,
  classifyReviewPath,
  deriveReviewCausalSurface,
  evaluateReviewCausalInvalidation,
  normalizeReviewRuntimeFailure,
  updateReviewConvergenceState
} from '../src/review-causal-dag.js';

test('two-file implementation and test fix preserves upstream planning judgments while invalidating descendants', () => {
  const changedFiles = [
    '.husky/pre-push',
    'tests/integration/vibepro-runtime-push-hook-entrypoints.test.js'
  ];
  for (const role of ['product_requirement', 'architecture_boundary', 'spec_consistency']) {
    const result = evaluateReviewCausalInvalidation({
      stage: 'planning_spec',
      role,
      changedFiles,
      causalReview: {
        invalidation_surface: [
          { path: 'docs/management/stories/active/story-x.md', domain: 'story', classified: true },
          { path: 'docs/specs/story-x.md', domain: 'spec', classified: true }
        ]
      }
    });
    assert.equal(result.reusable, true, `${role} should survive a release/test-only delta`);
    assert.equal(result.relevant_changed_files.length, 0);
    assert.equal(result.invalidation_surface_used, true);
  }
  const runtime = evaluateReviewCausalInvalidation({
    stage: 'implementation',
    role: 'runtime_contract',
    changedFiles,
    causalReview: {
      invalidation_surface: [
        { path: 'src/runtime.js', domain: 'implementation', classified: true },
        { path: 'tests/integration/vibepro-runtime-push-hook-entrypoints.test.js', domain: 'test', classified: true }
      ]
    }
  });
  assert.equal(runtime.reusable, false);
  assert.deepEqual(runtime.relevant_changed_files.map((item) => item.domain), ['release', 'test']);
});

test('path classifier keeps semantic, implementation, test and release surfaces distinct', () => {
  assert.equal(classifyReviewPath('docs/management/stories/active/story-x.md').domain, 'story');
  assert.equal(classifyReviewPath('.vibepro/spec/story-x/spec.json').domain, 'spec');
  assert.equal(classifyReviewPath('docs/architecture/x.md').domain, 'architecture');
  assert.equal(classifyReviewPath('src/runtime.js').domain, 'implementation');
  assert.equal(classifyReviewPath('test/runtime.test.js').domain, 'test');
  assert.equal(classifyReviewPath('.husky/pre-push').domain, 'release');
  assert.equal(classifyReviewPath('notes/unclassified.txt').classified, false);
});

test('causal surface separates inspected files from decision dependencies and exposes unknown inspected paths', () => {
  const first = deriveReviewCausalSurface({
    stage: 'planning_spec',
    role: 'product_requirement',
    inspectionInputs: [
      'docs/management/stories/active/story-x.md',
      'docs/specs/story-x.md',
      'src/runtime.js',
      'test/runtime.test.js'
    ]
  });
  assert.deepEqual(first.inspection_surface.map((item) => item.domain).sort(), ['spec', 'story', 'implementation', 'test'].sort());
  assert.deepEqual(first.decision_dependencies.map((item) => item.domain).sort(), ['spec', 'story']);
  assert.equal(first.classification_status, 'classified');

  const delta = deriveReviewCausalSurface({
    stage: 'planning_spec',
    role: 'product_requirement',
    inspectionInputs: ['src/runtime.js'],
    previousCausalReview: first
  });
  assert.deepEqual(delta.invalidation_surface.map((item) => item.path), first.invalidation_surface.map((item) => item.path));

  const unknown = deriveReviewCausalSurface({
    stage: 'planning_spec',
    role: 'product_requirement',
    inspectionInputs: ['notes/unclassified.txt']
  });
  assert.equal(unknown.classification_status, 'inconclusive_fail_closed');
  assert.deepEqual(unknown.unknown_inspection_surface.map((item) => item.path), ['notes/unclassified.txt']);
});

test('recorded invalidation surface is used and unclassified changed paths fail closed', () => {
  const causalReview = {
    invalidation_surface: [
      { path: 'docs/management/stories/active/story-x.md', domain: 'story', classified: true },
      { path: 'docs/specs/story-x.md', domain: 'spec', classified: true }
    ]
  };
  const unrelated = evaluateReviewCausalInvalidation({
    stage: 'planning_spec',
    role: 'product_requirement',
    changedFiles: ['src/runtime.js'],
    causalReview
  });
  assert.equal(unrelated.reusable, true);
  assert.equal(unrelated.invalidation_surface_used, true);

  const storyChange = evaluateReviewCausalInvalidation({
    stage: 'planning_spec',
    role: 'product_requirement',
    changedFiles: ['docs/management/stories/active/story-x.md'],
    causalReview
  });
  assert.equal(storyChange.reusable, false);
  assert.equal(storyChange.relevant_changed_files[0].path, 'docs/management/stories/active/story-x.md');

  const unknown = evaluateReviewCausalInvalidation({
    stage: 'planning_spec',
    role: 'product_requirement',
    changedFiles: ['notes/unclassified.txt'],
    causalReview
  });
  assert.equal(unknown.reusable, false);
  assert.equal(unknown.fail_closed, true);
  assert.equal(unknown.classification_status, 'inconclusive_fail_closed');
});

test('strict-head certification never reuses a changed candidate', () => {
  const result = evaluateReviewCausalInvalidation({
    stage: 'gate',
    role: 'release_risk',
    strictHead: true,
    changedFiles: ['README.md'],
    causalReview: { invalidation_surface: [{ path: 'README.md', domain: 'docs', classified: true }] }
  });
  assert.equal(result.reusable, false);
  assert.equal(result.fail_closed, true);
  assert.match(result.reason, /strict HEAD/);
});

test('stale content with no resolved changed-file delta fails closed', () => {
  const result = evaluateReviewCausalInvalidation({
    stage: 'planning_spec',
    role: 'product_requirement',
    changedFiles: [],
    causalReview: { invalidation_surface: [{ path: 'docs/specs/story-x.md', domain: 'spec', classified: true }] }
  });
  assert.equal(result.reusable, false);
  assert.equal(result.fail_closed, true);
  assert.equal(result.classification_status, 'unresolved_delta');
});

test('finding closure remains delta-scoped and refuses to hide unresolved prior findings', () => {
  const closure = buildReviewDeltaClosure({
    previousReview: {
      status: 'needs_changes',
      recorded_at: '2026-08-22T00:00:00Z',
      git_context: { head_sha: 'aaa' },
      findings: [{ id: 'finding-a' }, { id: 'finding-b' }]
    },
    resolvedFindings: ['finding-a:test/fix.test.js'],
    currentHeadSha: 'bbb',
    closureInputs: ['src/fix.js', 'test/fix.test.js']
  });
  assert.equal(closure.mode, 'delta_closure');
  assert.deepEqual(closure.resolved_findings, [{ finding_id: 'finding-a', evidence_ref: 'test/fix.test.js' }]);
  assert.deepEqual(closure.unresolved_finding_ids, ['finding-b']);
});

test('runtime failures are separate from product findings', () => {
  const failure = normalizeReviewRuntimeFailure('wrong-request', 'reviewer opened planning_spec instead of requirement');
  assert.deepEqual(failure, {
    kind: 'wrong_request',
    detail: 'reviewer opened planning_spec instead of requirement',
    product_finding: false
  });
  assert.throws(() => normalizeReviewRuntimeFailure('product_bug'), /must be one of/);
});

test('HEAD-only change without a completed review event does not advance a wave', () => {
  const stages = stageSummary({ recordedAt: '2026-08-22T00:00:00Z' });
  const first = advanceReviewConvergenceState(null, buildReviewConvergenceSnapshot({ headSha: 'head-1', stageSummaries: stages }));
  const second = advanceReviewConvergenceState(first, buildReviewConvergenceSnapshot({ headSha: 'head-2', stageSummaries: stages }));
  assert.equal(second.wave_count, first.wave_count);
  assert.equal(second.no_progress_count, first.no_progress_count);
  assert.equal(second.event_advanced, false);
  assert.equal(second.progress_detected, false);
  assert.deepEqual(second.progress_reasons, ['head_only_observation']);
  assert.equal(second.head_churn_count, 1);
});

test('same role with a different finding is semantic progress', () => {
  const first = advanceReviewConvergenceState(null, buildReviewConvergenceSnapshot({
    headSha: 'head-1',
    stageSummaries: stageSummary({ recordedAt: '2026-08-22T00:00:00Z', findingId: 'finding-a', detail: 'first defect' })
  }));
  const second = advanceReviewConvergenceState(first, buildReviewConvergenceSnapshot({
    headSha: 'head-2',
    stageSummaries: stageSummary({ recordedAt: '2026-08-22T01:00:00Z', findingId: 'finding-b', detail: 'different defect' })
  }));
  assert.equal(second.progress_detected, true);
  assert.equal(second.no_progress_count, 0);
  assert.ok(second.progress_reasons.includes('finding_state_changed'));
});

test('same finding repaired across multiple commits stays converging when evidence changes', () => {
  let state = advanceReviewConvergenceState(null, buildReviewConvergenceSnapshot({
    headSha: 'head-1',
    stageSummaries: stageSummary({ recordedAt: '2026-08-22T00:00:00Z', inspectionEvidence: 'evidence-1' })
  }));
  state = advanceReviewConvergenceState(state, buildReviewConvergenceSnapshot({
    headSha: 'head-2',
    stageSummaries: stageSummary({ recordedAt: '2026-08-22T01:00:00Z', inspectionEvidence: 'evidence-2' })
  }));
  assert.equal(state.status, 'converging');
  assert.equal(state.no_progress_count, 0);
  assert.ok(state.progress_reasons.includes('review_evidence_changed'));
  state = advanceReviewConvergenceState(state, buildReviewConvergenceSnapshot({
    headSha: 'head-3',
    stageSummaries: stageSummary({ recordedAt: '2026-08-22T02:00:00Z', inspectionEvidence: 'evidence-3' })
  }));
  assert.equal(state.status, 'converging');
  assert.equal(state.no_progress_count, 0);
});

test('three completed no-progress review waves after baseline stop as nonconvergent', () => {
  let state = advanceReviewConvergenceState(null, buildReviewConvergenceSnapshot({
    headSha: 'head-1',
    stageSummaries: stageSummary({ recordedAt: '2026-08-22T00:00:00Z' })
  }));
  for (let index = 1; index <= 3; index += 1) {
    state = advanceReviewConvergenceState(state, buildReviewConvergenceSnapshot({
      headSha: `head-${index + 1}`,
      stageSummaries: stageSummary({ recordedAt: `2026-08-22T0${index}:00:00Z` })
    }));
  }
  assert.equal(state.status, 'review_nonconvergent');
  assert.equal(state.no_progress_count, 3);
  assert.equal(state.wave_count, 4);
  assert.equal(state.head_churn_count, 3);
});

test('runtime retry followed by a successful pass converges instead of counting a product loop', () => {
  const failed = [{
    stage: 'requirement',
    roles: [{
      role: 'scope_risk',
      status: 'runtime_failed',
      effective_status: 'runtime_failed',
      recorded_at: '2026-08-22T00:00:00Z',
      findings: [],
      runtime_failure: { kind: 'timeout', detail: 'reviewer timeout' }
    }]
  }];
  const passed = [{
    stage: 'requirement',
    roles: [{
      role: 'scope_risk',
      status: 'pass',
      effective_status: 'pass',
      recorded_at: '2026-08-22T01:00:00Z',
      findings: [],
      inspection: { summary: 'reviewed', evidence: 'result', inputs: ['docs/specs/story-x.md'] },
      judgment_delta: ['runtime failed -> review completed']
    }]
  }];
  const first = advanceReviewConvergenceState(null, buildReviewConvergenceSnapshot({ headSha: 'head-1', stageSummaries: failed }));
  const second = advanceReviewConvergenceState(first, buildReviewConvergenceSnapshot({ headSha: 'head-1', stageSummaries: passed }));
  assert.equal(second.status, 'converged');
  assert.equal(second.no_progress_count, 0);
  assert.equal(second.snapshot.runtime_failures.length, 0);
});

test('polling the same event cursor does not count as another review wave', () => {
  const snapshot = buildReviewConvergenceSnapshot({
    headSha: 'head-1',
    stageSummaries: stageSummary({ recordedAt: '2026-08-22T00:00:00Z' })
  });
  const first = advanceReviewConvergenceState(null, snapshot);
  const second = advanceReviewConvergenceState(first, snapshot);
  assert.equal(second, first);
});

test('convergence state is persisted append-only by review event', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-review-convergence-'));
  const snapshot = buildReviewConvergenceSnapshot({
    headSha: 'head-1',
    stageSummaries: [{
      stage: 'gate',
      roles: [{
        role: 'release_risk',
        status: 'runtime_failed',
        effective_status: 'runtime_failed',
        recorded_at: '2026-08-22T00:00:00Z',
        findings: [],
        runtime_failure: { kind: 'timeout' }
      }]
    }]
  });
  const state = await updateReviewConvergenceState(root, snapshot);
  assert.equal(state.snapshot.runtime_failures[0].kind, 'timeout');
  const current = JSON.parse(await readFile(path.join(root, 'convergence', 'current.json'), 'utf8'));
  assert.equal(current.snapshot.progress_signature, state.snapshot.progress_signature);
});

function stageSummary({
  recordedAt,
  findingId = 'same-finding',
  detail = 'same unresolved defect',
  inspectionEvidence = 'same-evidence'
}) {
  return [{
    stage: 'requirement',
    roles: [{
      role: 'scope_risk',
      status: 'needs_changes',
      effective_status: 'needs_changes',
      binding_status: 'current',
      recorded_at: recordedAt,
      summary: 'same review conclusion',
      findings: [{ id: findingId, severity: 'high', detail }],
      inspection: {
        summary: 'inspected requirement and implementation',
        evidence: inspectionEvidence,
        inputs: ['docs/specs/story-x.md', 'src/runtime.js']
      },
      judgment_delta: ['initial assumption -> unresolved defect'],
      causal_review: {
        dependency_domains: ['story', 'spec', 'architecture', 'implementation', 'config'],
        invalidation_surface: [{ path: 'docs/specs/story-x.md', domain: 'spec', classified: true }],
        classification_status: 'classified'
      },
      delta_closure: { mode: 'full_review', unresolved_finding_ids: [findingId] }
    }]
  }];
}
