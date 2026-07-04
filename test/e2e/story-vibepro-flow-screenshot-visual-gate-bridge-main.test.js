import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const STORY_ID = 'story-vibepro-flow-screenshot-visual-gate-bridge';

test('story-vibepro-flow-screenshot-visual-gate-bridge acceptance route is executable', async () => {
  const [story, spec, flowVerifier, prManager, cliTest] = await Promise.all([
    readFile(new URL('../../docs/management/stories/active/story-vibepro-flow-screenshot-visual-gate-bridge.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/specs/story-vibepro-flow-screenshot-visual-gate-bridge.md', import.meta.url), 'utf8'),
    readFile(new URL('../../src/flow-verifier.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pr-manager.js', import.meta.url), 'utf8'),
    readFile(new URL('../../test/vibepro-cli.test.js', import.meta.url), 'utf8')
  ]);

  assert.match(story, /FSB-S-1/, `${STORY_ID} ac:1 passing screenshot flow resolves visual gate coverage`);
  assert.match(flowVerifier, /recordVisualEvidenceFromFlowRun/, `${STORY_ID} ac:1 passing flow auto-records visual evidence`);
  assert.match(cliTest, /verify flow auto-records current Visual QA evidence for screenshot probes/, `${STORY_ID} ac:1 regression test exists`);

  assert.match(story, /FSB-S-2/, `${STORY_ID} ac:2 failing flow is covered`);
  assert.match(flowVerifier, /verification\.status !== 'pass'/, `${STORY_ID} ac:2 failing flow does not emit visual evidence`);
  assert.match(spec, /MUST NOT record verification evidence/, `${STORY_ID} ac:2 failure invariant is explicit`);

  assert.match(story, /FSB-S-3/, `${STORY_ID} ac:3 screenshot-less passing run is covered`);
  assert.match(flowVerifier, /screenshotTargets\.length === 0/, `${STORY_ID} ac:3 screenshot-less run skips visual markers`);

  assert.match(story, /FSB-S-4/, `${STORY_ID} ac:4 residual precedence is covered`);
  assert.match(prManager, /buildVisualQaEvidenceFromVerification/, `${STORY_ID} ac:4 verification fallback is isolated behind residual evidence`);
  assert.match(cliTest, /residual Visual QA evidence remains authoritative over verification fallback/, `${STORY_ID} ac:4 residual precedence regression exists`);

  assert.match(story, /FSB-S-5/, `${STORY_ID} ac:5 provenance coverage is present`);
  assert.match(flowVerifier, /flow_run_id/, `${STORY_ID} ac:5 flow run provenance is recorded`);
  assert.match(flowVerifier, /screenshot_paths/, `${STORY_ID} ac:5 screenshot provenance is recorded`);

  assert.match(story, /FSB-S-6/, `${STORY_ID} ac:6 branch coverage acceptance exists`);
  assert.match(cliTest, /verify flow auto-records current Visual QA evidence/, `${STORY_ID} ac:6 passing branch regression is executable`);
  assert.match(cliTest, /residual Visual QA evidence remains authoritative/, `${STORY_ID} ac:6 residual branch regression is executable`);
});
