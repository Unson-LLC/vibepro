import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-design-input-judgment';
const SCENARIO_S001 = 'Given the VibePro workflow state is Story selected, when an agent runs story diagnose --pre-architecture, then the workflow state transitions to design_input and the manifest run plus evidence file record phase=design_input.';
const SCENARIO_S002 = 'Given the VibePro workflow status is Architecture/Spec and implementation files changed without design-input diagnosis, when PR prepare runs, then gate:design_input_judgment is needs_review and required=false.';
const SCENARIO_S003 = 'Given the VibePro workflow state already has design-input diagnosis for the Story, when PR prepare builds the Gate DAG, then gate:design_input_judgment transitions to passed.';
const SCENARIO_S004 = 'Given Story plan or repo status has no prior workflow run, when next commands are shown, then the first diagnosis command includes --pre-architecture.';
const SCENARIO_S005 = 'Given a workflow-heavy Story, when Architecture/Spec are prepared, then design-input diagnosis evidence is available before implementation and pre-implementation diagnosis remains a separate final workflow consistency check.';
const SCENARIO_S006 = 'Given diagnosis or PR prepare workflow evidence is replayed, when artifacts are inspected, then design_input_judgment and pre_implementation_judgment are not collapsed into one generic Engineering Judgment record.';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-design-input-e2e-'));
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'workflow.js'), 'export function workflowGate(){ return "ready"; }\n');
  await writeGraphifyOut(repo);
  await runCli(['init', repo, '--story-id', STORY_ID, '--title', 'Design input judgment', '--language', 'ja']);
  return repo;
}

async function makeGitRepo() {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init design input e2e fixture']);
  await git(repo, ['switch', '-c', 'feature/design-input-e2e']);
  return repo;
}

async function writeGraphifyOut(repo) {
  await mkdir(path.join(repo, 'graphify-out'), { recursive: true });
  await writeFile(path.join(repo, 'graphify-out', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'src/workflow.js', source_file: 'src/workflow.js', community: 'workflow' },
      { id: `docs/management/stories/active/${STORY_ID}.md`, source_file: `docs/management/stories/active/${STORY_ID}.md`, community: 'workflow' }
    ],
    links: [
      { source: 'src/workflow.js', target: `docs/management/stories/active/${STORY_ID}.md` }
    ]
  }, null, 2));
  await writeFile(path.join(repo, 'graphify-out', 'GRAPH_REPORT.md'), '# Graphify Report\n');
}

async function writeStoryPlanGraph(repo) {
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'workflow-source', source_file: 'src/workflow.js', community: 'design-input' },
      { id: 'workflow-helper', source_file: 'src/workflow-helper.js', community: 'design-input' }
    ],
    edges: [
      { source: 'workflow-source', target: 'workflow-helper' }
    ]
  }, null, 2));
}

async function writeCrossSurfaceDesignChange(repo) {
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: Design input judgment
architecture_docs:
  - docs/architecture/design-input-judgment.md
spec_docs:
  - docs/specs/design-input-judgment.md
---

# Design input judgment

## Background

Workflow-heavy Architecture and Spec should be informed by diagnosis before implementation.

## Acceptance Criteria

- [ ] Design-input diagnosis is visible before Architecture and Spec are treated as settled
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'design-input-judgment.md'), '# Design Input Architecture\n\nThe workflow gate records early judgment evidence.\n');
  await writeFile(path.join(repo, 'docs', 'specs', 'design-input-judgment.md'), '# Design Input Spec\n\n- The diagnosis phase is recorded.\n');
  await writeFile(path.join(repo, 'src', 'workflow.js'), 'export function workflowGate(){ return "design-input"; }\n');
}

function findGate(prepare, id) {
  return prepare.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

test('DIJ-SCENARIO-004 status and story plan point first-run stories to pre-architecture diagnosis', async () => {
  const repo = await makeRepo();
  const statusResult = await runCli(['status', repo, '--json']);
  assert.equal(statusResult.exitCode, 0);
  assert.equal(statusResult.status.next_commands.some((command) => command.includes(`story diagnose ${repo} --id ${STORY_ID} --pre-architecture --run-graphify`)), true, `${STORY_ID} S-004 ${SCENARIO_S004}`);

  await writeStoryPlanGraph(repo);
  await runCli(['story', 'derive', repo]);
  const planResult = await runCli(['story', 'plan', repo, '--limit', '2', '--json']);
  assert.equal(planResult.exitCode, 0);
  assert.equal(planResult.result.plan.next_commands.some((command) => command.includes('story diagnose . --id') && command.includes('--pre-architecture --run-graphify')), true, `${STORY_ID} S-004 ${SCENARIO_S004}`);
});

test('DIJ-SCENARIO-001 design-input diagnosis writes phase-specific manifest and evidence artifacts', async () => {
  const repo = await makeRepo();
  const result = await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', '001-design-input', '--pre-architecture']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.diagnosis.run.phase, 'design_input', `${STORY_ID} S-001 ${SCENARIO_S001}`);
  assert.equal(result.result.diagnosis.run.design_input_judgment.phase, 'design_input');

  const evidence = JSON.parse(await readFile(path.join(repo, '.vibepro', 'diagnostics', '001-design-input', 'evidence.json'), 'utf8'));
  assert.equal(evidence.diagnosis_phase.phase, 'design_input');
  assert.equal(evidence.design_input_judgment.phase, 'design_input', `${STORY_ID} S-001 ${SCENARIO_S001}`);
  assert.deepEqual(evidence.design_input_judgment.feeds, ['architecture', 'spec', 'implementation_plan']);
});

test('DIJ-SCENARIO-002 DIJ-SCENARIO-003 DIJ-SCENARIO-006 pr prepare separates design-input and pre-implementation judgment artifacts', async () => {
  const repo = await makeGitRepo();
  await writeCrossSurfaceDesignChange(repo);
  await git(repo, ['add', 'docs/management/stories/active', 'docs/architecture', 'docs/specs', 'src/workflow.js']);
  await git(repo, ['commit', '-m', 'feat: add cross-surface design input flow']);

  const missing = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json']);
  assert.equal(missing.exitCode, 0);
  assert.equal(missing.result.preparation.pr_context.design_input_judgment.status, 'missing');
  const missingGate = findGate(missing.result.preparation, 'gate:design_input_judgment');
  assert.equal(missingGate.status, 'needs_review', `${STORY_ID} S-002 ${SCENARIO_S002}`);
  assert.equal(missingGate.required, false, `${STORY_ID} S-002 ${SCENARIO_S002}`);

  await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', '001-design-input', '--pre-architecture']);
  await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', '002-pre-implementation']);
  const prepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json']);
  assert.equal(prepare.exitCode, 0);
  assert.equal(prepare.result.preparation.pr_context.design_input_judgment.status, 'present', `${STORY_ID} S-005 ${SCENARIO_S005}`);
  assert.equal(prepare.result.preparation.pr_context.design_input_judgment.artifact_status, 'present', `${STORY_ID} S-005 ${SCENARIO_S005}`);
  assert.equal(prepare.result.preparation.pr_context.design_input_judgment.run_id, '001-design-input', `${STORY_ID} S-006 ${SCENARIO_S006}`);
  assert.equal(prepare.result.preparation.pr_context.pre_implementation_judgment.phase, 'pre_implementation', `${STORY_ID} S-006 ${SCENARIO_S006}`);

  const passedGate = findGate(prepare.result.preparation, 'gate:design_input_judgment');
  assert.equal(passedGate.status, 'passed', `${STORY_ID} S-003 ${SCENARIO_S003}`);
  const gateIds = prepare.result.preparation.pr_context.gate_dag.nodes.map((node) => node.id);
  assert.equal(gateIds.indexOf('gate:design_input_judgment') > gateIds.indexOf('gate:story_source_integrity'), true, `${STORY_ID} S-003 ${SCENARIO_S003}`);
  assert.equal(gateIds.indexOf('gate:design_input_judgment') < gateIds.indexOf('gate:engineering_judgment_route'), true, `${STORY_ID} S-003 ${SCENARIO_S003}`);
});
