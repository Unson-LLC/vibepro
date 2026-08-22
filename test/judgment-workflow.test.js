import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import {
  evaluateJudgmentWorkflow,
  prepareJudgmentInput,
  readDevelopmentJudgmentProjection,
  recordJudgmentOutcome
} from '../src/judgment-workflow.js';
import { STANDARD_JUDGMENT_AXES } from '../src/senior-judgment-dag.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-development-judgment-workflow';

function silentIo() {
  return {
    stdout: { write() {} },
    stderr: { write() {} }
  };
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-judgment-workflow-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'index.js'), 'export const value = 1;\n');
  await execFileAsync('git', ['add', 'index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initialize repository'], { cwd: root });
  const initialized = await runCli([
    'init', root,
    '--story-id', STORY_ID,
    '--title', 'Connect senior judgment to durable development judgment'
  ], silentIo());
  assert.equal(initialized.exitCode, 0);
  await writeFile(path.join(root, 'index.js'), 'export const value = 2;\n');
  return root;
}

test('judgment prepare creates a conservative draft and evaluation compiles it into a non-blocking durable DAG', async () => {
  const root = await setupRepo();
  const prepared = await prepareJudgmentInput(root, {
    storyId: STORY_ID,
    runId: 'judgment-workflow-run-1'
  });

  assert.equal(prepared.input.problem_frame.status, 'uncertain');
  assert.equal(prepared.input.axes.length, STANDARD_JUDGMENT_AXES.length);
  assert.ok(prepared.input.axes.every((axis) => axis.activation === 'inactive'));
  assert.equal(prepared.blocking, false);
  assert.ok(prepared.changed_files.includes('index.js'));

  const evaluated = await evaluateJudgmentWorkflow(root, {
    storyId: STORY_ID,
    inputPath: prepared.artifact
  });
  assert.equal(evaluated.development_judgment.summary.valid, true);
  assert.equal(evaluated.development_judgment.summary.acyclic, true);
  assert.equal(evaluated.development_judgment.projection.blocking, false);
  assert.equal(evaluated.development_judgment.dag.run_id, 'judgment-workflow-run-1');
  assert.deepEqual(
    evaluated.development_judgment.dag.nodes.map((node) => node.id),
    ['goal_contract', 'problem_frame', 'development_mode', 'option_pruning', 'recommendation']
  );

  const immutableRunPath = path.join(root, evaluated.development_judgment.artifacts.run_json);
  const immutableBefore = await readFile(immutableRunPath, 'utf8');
  const outcome = await recordJudgmentOutcome(root, {
    storyId: STORY_ID,
    runId: 'judgment-workflow-run-1',
    evaluationId: 'outcome-workflow-1',
    humanDecision: 'modified',
    effect: 'changed_plan',
    status: 'mixed',
    summary: 'The judgment changed the implementation order but needed human correction.',
    evidenceRefs: ['docs/outcome.md'],
    observedOutcomes: ['plan_change:Implementation order changed']
  });
  const immutableAfter = await readFile(immutableRunPath, 'utf8');

  assert.equal(immutableAfter, immutableBefore);
  assert.equal(outcome.projection.outcome_count, 1);
  assert.equal(outcome.projection.latest_outcome_status, 'mixed');
  const projection = await readDevelopmentJudgmentProjection(root, STORY_ID);
  assert.equal(projection.available, true);
  assert.equal(projection.outcome_count, 1);
  assert.equal(projection.blocking, false);
});

test('judgment CLI prepares, evaluates and records outcomes while PR prepare only projects the result', async () => {
  const root = await setupRepo();
  const prepared = await runCli([
    'judgment', 'prepare', root,
    '--id', STORY_ID,
    '--run-id', 'judgment-workflow-cli-run',
    '--json'
  ], silentIo());
  assert.equal(prepared.exitCode, 0);
  assert.equal(prepared.result.blocking, false);

  const evaluated = await runCli([
    'judgment', 'evaluate', root,
    '--id', STORY_ID,
    '--input', prepared.result.artifact,
    '--json'
  ], silentIo());
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.result.development_judgment.projection.available, true);

  const outcome = await runCli([
    'judgment', 'outcome', 'record', root,
    '--id', STORY_ID,
    '--run', 'judgment-workflow-cli-run',
    '--human-decision', 'accepted',
    '--effect', 'changed_review_focus',
    '--status', 'confirmed',
    '--summary', 'The judgment changed the review focus and the result was confirmed.',
    '--evidence', 'review/final.md',
    '--observed-outcome', 'review_focus:Review focused on the actual boundary',
    '--json'
  ], silentIo());
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.subcommand, 'outcome-record');

  const pr = await runCli([
    'pr', 'prepare', root,
    '--story-id', STORY_ID,
    '--base', 'main',
    '--json'
  ], silentIo());
  assert.equal(pr.exitCode, 0);
  assert.equal(pr.result.preparation.development_judgment.available, true);
  assert.equal(pr.result.preparation.development_judgment.blocking, false);
  assert.equal(pr.result.preparation.development_judgment.outcome_count, 1);
  assert.ok(['ready', 'needs_review'].includes(pr.result.preparation.gate_status));

  const body = await readFile(pr.result.artifacts.pr_body, 'utf8');
  assert.match(body, /### Development Judgment/);
  assert.match(body, /- blocking: false/);
  assert.match(body, /- outcome evaluations: 1/);
});
