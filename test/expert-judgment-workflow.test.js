import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { evaluateJudgmentWorkflow } from '../src/judgment-workflow.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-expert-judgment-workflow';
const EXPERT_FIXTURE = new URL('../examples/expert-judgment/boundary-dag.json', import.meta.url);

function silentIo() {
  return {
    stdout: { write() {} },
    stderr: { write() {} }
  };
}

function capturingIo() {
  const stderrChunks = [];
  return {
    io: {
      stdout: { write() {} },
      stderr: { write(chunk) { stderrChunks.push(chunk); } }
    },
    stderrText() {
      return stderrChunks.join('');
    }
  };
}

async function setupRepo(suffix) {
  const root = await mkdtemp(path.join(os.tmpdir(), `vibepro-expert-judgment-${suffix}-`));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'index.js'), 'export const value = 1;\n');
  await execFileAsync('git', ['add', 'index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initialize repository'], { cwd: root });
  const initialized = await runCli([
    'init', root,
    '--story-id', STORY_ID,
    '--title', 'Connect expert judgment to the Development Judgment workflow'
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

async function recordApplicability(root) {
  const result = await runCli([
    'judgment', 'applicability', 'record', root,
    '--id', STORY_ID,
    '--applicable', 'yes',
    '--reason', 'The workflow has an explicit boundary decision to review.',
    '--recorded-by', 'test-agent',
    '--json'
  ], silentIo());
  assert.equal(result.exitCode, 0);
  return result;
}

async function readFixture() {
  return JSON.parse(await readFile(EXPERT_FIXTURE, 'utf8'));
}

async function writeJson(root, suffix, value) {
  const target = path.join(root, `expert-input-${suffix}.json`);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

async function writeExpertInput(root, suffix, mutate = () => {}) {
  const input = await readFixture();
  input.case_id = STORY_ID;
  mutate(input);
  return {
    input,
    path: await writeJson(root, suffix, input)
  };
}

async function prepare(root, runId, expertInputPath) {
  const args = [
    'judgment', 'prepare', root,
    '--id', STORY_ID,
    '--run-id', runId
  ];
  if (expertInputPath) args.push('--expert-input', expertInputPath);
  args.push('--json');
  return runCli(args, silentIo());
}

async function readArtifact(root, artifact) {
  const absolute = path.isAbsolute(artifact) ? artifact : path.resolve(root, artifact);
  return {
    absolute,
    input: JSON.parse(await readFile(absolute, 'utf8'))
  };
}

async function updateArtifact(root, artifact, mutate) {
  const loaded = await readArtifact(root, artifact);
  mutate(loaded.input);
  await writeFile(loaded.absolute, `${JSON.stringify(loaded.input, null, 2)}\n`);
  return loaded.input;
}

async function adopt(root, artifact) {
  return runCli([
    'judgment', 'input', 'adopt', root,
    '--id', STORY_ID,
    '--input', artifact,
    '--reviewed-by', 'test-agent',
    '--authority', 'boundary-case-fixture',
    '--summary', 'The embedded expert observations are reviewed as advisory context.',
    '--json'
  ], silentIo());
}

async function evaluate(root, inputPath) {
  return runCli([
    'judgment', 'evaluate', root,
    '--id', STORY_ID,
    '--input', inputPath,
    '--json'
  ], silentIo());
}

function expertJudgment(result) {
  const judgment = result.expert_judgment
    ?? result.senior?.expert_judgment
    ?? result.operational?.expert_judgment;
  assert.ok(judgment, 'evaluation should expose the recomputed expert_judgment');
  return judgment;
}

function expertNode(result, nodeId) {
  const node = expertJudgment(result).nodes.find((candidate) => candidate.node_id === nodeId);
  assert.ok(node, `expert node ${nodeId} should be present`);
  return node;
}

function allNextActions(result) {
  return [
    ...(result.next_actions ?? []),
    ...(result.senior?.next_actions ?? []),
    ...(result.operational?.next_actions ?? [])
  ];
}

function invalidExpertInput(base, kind) {
  if (kind === 'null') return null;
  const invalid = structuredClone(base);
  if (kind === 'invalid-kind') {
    invalid.observations[0].kind = 'not-a-catalog-kind';
  } else if (kind === 'case-mismatch') {
    invalid.case_id = 'different-story';
  }
  return invalid;
}

async function makeActionable(root, artifact) {
  return updateArtifact(root, artifact, (input) => {
    input.problem_frame = {
      status: 'valid',
      statement: 'The delivery plan needs an explicit boundary decision.',
      reason: 'The expert judgment must be consumed by the plan without becoming a blocking gate.'
    };
    input.development_cycle.current_constraint = {
      kind: 'value_constraint',
      status: 'verified',
      statement: 'The plan currently has no durable boundary guidance.',
      source_refs: ['index.js'],
      decision_evidence: {
        status: 'sufficient',
        reason: 'The current plan lacks the expert judgment binding.',
        source_refs: ['index.js']
      }
    };
    input.decision_profile = {
      materiality: 'medium',
      reversibility: 'easy',
      blast_radius: 'local'
    };
    input.options = [{
      id: 'option-bind-expert-judgment',
      summary: 'Bind the advisory boundary judgment to the generated plan.',
      action: 'fix',
      addresses: [],
      violates: [],
      residual_risk: 'low'
    }];
  });
}

test('CLI preserves external observations through adoption and recomputes a tampered expert cache', async () => {
  const root = await setupRepo('snapshot');
  await recordApplicability(root);
  const external = await writeExpertInput(root, 'snapshot');

  const prepared = await prepare(root, 'expert-snapshot-run', external.path);
  assert.equal(prepared.exitCode, 0);
  assert.deepEqual(prepared.result.input.expert_input, external.input);
  assert.equal(prepared.result.expert_judgment.case_id, STORY_ID);
  assert.equal(prepared.result.expert_judgment.nodes.length, 8);

  const changedExternal = structuredClone(external.input);
  changedExternal.observations[0].value = !changedExternal.observations[0].value;
  await writeFile(external.path, `${JSON.stringify(changedExternal, null, 2)}\n`);

  await updateArtifact(root, prepared.result.artifact, (draft) => {
    assert.deepEqual(draft.expert_input, external.input);
    draft.expert_judgment = structuredClone(prepared.result.expert_judgment);
    draft.expert_judgment.nodes[0].finding = 'tampered cache must not be trusted';
  });

  const adopted = await adopt(root, prepared.result.artifact);
  assert.equal(adopted.exitCode, 0);
  const evaluated = await evaluate(root, adopted.result.adoption.adopted_input);
  assert.equal(evaluated.exitCode, 0);

  const judgment = expertJudgment(evaluated.result);
  const adoptedInput = await readArtifact(root, adopted.result.adoption.adopted_input);
  assert.deepEqual(adoptedInput.input.expert_input.observations, external.input.observations);
  assert.notEqual(judgment.nodes[0].finding, 'tampered cache must not be trusted');
  assert.ok(allNextActions(evaluated.result).some((action) => (
    action && typeof action === 'object' && action.type === 'review_expert_judgment'
  )));
});

test('expert judgment is compiled into eight development nodes with ten dependencies and preserves upstream unknowns', async () => {
  const root = await setupRepo('dag');
  await recordApplicability(root);
  const external = await writeExpertInput(root, 'dag');
  const prepared = await prepare(root, 'expert-dag-run', external.path);
  assert.equal(prepared.exitCode, 0);
  const adopted = await adopt(root, prepared.result.artifact);
  assert.equal(adopted.exitCode, 0);
  const evaluated = await evaluate(root, adopted.result.adoption.adopted_input);
  assert.equal(evaluated.exitCode, 0);

  const dag = evaluated.result.development_judgment.dag;
  const expertDagNodes = dag.nodes.filter((node) => node.id?.startsWith('expert:'));
  assert.equal(expertDagNodes.length, 8);
  assert.deepEqual(
    expertDagNodes.map((node) => node.id),
    [
      'expert:outcome-scope',
      'expert:decision-authority',
      'expert:change-ownership',
      'expert:information-boundary',
      'expert:execution-boundary',
      'expert:structural-simplification',
      'expert:runtime-reachability',
      'expert:evidence-decision-value'
    ]
  );
  assert.ok(expertDagNodes.every((node) => node.status === 'proposed'));
  assert.ok(expertDagNodes.every((node) => (
    node.context_snapshot
    && typeof node.context_snapshot === 'object'
    && 'unknowns' in node.context_snapshot
    && 'adoption_status' in node.context_snapshot
    && 'next_checks' in node.context_snapshot
  )));

  const expectedEdges = [
    ['outcome-scope', 'decision-authority'],
    ['outcome-scope', 'change-ownership'],
    ['decision-authority', 'information-boundary'],
    ['change-ownership', 'execution-boundary'],
    ['information-boundary', 'execution-boundary'],
    ['change-ownership', 'structural-simplification'],
    ['execution-boundary', 'runtime-reachability'],
    ['structural-simplification', 'runtime-reachability'],
    ['outcome-scope', 'evidence-decision-value'],
    ['runtime-reachability', 'evidence-decision-value']
  ];
  const edgeKeys = new Set(dag.edges.map((edge) => `${edge.from}->${edge.to}`));
  for (const [from, to] of expectedEdges) {
    assert.ok(edgeKeys.has(`expert:${from}->expert:${to}`), `missing expert edge ${from} -> ${to}`);
  }
  assert.ok(edgeKeys.has('goal_contract->problem_frame'));
  assert.ok(edgeKeys.has('problem_frame->development_mode'));

  const unknownRoot = await setupRepo('upstream-unknown');
  await recordApplicability(unknownRoot);
  const unknownExternal = await writeExpertInput(unknownRoot, 'upstream-unknown', (input) => {
    const observation = input.observations.find((item) => item.kind === 'owner_value_choice_required');
    observation.source_refs = [];
  });
  const unknownPrepared = await prepare(unknownRoot, 'expert-upstream-unknown-run', unknownExternal.path);
  assert.equal(unknownPrepared.exitCode, 0);
  const unknownAdopted = await adopt(unknownRoot, unknownPrepared.result.artifact);
  assert.equal(unknownAdopted.exitCode, 0);
  const unknownEvaluated = await evaluate(unknownRoot, unknownAdopted.result.adoption.adopted_input);
  assert.equal(unknownEvaluated.exitCode, 0);

  assert.equal(expertNode(unknownEvaluated.result, 'decision-authority').status, 'insufficient');
  assert.ok(unknownEvaluated.result.operational.expert_unresolved_node_count > 0);
  assert.ok(unknownEvaluated.result.development_judgment.dag.expert_unresolved_node_count > 0);
  const downstream = expertNode(unknownEvaluated.result, 'information-boundary');
  assert.ok(downstream.upstream_unknowns.some((item) => item.node_id === 'decision-authority'));
  const finalNode = expertNode(unknownEvaluated.result, 'evidence-decision-value');
  assert.ok(finalNode.upstream_unknowns.some((item) => item.node_id === 'decision-authority'));
});

test('invalid expert kind, null input, and case mismatch are rejected at prepare, adoption, and senior evaluation', async () => {
  const invalidKinds = ['invalid-kind', 'null', 'case-mismatch'];

  for (const invalidKind of invalidKinds) {
    const root = await setupRepo(`prepare-${invalidKind}`);
    await recordApplicability(root);
    const valid = await readFixture();
    valid.case_id = STORY_ID;
    const invalidPath = await writeJson(root, `prepare-${invalidKind}`, invalidExpertInput(valid, invalidKind));
    const captured = capturingIo();
    const result = await runCli([
      'judgment', 'prepare', root,
      '--id', STORY_ID,
      '--run-id', `expert-invalid-prepare-${invalidKind}`,
      '--expert-input', invalidPath,
      '--json'
    ], captured.io);
    assert.notEqual(result.exitCode, 0, `${invalidKind} should be rejected by prepare`);
    assert.ok(captured.stderrText() || result.error, `${invalidKind} should report a prepare error`);
  }

  for (const invalidKind of invalidKinds) {
    const root = await setupRepo(`adopt-${invalidKind}`);
    await recordApplicability(root);
    const valid = await writeExpertInput(root, `adopt-${invalidKind}`);
    const prepared = await prepare(root, `expert-invalid-adopt-${invalidKind}`, valid.path);
    assert.equal(prepared.exitCode, 0);
    const invalid = invalidExpertInput(valid.input, invalidKind);
    await updateArtifact(root, prepared.result.artifact, (draft) => {
      draft.expert_input = invalid;
    });
    const captured = capturingIo();
    const result = await runCli([
      'judgment', 'input', 'adopt', root,
      '--id', STORY_ID,
      '--input', prepared.result.artifact,
      '--reviewed-by', 'test-agent',
      '--authority', 'boundary-case-fixture',
      '--summary', 'Invalid input must not become an adopted judgment.',
      '--json'
    ], captured.io);
    assert.notEqual(result.exitCode, 0, `${invalidKind} should be rejected by adopt`);
    assert.ok(captured.stderrText() || result.error, `${invalidKind} should report an adopt error`);
  }

  for (const invalidKind of invalidKinds) {
    const root = await setupRepo(`evaluate-${invalidKind}`);
    await recordApplicability(root);
    const valid = await writeExpertInput(root, `evaluate-${invalidKind}`);
    const prepared = await prepare(root, `expert-invalid-evaluate-${invalidKind}`, valid.path);
    assert.equal(prepared.exitCode, 0);
    await updateArtifact(root, prepared.result.artifact, (draft) => {
      draft.expert_input = invalidExpertInput(valid.input, invalidKind);
    });
    const loaded = await readArtifact(root, prepared.result.artifact);
    await assert.rejects(
      () => evaluateJudgmentWorkflow(root, {
        storyId: STORY_ID,
        inputPath: loaded.absolute
      }),
      `${invalidKind} should be rejected by senior evaluation`
    );
  }
});

test('legacy judgment keeps its five-node DAG and mode/recommendation when no expert input is supplied', async () => {
  const legacyRoot = await setupRepo('legacy');
  await recordApplicability(legacyRoot);
  const legacyPrepared = await prepare(legacyRoot, 'legacy-judgment-run');
  assert.equal(legacyPrepared.exitCode, 0);
  assert.equal(legacyPrepared.result.input.expert_input, undefined);
  assert.equal(legacyPrepared.result.expert_judgment, undefined);
  const legacyAdopted = await adopt(legacyRoot, legacyPrepared.result.artifact);
  assert.equal(legacyAdopted.exitCode, 0);
  const legacyEvaluated = await evaluate(legacyRoot, legacyAdopted.result.adoption.adopted_input);
  assert.equal(legacyEvaluated.exitCode, 0);

  assert.deepEqual(
    legacyEvaluated.result.development_judgment.dag.nodes.map((node) => node.id),
    ['goal_contract', 'problem_frame', 'development_mode', 'option_pruning', 'recommendation']
  );
  assert.equal(legacyEvaluated.result.expert_judgment, undefined);

  const expertRoot = await setupRepo('compatibility');
  await recordApplicability(expertRoot);
  const expertInput = await writeExpertInput(expertRoot, 'compatibility');
  const expertPrepared = await prepare(expertRoot, 'expert-compatibility-run', expertInput.path);
  assert.equal(expertPrepared.exitCode, 0);
  const expertAdopted = await adopt(expertRoot, expertPrepared.result.artifact);
  assert.equal(expertAdopted.exitCode, 0);
  const expertEvaluated = await evaluate(expertRoot, expertAdopted.result.adoption.adopted_input);
  assert.equal(expertEvaluated.exitCode, 0);
  assert.equal(expertEvaluated.result.operational.actionable, false);

  assert.equal(
    expertEvaluated.result.senior.development_mode,
    legacyEvaluated.result.senior.development_mode
  );
  assert.equal(
    expertEvaluated.result.senior.recommendation,
    legacyEvaluated.result.senior.recommendation
  );
});

test('operational plan acceptance carries expert node, adoption status, and next checks', async () => {
  const root = await setupRepo('plan-acceptance');
  await recordApplicability(root);
  const external = await writeExpertInput(root, 'plan-acceptance');
  const prepared = await prepare(root, 'expert-plan-acceptance-run', external.path);
  assert.equal(prepared.exitCode, 0);
  await makeActionable(root, prepared.result.artifact);
  const adopted = await adopt(root, prepared.result.artifact);
  assert.equal(adopted.exitCode, 0);
  const evaluated = await evaluate(root, adopted.result.adoption.adopted_input);
  assert.equal(evaluated.exitCode, 0);

  const planned = await runCli(['story', 'plan', root, '--json'], silentIo());
  assert.equal(planned.exitCode, 0, JSON.stringify(planned));
  const task = planned.result.plan.task_candidates.find((candidate) => candidate.source_type === 'development_judgment');
  assert.ok(task, 'the operational plan should contain the judgment guidance task');
  const acceptance = (task.acceptance ?? []).join('\n');
  assert.match(acceptance, /expert:outcome-scope|outcome-scope/);
  assert.match(acceptance, /adoption_status|採択|採用/);
  assert.match(acceptance, /next_checks|次の確認/);
});
