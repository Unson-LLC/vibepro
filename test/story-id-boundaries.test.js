import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveArtifactRoute } from '../src/artifact-routing.js';
import { buildManagedWorktreeGate } from '../src/managed-worktree-gate.js';
import { readManagedExecutionState } from '../src/managed-worktree.js';
import { isSafeStoryId, isSafeStoryPathSegment } from '../src/story-id.js';

const ROOT = process.cwd();
const UNSAFE_IDS = [
  '../story-escape',
  'story-a/../../escape',
  'story-a%2fescape',
  'story-a%5cescape',
  'story-a..escape'
];

test('GDL-S-9 shared Story ID validator rejects traversal and encoded separators', () => {
  assert.equal(isSafeStoryId('story-vibepro-gate-decision-outcome-ledger'), true);
  assert.equal(isSafeStoryPathSegment('story-VibePro-Example'), true);
  for (const storyId of UNSAFE_IDS) assert.equal(isSafeStoryId(storyId), false, storyId);
});

test('GDL-S-9 managed execution rejects unsafe Story IDs before state lookup', async () => {
  for (const storyId of UNSAFE_IDS) {
    await assert.rejects(
      () => readManagedExecutionState(ROOT, storyId),
      (error) => error.code === 'story_id_invalid'
    );
    await assert.rejects(
      () => buildManagedWorktreeGate(ROOT, { storyId }),
      (error) => error.code === 'story_id_invalid'
    );
  }
});

test('GDL-S-9 review artifact routing rejects unsafe Story IDs instead of slugifying', async () => {
  for (const storyId of UNSAFE_IDS) {
    await assert.rejects(
      () => resolveArtifactRoute(ROOT, 'review', { storyId }),
      (error) => error.code === 'invalid_story_id'
    );
  }
});
