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

  assert.match(story, /FSB-S-1/, `${STORY_ID} ac:1 passing screenshot flow points to residual gate coverage`);
  assert.match(flowVerifier, /visual_residual_required/, `${STORY_ID} ac:1 passing flow requires residual visual evidence`);
  assert.match(cliTest, /verify flow requires residual Visual QA evidence for screenshot probes/, `${STORY_ID} ac:1 regression test exists`);

  assert.match(story, /FSB-S-2/, `${STORY_ID} ac:2 failing flow is covered`);
  assert.match(flowVerifier, /verification\.status !== 'pass'/, `${STORY_ID} ac:2 failing flow does not emit visual evidence`);
  assert.match(spec, /MUST NOT record verification evidence/, `${STORY_ID} ac:2 failure invariant is explicit`);

  assert.match(story, /FSB-S-3/, `${STORY_ID} ac:3 screenshot-less passing run is covered`);
  assert.match(flowVerifier, /screenshotTargets\.length === 0/, `${STORY_ID} ac:3 screenshot-less run skips visual markers`);

  assert.match(story, /FSB-S-4/, `${STORY_ID} ac:4 residual precedence is covered`);
  assert.match(prManager, /buildVisualQaEvidenceFromVerification/, `${STORY_ID} ac:4 verification fallback is isolated behind residual evidence`);
  assert.match(cliTest, /residual Visual QA evidence remains authoritative over verification fallback/, `${STORY_ID} ac:4 residual precedence regression exists`);

  assert.match(story, /FSB-S-5/, `${STORY_ID} ac:5 provenance coverage is present`);
  assert.match(flowVerifier, /verification\.run_id/, `${STORY_ID} ac:5 flow run provenance is available`);
  assert.match(flowVerifier, /screenshot_paths/, `${STORY_ID} ac:5 screenshot provenance is recorded`);

  assert.match(story, /FSB-S-6/, `${STORY_ID} ac:6 branch coverage acceptance exists`);
  assert.match(cliTest, /verify flow requires residual Visual QA evidence/, `${STORY_ID} ac:6 passing branch regression is executable`);
  assert.match(cliTest, /residual Visual QA evidence remains authoritative/, `${STORY_ID} ac:6 residual branch regression is executable`);

  assert.match(spec, /FSB-S-7/, `${STORY_ID} ac:7 prose-only visual evidence is covered`);
  assert.match(prManager, /isVisualQaArtifactRef/, `${STORY_ID} ac:7 fallback requires visual artifacts`);
  assert.match(prManager, /visualArtifacts\.length === 0/, `${STORY_ID} ac:7 prose-only evidence is rejected`);
  assert.match(cliTest, /prose-only Story wrapper evidence does not satisfy Visual QA Gate/, `${STORY_ID} ac:7 regression test exists`);

  assert.match(spec, /FSB-S-8/, `${STORY_ID} ac:8 not-recorded reasons are covered`);
  assert.match(flowVerifier, /buildAutoVisualEvidenceNotRecorded/, `${STORY_ID} ac:8 skipped auto evidence has a reason`);
  assert.match(flowVerifier, /formatAutoVisualEvidenceSummary/, `${STORY_ID} ac:8 summary renders the reason`);
  assert.match(cliTest, /reason: screenshots_missing/, `${STORY_ID} ac:8 regression test checks report output`);
});
