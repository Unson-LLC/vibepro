import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-development-judgment-operating-loop';

function silentIo() {
  return {
    stdout: { write() {} },
    stderr: { write() {} }
  };
}

async function setupRepo(suffix) {
  const root = await mkdtemp(path.join(os.tmpdir(), `vibepro-judgment-ops-${suffix}-`));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'index.js'), 'export const value = 1;\n');
  await execFileAsync('git', ['add', 'index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initialize repository'], { cwd: root });
  const initialized = await runCli([
    'init', root,
    '--story-id', STORY_ID,
    '--title', 'Operate the Development Judgment loop'
  ], silentIo());
  assert.equal(initialized.exitCode, 0);
  await writeCatalog(root);
  await writeFile(path.join(root, 'index.js'), 'export const value = 2;\n');
  return root;
}

async function writeCatalog(root) {
  const dir = path.join(root, '.vibepro', 'stories');
  await mkdir(dir, { recursive: true });
  const catalog = {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    story_count: 1,
    source: { warnings: [], run_id: null },
    coverage: {
      status: 'ok',
      totals: { coverage_ratio: 1, uncovered_files: 0 },
      uncovered: []
    },
    open_questions: [],
    stories: [{
      story_id: STORY_ID,
      title: 'Operate the Development Judgment loop',
      category: 'product',
      view: 'dev',
      horizon: null,
      period: null,
      source: { type: 'manual', paths: [] },
      derived: {
        confidence: 'high',
        open_questions: [],
        story_contract: null,
        story_definition: { acceptance_focus: ['Judgment changes the delivery plan'] },
        meaning: {
          confidence: 'high',
          workflow_position: { stage: 'decision' },
          evidence_by_type: { docs_evidence: [], code_evidence: [] },
          code_scope: { evidence: [] },
          counter_evidence: []
        }
      }
    }]
  };
  await writeFile(path.join(dir, 'story-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
}

async function createActionableInput(root, preparedArtifact) {
  const absolute = path.join(root, preparedArtifact);
  const input = JSON.parse(await readFile(absolute, 'utf8'));
  input.problem_frame = {
    status: 'valid',
    statement: 'The delivery plan does not yet consume the selected development mode.',
    reason: 'The Story requires an explicit causal link from judgment to planning.'
  };
  input.development_cycle.current_constraint = {
    kind: 'value_constraint',
    status: 'verified',
    statement: 'The judgment result is not consumed by the delivery plan.',
    source_refs: ['index.js'],
    decision_evidence: {
      status: 'sufficient',
      reason: 'The current plan has no judgment binding and the proposed option adds one without gate authority.',
      source_refs: ['index.js']
    }
  };
  input.decision_profile = {
    materiality: 'medium',
    reversibility: 'easy',
    blast_radius: 'local'
  };
  input.options = [{
    id: 'option-bind-plan',
    summary: 'Bind the actionable judgment to Story plan generation.',
    action: 'fix',
    addresses: [],
    violates: [],
    residual_risk: 'low'
  }];
  await writeFile(absolute, `${JSON.stringify(input, null, 2)}\n`);
  return absolute;
}

test('standard judgment operation reaches plan consumption, disposition, outcome, and next-run feedback', async () => {
  const root = await setupRepo('closed-loop');

  const initialStatus = await runCli(['judgment', 'status', root, '--id', STORY_ID, '--json'], silentIo());
  assert.equal(initialStatus.exitCode, 0);
  assert.equal(initialStatus.result.lifecycle, 'not_started');
  assert.equal(initialStatus.result.blocking, false);

  const applicability = await runCli([
    'judgment', 'applicability', 'record', root,
    '--id', STORY_ID,
    '--applicable', 'yes',
    '--reason', 'The Story has multiple delivery choices and a meaningful VALUE/SIMPLIFY/VALIDATE decision.',
    '--recorded-by', 'test-agent',
    '--json'
  ], silentIo());
  assert.equal(applicability.exitCode, 0);
  assert.equal(applicability.result.status.lifecycle, 'applicable_not_prepared');

  const prepared = await runCli([
    'judgment', 'prepare', root,
    '--id', STORY_ID,
    '--run-id', 'judgment-ops-run-1',
    '--json'
  ], silentIo());
  assert.equal(prepared.exitCode, 0);
  assert.equal(prepared.result.lifecycle, 'draft_prepared');
  assert.equal(prepared.result.input.problem_frame.status, 'uncertain');
  const adoptedInput = await createActionableInput(root, prepared.result.artifact);

  const adopted = await runCli([
    'judgment', 'input', 'adopt', root,
    '--id', STORY_ID,
    '--input', adoptedInput,
    '--reviewed-by', 'test-agent',
    '--authority', 'story-and-repository-evidence',
    '--summary', 'Reviewed the problem frame, constraint, and viable option.',
    '--json'
  ], silentIo());
  assert.equal(adopted.exitCode, 0);
  assert.equal(adopted.result.status.lifecycle, 'input_reviewed');

  const evaluated = await runCli([
    'judgment', 'evaluate', root,
    '--id', STORY_ID,
    '--input', adopted.result.adoption.adopted_input,
    '--json'
  ], silentIo());
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.result.operational.actionable, true);
  assert.equal(evaluated.result.operational.development_mode, 'VALUE');
  assert.equal(evaluated.result.operational_status.lifecycle, 'evaluated_actionable');

  const planned = await runCli(['story', 'plan', root, '--json'], silentIo());
  assert.equal(planned.exitCode, 0);
  assert.equal(planned.result.plan.development_judgment.status, 'applied');
  assert.equal(planned.result.plan.development_judgment.effect, 'changed_plan');
  assert.ok(planned.result.plan.task_candidates.some((task) => task.source_type === 'development_judgment'));

  const consumed = await runCli(['judgment', 'status', root, '--id', STORY_ID, '--json'], silentIo());
  assert.equal(consumed.result.lifecycle, 'consumed_by_plan');
  assert.equal(consumed.result.plan_binding.effect, 'changed_plan');

  const disposition = await runCli([
    'judgment', 'disposition', 'record', root,
    '--id', STORY_ID,
    '--run', 'judgment-ops-run-1',
    '--human-decision', 'accepted',
    '--effect', 'changed_plan',
    '--summary', 'The VALUE judgment was accepted and changed the generated plan.',
    '--recorded-by', 'test-agent',
    '--json'
  ], silentIo());
  assert.equal(disposition.exitCode, 0);
  assert.equal(disposition.result.status.lifecycle, 'outcome_pending');

  const pending = await runCli(['judgment', 'pending', root, '--json'], silentIo());
  assert.equal(pending.exitCode, 0);
  assert.equal(pending.result.pending_count, 1);
  assert.equal(pending.result.pending[0].pending_outcome, true);

  const outcome = await runCli([
    'judgment', 'outcome', 'record', root,
    '--id', STORY_ID,
    '--run', 'judgment-ops-run-1',
    '--status', 'confirmed',
    '--summary', 'The judgment-guidance task was consumed and the intended plan binding remained observable.',
    '--evidence', '.vibepro/stories/story-plan.json',
    '--observed-outcome', 'plan_binding:Development Judgment is bound to the Story plan',
    '--json'
  ], silentIo());
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.result.status.lifecycle, 'closed');

  const pr = await runCli([
    'pr', 'prepare', root,
    '--story-id', STORY_ID,
    '--base', 'main',
    '--json'
  ], silentIo());
  assert.equal(pr.exitCode, 0);
  assert.equal(pr.result.preparation.development_judgment.lifecycle, 'closed');
  assert.equal(pr.result.preparation.development_judgment.blocking, false);
  const body = await readFile(pr.result.artifacts.pr_body, 'utf8');
  assert.match(body, /- lifecycle: closed/);
  assert.match(body, /- plan binding: applied/);
  assert.match(body, /- pending outcome: false/);

  const nextPrepared = await runCli([
    'judgment', 'prepare', root,
    '--id', STORY_ID,
    '--run-id', 'judgment-ops-run-2',
    '--json'
  ], silentIo());
  assert.equal(nextPrepared.exitCode, 0);
  assert.equal(nextPrepared.result.feedback.outcome, 'confirmed');
  assert.equal(nextPrepared.result.input.development_cycle.history_boundary.kind, 'verified_external_outcome');
  assert.deepEqual(nextPrepared.result.input.development_cycle.adopted_batches, []);
});

test('story plan advances the judgment loop and persists explicit disposition and outcome', async () => {
  const root = await setupRepo('story-plan-loop');

  const prepared = await runCli([
    'story', 'plan', root,
    '--judgment-applicable', 'yes',
    '--judgment-reason', 'The plan must select between meaningful implementation choices.',
    '--judgment-actor', 'test-agent',
    '--json'
  ], silentIo());
  assert.equal(prepared.exitCode, 0);
  assert.deepEqual(
    prepared.result.judgmentProgress.map((entry) => entry.action),
    ['applicability_recorded', 'input_prepared']
  );
  assert.equal(prepared.result.judgmentClosure.status.lifecycle, 'draft_prepared');

  const adoptedInput = await createActionableInput(
    root,
    prepared.result.judgmentClosure.status.draft.artifact
  );
  const closed = await runCli([
    'story', 'plan', root,
    '--judgment-input', adoptedInput,
    '--judgment-reviewed-by', 'test-agent',
    '--judgment-authority', 'story-and-repository-evidence',
    '--judgment-review-summary', 'Reviewed the problem frame, constraint, and viable option.',
    '--judgment-human-decision', 'accepted',
    '--judgment-effect', 'changed_plan',
    '--judgment-disposition-summary', 'Accepted the VALUE guidance and applied it to the plan.',
    '--judgment-outcome-status', 'confirmed',
    '--judgment-outcome-summary', 'The generated plan retained the intended judgment binding.',
    '--judgment-evidence', '.vibepro/stories/story-plan.json',
    '--judgment-observed-outcome', 'plan_binding:Development Judgment is bound to the Story plan',
    '--judgment-actor', 'test-agent',
    '--json'
  ], silentIo());

  assert.equal(closed.exitCode, 0);
  assert.deepEqual(
    closed.result.judgmentProgress.map((entry) => entry.action),
    ['input_adopted', 'judgment_evaluated']
  );
  assert.equal(closed.result.plan.development_judgment.status, 'applied');
  assert.equal(closed.result.judgmentClosure.disposition.human_decision, 'accepted');
  assert.equal(closed.result.judgmentClosure.disposition.effect, 'changed_plan');
  assert.equal(closed.result.judgmentClosure.outcome.status, 'confirmed');
  assert.equal(closed.result.judgmentClosure.status.lifecycle, 'closed');

  const pending = await runCli(['judgment', 'pending', root, '--json'], silentIo());
  assert.equal(pending.result.pending_count, 0);
});

test('not-applicable judgment remains explicit, non-blocking, and does not inject a plan task', async () => {
  const root = await setupRepo('not-applicable');
  const applicability = await runCli([
    'judgment', 'applicability', 'record', root,
    '--id', STORY_ID,
    '--applicable', 'no',
    '--reason', 'This fixture represents a mechanical change with no meaningful engineering choice.',
    '--recorded-by', 'test-agent',
    '--json'
  ], silentIo());
  assert.equal(applicability.exitCode, 0);
  assert.equal(applicability.result.status.lifecycle, 'not_applicable');

  const plan = await runCli(['story', 'plan', root, '--json'], silentIo());
  assert.equal(plan.exitCode, 0);
  assert.equal(plan.result.plan.development_judgment.status, 'not_applicable');
  assert.equal(plan.result.plan.development_judgment.blocking, false);
  assert.equal(plan.result.plan.task_candidates.some((task) => task.source_type === 'development_judgment'), false);
});
