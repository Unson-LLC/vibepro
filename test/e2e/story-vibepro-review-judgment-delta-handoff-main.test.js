import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('story-vibepro-review-judgment-delta-handoff acceptance evidence is implemented and tested', async () => {
  const [story, spec, architecture, agentReviewSource, reviewTests] = await Promise.all([
    readFile(new URL('../../docs/management/stories/active/story-vibepro-review-judgment-delta-handoff.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/specs/vibepro-review-judgment-delta-handoff.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/architecture/vibepro-review-judgment-delta-handoff.md', import.meta.url), 'utf8'),
    readFile(new URL('../../src/agent-review.js', import.meta.url), 'utf8'),
    readFile(new URL('../review-inspection-first.test.js', import.meta.url), 'utf8')
  ]);

  assert.match(story, /story-vibepro-review-judgment-delta-handoff/);
  assert.match(story, /--inspection-input/);
  assert.match(story, /--judgment-delta/);
  assert.match(spec, /inspection\.inputs\[\]/);
  assert.match(spec, /judgment_delta\[\]/);
  assert.match(spec, /flowchart TD/);
  assert.match(architecture, /handoff artifact/);
  assert.match(agentReviewSource, /inspection_inputs/);
  assert.match(agentReviewSource, /judgment_delta/);
  assert.match(agentReviewSource, /formatReviewHandoffSuffix/);
  assert.match(reviewTests, /recordAgentReview persists inspection inputs and judgment delta for handoff/);
});
