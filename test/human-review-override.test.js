import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertHumanReviewOverride, evaluateHumanReviewOverride } from '../src/human-review-override.js';

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
});

test('HRO-S4 the same explicit override authorizes PR creation and merge checks', async () => {
  const decision = {
    decision_id: 'decision-hro-1',
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
