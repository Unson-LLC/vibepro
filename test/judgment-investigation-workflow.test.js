import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { advanceJudgmentInvestigation } from '../src/judgment-investigation.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-judgment-investigation-workflow';

function silentIo() {
  return {
    stdout: { write() {} },
    stderr: { write() {} }
  };
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-judgment-investigation-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await writeFile(path.join(root, 'index.js'), 'export const value = 1;\n');
  await execFileAsync('git', ['add', 'index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'initialize repository'], { cwd: root });
  const initialized = await runCli([
    'init', root,
    '--story-id', STORY_ID,
    '--title', 'Carry investigation questions into the development plan'
  ], silentIo());
  assert.equal(initialized.exitCode, 0);
  await writeCatalog(root);
  await writeFile(path.join(root, 'index.js'), 'export const value = 2;\n');
  return root;
}

async function writeCatalog(root) {
  const directory = path.join(root, '.vibepro', 'stories');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'story-catalog.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    story_count: 1,
    source: { warnings: [], run_id: null },
    coverage: { status: 'ok', totals: { coverage_ratio: 1, uncovered_files: 0 }, uncovered: [] },
    open_questions: [],
    stories: [{
      story_id: STORY_ID,
      title: 'Carry investigation questions into the development plan',
      category: 'product',
      view: 'dev',
      horizon: null,
      period: null,
      source: { type: 'manual', paths: [] },
      derived: {
        confidence: 'high',
        open_questions: [],
        story_contract: null,
        story_definition: { acceptance_focus: ['Investigation questions remain visible in the plan'] },
        meaning: {
          confidence: 'high',
          workflow_position: { stage: 'decision' },
          evidence_by_type: { docs_evidence: [], code_evidence: [] },
          code_scope: { evidence: [] },
          counter_evidence: []
        }
      }
    }]
  }, null, 2)}\n`);
}

async function createInvestigationResult(root) {
  const request = {
    schema_version: '0.1.0',
    case_id: STORY_ID,
    goal: 'Choose the smallest safe change for the current delivery boundary.',
    scope: { files: ['index.js'] },
    constraints: ['Keep the public export contract stable.']
  };
  const initial = await advanceJudgmentInvestigation(root, request, {
    collectEvidence: async (_repoRoot, evidenceRequest) => ({
      provider: evidenceRequest.provider,
      status: 'available',
      content: 'The fixture graph contains the current export boundary.',
      source_refs: ['fixture:graph/index.js']
    })
  });
  const analyzed = await advanceJudgmentInvestigation(root, initial, {
    response: {
      context_id: initial.context_id,
      questions: [{
        id: 'question-boundary-contract',
        text: 'Which runtime contract would change if this boundary moved?',
        path_id: null,
        status: 'open',
        finding: 'The available structure does not establish the runtime contract.',
        evidence_ids: []
      }],
      observations: [],
      options: [{
        id: 'option-keep-boundary',
        description: 'Keep the boundary local until the runtime contract is verified.',
        tradeoffs: ['A follow-up investigation remains necessary.'],
        question_ids: ['question-boundary-contract'],
        evidence_ids: []
      }],
      recommendation: null,
      unknowns: [],
      requests: []
    }
  });
  // This forged cache is intentionally accepted as input to prepare.  The
  // validator must recompute it back to needs_evidence from the open question.
  analyzed.status = 'candidate_ready';
  return analyzed;
}

async function makeActionableInput(root, artifact) {
  const inputPath = path.join(root, artifact);
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  input.problem_frame = {
    status: 'valid',
    statement: 'The delivery boundary is not yet tied to a verified runtime contract.',
    reason: 'The investigation has identified an open contract question that changes the placement choice.'
  };
  input.development_cycle.current_constraint = {
    kind: 'value_constraint',
    status: 'verified',
    statement: 'The plan must preserve the public export boundary while the contract is checked.',
    source_refs: ['index.js'],
    decision_evidence: {
      status: 'sufficient',
      reason: 'The current change is local and the remaining question is carried as an advisory plan item.',
      source_refs: ['index.js']
    }
  };
  input.decision_profile = {
    materiality: 'medium',
    reversibility: 'easy',
    blast_radius: 'local'
  };
  input.options = [{
    id: 'option-bind-investigation',
    summary: 'Keep the local boundary and bind the unresolved contract question to the plan.',
    action: 'fix',
    addresses: [],
    violates: [],
    residual_risk: 'low'
  }];
  // A caller-supplied context/status and an old expert input are stale caches.
  // Senior validation must rebuild both from investigation_input.
  input.investigation_context = { status: 'candidate_ready', questions: [] };
  input.expert_input = {
    schema_version: '0.1.0',
    case_id: STORY_ID,
    observations: [{
      id: 'stale-observation',
      kind: 'delivery_outcome_defined',
      value: true,
      source_refs: ['stale-cache']
    }],
    decision_paths: []
  };
  await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  return inputPath;
}

test('investigation survives prepare, adoption, evaluation, and plan consumption with forged caches ignored', async () => {
  const root = await setupRepo();
  const investigationPath = path.join(root, 'investigation.json');
  const investigation = await createInvestigationResult(root);
  await writeFile(investigationPath, `${JSON.stringify(investigation, null, 2)}\n`);

  const applicability = await runCli([
    'judgment', 'applicability', 'record', root,
    '--id', STORY_ID,
    '--applicable', 'yes',
    '--reason', 'The contract boundary still has a meaningful engineering choice.',
    '--recorded-by', 'test-agent',
    '--json'
  ], silentIo());
  assert.equal(applicability.exitCode, 0);

  const prepared = await runCli([
    'judgment', 'prepare', root,
    '--id', STORY_ID,
    '--run-id', 'judgment-investigation-run-1',
    '--investigation', investigationPath,
    '--json'
  ], silentIo());
  assert.equal(prepared.exitCode, 0);
  assert.equal(prepared.result.input.investigation_input.status, 'needs_evidence');
  assert.equal(prepared.result.input.investigation_context.questions.length, 1);
  assert.equal(prepared.result.input.investigation_context.questions[0].id, 'question-boundary-contract');

  const actionableInput = await makeActionableInput(root, prepared.result.artifact);
  const adopted = await runCli([
    'judgment', 'input', 'adopt', root,
    '--id', STORY_ID,
    '--input', actionableInput,
    '--reviewed-by', 'test-agent',
    '--authority', 'story-and-repository-evidence',
    '--summary', 'Reviewed the frame and retained the investigation question as advisory context.',
    '--json'
  ], silentIo());
  assert.equal(adopted.exitCode, 0);

  const evaluated = await runCli([
    'judgment', 'evaluate', root,
    '--id', STORY_ID,
    '--input', adopted.result.adoption.adopted_input,
    '--json'
  ], silentIo());
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.result.operational.actionable, true);
  assert.equal(evaluated.result.operational.investigation_unresolved_count, 1);
  assert.equal(evaluated.result.senior.investigation_input.status, 'needs_evidence');
  assert.equal(evaluated.result.senior.investigation_context.status, 'needs_evidence');
  assert.ok(evaluated.result.senior.investigation_unresolved_questions.some(
    (question) => question.id === 'question-boundary-contract'
  ));
  assert.equal(evaluated.result.senior.expert_input, undefined);

  const planned = await runCli(['story', 'plan', root, '--json'], silentIo());
  assert.equal(planned.exitCode, 0);
  assert.equal(planned.result.plan.development_judgment.status, 'applied');
  assert.equal(planned.result.plan.development_judgment.investigation_unresolved_count, 1);
  assert.ok(planned.result.plan.questions.some(
    (question) => question.field === 'judgment_investigation_open_question'
      && question.question.includes('Which runtime contract')
  ));
  assert.ok(planned.result.plan.task_candidates.some((task) => (
    task.source_type === 'development_judgment'
      && task.acceptance.some((criterion) => criterion.includes('Which runtime contract'))
  )));
});
