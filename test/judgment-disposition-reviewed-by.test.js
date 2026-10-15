import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';

const STORY_ID = 'story-disposition-reviewed-by';

function silentIo() {
  return {
    stdout: { write() {} },
    stderr: { write() {} }
  };
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-disposition-reviewed-by-'));
  return root;
}

async function seedEvaluation(root, runId) {
  const evaluationDir = path.join(
    root,
    '.vibepro',
    'reviews',
    STORY_ID,
    'development-judgment',
    'evaluations'
  );
  await mkdir(evaluationDir, { recursive: true });
  const evaluation = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    run_id: runId,
    actionable: true,
    development_mode: 'VALUE',
    recommendation: 'proceed'
  };
  const body = `${JSON.stringify(evaluation, null, 2)}\n`;
  await writeFile(path.join(evaluationDir, `${runId}.json`), body);
  await writeFile(path.join(evaluationDir, 'current.json'), body);
}

async function recordDisposition(root, runId, extraArgs = []) {
  return runCli([
    'judgment', 'disposition', 'record', root,
    '--id', STORY_ID,
    '--run', runId,
    '--human-decision', 'accepted',
    '--effect', 'changed_plan',
    '--summary', 'Accepted the optional reviewed_by field.',
    '--json',
    ...extraArgs
  ], silentIo());
}

async function readCurrentDisposition(root, runId) {
  const currentPath = path.join(
    root,
    '.vibepro',
    'reviews',
    STORY_ID,
    'development-judgment',
    'dispositions',
    runId,
    'current.json'
  );
  return JSON.parse(await readFile(currentPath, 'utf8'));
}

test('disposition record leaves reviewed_by null when --reviewed-by is omitted', async () => {
  const root = await setupRepo();
  const runId = 'run-missing-reviewed-by';
  await seedEvaluation(root, runId);

  const disposition = await recordDisposition(root, runId, ['--recorded-by', 'recorder']);
  assert.equal(disposition.exitCode, 0);
  assert.equal(disposition.result.disposition.reviewed_by, null);
  assert.equal(disposition.result.disposition.recorded_by, 'recorder');

  const stored = await readCurrentDisposition(root, runId);
  assert.equal(stored.reviewed_by, null);
  assert.equal(stored.recorded_by, 'recorder');
  assert.equal(stored.schema_version, '0.1.0');
});

test('disposition record stores null reviewed_by for an empty --reviewed-by', async () => {
  const root = await setupRepo();
  const runId = 'run-empty-reviewed-by';
  await seedEvaluation(root, runId);

  const empty = await recordDisposition(root, runId, ['--reviewed-by', '']);
  assert.equal(empty.exitCode, 0);
  assert.equal(empty.result.disposition.reviewed_by, null);
  assert.equal(empty.result.disposition.recorded_by, 'unknown');

  const blankRoot = await setupRepo();
  const blankRunId = 'run-blank-reviewed-by';
  await seedEvaluation(blankRoot, blankRunId);
  const blank = await recordDisposition(blankRoot, blankRunId, ['--reviewed-by', '   ']);
  assert.equal(blank.exitCode, 0);
  assert.equal(blank.result.disposition.reviewed_by, null);
  assert.equal((await readCurrentDisposition(blankRoot, blankRunId)).reviewed_by, null);
});

test('disposition record stores Japanese --reviewed-by text unchanged', async () => {
  const root = await setupRepo();
  const runId = 'run-japanese-reviewed-by';
  await seedEvaluation(root, runId);
  const reviewer = 'レビュー担当';

  const disposition = await recordDisposition(root, runId, ['--reviewed-by', reviewer]);
  assert.equal(disposition.exitCode, 0);
  assert.equal(disposition.result.disposition.reviewed_by, reviewer);

  const stored = await readCurrentDisposition(root, runId);
  assert.equal(stored.reviewed_by, reviewer);
  const raw = await readFile(path.join(
    root,
    '.vibepro',
    'reviews',
    STORY_ID,
    'development-judgment',
    'dispositions',
    runId,
    'current.json'
  ), 'utf8');
  assert.match(raw, /レビュー担当/);
});

test('disposition record trims surrounding whitespace from --reviewed-by', async () => {
  const root = await setupRepo();
  const runId = 'run-trimmed-reviewed-by';
  await seedEvaluation(root, runId);

  const disposition = await recordDisposition(root, runId, ['--reviewed-by', '  レビュー担当  ']);
  assert.equal(disposition.exitCode, 0);
  assert.equal(disposition.result.disposition.reviewed_by, 'レビュー担当');

  const stored = await readCurrentDisposition(root, runId);
  assert.equal(stored.reviewed_by, 'レビュー担当');
});

test('disposition record treats a trailing --reviewed-by without a value as null', async () => {
  const root = await setupRepo();
  const runId = 'run-trailing-reviewed-by';
  await seedEvaluation(root, runId);

  const disposition = await recordDisposition(root, runId, ['--reviewed-by']);
  assert.equal(disposition.exitCode, 0);
  assert.equal(disposition.result.disposition.reviewed_by, null);
  assert.equal(disposition.result.disposition.recorded_by, 'unknown');

  const stored = await readCurrentDisposition(root, runId);
  assert.equal(stored.reviewed_by, null);
});

test('judgment outcome record stores reviewed_by on the disposition it writes', async () => {
  const root = await setupRepo();
  const runId = 'run-outcome-reviewed-by';
  await seedEvaluation(root, runId);
  const applicabilityDir = path.join(
    root,
    '.vibepro',
    'reviews',
    STORY_ID,
    'development-judgment',
    'applicability'
  );
  await mkdir(applicabilityDir, { recursive: true });
  await writeFile(path.join(applicabilityDir, 'current.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    applicable: true,
    reason: 'Outcome record writes the disposition on the operational path.',
    recorded_by: 'recorder'
  }, null, 2)}\n`);

  const outcome = await runCli([
    'judgment', 'outcome', 'record', root,
    '--id', STORY_ID,
    '--run', runId,
    '--human-decision', 'accepted',
    '--effect', 'changed_plan',
    '--reviewed-by', '結果確認者',
    '--status', 'confirmed',
    '--summary', 'Outcome path persists reviewed_by.',
    '--json'
  ], silentIo());
  assert.equal(outcome.exitCode, 0);

  const stored = await readCurrentDisposition(root, runId);
  assert.equal(stored.reviewed_by, '結果確認者');
  assert.equal(stored.human_decision, 'accepted');
  assert.equal(stored.effect, 'changed_plan');
});

test('existing disposition records without reviewed_by stay readable', async () => {
  const root = await setupRepo();
  const runId = 'run-legacy-disposition';
  await seedEvaluation(root, runId);
  const dispositionDir = path.join(
    root,
    '.vibepro',
    'reviews',
    STORY_ID,
    'development-judgment',
    'dispositions',
    runId
  );
  await mkdir(dispositionDir, { recursive: true });
  const legacy = {
    schema_version: '0.1.0',
    disposition_id: 'disposition-legacy',
    story_id: STORY_ID,
    run_id: runId,
    human_decision: 'accepted',
    effect: 'changed_plan',
    summary: 'Legacy disposition recorded before reviewed_by existed.',
    evidence_refs: [],
    recorded_by: 'legacy-recorder',
    recorded_at: '2026-08-01T00:00:00.000Z',
    artifact: `.vibepro/reviews/${STORY_ID}/development-judgment/dispositions/${runId}/current.json`,
    advisory: true,
    blocking: false
  };
  const currentPath = path.join(dispositionDir, 'current.json');
  await writeFile(currentPath, `${JSON.stringify(legacy, null, 2)}\n`);
  const applicabilityDir = path.join(
    root,
    '.vibepro',
    'reviews',
    STORY_ID,
    'development-judgment',
    'applicability'
  );
  await mkdir(applicabilityDir, { recursive: true });
  await writeFile(path.join(applicabilityDir, 'current.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    applicable: true,
    reason: 'Existing operational dispositions remain readable.',
    recorded_by: 'legacy-recorder'
  }, null, 2)}\n`);
  const before = await readFile(currentPath, 'utf8');

  const status = await runCli([
    'judgment', 'status', root,
    '--id', STORY_ID,
    '--json'
  ], silentIo());
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.disposition.recorded_by, 'legacy-recorder');
  assert.equal(status.result.disposition.human_decision, 'accepted');
  assert.equal(Object.hasOwn(status.result.disposition, 'reviewed_by'), false);

  const outcome = await runCli([
    'judgment', 'outcome', 'record', root,
    '--id', STORY_ID,
    '--run', runId,
    '--status', 'unknown',
    '--summary', 'Legacy disposition can still receive an outcome.',
    '--json'
  ], silentIo());
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.result.outcome.disposition_artifact, legacy.artifact);
  assert.equal(await readFile(currentPath, 'utf8'), before);
});
