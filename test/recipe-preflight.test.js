import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RECIPE_REGISTRY,
  runRecipePreflight,
  extractSpecDocDiagramKinds
} from '../src/recipe-preflight.js';

async function makeRepo({ config } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-preflight-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', runs: [], latest_run_by_story: {} }, null, 2)
  );
  await writeFile(
    path.join(root, '.vibepro', 'config.json'),
    `${JSON.stringify(config ?? {
      schema_version: '0.1.0',
      tool: 'vibepro',
      workspace: '.vibepro',
      brainbase: { stories: [] }
    }, null, 2)}\n`
  );
  return root;
}

async function writeEvidence(root, storyId, commands) {
  const dir = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'verification-evidence.json'),
    JSON.stringify({ schema_version: '0.1.0', story_id: storyId, warnings: [], commands }, null, 2)
  );
}

async function writeStoryDoc(root, storyId, frontmatter, body = '# Story\n') {
  const dir = path.join(root, 'docs', 'management', 'stories', 'active');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${storyId}.md`), `---\n${frontmatter}\n---\n\n${body}`);
}

async function writeSpecDoc(root, storyId, frontmatter, body = '# Spec\n') {
  const dir = path.join(root, 'docs', 'specs');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${storyId}.md`), `---\n${frontmatter}\n---\n\n${body}`);
}

async function writeFinalSpec(root, storyId, spec) {
  const dir = path.join(root, '.vibepro', 'spec', storyId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
}

async function writeDecisionRecords(root, storyId, decisions) {
  const dir = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'decision-records.json'),
    JSON.stringify({ schema_version: '0.1.0', model: 'vibepro-decision-records-v1', story_id: storyId, decisions }, null, 2)
  );
}

function findResult(preflight, recipeId) {
  return preflight.results.find((item) => item.recipe_id === recipeId);
}

// RPA-S-1
test('verify-status-artifact: passing record without artifact gets a generated status artifact (strength becomes strong)', async () => {
  const root = await makeRepo();
  const storyId = 'story-a';
  await writeEvidence(root, storyId, [{
    kind: 'unit',
    status: 'pass',
    command: 'npm test',
    summary: 'unit passed',
    artifact: null,
    observation: { targets: ['src/x.js'], scenarios: ['ran unit'], values: { exit_code: '0' } },
    executed_at: '2026-07-01T00:00:00.000Z'
  }]);

  const preflight = await runRecipePreflight(root, { storyId });
  const result = findResult(preflight, 'verify-status-artifact');
  assert.equal(result.detected, true);
  assert.equal(result.action, 'auto_fix');
  assert.equal(result.action_taken, 'generated status artifact from recorded exit code');
  assert.equal(result.artifacts.length, 1);

  // status artifact content is a generic status JSON from the recorded exit code
  const statusArtifact = JSON.parse(await readFile(path.join(root, result.artifacts[0]), 'utf8'));
  assert.deepEqual(statusArtifact, { status: 'pass', exit_code: 0 });

  // re-recorded evidence now has an artifact and cross-check verified -> spine strength strong
  const evidence = JSON.parse(await readFile(path.join(root, '.vibepro', 'pr', storyId, 'verification-evidence.json'), 'utf8'));
  const command = evidence.commands.find((item) => item.kind === 'unit');
  assert.ok(command.artifact, 'record should now carry a durable artifact');
  assert.equal(command.artifact_check.status, 'verified');
});

// RPA-S-2
test('generic-token-clause-binding: all-generic record without a clause id yields a next_command naming the binding', async () => {
  const root = await makeRepo();
  const storyId = 'story-b';
  await writeSpecDoc(root, storyId, 'story_id: story-b\ntitle: B', '# Spec\n\nSee RPA-CONTRACT-001 for the contract.\n');
  await writeEvidence(root, storyId, [{
    kind: 'unit',
    status: 'pass',
    command: 'npm test',
    summary: 'unit regression',
    artifact: 'unit.json',
    observation: { targets: [], scenarios: [], values: {} },
    executed_at: '2026-07-01T00:00:00.000Z'
  }]);

  const preflight = await runRecipePreflight(root, { storyId });
  const result = findResult(preflight, 'generic-token-clause-binding');
  assert.equal(result.detected, true);
  assert.equal(result.action, 'next_command');
  assert.match(result.next_command, /vibepro verify record/);
  assert.match(result.next_command, /RPA-CONTRACT-001/);
});

test('generic-token-clause-binding: record already binding a clause id is not detected', async () => {
  const root = await makeRepo();
  const storyId = 'story-b2';
  await writeEvidence(root, storyId, [{
    kind: 'unit',
    status: 'pass',
    command: 'npm test',
    summary: 'unit regression binds RPA-CONTRACT-001',
    artifact: 'unit.json',
    observation: { targets: [], scenarios: [], values: {} },
    executed_at: '2026-07-01T00:00:00.000Z'
  }]);

  const preflight = await runRecipePreflight(root, { storyId });
  assert.equal(findResult(preflight, 'generic-token-clause-binding').detected, false);
});

// RPA-S-3
test('architecture-reason-frontmatter: architecture-referencing story without reason: yields the 4-element template', async () => {
  const root = await makeRepo();
  const storyId = 'story-c';
  await writeStoryDoc(root, storyId, 'story_id: story-c\ntitle: C\nparent_design: design-c\narchitecture_docs:\n  - docs/architecture/c.md');

  const preflight = await runRecipePreflight(root, { storyId });
  const result = findResult(preflight, 'architecture-reason-frontmatter');
  assert.equal(result.detected, true);
  assert.equal(result.action, 'next_command');
  assert.match(result.next_command, /alternatives/);
  assert.match(result.next_command, /compatibility/);
  assert.match(result.next_command, /rollback/);
  assert.match(result.next_command, /boundary/);
});

test('architecture-reason-frontmatter: story that already has reason: is not detected', async () => {
  const root = await makeRepo();
  const storyId = 'story-c2';
  await writeStoryDoc(root, storyId, 'story_id: story-c2\ntitle: C2\nparent_design: design-c2\nreason: "alternatives: x; compatibility: y; rollback: z; boundary: w"');

  const preflight = await runRecipePreflight(root, { storyId });
  assert.equal(findResult(preflight, 'architecture-reason-frontmatter').detected, false);
});

// RPA-S-4
test('followup-decision-artifact: accepted followup with reason but no artifact yields a re-record command', async () => {
  const root = await makeRepo();
  const storyId = 'story-d';
  await writeDecisionRecords(root, storyId, [{
    decision_id: 'decision-1',
    type: 'waiver',
    status: 'accepted',
    source: 'gate:pr_scope_judgment',
    summary: 'scope accepted',
    reason: 'bounded followup',
    artifact: null
  }]);

  const preflight = await runRecipePreflight(root, { storyId });
  const result = findResult(preflight, 'followup-decision-artifact');
  assert.equal(result.detected, true);
  assert.equal(result.action, 'next_command');
  assert.match(result.next_command, /vibepro decision record/);
  assert.match(result.next_command, /--artifact/);
});

test('followup-decision-artifact: accepted followup that already has an artifact is not detected', async () => {
  const root = await makeRepo();
  const storyId = 'story-d2';
  await writeDecisionRecords(root, storyId, [{
    decision_id: 'decision-1',
    type: 'waiver',
    status: 'accepted',
    source: 'gate:pr_scope_judgment',
    summary: 'scope accepted',
    reason: 'bounded followup',
    artifact: '.vibepro/pr/story-d2/tracking.json'
  }]);

  const preflight = await runRecipePreflight(root, { storyId });
  assert.equal(findResult(preflight, 'followup-decision-artifact').detected, false);
});

// RPA-S-5
test('design-diagrams-final-spec: diagram only in the spec doc, not the final spec, yields spec write --final command', async () => {
  const root = await makeRepo();
  const storyId = 'story-e';
  await writeSpecDoc(root, storyId, 'story_id: story-e\ntitle: E\ndiagrams:\n  - kind: threat_model\n    mermaid: |\n      flowchart LR\n        A --> B');
  await writeFinalSpec(root, storyId, { schema_version: '0.1.0', story_id: storyId, diagrams: [] });

  const preflight = await runRecipePreflight(root, { storyId });
  const result = findResult(preflight, 'design-diagrams-final-spec');
  assert.equal(result.detected, true);
  assert.equal(result.action, 'next_command');
  assert.match(result.next_command, /spec write . --id story-e --final/);
  assert.match(result.next_command, /threat_model/);
});

test('design-diagrams-final-spec: diagram present in final spec diagrams[] is not detected', async () => {
  const root = await makeRepo();
  const storyId = 'story-e2';
  await writeSpecDoc(root, storyId, 'story_id: story-e2\ntitle: E2\ndiagrams:\n  - kind: flow\n    mermaid: |\n      flowchart LR\n        A --> B');
  await writeFinalSpec(root, storyId, { schema_version: '0.1.0', story_id: storyId, diagrams: [{ kind: 'flow', mermaid: 'flowchart LR' }] });

  const preflight = await runRecipePreflight(root, { storyId });
  assert.equal(findResult(preflight, 'design-diagrams-final-spec').detected, false);
});

test('extractSpecDocDiagramKinds parses nested diagrams frontmatter and stops at the next top-level key', () => {
  const raw = [
    '---',
    'story_id: story-x',
    'diagrams:',
    '  - kind: flow',
    '    mermaid: |',
    '      flowchart LR',
    '        A --> B',
    '  - kind: sequence',
    '    mermaid: |',
    '      sequenceDiagram',
    'title: X',
    '---',
    '',
    '# Spec'
  ].join('\n');
  assert.deepEqual(extractSpecDocDiagramKinds(raw), ['flow', 'sequence']);
});

// RPA-S-6
test('story-catalog-registration: unregistered story is appended to config brainbase.stories[] and echoed', async () => {
  const root = await makeRepo();
  const storyId = 'story-f';
  await writeStoryDoc(root, storyId, 'story_id: story-f\ntitle: "Feature F"\nview: dev\nperiod: 2026-07');

  const preflight = await runRecipePreflight(root, { storyId });
  const result = findResult(preflight, 'story-catalog-registration');
  assert.equal(result.detected, true);
  assert.equal(result.action, 'auto_fix');
  assert.equal(result.action_taken, 'appended story catalog entry');
  assert.equal(result.details.appended_entry.story_id, storyId);
  assert.equal(result.details.appended_entry.title, 'Feature F');
  assert.equal(result.details.appended_entry.ssot, 'local');

  const config = JSON.parse(await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8'));
  assert.ok(config.brainbase.stories.some((story) => story.story_id === storyId));
});

test('story-catalog-registration: already-registered story is not detected', async () => {
  const storyId = 'story-f2';
  const root = await makeRepo({
    config: {
      schema_version: '0.1.0',
      tool: 'vibepro',
      workspace: '.vibepro',
      brainbase: { stories: [{ story_id: storyId, title: 'F2', ssot: 'local', status: 'active' }] }
    }
  });

  const preflight = await runRecipePreflight(root, { storyId });
  assert.equal(findResult(preflight, 'story-catalog-registration').detected, false);
});

// RPA-S-7
test('clean story: preflight is a no-op (all recipes detected:false, config unchanged, one result per recipe)', async () => {
  const storyId = 'story-clean';
  const root = await makeRepo({
    config: {
      schema_version: '0.1.0',
      tool: 'vibepro',
      workspace: '.vibepro',
      brainbase: { stories: [{ story_id: storyId, title: 'Clean', ssot: 'local', status: 'active' }] }
    }
  });
  // minimal story doc with no architecture reference
  await writeStoryDoc(root, storyId, `story_id: ${storyId}\ntitle: Clean`);
  const configBefore = await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8');

  const preflight = await runRecipePreflight(root, { storyId });

  assert.equal(preflight.results.length, RECIPE_REGISTRY.length);
  for (const result of preflight.results) {
    assert.equal(result.detected, false, `${result.recipe_id} should not be detected on a clean story`);
    assert.equal(result.action_taken, null);
    assert.deepEqual(result.artifacts, []);
    assert.equal(result.next_command, null);
  }
  const configAfter = await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8');
  assert.equal(configAfter, configBefore, 'config.json must be byte-identical after a no-op preflight');
});

test('report lists every registered recipe exactly once, in registry order', async () => {
  const root = await makeRepo();
  const preflight = await runRecipePreflight(root, { storyId: 'story-order' });
  assert.deepEqual(
    preflight.results.map((item) => item.recipe_id),
    RECIPE_REGISTRY.map((recipe) => recipe.id)
  );
});

// RPA-CONTRACT-005 (parse_failure): corrupt on-disk JSON is isolated per recipe
test('parse failure: corrupt verification-evidence.json is isolated as action_taken failed without aborting preflight', async () => {
  const root = await makeRepo();
  const storyId = 'story-parse-fail';
  const dir = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'verification-evidence.json'), '{ this is not valid json');

  const preflight = await runRecipePreflight(root, { storyId });

  const verify = findResult(preflight, 'verify-status-artifact');
  assert.equal(verify.action_taken, 'failed', 'evidence-reading recipe must report failed on parse failure');
  assert.ok(verify.error, 'parse failure must carry an error message');
  // recipes that do not read the corrupt file still run and report
  assert.equal(preflight.results.length, RECIPE_REGISTRY.length);
  const catalog = findResult(preflight, 'story-catalog-registration');
  assert.equal(catalog.detected, true, 'later recipes still execute after a parse failure');
});

// schema_failure: unexpected evidence shape is tolerated as not-detected, not a crash
test('schema failure tolerance: evidence with a non-array commands field is treated as no evidence', async () => {
  const root = await makeRepo();
  const storyId = 'story-schema-fail';
  const dir = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'verification-evidence.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: storyId,
    commands: { unexpected: 'object shape' }
  }));

  const preflight = await runRecipePreflight(root, { storyId });
  assert.equal(findResult(preflight, 'verify-status-artifact').detected, false);
  assert.equal(findResult(preflight, 'verify-status-artifact').action_taken, null);
  assert.equal(findResult(preflight, 'generic-token-clause-binding').detected, false);
});

// RPA-CONTRACT-005
test('failure isolation: a recipe that throws is reported failed and does not abort the others', async () => {
  const root = await makeRepo();
  const throwingRecipe = {
    id: 'always-throws',
    action: 'next_command',
    detect() { throw new Error('boom'); }
  };
  const okRecipe = {
    id: 'always-detects',
    action: 'next_command',
    detect() { return { detected: true, next_command: 'noop', reason: 'r' }; }
  };
  const preflight = await runRecipePreflight(root, {
    storyId: 'story-fail',
    registry: [throwingRecipe, okRecipe]
  });
  assert.equal(preflight.results.length, 2);
  assert.equal(preflight.results[0].recipe_id, 'always-throws');
  assert.equal(preflight.results[0].action_taken, 'failed');
  assert.equal(preflight.results[1].recipe_id, 'always-detects');
  assert.equal(preflight.results[1].detected, true);
  assert.equal(preflight.results[1].next_command, 'noop');
});

// RPA-S-8
test('open registry: a seventh recipe added by append runs after the existing six unchanged', async () => {
  const root = await makeRepo();
  let ran = false;
  const seventh = {
    id: 'seventh-recipe',
    action: 'next_command',
    detect() { ran = true; return { detected: true, next_command: 'seventh', reason: 'r' }; }
  };
  const preflight = await runRecipePreflight(root, {
    storyId: 'story-seven',
    registry: [...RECIPE_REGISTRY, seventh]
  });
  assert.equal(ran, true);
  assert.equal(preflight.results.length, RECIPE_REGISTRY.length + 1);
  assert.deepEqual(
    preflight.results.slice(0, RECIPE_REGISTRY.length).map((item) => item.recipe_id),
    RECIPE_REGISTRY.map((recipe) => recipe.id)
  );
  const seventhResult = preflight.results[RECIPE_REGISTRY.length];
  assert.equal(seventhResult.recipe_id, 'seventh-recipe');
  assert.equal(seventhResult.detected, true);
});

// RPA-CONTRACT-004 (dry-run auto_fix does not write)
test('dry-run: detected auto_fix recipes are planned, not applied', async () => {
  const root = await makeRepo();
  const storyId = 'story-dry';
  await writeStoryDoc(root, storyId, `story_id: ${storyId}\ntitle: Dry`);
  const configBefore = await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8');

  const preflight = await runRecipePreflight(root, { storyId, dryRun: true });
  const result = findResult(preflight, 'story-catalog-registration');
  assert.equal(result.detected, true);
  assert.equal(result.action_taken, 'planned');

  const configAfter = await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8');
  assert.equal(configAfter, configBefore, 'dry-run must not mutate config.json');
});
