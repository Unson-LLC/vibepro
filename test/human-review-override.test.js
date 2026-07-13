import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertHumanReviewOverride, evaluateHumanReviewOverride } from '../src/human-review-override.js';
import { buildHumanReviewOverrideGate, buildPrPrepareGateStatus } from '../src/pr-manager.js';
import { resolveCurrentHumanReviewRecommendation } from '../src/merge-manager.js';

async function makeReview(recommendation, decisions = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-review-override-'));
  const storyId = 'story-human-review-override';
  const prDir = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(prDir, 'human-review.json'), JSON.stringify({ recommended_decision: recommendation }));
  await writeFile(path.join(prDir, 'decision-records.json'), JSON.stringify({ decisions }));
  return { root, storyId };
}

test('HRO-S1 proceed recommendation does not require an override', async () => {
  const { root, storyId } = await makeReview('proceed');
  assert.deepEqual(await evaluateHumanReviewOverride(root, storyId, 'head-1'), {
    required: false,
    recommendation: 'proceed',
    decision: null
  });
});

test('HRO-S2 split_pr blocks PR creation without reason and reviewer', async () => {
  const { root, storyId } = await makeReview('split_pr', [{
    status: 'accepted',
    source: 'human-review:split_pr',
    reason: 'The split is unnecessary.',
    reviewer: null,
    git_context: { head_sha: 'head-1' }
  }]);
  await assert.rejects(
    assertHumanReviewOverride(root, storyId, 'head-1', 'PR creation'),
    /split_pr override required before PR creation.*--reviewer/
  );
});

test('HRO-S3 block override requires a current-HEAD accepted decision', async () => {
  const { root, storyId } = await makeReview('block', [{
    status: 'accepted',
    source: 'human-review:block',
    reason: 'The risk is independently controlled.',
    reviewer: 'Senior Reviewer',
    git_context: { head_sha: 'old-head' }
  }]);
  await assert.rejects(assertHumanReviewOverride(root, storyId, 'head-1', 'merge'), /block override required before merge/);
  await assert.rejects(assertHumanReviewOverride(root, storyId, '', 'merge'), /block override required before merge/);
});

test('HRO-S4 the same explicit override authorizes PR creation and merge checks', async () => {
  const decision = {
    decision_id: 'decision-hro-1',
    story_id: 'story-human-review-override',
    type: 'waiver',
    status: 'accepted',
    source: 'human-review:split_pr',
    reason: 'The changed files form one atomic compatibility boundary.',
    reviewer: 'Senior Reviewer',
    git_context: { head_sha: 'head-1' }
  };
  const { root, storyId } = await makeReview('split_pr', [decision]);
  assert.deepEqual((await assertHumanReviewOverride(root, storyId, 'head-1', 'PR creation')).decision, decision);
  assert.deepEqual((await assertHumanReviewOverride(root, storyId, 'head-1', 'merge')).decision, decision);
});

test('HRO-S5 missing human review artifact fails closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-review-override-'));
  await assert.rejects(
    assertHumanReviewOverride(root, 'story-human-review-override', 'head-1', 'merge'),
    /missing_human_review override required/
  );
});

test('HRO-S6 only a waiver for the selected story can override review', async () => {
  const base = {
    status: 'accepted', source: 'human-review:block', reason: 'reason', reviewer: 'reviewer',
    git_context: { head_sha: 'head-1' }
  };
  const { root, storyId } = await makeReview('block', [
    { ...base, type: 'noise', story_id: 'story-human-review-override' },
    { ...base, type: 'waiver', story_id: 'another-story' }
  ]);
  await assert.rejects(assertHumanReviewOverride(root, storyId, 'head-1', 'merge'), /block override required/);
});

test('HRO-S7 prepare gate exposes an unresolved split recommendation', async () => {
  const gate = buildHumanReviewOverrideGate({
    required: true,
    recommendation: 'split_pr',
    expected_source: 'human-review:split_pr',
    decision: null
  }, 'story-human-review-override');
  assert.equal(gate.id, 'gate:human_review_override');
  assert.equal(gate.status, 'needs_review');
  assert.equal(gate.required, true);
  assert.match(gate.reason, /before PR creation or merge/);
});

test('HRO-S8 prepare gate is satisfied only by the evaluated current-HEAD waiver', async () => {
  const gate = buildHumanReviewOverrideGate({
    required: true,
    recommendation: 'block',
    expected_source: 'human-review:block',
    decision: { reviewer: 'Senior Reviewer' }
  }, 'story-human-review-override');
  assert.equal(gate.status, 'satisfied');
  assert.match(gate.reason, /Senior Reviewer/);
});

test('HRO-S9 unresolved override gate blocks PR readiness', () => {
  const gate = buildHumanReviewOverrideGate({
    required: true,
    recommendation: 'split_pr',
    expected_source: 'human-review:split_pr',
    decision: null
  }, 'story-human-review-override');
  const status = buildPrPrepareGateStatus({ overall_status: 'ready_for_review', nodes: [gate] });
  assert.equal(status.ready_for_pr_create, false);
  assert.equal(status.unresolved_gates.some((item) => item.id === gate.id), true);
});

test('HRO-S10 merge fails closed when the PR lifecycle artifact is missing or stale', () => {
  assert.equal(resolveCurrentHumanReviewRecommendation({
    currentHeadSha: 'head-1',
    prCreate: null,
    prPrepare: { split_plan: { status: 'clean' } },
    gateDag: { overall_status: 'ready_for_review' },
    humanReview: { recommended_decision: 'proceed' }
  }), 'block');
  assert.equal(resolveCurrentHumanReviewRecommendation({
    currentHeadSha: 'head-1',
    prCreate: { artifact_freshness: { status: 'current', artifact_head_sha: 'old-head' } },
    prPrepare: { split_plan: { status: 'clean' } },
    gateDag: { overall_status: 'ready_for_review' },
    humanReview: { recommended_decision: 'proceed' }
  }), 'block');
});

test('HRO-S11 merge preserves human review block and split recommendations', () => {
  const prCreate = { artifact_freshness: { status: 'current', artifact_head_sha: 'head-1' } };
  for (const recommendation of ['split_pr', 'block']) {
    assert.equal(resolveCurrentHumanReviewRecommendation({
      currentHeadSha: 'head-1', prCreate, prPrepare: {}, gateDag: {}, humanReview: {
        recommended_decision: recommendation
      }
    }), recommendation);
  }
});

test('HRO-S12 merge derives split and gate readiness only for a current PR lifecycle', () => {
  const prCreate = { artifact_freshness: { status: 'current', artifact_head_sha: 'head-1' } };
  assert.equal(resolveCurrentHumanReviewRecommendation({
    currentHeadSha: 'head-1',
    prCreate,
    prPrepare: { split_plan: { status: 'split_recommended' } },
    gateDag: { overall_status: 'ready_for_review' },
    humanReview: null
  }), 'split_pr');
  assert.equal(resolveCurrentHumanReviewRecommendation({
    currentHeadSha: 'head-1',
    prCreate,
    prPrepare: { split_plan: { status: 'clean' } },
    gateDag: { overall_status: 'ready_for_review' },
    humanReview: null
  }), 'proceed');
  assert.equal(resolveCurrentHumanReviewRecommendation({
    currentHeadSha: 'head-1',
    prCreate,
    prPrepare: { split_plan: { status: 'clean' } },
    gateDag: { overall_status: 'needs_verification' },
    humanReview: null
  }), 'block');
});
