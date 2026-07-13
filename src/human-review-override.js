import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir } from './workspace.js';

const OVERRIDE_RECOMMENDATIONS = new Set(['split_pr', 'block']);

export async function evaluateHumanReviewOverride(repoRoot, storyId, currentHeadSha, expectedRecommendation = null) {
  const prDir = path.join(getWorkspaceDir(path.resolve(repoRoot)), 'pr', storyId);
  const [humanReview, decisionRecords] = await Promise.all([
    readJsonIfExists(path.join(prDir, 'human-review.json')),
    readJsonIfExists(path.join(prDir, 'decision-records.json'))
  ]);
  const recommendation = expectedRecommendation ?? humanReview?.recommended_decision ?? null;
  if (!humanReview && expectedRecommendation === null) {
    return {
      required: true,
      recommendation: 'missing_human_review',
      expected_source: 'human-review:<recommendation>',
      decision: null
    };
  }
  if (!OVERRIDE_RECOMMENDATIONS.has(recommendation)) {
    return { required: false, recommendation, decision: null };
  }

  if (!currentHeadSha) {
    return {
      required: true,
      recommendation,
      expected_source: `human-review:${recommendation}`,
      decision: null
    };
  }

  const expectedSource = `human-review:${recommendation}`;
  const decision = (decisionRecords?.decisions ?? []).find((item) => (
    item?.status === 'accepted'
    && item?.type === 'waiver'
    && item?.story_id === storyId
    && item?.source === expectedSource
    && item?.reason?.trim()
    && item?.reviewer?.trim()
    && item?.git_context?.head_sha === currentHeadSha
  )) ?? null;
  return {
    required: true,
    recommendation,
    expected_source: expectedSource,
    decision
  };
}

export async function assertHumanReviewOverride(repoRoot, storyId, currentHeadSha, operation, expectedRecommendation = null) {
  const result = await evaluateHumanReviewOverride(repoRoot, storyId, currentHeadSha, expectedRecommendation);
  if (result.required && !result.decision) {
    throw new Error(
      `Human review ${result.recommendation} override required before ${operation}: ` +
      `record a current-HEAD accepted decision with --source ${result.expected_source}, ` +
      '`--reason <why proceeding is safe>`, and `--reviewer <reviewer identity>`.'
    );
  }
  return result;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
