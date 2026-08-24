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
    const result = evaluateReviewCausalInvalidation({ stage: 'planning_spec', role, changedFiles });
    assert.equal(result.reusable, true, `${role} should survive a release/test-only delta`);
    assert.equal(result.relevant_changed_files.length, 0);
  }
  const runtime = evaluateReviewCausalInvalidation({
    stage: 'implementation',
    role: 'runtime_contract',
    changedFiles
  });
  assert.equal(runtime.reusable, false);
  assert.deepEqual(runtime.relevant_changed_files.map((item) => item.domain), ['release', 'test']);
  const gate = evaluateReviewCausalInvalidation({
    stage: 'gate',
    role: 'release_risk',
    changedFiles
  });
  assert.equal(gate.reusable, false);
});

test('path classifier keeps semantic, implementation, test and release surfaces distinct', () => {
  assert.equal(classifyReviewPath('docs/management/stories/active/story-x.md').domain, 'story');
  assert.equal(classifyReviewPath('.vibepro/spec/story-x/spec.json').domain, 'spec');
  assert.equal(classifyReviewPath('docs/architecture/x.md').domain, 'architecture');
  assert.equal(classifyReviewPath('src/runtime.js').domain, 'implementation');
  assert.equal(classifyReviewPath('test/runtime.test.js').domain, 'test');
  assert.equal(classifyReviewPath('.husky/pre-push').domain, 'release');
});

test('causal surface separates inspected files from decision dependencies and carries prior dependencies into delta closure', () => {
  const first = deriveReviewCausalSurface({
    stage: 'planning_spec',
    role: 'product_requirement',
    inspectionInputs: [
      'docs/management/stories/active/story-x.md',
      '.vibepro/spec/story-x/spec.json',
      'src/runtime.js',
      'test/runtime.test.js'
    ]
  });
  assert.deepEqual(first.inspection_surface.map((item) => item.domain).sort(), ['spec', 'story', 'implementation', 'test'].sort());
  assert.deepEqual(first.decision_dependencies.map((item) => item.domain).sort(), ['spec', 'story']);

  const delta = deriveReviewCausalSurface({
    stage: 'planning_spec',
    role: 'product_requirement',
    inspectionInputs: ['src/runtime.js'],
    previousCausalReview: first
  });
  assert.deepEqual(delta.decision_dependencies.map((item) => item.path), first.decision_dependencies.map((item) => item.path));
});

test('strict-head certification never reuses a changed candidate', () => {
  const result = evaluateReviewCausalInvalidation({
    stage: 'gate',
    role: 'release_risk',
    strictHead: true,
    changedFiles: ['README.md']
  });
  assert.equal(result.reusable, false);
  assert.match(result.reason, /strict HEAD/);
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

test('three unchanged semantic review waves stop as nonconvergent even when HEAD churns', () => {
  const stage = (recordedAt) => [{
    stage: 'requirement',
    roles: [{
      role: 'scope_risk',
      effective_status: 'stale',
      binding_status: 'stale',
      recorded_at: recordedAt,
      findings: [{ id: 'same-finding' }]
    }]
  }];
  let state = advanceReviewConvergenceState(null, buildReviewConvergenceSnapshot({ headSha: 'head-1', stageSummaries: stage('2026-08-22T00:00:00Z') }));
  assert.equal(state.status, 'converging');
  state = advanceReviewConvergenceState(state, buildReviewConvergenceSnapshot({ headSha: 'head-2', stageSummaries: stage('2026-08-22T01:00:00Z') }));
  assert.equal(state.status, 'converging');
  state = advanceReviewConvergenceState(state, buildReviewConvergenceSnapshot({ headSha: 'head-3', stageSummaries: stage('2026-08-22T02:00:00Z') }));
  assert.equal(state.status, 'review_nonconvergent');
  assert.equal(state.repeat_count, 3);
  assert.equal(state.head_churn_count, 2);
});

test('polling the same event cursor does not count as another review wave', () => {
  const snapshot = buildReviewConvergenceSnapshot({
    headSha: 'head-1',
    stageSummaries: [{ stage: 'gate', roles: [{ role: 'release_risk', effective_status: 'missing', recorded_at: null, findings: [] }] }]
  });
  const first = advanceReviewConvergenceState(null, snapshot);
  const second = advanceReviewConvergenceState(first, snapshot);
  assert.equal(second, first);
  assert.equal(second.repeat_count, 1);
});

test('convergence state is persisted append-only by review event', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-review-convergence-'));
  const snapshot = buildReviewConvergenceSnapshot({
    headSha: 'head-1',
    stageSummaries: [{ stage: 'gate', roles: [{ role: 'release_risk', effective_status: 'runtime_failed', recorded_at: '2026-08-22T00:00:00Z', findings: [], runtime_failure: { kind: 'timeout' } }] }]
  });
  const state = await updateReviewConvergenceState(root, snapshot);
  assert.equal(state.snapshot.runtime_failures[0].kind, 'timeout');
  const current = JSON.parse(await readFile(path.join(root, 'convergence', 'current.json'), 'utf8'));
  assert.equal(current.snapshot.semantic_signature, state.snapshot.semantic_signature);
});
