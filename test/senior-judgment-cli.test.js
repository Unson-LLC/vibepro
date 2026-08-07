import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';
import { STANDARD_JUDGMENT_AXES } from '../src/senior-judgment-dag.js';
import { initWorkspace } from '../src/workspace.js';

function createInput(overrides = {}) {
  return {
    schema_version: '0.1.0',
    story_id: 'story-senior-judgment',
    run_id: 'judgment-001',
    parent_run_id: null,
    goal: {
      statement: 'Fix the actual failure with the smallest safe change',
      success_criteria: ['The current reproduction passes']
    },
    observations: [{
      id: 'obs-1',
      statement: 'A current test reproduces the failure',
      source_ref: 'test/reproduction.test.js',
      freshness: 'current'
    }],
    contradictions: [],
    problem_frame: {
      status: 'valid',
      statement: 'The implementation violates the expected contract',
      reason: 'The reproduction isolates the implementation boundary'
    },
    decision_profile: {
      materiality: 'low',
      reversibility: 'easy',
      blast_radius: 'local'
    },
    axes: STANDARD_JUDGMENT_AXES.map((axisId) => ({
      id: axisId,
      activation: 'inactive',
      activation_reason: 'The scope scan found no reachable concern for this axis',
      hypotheses: []
    })),
    constraints: [],
    options: [],
    ...overrides
  };
}

test('judgment evaluate writes immutable run evidence and review projections without gate authority', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-judgment-'));
  await initWorkspace(repo);
  const inputPath = path.join(repo, 'judgment-input.json');
  const input = createInput();
  input.axes = input.axes.map((axis) => axis.id === 'data_state' ? {
    ...axis,
    activation: 'active',
    activation_reason: 'The change reaches persisted state',
    hypotheses: [{
      id: 'h-state-loss',
      claim: 'The change loses persisted state',
      predictions: [{ id: 'p-row-loss', statement: 'The persisted row count decreases' }],
      evidence: [{
        id: 'ev-row-count',
        prediction_id: 'p-row-loss',
        relation: 'refutes',
        freshness: 'current',
        source_ref: 'test/state-migration.test.js',
        summary: 'The current migration test preserves every row and identifier'
      }]
    }]
  } : axis);
  await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  let stdout = '';

  const cliResult = await runCli([
    'judgment', 'evaluate', repo,
    '--id', 'story-senior-judgment',
    '--input', inputPath,
    '--json'
  ], { stdout: { write: (value) => { stdout += value; } } });

  assert.equal(cliResult.exitCode, 0);
  const output = JSON.parse(stdout);
  assert.equal(output.recommendation, 'proceed');
  assert.equal(output.advisory, true);
  assert.match(output.artifacts.run_json, /senior-judgment\/runs\/judgment-001\.json$/);
  const current = JSON.parse(await readFile(
    path.join(repo, '.vibepro', 'reviews', 'story-senior-judgment', 'senior-judgment.json'),
    'utf8'
  ));
  const markdown = await readFile(
    path.join(repo, '.vibepro', 'reviews', 'story-senior-judgment', 'senior-judgment.md'),
    'utf8'
  );
  assert.equal(current.recommendation, 'proceed');
  assert.equal(current.decision_context.axes.length, STANDARD_JUDGMENT_AXES.length);
  assert.equal('gate_status' in current, false);
  assert.equal('ready_for_pr_create' in current, false);
  assert.match(markdown, /Advisory recommendation: \*\*proceed\*\*/);
  assert.match(markdown, /test\/state-migration\.test\.js/);
  assert.match(markdown, /preserves every row and identifier/);
  assert.match(markdown, /Final authority remains with humans, CI, and repository rules/);
});

test('judgment evaluate enforces lineage and records the decision delta for a valid child run', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-judgment-lineage-'));
  await initWorkspace(repo);
  const firstInput = path.join(repo, 'first.json');
  await writeFile(firstInput, `${JSON.stringify(createInput(), null, 2)}\n`);
  const first = await runCli([
    'judgment', 'evaluate', repo,
    '--id', 'story-senior-judgment',
    '--input', firstInput,
    '--json'
  ]);
  assert.equal(first.exitCode, 0);

  let duplicateError = '';
  const duplicate = await runCli([
    'judgment', 'evaluate', repo,
    '--id', 'story-senior-judgment',
    '--input', firstInput
  ], { stderr: { write: (value) => { duplicateError += value; } } });
  assert.equal(duplicate.exitCode, 1);
  assert.match(duplicateError, /already exists/);

  const childInput = path.join(repo, 'child.json');
  await writeFile(childInput, `${JSON.stringify(createInput({
    run_id: 'judgment-002',
    parent_run_id: 'missing-parent'
  }), null, 2)}\n`);
  let parentError = '';
  const missingParent = await runCli([
    'judgment', 'evaluate', repo,
    '--id', 'story-senior-judgment',
    '--input', childInput
  ], { stderr: { write: (value) => { parentError += value; } } });
  assert.equal(missingParent.exitCode, 1);
  assert.match(parentError, /parent run .* does not exist/i);

  const collidingRunId = 'judgment-004';
  const runsRoot = path.join(
    repo,
    '.vibepro',
    'reviews',
    'story-senior-judgment',
    'senior-judgment',
    'runs'
  );
  await writeFile(path.join(runsRoot, `${collidingRunId}.md`), '# Pre-existing artifact\n');
  const collisionInput = path.join(repo, 'collision.json');
  await writeFile(collisionInput, `${JSON.stringify(createInput({
    run_id: collidingRunId,
    parent_run_id: 'judgment-001'
  }), null, 2)}\n`);
  let collisionError = '';
  const collision = await runCli([
    'judgment', 'evaluate', repo,
    '--id', 'story-senior-judgment',
    '--input', collisionInput
  ], { stderr: { write: (value) => { collisionError += value; } } });
  assert.equal(collision.exitCode, 1);
  assert.match(collisionError, /already exists/);
  await assert.rejects(readFile(path.join(runsRoot, `${collidingRunId}.json`), 'utf8'), { code: 'ENOENT' });

  const validChildInput = path.join(repo, 'valid-child.json');
  await writeFile(validChildInput, `${JSON.stringify(createInput({
    run_id: 'judgment-003',
    parent_run_id: 'judgment-001',
    problem_frame: {
      status: 'invalid',
      statement: 'The reported symptom is not the generating problem',
      reason: 'New current evidence falsified the original frame'
    }
  }), null, 2)}\n`);
  let childStdout = '';
  const validChild = await runCli([
    'judgment', 'evaluate', repo,
    '--id', 'story-senior-judgment',
    '--input', validChildInput,
    '--json'
  ], { stdout: { write: (value) => { childStdout += value; } } });
  assert.equal(validChild.exitCode, 0);
  const child = JSON.parse(childStdout);
  assert.equal(child.recommendation, 'revise_problem');
  assert.deepEqual(child.decision_delta.recommendation, {
    from: 'proceed',
    to: 'revise_problem'
  });
  assert.deepEqual(child.decision_delta.problem_frame, {
    from: 'valid',
    to: 'invalid'
  });
  assert.equal(child.parent_run_id, 'judgment-001');
  const childMarkdown = await readFile(
    path.join(repo, '.vibepro', 'reviews', 'story-senior-judgment', 'senior-judgment.md'),
    'utf8'
  );
  assert.match(childMarkdown, /Problem frame: valid -> invalid/);
});
