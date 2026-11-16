import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getReviewStatus, prepareReview, recordReview } from '../src/lightweight-review.js';

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-light-review-'));
  await mkdir(path.join(root, '.vibepro'));
  await writeFile(path.join(root, '.vibepro/config.json'), '{}');
  await writeFile(path.join(root, 'index.js'), 'export const value = 1;\n');
  return root;
}
const storyId = 'story-review';

test('review records reviewer attribution and reads the persisted verdict', async () => {
  const root = await setup();
  const result = await recordReview(root, { storyId, status: 'pass', stdinText: '内容を確認済み', inspectionInputs: ['index.js'], agentSystem: 'codex', agentId: 'reviewer-1' });
  const record = JSON.parse(await readFile(result.artifact, 'utf8'));
  assert.deepEqual(record.reviewer, { system: 'codex', id: 'reviewer-1' });
  assert.equal((await getReviewStatus(root, { storyId })).complete, true);
});

test('review rejects traversal identifiers and pass without readable inspection evidence', async () => {
  const root = await setup();
  await assert.rejects(prepareReview(root, { storyId: '../escape' }));
  await assert.rejects(recordReview(root, { storyId, role: '../../escape', status: 'block', summary: '問題' }));
  for (const inspectionInputs of [[], ['missing.js'], ['.vibepro/config.json']]) {
    await assert.rejects(recordReview(root, { storyId, status: 'pass', summary: '確認', inspectionInputs }), /existing inspection inputs/);
  }
});

test('corrupt review is not reported as missing or passing', async () => {
  const root = await setup();
  const result = await recordReview(root, { storyId, status: 'block', summary: '入力で例外' });
  await writeFile(result.artifact, '{');
  await assert.rejects(getReviewStatus(root, { storyId }));
});
