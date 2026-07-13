import assert from 'node:assert/strict';
import test from 'node:test';

import { assertHumanReviewOverride } from '../../src/human-review-override.js';
import { buildHumanReviewOverrideGate, buildPrPrepareGateStatus } from '../../src/pr-manager.js';
import { resolveCurrentHumanReviewRecommendation } from '../../src/merge-manager.js';

const storyId = 'story-vibepro-human-review-override';

test('story-vibepro-human-review-override HRO-S2 ac:1 ac:3 PR readiness exposes a current-HEAD override block', () => {
  const gate = buildHumanReviewOverrideGate({
    required: true,
    recommendation: 'split_pr',
    expected_source: 'human-review:split_pr',
    decision: null
  }, storyId);
  const readiness = buildPrPrepareGateStatus({ overall_status: 'ready_for_review', nodes: [gate] });
  assert.equal(readiness.ready_for_pr_create, false);
  assert.match(gate.reason, /before PR creation or merge/);
});

test('story-vibepro-human-review-override HRO-S3 ac:2 merge re-evaluates stale lifecycle and blocks visibly', async () => {
  const recommendation = resolveCurrentHumanReviewRecommendation({
    currentHeadSha: 'head-2',
    prCreate: { artifact_freshness: { status: 'current', artifact_head_sha: 'head-1' } },
    prPrepare: { split_plan: { status: 'clean' } },
    gateDag: { overall_status: 'ready_for_review' },
    humanReview: { recommended_decision: 'proceed' }
  });
  assert.equal(recommendation, 'block');
  await assert.rejects(
    assertHumanReviewOverride('/missing-repo', storyId, 'head-2', 'merge', recommendation),
    /block override required before merge/
  );
});

test('story-vibepro-human-review-override HRO-S1 ac:4 proceed preserves the existing route for a current lifecycle', () => {
  assert.equal(resolveCurrentHumanReviewRecommendation({
    currentHeadSha: 'head-1',
    prCreate: { artifact_freshness: { status: 'current', artifact_head_sha: 'head-1' } },
    prPrepare: { split_plan: { status: 'clean' } },
    gateDag: { overall_status: 'ready_for_review' },
    humanReview: { recommended_decision: 'proceed' }
  }), 'proceed');
});
