import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const architecturePath = 'docs/architecture/vibepro-autonomy-roadmap-rebaseline.md';
const storyPath = 'docs/management/stories/active/story-vibepro-autonomy-roadmap-rebaseline.md';
const specPath = 'docs/specs/story-vibepro-autonomy-roadmap-rebaseline.md';

test('autonomy roadmap rebaseline preserves the existing public contract', async () => {
  const [architecture, story, spec] = await Promise.all([
    readFile(architecturePath, 'utf8'),
    readFile(storyPath, 'utf8'),
    readFile(specPath, 'utf8')
  ]);

  assert.match(architecture, /文書とStory登録だけでruntimeを変更しない/);
  assert.match(architecture, /既存のbudget・cost accounting・review provenance・evidence freshnessは再実装せず/);
  assert.match(story, /完了済みのGuarded Run Session Contract、Run Context Capsule、Safe Action Orchestrator、Next Best Action Controller/);
  assert.match(story, /残りの実装順を `5 → 6 → 7 → 8 → 9 → 10` に固定/);
  assert.equal((story.match(/- \[x\] RBL-S-/g) ?? []).length, 6);
  assert.match(spec, /完了済み4件と未完6件/);
  assert.doesNotMatch(spec, /完了済み2件と未完8件/);
});
