import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { parseJudgmentStorySections } from '../src/judgment-story-sections.js';
import { prepareJudgmentInput } from '../src/judgment-workflow.js';
import { evaluateSeniorJudgment, validateSeniorJudgmentInput } from '../src/senior-judgment-dag.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-prepare-reads-headings';

function silentIo() {
  return {
    stdout: { write() {} },
    stderr: { write() {} },
    env: { ...process.env, VIBEPRO_ALLOW_JUDGMENT_RUN_ID: '1' }
  };
}

const COMPLETE_STORY = `# Prepare reads headings

## Acceptance Criteria

- The draft copies the Story headings.

## Problem Frame

- status: valid
- statement: The adopted input is not tied to the prepare receipt.
- reason: Hand-made runs were adopted.

## Current Constraint

- kind: value_constraint
- status: verified
- statement: Adoption does not read the draft receipt.
- source_refs: src/judgment-operations.js
- decision_evidence_status: sufficient
- decision_evidence_reason: The adopt path stores run_id from the input alone.
- decision_evidence_source_refs: src/judgment-operations.js

## Observations

### obs-receipt
- statement: The receipt file is unread during adopt.
- source_ref: src/judgment-operations.js
- freshness: current

## Constraints

### keep-receipt
- kind: invariant
- statement: Adoption requires the prepare receipt.

## Options

### option-bind-receipt
- summary: Refuse adopt unless the receipt matches.
- action: fix
- addresses:
- violates:
- residual_risk: low

## Axes

### security_boundary
- activation: active
- activation_reason: Adoption is an authority boundary.

#### hypothesis-receipt
- claim: A missing receipt can still be adopted.

##### prediction-receipt
- statement: adopt rejects a missing receipt.

##### evidence-receipt
- prediction_id: prediction-receipt
- relation: supports
- freshness: current
- source_ref: src/judgment-operations.js
- summary: adopt checks the draft receipt.
`;

test('judgment prepare copies each Story judgment heading and evaluates without added fields', async () => {
  const root = await setupRepo(COMPLETE_STORY);
  const prepared = await prepareJudgmentInput(root, {
    storyId: STORY_ID,
    runId: 'judgment-20261014182400-a1b2c3d4',
    env: silentIo().env
  });
  const input = prepared.input;
  assert.equal(input.problem_frame.status, 'valid');
  assert.equal(input.problem_frame.statement, 'The adopted input is not tied to the prepare receipt.');
  assert.equal(input.development_cycle.current_constraint.kind, 'value_constraint');
  assert.equal(input.development_cycle.current_constraint.decision_evidence.status, 'sufficient');
  assert.deepEqual(input.observations.map((item) => item.id), ['obs-receipt']);
  assert.equal(input.constraints[0].id, 'keep-receipt');
  assert.equal(input.options[0].action, 'fix');
  assert.deepEqual(input.options[0].violates, []);
  const axis = input.axes.find((item) => item.id === 'security_boundary');
  assert.equal(axis.activation, 'active');
  assert.equal(axis.hypotheses[0].predictions[0].id, 'prediction-receipt');
  assert.equal(input.axes.filter((item) => item.activation === 'inactive').length, input.axes.length - 1);

  const validated = validateSeniorJudgmentInput(input);
  const evaluated = evaluateSeniorJudgment(validated);
  assert.equal(evaluated.development_mode, 'VALUE');
  assert.ok(evaluated.viable_options.some((option) => option.id === 'option-bind-receipt'));
  assert.equal(typeof evaluated.recommendation, 'string');
});

test('omitted Story judgment headings stay uncertain and empty', async () => {
  const root = await setupRepo('# Plain story\n\n## Story\n\nNo judgment headings.\n');
  const prepared = await prepareJudgmentInput(root, {
    storyId: STORY_ID,
    runId: 'judgment-20261014182401-b2c3d4e5',
    env: silentIo().env
  });
  assert.equal(prepared.input.problem_frame.status, 'uncertain');
  assert.match(prepared.input.problem_frame.reason, /does not infer/);
  assert.equal(prepared.input.development_cycle.current_constraint.status, 'unknown');
  assert.deepEqual(prepared.input.constraints, []);
  assert.deepEqual(prepared.input.options, []);
  assert.ok(prepared.input.axes.every((axis) => axis.activation === 'inactive' && axis.hypotheses.length === 0));
  assert.ok(prepared.input.observations.length > 0);
  assert.equal(prepared.input.observations.some((item) => item.id === 'obs-receipt'), false);
});

test('an empty Problem Frame heading stays uncertain', () => {
  const parsed = parseJudgmentStorySections('## Problem Frame\n\n## Story\n\nprose\n');
  assert.equal(parsed.problem_frame, null);
});

test('invalid judgment heading fields are rejected without guessing', () => {
  assert.throws(
    () => parseJudgmentStorySections('## Problem Frame\n\n- status: maybe\n- statement: x\n- reason: y\n'),
    /status must be one of valid, invalid, uncertain/
  );
  assert.throws(
    () => parseJudgmentStorySections('## Problem Frame\n\n- status: valid\n- statement: x\n'),
    /field "reason" is required/
  );
  assert.throws(
    () => parseJudgmentStorySections('## Problem Frame\n\nThe problem is obvious.\n'),
    /invalid line/
  );
  assert.throws(
    () => parseJudgmentStorySections('## Options\n\n### option-one\n- summary: Fix it\n- action: rewrite\n- residual_risk: low\n'),
    /action on option-one must be one of/
  );
  assert.throws(
    () => parseJudgmentStorySections('## Constraints\n\n### Keep Receipt\n- kind: invariant\n- statement: x\n'),
    /not a lowercase identifier/
  );
  assert.throws(
    () => parseJudgmentStorySections('## Axes\n\n### not_an_axis\n- activation: inactive\n- activation_reason: no\n'),
    /not a standard judgment axis/
  );
  assert.throws(
    () => parseJudgmentStorySections('## Problem Frame\n\n- status: valid\n## Problem Frame\n\n- status: invalid\n'),
    /duplicated/
  );
});

async function setupRepo(storyMarkdown) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-story-headings-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'index.js'), 'export const value = 1;\n');
  await execFileAsync('git', ['add', 'index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initialize repository'], { cwd: root });
  const initialized = await runCli([
    'init', root,
    '--story-id', STORY_ID,
    '--title', 'Prepare reads story headings'
  ], silentIo());
  assert.equal(initialized.exitCode, 0);
  const storyPath = path.join(root, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`);
  await mkdir(path.dirname(storyPath), { recursive: true });
  await writeFile(storyPath, storyMarkdown);
  return root;
}
