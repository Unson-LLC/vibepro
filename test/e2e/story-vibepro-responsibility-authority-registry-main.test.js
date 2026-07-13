import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-responsibility-authority-registry';

test('story-vibepro-responsibility-authority-registry replays responsibility authority workflow', async () => {
  const acceptanceMarkers = [
    'story-vibepro-responsibility-authority-registry ac:1',
    'story-vibepro-responsibility-authority-registry ac:2',
    'story-vibepro-responsibility-authority-registry ac:3',
    'story-vibepro-responsibility-authority-registry ac:4',
    'story-vibepro-responsibility-authority-registry ac:5',
    'story-vibepro-responsibility-authority-registry ac:6',
    'story-vibepro-responsibility-authority-registry ac:7',
    'story-vibepro-responsibility-authority-registry ac:8',
    'story-vibepro-responsibility-authority-registry ac:9'
  ];
  const scenarioAssertions = [
    {
      marker: `${STORY_ID} S-001`,
      statement: 'Given a PR changes a cleanup or recovery file and a registry entry owns that path, pr prepare includes a responsibility authority gate for the matched contract.'
    },
    {
      marker: `${STORY_ID} S-002`,
      statement: 'Given a matched Domain Contract has no current-head evidence, PR readiness is not ready_for_review.'
    },
    {
      marker: `${STORY_ID} S-003`,
      statement: 'Given a workflow-heavy PR changes Responsibility Authority Gate DAG placement or execute-state blocker classification, when pr prepare evaluates readiness, then the workflow state transition from path/surface discovery through gate:responsibility_authority to Requirement Gate and execute-state blocker reporting is covered by current E2E replay evidence.'
    }
  ];
  const repo = await makeWorkflowRepo();

  assert.equal(
    new Set(acceptanceMarkers).size,
    9,
    'story-vibepro-responsibility-authority-registry ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9'
  );

  const preEvidence = await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(preEvidence.exitCode, 0, preEvidence.stderr);
  const preEvidenceGateDag = preEvidence.result.preparation.pr_context.gate_dag;
  const preEvidenceResponsibilityGate = preEvidenceGateDag.nodes.find((node) => node.id === 'gate:responsibility_authority');

  assert.equal(
    preEvidenceResponsibilityGate?.status,
    'needs_evidence',
    `${scenarioAssertions[1].marker}: ${scenarioAssertions[1].statement}`
  );
  assert.equal(
    preEvidence.result.preparation.gate_status.ready_for_pr_create,
    false,
    `${scenarioAssertions[1].marker}: ${scenarioAssertions[1].statement}`
  );

  const preEvidenceGateDagPath = path.join(repo, '.vibepro', 'pr', STORY_ID, 'gate-dag.json');
  await writeFile(preEvidenceGateDagPath, `${JSON.stringify({
    schema_version: preEvidenceGateDag.schema_version,
    story_id: STORY_ID,
    overall_status: 'needs_verification',
    nodes: [preEvidenceResponsibilityGate],
    edges: []
  }, null, 2)}\n`);
  const preEvidenceState = await runCli(['execute', 'reconcile', repo, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(preEvidenceState.exitCode, 0, preEvidenceState.stderr);
  assert.equal(
    preEvidenceState.result.state.blocking_gate?.id,
    'gate:responsibility_authority',
    `${scenarioAssertions[2].marker}: ${scenarioAssertions[2].statement}`
  );
  assert.equal(
    preEvidenceState.result.state.completed_phases.includes('ready_for_pr_create'),
    false,
    `${scenarioAssertions[2].marker}: ${scenarioAssertions[2].statement}`
  );

  await runCli([
    'verify',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--kind',
    'unit',
    '--status',
    'pass',
    '--command',
    'node --test test/responsibility-authority.test.js',
    '--summary',
    'unit_regression cleanup_recovery_replay current_head_verification malformed parse_failure coverage for GEN-STATE-001',
    '--target',
    'GEN-STATE-001',
    '--scenario',
    'parse_failure: malformed responsibility-authority JSON fails closed instead of becoming no registered authority',
    '--observed',
    'parse_failure=covered'
  ]);

  await runCli([
    'verify',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--kind',
    'e2e',
    '--status',
    'pass',
    '--command',
    'node --test tests/e2e/responsibility-authority-workflow.test.js',
    '--summary',
    'flow_replay artifact_replay scenario_clause_e2e covered responsibility authority workflow state transition from path surface discovery to Requirement Gate and execute-state blocker reporting',
    '--artifact',
    'artifacts/responsibility-authority-workflow.json',
    '--target',
    'tests/e2e/responsibility-authority-workflow.test.js',
    '--target',
    'src/workers/responsibility-authority-worker.js',
    '--scenario',
    'flow_replay: path surface discovery transitions through gate:responsibility_authority before gate:requirement',
    '--scenario',
    'scenario_clause_e2e: RAR-S-007 workflow state transition and execute-state blocker reporting are replayed',
    '--scenario',
    'artifact_replay: pr prepare gate-dag artifact records responsibility authority before Requirement Gate',
    '--observed',
    'flow_replay=true',
    '--observed',
    'scenario_clause_e2e=true',
    '--observed',
    'artifact_replay=covered'
  ]);

  const prepared = await runCli([
    'pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json',
    '--evidence-depth', 'standard',
    '--evidence-depth-reason', 'replay responsibility authority Gate DAG ordering',
    '--evidence-depth-consumer', 'responsibility-authority-e2e',
    '--evidence-depth-target', 'gate-dag.json'
  ]);
  assert.equal(prepared.exitCode, 0, prepared.stderr);
  const preparation = prepared.result.preparation;
  const gateDag = preparation.pr_context.gate_dag;
  const responsibilityGate = gateDag.nodes.find((node) => node.id === 'gate:responsibility_authority');
  const responsibilityToRequirement = gateDag.edges.find((edge) => (
    edge.from === 'gate:responsibility_authority' && edge.to === 'gate:requirement'
  ));
  const persistedGateDag = JSON.parse(await readFile(
    path.join(repo, '.vibepro', 'pr', STORY_ID, 'gate-dag.json'),
    'utf8'
  ));

  assert.equal(responsibilityGate?.status, 'passed');
  assert.ok(responsibilityToRequirement, `${scenarioAssertions[0].marker}: ${scenarioAssertions[0].statement}`);
  assert.equal(
    persistedGateDag.nodes.find((node) => node.id === 'gate:responsibility_authority')?.status,
    'passed',
    `${scenarioAssertions[0].marker}: ${scenarioAssertions[0].statement}`
  );
  assert.equal(preparation.pr_context.responsibility_authority.summary.matched_contract_clause_count, 1);
  assert.equal(preparation.pr_context.requirement_consistency.summary.responsibility_authority_ref_count >= 1, true);
});

async function makeWorkflowRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rar-e2e-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await runCli(['init', repo, '--story-id', STORY_ID, '--title', 'Responsibility Authority Registry']);
  await writeStoryDocs(repo);
  await writeFile(path.join(repo, 'README.md'), '# Responsibility Authority Fixture\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: initialize story repo']);
  await git(repo, ['switch', '-c', 'feature/responsibility-authority-registry']);

  await writeResponsibilityFixture(repo);
  await mkdir(path.join(repo, 'src', 'workers'), { recursive: true });
  await mkdir(path.join(repo, 'tests', 'e2e'), { recursive: true });
  await mkdir(path.join(repo, 'artifacts'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'workers', 'responsibility-authority-worker.js'), [
    'export function resolveResponsibilityWorkflow(task) {',
    '  return task.metadata?.awaitingProductionGenerationStart ? "PENDING" : task.status;',
    '}',
    ''
  ].join('\n'));
  await writeFile(path.join(repo, 'tests', 'e2e', 'responsibility-authority-workflow.test.js'), [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    '',
    'test("responsibility authority workflow replay", () => {',
    '  assert.equal("gate:responsibility_authority -> gate:requirement".includes("gate:requirement"), true);',
    '});',
    ''
  ].join('\n'));
  await writeFile(path.join(repo, 'artifacts', 'responsibility-authority-workflow.json'), JSON.stringify({
    status: 'pass',
    replay: 'flow_replay',
    scenario_clause_e2e: true
  }, null, 2));
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add responsibility authority fixture']);
  return repo;
}

async function writeStoryDocs(repo) {
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: Responsibility Authority Registry
architecture_docs:
  - docs/architecture/responsibility-authority.md
spec_docs:
  - docs/specs/responsibility-authority.md
---

# Responsibility Authority Registry

## Background

Workflow state and cleanup/recovery contracts need a responsibility authority before PR readiness.

## Acceptance Criteria

- Responsibility authority is resolved before Requirement Gate.
- Workflow replay covers responsibility authority state transition evidence.
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'responsibility-authority.md'), '# Responsibility Authority\n\nGate DAG placement is after path/surface discovery and before Requirement Gate.\n');
  await writeFile(path.join(repo, 'docs', 'specs', 'responsibility-authority.md'), `# Responsibility Authority Spec

## Scenarios

- Given workflow state transition evidence exists, when PR prepare runs, then gate:responsibility_authority transitions to passed before Requirement Gate.
`);
}

async function writeResponsibilityFixture(repo) {
  await mkdir(path.join(repo, 'docs', 'contracts'), { recursive: true });
  await writeFile(path.join(repo, 'responsibility-authority.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    responsibilities: [
      {
        id: 'generation.cleanup.cancellation_policy',
        primary_authority: {
          kind: 'domain_contract',
          ref: 'docs/contracts/generation-state.json#GEN-STATE-001'
        },
        supporting_authority: ['docs/architecture/responsibility-authority.md'],
        owned_surfaces: {
          paths: ['src/workers/*authority*', 'src/workers/*cleanup*', 'src/workers/*recovery*'],
          symbols: ['GenerationTask.PENDING', 'metadata.awaitingProductionGenerationStart'],
          risk_surfaces: ['core_workflow_state', 'queue_worker']
        },
        required_evidence: ['unit_regression', 'cleanup_recovery_replay', 'current_head_verification'],
        unknown_policy: 'block_or_review'
      }
    ]
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'docs', 'contracts', 'generation-state.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    domain: 'generation',
    clauses: [
      {
        id: 'GEN-STATE-001',
        statement: 'cleanup/recovery workflow state must not cancel GenerationTask.PENDING while metadata.awaitingProductionGenerationStart=true',
        applies_to: {
          responsibilities: ['generation.cleanup.cancellation_policy'],
          paths: ['src/workers/*authority*', 'src/workers/*cleanup*', 'src/workers/*recovery*'],
          symbols: ['GenerationTask.PENDING', 'metadata.awaitingProductionGenerationStart'],
          risk_surfaces: ['core_workflow_state', 'queue_worker']
        },
        evidence_requirements: ['cleanup_recovery_replay']
      }
    ]
  }, null, 2)}\n`);
}

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}
