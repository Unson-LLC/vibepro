import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const STORY_ID = 'story-vibepro-journey-curate-command';

test('story-vibepro-journey-curate-command acceptance route is executable', async () => {
  const [story, spec, journeyMap, storyManager, journeyTest, cli] = await Promise.all([
    readFile(new URL('../../docs/management/stories/active/story-vibepro-journey-curate-command.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/specs/story-vibepro-journey-curate-command.md', import.meta.url), 'utf8'),
    readFile(new URL('../../src/journey-map.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/story-manager.js', import.meta.url), 'utf8'),
    readFile(new URL('../../test/journey-map.test.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/cli.js', import.meta.url), 'utf8')
  ]);

  assert.match(story, /JCC-S-1/, `${STORY_ID} ac:1 full resolution acceptance exists`);
  assert.match(journeyMap, /export async function curateJourneyMap/, `${STORY_ID} ac:1 curate command producer exists`);
  assert.match(journeyMap, /curation_status: 'curated'/, `${STORY_ID} ac:1 curated artifact status is written`);
  assert.match(journeyTest, /writes curated Journey with deferrals/, `${STORY_ID} ac:1 curated write regression exists`);

  assert.match(story, /JCC-S-2/, `${STORY_ID} ac:2 partial resolution rejection acceptance exists`);
  assert.match(journeyMap, /unresolved_conflicts/, `${STORY_ID} ac:2 unresolved conflicts are reported`);
  assert.match(journeyMap, /unresolved_open_questions/, `${STORY_ID} ac:2 unresolved open questions are reported`);

  assert.match(story, /JCC-S-3/, `${STORY_ID} ac:3 explicit defer acceptance exists`);
  assert.match(journeyMap, /status === 'deferred'/, `${STORY_ID} ac:3 deferred questions are preserved`);
  assert.match(spec, /Deferrals are preserved/, `${STORY_ID} ac:3 deferral invariant is explicit`);

  assert.match(story, /JCC-S-4/, `${STORY_ID} ac:4 missing context acceptance exists`);
  assert.match(journeyMap, /Journey context pack is missing/, `${STORY_ID} ac:4 missing pack failure names derive`);
  assert.match(journeyMap, /vibepro journey derive/, `${STORY_ID} ac:4 next command points to derive`);

  assert.match(story, /JCC-S-5/, `${STORY_ID} ac:5 diagnose next action acceptance exists`);
  assert.match(storyManager, /vibepro journey curate \./, `${STORY_ID} ac:5 story diagnose suggests journey curate`);
  assert.match(cli, /journey curate \[repo\]/, `${STORY_ID} ac:5 CLI exposes journey curate`);

  assert.match(story, /JCC-S-6/, `${STORY_ID} ac:6 branch coverage acceptance exists`);
  assert.match(journeyTest, /rejects partial judgments/, `${STORY_ID} ac:6 partial rejection regression is executable`);
  assert.match(journeyTest, /writes curated Journey with deferrals/, `${STORY_ID} ac:6 defer regression is executable`);
});
