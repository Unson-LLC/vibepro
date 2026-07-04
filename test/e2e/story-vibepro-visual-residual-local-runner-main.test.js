import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const STORY_ID = 'story-vibepro-visual-residual-local-runner';

test('story-vibepro-visual-residual-local-runner acceptance route is executable', async () => {
  const [story, spec, visualVerifier, prManager, cliTest, cli] = await Promise.all([
    readFile(new URL('../../docs/management/stories/active/story-vibepro-visual-residual-local-runner.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/specs/story-vibepro-visual-residual-local-runner.md', import.meta.url), 'utf8'),
    readFile(new URL('../../src/visual-verifier.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pr-manager.js', import.meta.url), 'utf8'),
    readFile(new URL('../../test/vibepro-cli.test.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/cli.js', import.meta.url), 'utf8')
  ]);

  assert.match(story, /VRL-S-1/, `${STORY_ID} ac:1 within-threshold acceptance exists`);
  assert.match(visualVerifier, /meanAbsResidualPct <= thresholdPct/, `${STORY_ID} ac:1 threshold pass is computed locally`);
  assert.match(cliTest, /verify visual writes residual artifacts accepted by Visual QA Gate/, `${STORY_ID} ac:1 residual artifact regression exists`);

  assert.match(story, /VRL-S-2/, `${STORY_ID} ac:2 threshold exceedance acceptance exists`);
  assert.match(visualVerifier, /needs_review/, `${STORY_ID} ac:2 threshold exceedance maps to needs_review`);
  assert.match(prManager, /Visual QA evidence is within/, `${STORY_ID} ac:2 visual gate reason consumes residual evidence`);

  assert.match(story, /VRL-S-3/, `${STORY_ID} ac:3 missing baseline acceptance exists`);
  assert.match(visualVerifier, /baseline_missing/, `${STORY_ID} ac:3 baseline_missing is surfaced`);
  assert.match(cliTest, /verify visual reports baseline_missing and does not pass the Visual QA Gate/, `${STORY_ID} ac:3 baseline_missing regression exists`);

  assert.match(story, /VRL-S-4/, `${STORY_ID} ac:4 baseline update acceptance exists`);
  assert.match(visualVerifier, /updateBaseline/, `${STORY_ID} ac:4 explicit baseline update path exists`);
  assert.match(visualVerifier, /baselinePath/, `${STORY_ID} ac:4 baseline artifacts are stored per probe`);

  assert.match(story, /VRL-S-5/, `${STORY_ID} ac:5 schema parity acceptance exists`);
  assert.match(visualVerifier, /artifact_kind: 'visual_residual'/, `${STORY_ID} ac:5 visual residual schema is emitted`);
  assert.match(prManager, /residual.*\\.json/i, `${STORY_ID} ac:5 existing gate reads residual JSON`);

  assert.match(story, /VRL-S-6/, `${STORY_ID} ac:6 branch coverage acceptance exists`);
  assert.match(cli, /verify visual/, `${STORY_ID} ac:6 CLI exposes verify visual`);
  assert.match(cliTest, /baseline_missing/, `${STORY_ID} ac:6 missing baseline branch regression is executable`);
});
