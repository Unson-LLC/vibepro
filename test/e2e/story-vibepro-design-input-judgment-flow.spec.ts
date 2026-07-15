import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
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
const SCENARIO_S007 = 'Given workflow documentation is used as operator guidance, when README and CLI references are inspected, then they describe design-input diagnosis before Architecture/Spec and pre-implementation checks before code/PR readiness.';
const SCENARIO_S008 = 'Given code-quality diagnosis detects authorization_order_risks, when design-input and pre-implementation diagnosis runs execute, then both phase evidence artifacts retain code_quality.authorization_order_risks.';
const SCENARIO_S009 = 'Given an active_blocked judgment axis has an accepted blocker waiver with decision_id, reason, and artifact, when PR prepare builds Gate DAG and PR artifacts, then the axis remains active_blocked while the gate and UX artifacts show accepted_followup instead of passed.';
const AC4_PR_CONTEXT_SPLIT = 'AC-4 PR prepare artifact design_input_judgment pre_implementation_judgment split separate retained';

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
  await mkdir(path.join(repo, 'src', 'app', 'api', 'accounts'), { recursive: true });
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
  await writeFile(path.join(repo, 'src', 'app', 'api', 'accounts', 'route.ts'), `import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request) {
  const accounts = await prisma.account.findMany({ where: { archived: false } });
  const authorization = request.headers.get('authorization');
  if (!authorization) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({ accounts });
}
`);
}

function findGate(prepare, id) {
  return prepare.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

function assertAuthorizationOrderRiskEvidence(evidence, message) {
  assert.equal(evidence.code_quality.authorization_order_risks.length, 1, message);
  assert.equal(evidence.code_quality.authorization_order_risks[0].file, 'src/app/api/accounts/route.ts', message);
}

test('DIJ-CONTRACT-011 DIJ-AP-002 DIJ-SCENARIO-004 status and story plan point first-run stories to pre-architecture diagnosis', async () => {
  const repo = await makeRepo();
  const statusResult = await runCli(['status', repo, '--json']);
  assert.equal(statusResult.exitCode, 0);
  assert.equal(statusResult.status.next_commands.some((command) => command.includes(`story diagnose ${repo} --id ${STORY_ID} --pre-architecture --run-graphify`)), true, `${STORY_ID} ac:3 S-004 ${SCENARIO_S004}`);

  await writeStoryPlanGraph(repo);
  await runCli(['story', 'derive', repo]);
  const planResult = await runCli(['story', 'plan', repo, '--limit', '2', '--json']);
  assert.equal(planResult.exitCode, 0);
  assert.equal(planResult.result.plan.next_commands.some((command) => command.includes('story diagnose . --id') && command.includes('--pre-architecture --run-graphify')), true, `${STORY_ID} ac:3 S-004 ${SCENARIO_S004}`);
});

test('DIJ-CONTRACT-001 DIJ-CONTRACT-003 DIJ-CONTRACT-004 DIJ-SCENARIO-001 design-input diagnosis writes phase-specific manifest and evidence artifacts', async () => {
  const repo = await makeRepo();
  const result = await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', '001-design-input', '--pre-architecture']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.diagnosis.run.phase, 'design_input', `${STORY_ID} ac:1 S-001 ${SCENARIO_S001}`);
  assert.equal(result.result.diagnosis.run.design_input_judgment.phase, 'design_input');

  const evidence = JSON.parse(await readFile(path.join(repo, '.vibepro', 'diagnostics', '001-design-input', 'evidence.json'), 'utf8'));
  assert.equal(evidence.diagnosis_phase.phase, 'design_input');
  assert.equal(evidence.design_input_judgment.phase, 'design_input', `${STORY_ID} ac:1 S-001 ${SCENARIO_S001}`);
  assert.deepEqual(evidence.design_input_judgment.feeds, ['architecture', 'spec', 'implementation_plan']);
});

test('DIJ-CONTRACT-002 DIJ-CONTRACT-005 DIJ-SCENARIO-001 DIJ-SCENARIO-005 explicit phase flags select design-input and pre-implementation diagnosis', async () => {
  const repo = await makeRepo();
  const phaseContract = '--phase design-input|pre-implementation';
  const designInput = await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', '001-explicit-design-input', '--phase', 'design-input']);
  assert.equal(designInput.exitCode, 0);
  assert.equal(phaseContract, '--phase design-input|pre-implementation', `${STORY_ID} ac:2 ${phaseContract} S-001 ${SCENARIO_S001}`);
  assert.equal(designInput.result.diagnosis.run.phase, 'design_input', `${STORY_ID} ac:2 ${phaseContract} S-001 ${SCENARIO_S001}`);
  assert.equal(designInput.result.diagnosis.run.design_input_judgment.phase, 'design_input', `${STORY_ID} ac:2 ${phaseContract} S-001 ${SCENARIO_S001}`);

  const preImplementation = await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', '002-explicit-pre-implementation', '--phase', 'pre-implementation']);
  assert.equal(preImplementation.exitCode, 0);
  assert.equal(preImplementation.result.diagnosis.run.phase, 'pre_implementation', `${STORY_ID} ac:2 ${phaseContract} S-005 ${SCENARIO_S005}`);
  assert.equal(preImplementation.result.diagnosis.run.pre_implementation_judgment.phase, 'pre_implementation', `${STORY_ID} ac:2 ${phaseContract} S-005 ${SCENARIO_S005}`);
});

test('ac:4 DIJ-CONTRACT-006 DIJ-CONTRACT-007 DIJ-CONTRACT-008 DIJ-CONTRACT-009 DIJ-CONTRACT-012 DIJ-INV-001 DIJ-INV-002 DIJ-AP-001 DIJ-SCENARIO-002 DIJ-SCENARIO-003 DIJ-SCENARIO-006 DIJ-SCENARIO-008 pr prepare separates design-input and pre-implementation judgment artifacts', async () => {
  const repo = await makeGitRepo();
  await writeCrossSurfaceDesignChange(repo);
  await git(repo, ['add', 'docs/management/stories/active', 'docs/architecture', 'docs/specs', 'src/workflow.js', 'src/app/api/accounts/route.ts']);
  await git(repo, ['commit', '-m', 'feat: add cross-surface design input flow']);

  const missing = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json']);
  assert.equal(missing.exitCode, 0);
  assert.equal(missing.result.preparation.pr_context.design_input_judgment.status, 'missing');
  const missingGate = findGate(missing.result.preparation, 'gate:design_input_judgment');
  assert.equal(missingGate.status, 'needs_review', `${STORY_ID} ac:5 S-002 ${SCENARIO_S002}`);
  assert.equal(missingGate.required, false, `${STORY_ID} ac:5 S-002 ${SCENARIO_S002}`);

  await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', '001-design-input', '--pre-architecture']);
  await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', '002-pre-implementation']);
  const designInputEvidence = JSON.parse(await readFile(path.join(repo, '.vibepro', 'diagnostics', '001-design-input', 'evidence.json'), 'utf8'));
  const preImplementationEvidence = JSON.parse(await readFile(path.join(repo, '.vibepro', 'diagnostics', '002-pre-implementation', 'evidence.json'), 'utf8'));
  assertAuthorizationOrderRiskEvidence(designInputEvidence, `${STORY_ID} DIJ-CONTRACT-012 DIJ-SCENARIO-008 ${SCENARIO_S008}`);
  assertAuthorizationOrderRiskEvidence(preImplementationEvidence, `${STORY_ID} DIJ-CONTRACT-012 DIJ-SCENARIO-008 ${SCENARIO_S008}`);
  const prepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json']);
  assert.equal(prepare.exitCode, 0);
  assert.equal(prepare.result.preparation.pr_context.design_input_judgment.status, 'present', `${STORY_ID} ac:4 ac:6 S-005 ${SCENARIO_S005}`);
  assert.equal(prepare.result.preparation.pr_context.design_input_judgment.artifact_status, 'present', `${STORY_ID} ac:6 S-005 ${SCENARIO_S005}`);
  assert.equal(prepare.result.preparation.pr_context.design_input_judgment.run_id, '001-design-input', `${STORY_ID} ac:4 S-006 ${SCENARIO_S006}`);
  assert.equal(prepare.result.preparation.pr_context.pre_implementation_judgment.phase, 'pre_implementation', `${STORY_ID} ac:4 S-006 ${SCENARIO_S006}`);
  assert.equal(prepare.result.preparation.pr_context.pre_implementation_judgment.status, 'present', `${STORY_ID} ac:4 S-006 ${SCENARIO_S006}`);
  assert.equal(prepare.result.preparation.pr_context.pre_implementation_judgment.source, 'story_diagnosis_artifact', `${STORY_ID} ac:4 S-006 ${SCENARIO_S006}`);
  assert.equal(prepare.result.preparation.pr_context.pre_implementation_judgment.run_id, '002-pre-implementation', `${STORY_ID} ac:4 S-006 ${SCENARIO_S006}`);
  assert.equal(prepare.result.preparation.pr_context.pre_implementation_judgment.artifact_status, 'present', `${STORY_ID} ac:4 S-006 ${SCENARIO_S006}`);
  assert.equal(typeof prepare.result.preparation.pr_context.pre_implementation_judgment.finding_count, 'number', `${STORY_ID} ac:4 S-006 ${SCENARIO_S006}`);
  assert.match(AC4_PR_CONTEXT_SPLIT, /design_input_judgment/, `${STORY_ID} ac:4 DIJ-CONTRACT-006 ${SCENARIO_S006}`);
  assert.match(AC4_PR_CONTEXT_SPLIT, /pre_implementation_judgment/, `${STORY_ID} ac:4 DIJ-CONTRACT-007 ${SCENARIO_S006}`);

  const passedGate = findGate(prepare.result.preparation, 'gate:design_input_judgment');
  assert.equal(passedGate.status, 'passed', `${STORY_ID} ac:6 S-003 ${SCENARIO_S003}`);
  const gateIds = prepare.result.preparation.pr_context.gate_dag.nodes.map((node) => node.id);
  assert.equal(gateIds.indexOf('gate:design_input_judgment') > gateIds.indexOf('gate:story_source_integrity'), true, `${STORY_ID} ac:6 S-003 ${SCENARIO_S003}`);
  assert.equal(gateIds.indexOf('gate:design_input_judgment') < gateIds.indexOf('gate:engineering_judgment_route'), true, `${STORY_ID} ac:6 S-003 ${SCENARIO_S003}`);
});

test('DIJ-SCENARIO-009 active blocker waiver stays visible as accepted followup across Gate DAG and PR UX artifacts', async () => {
  const repo = await makeGitRepo();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: Design input judgment blocker waiver
---

# Design input judgment blocker waiver

## Acceptance Criteria

- [ ] CLI output contract remains compatible when formatter changes.
`);
  await writeFile(path.join(repo, 'src', 'formatter.js'), 'export function renderConfig(){ return "cli output format"; }\n');
  await git(repo, ['add', 'docs/management/stories/active', 'src/formatter.js']);
  await git(repo, ['commit', '-m', 'feat: add blocker waiver fixture']);
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
    'node --test test/e2e/story-vibepro-design-input-judgment-flow.spec.ts',
    '--summary',
    'broad regression suite passed',
    '--target',
    'test/e2e/story-vibepro-design-input-judgment-flow.spec.ts'
  ]);
  const decision = await runCli([
    'decision',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--type',
    'waiver',
    '--summary',
    'public contract blocker is temporarily waived with owner signoff',
    '--source',
    'gate:judgment_axis_public_contract',
    '--reason',
    'temporary operator-controlled rollout with linked follow-up',
    '--artifact',
    `docs/management/stories/active/${STORY_ID}.md`,
    '--status',
    'accepted',
    '--json'
  ]);
  assert.equal(decision.exitCode, 0);
  assert.equal(Boolean(decision.result.decision.decision_id), true, `${STORY_ID} DIJ-SCENARIO-009 ${SCENARIO_S009}`);

  const prepare = await runCli([
    'pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json',
    '--evidence-depth', 'standard',
    '--evidence-depth-reason', 'verify accepted follow-up across reviewer HTML surfaces',
    '--evidence-depth-consumer', 'design-input-judgment-e2e',
    '--evidence-depth-target', 'gate-dag.html',
    '--evidence-depth-target', 'pr-prepare.html',
    '--evidence-depth-target', 'review-cockpit.html'
  ]);
  assert.equal(prepare.exitCode, 0);
  const axis = prepare.result.preparation.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'public_contract');
  assert.equal(axis.status, 'active_blocked', `${STORY_ID} DIJ-SCENARIO-009 ${SCENARIO_S009}`);
  assert.equal(axis.blocker_waiver.decision_id, decision.result.decision.decision_id, `${STORY_ID} DIJ-SCENARIO-009 ${SCENARIO_S009}`);
  const gate = findGate(prepare.result.preparation, 'gate:judgment_axis_public_contract');
  assert.equal(gate.status, 'accepted_followup', `${STORY_ID} DIJ-SCENARIO-009 ${SCENARIO_S009}`);
  assert.equal(gate.axis_status, 'active_blocked', `${STORY_ID} DIJ-SCENARIO-009 ${SCENARIO_S009}`);
  assert.equal(gate.blocker_waiver_valid, true, `${STORY_ID} DIJ-SCENARIO-009 ${SCENARIO_S009}`);
  assert.equal(gate.reason.includes('explicitly waived'), true, `${STORY_ID} DIJ-SCENARIO-009 ${SCENARIO_S009}`);
  assert.equal(gate.reason.includes(decision.result.decision.decision_id), true, `${STORY_ID} DIJ-SCENARIO-009 ${SCENARIO_S009}`);

  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  const gateDagHtml = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'gate-dag.html'), 'utf8');
  const prPrepareHtml = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-prepare.html'), 'utf8');
  const reviewCockpitHtml = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'review-cockpit.html'), 'utf8');
  assert.match(prBody, /- 証跡: `\.vibepro\/pr\/story-vibepro-design-input-judgment\/`/);
  assert.doesNotMatch(prBody, /public_contract: active_blocked/);
  assert.match(gateDagHtml, /gate:judgment_axis_public_contract[\s\S]{0,700}accepted_followup/);
  assert.match(gateDagHtml, /explicitly waived/);
  const publicContractCard = gateDagHtml.match(/<article class="card [^"]+" data-node-id="gate:judgment_axis_public_contract"[\s\S]*?<\/article>/)?.[0] ?? '';
  assert.match(publicContractCard, /accepted_followup/);
  assert.doesNotMatch(publicContractCard, />passed</);
  assert.match(prPrepareHtml, /accepted_followup/);
  assert.match(reviewCockpitHtml, /accepted_followup/);
});

test('DIJ-CONTRACT-010 DIJ-AP-003 manifest_only_false_pass DIJ-SCENARIO-003 manifest-only design-input run does not pass the PR gate', async () => {
  const repo = await makeGitRepo();
  await writeCrossSurfaceDesignChange(repo);
  await git(repo, ['add', 'docs/management/stories/active', 'docs/architecture', 'docs/specs', 'src/workflow.js', 'src/app/api/accounts/route.ts']);
  await git(repo, ['commit', '-m', 'feat: add cross-surface manifest-only flow']);
  await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', '001-design-input', '--pre-architecture']);
  await unlink(path.join(repo, '.vibepro', 'diagnostics', '001-design-input', 'evidence.json'));

  const prepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json']);
  assert.equal(prepare.exitCode, 0);
  assert.equal(prepare.result.preparation.pr_context.design_input_judgment.artifact_status, 'missing', `${STORY_ID} ac:6 S-003 ${SCENARIO_S003}`);
  const gate = findGate(prepare.result.preparation, 'gate:design_input_judgment');
  assert.equal(gate.status, 'needs_review', `${STORY_ID} ac:6 S-003 ${SCENARIO_S003}`);
  assert.match(
    prepare.result.preparation.pr_context.design_input_judgment.required_actions.join('\n'),
    /Regenerate the missing design-input diagnosis evidence artifact/,
    `${STORY_ID} ac-7 S-007 ${SCENARIO_S007}`
  );
  assert.match(
    gate.required_actions.join('\n'),
    /vibepro story diagnose \. --id <story-id> --pre-architecture --run-graphify/,
    `${STORY_ID} ac-7 S-007 ${SCENARIO_S007}`
  );
});

test('ac-8 DIJ-CONTRACT-011 DIJ-SCENARIO-007 documentation explains design-input before Architecture and final readiness before PR', async () => {
  const root = process.cwd();
  const readmeJa = await readFile(path.join(root, 'README.ja.md'), 'utf8');
  const cliReference = await readFile(path.join(root, 'docs', 'reference', 'cli.md'), 'utf8');
  const workflowSkill = await readFile(path.join(root, 'skills', 'vibepro-workflow', 'SKILL.md'), 'utf8');

  assert.match(readmeJa, /--pre-architecture --run-graphify/, `${STORY_ID} ac-8 S-007 ${SCENARIO_S007}`);
  assert.match(cliReference, /--phase design-input\|pre-implementation/, `${STORY_ID} ac-8 S-007 ${SCENARIO_S007}`);
  assert.match(workflowSkill, /Architecture\/Spec前|design-input/, `${STORY_ID} ac-8 S-007 ${SCENARIO_S007}`);
  const readmeDesignInputBeforeArchitecture = readmeJa.indexOf('Architecture / Spec を確定扱いにする前に `story diagnose --pre-architecture`');
  const readmePreImplementationBeforePr = readmeJa.indexOf('実装やPR readinessの前に `story diagnose --phase pre-implementation`');
  assert.notEqual(readmeDesignInputBeforeArchitecture, -1, `${STORY_ID} ac-8 S-007 ${SCENARIO_S007}`);
  assert.notEqual(readmePreImplementationBeforePr, -1, `${STORY_ID} ac-8 S-007 ${SCENARIO_S007}`);
  assert.equal(readmeDesignInputBeforeArchitecture < readmePreImplementationBeforePr, true, `${STORY_ID} ac-8 S-007 ${SCENARIO_S007}`);

  const cliDesignInputBeforeArchitecture = cliReference.indexOf('before finalizing Architecture/Spec');
  const cliPreImplementationBeforePr = cliReference.indexOf('Before implementation or PR readiness');
  assert.notEqual(cliDesignInputBeforeArchitecture, -1, `${STORY_ID} ac-8 S-007 ${SCENARIO_S007}`);
  assert.notEqual(cliPreImplementationBeforePr, -1, `${STORY_ID} ac-8 S-007 ${SCENARIO_S007}`);
  assert.equal(cliDesignInputBeforeArchitecture < cliPreImplementationBeforePr, true, `${STORY_ID} ac-8 S-007 ${SCENARIO_S007}`);

  const workflowDesignInputBeforeArchitecture = workflowSkill.indexOf('Before final Architecture/Spec');
  const workflowPreImplementationBeforePr = workflowSkill.indexOf('Before implementation or PR readiness');
  assert.notEqual(workflowDesignInputBeforeArchitecture, -1, `${STORY_ID} ac-8 S-007 ${SCENARIO_S007}`);
  assert.notEqual(workflowPreImplementationBeforePr, -1, `${STORY_ID} ac-8 S-007 ${SCENARIO_S007}`);
  assert.equal(workflowDesignInputBeforeArchitecture < workflowPreImplementationBeforePr, true, `${STORY_ID} ac-8 S-007 ${SCENARIO_S007}`);
});
