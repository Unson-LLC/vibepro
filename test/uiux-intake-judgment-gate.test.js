import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY = 'story-uiux-intake-judgment';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function makeGitRepoWithStory() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-uiux-intake-judgment-'));
  await writeFile(path.join(repo, 'index.html'), '<!doctype html><title>Test</title>');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli([
    'init',
    repo,
    '--story-id',
    STORY,
    '--title',
    'UI/UX intake judgment gate test story',
    '--view',
    'dev'
  ]);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init test repo']);
  await git(repo, ['switch', '-c', 'feature/test-story']);
  await writeFile(path.join(repo, 'src.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src.js']);
  await git(repo, ['commit', '-m', 'feat: add source']);
  return repo;
}

async function prPrepare(repo) {
  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY, '--json']);
  assert.equal(result.exitCode, 0, JSON.stringify(result.result ?? result.error, null, 2));
  return readJson(path.join(repo, '.vibepro', 'pr', STORY, 'pr-prepare.json'));
}

function gateNode(prepare, id) {
  return prepare.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

test('UIJ-SCENARIO-001 gate:uiux_intake_judgment blocks with needs_evidence when no intake judgment is recorded', async () => {
  const repo = await makeGitRepoWithStory();
  const prepare = await prPrepare(repo);
  const gate = gateNode(prepare, 'gate:uiux_intake_judgment');
  assert.ok(gate, 'gate:uiux_intake_judgment must always be present in the gate DAG');
  assert.equal(gate.status, 'needs_evidence');
  assert.equal(gate.required, true);
  assert.equal(gate.resolved_by, null);
  assert.match(gate.reason, /intake_not_applicable/);
  const edges = prepare.pr_context.gate_dag.edges;
  assert.ok(edges.some((edge) => edge.to === 'gate:uiux_intake_judgment'), 'gate must be connected in the DAG');
  assert.ok(edges.some((edge) => edge.from === 'gate:uiux_intake_judgment'), 'gate must have an outgoing edge');
});

test('UIJ-SCENARIO-008 unrecorded judgment reaches the enforcement surface: execution gate blocks on gate:uiux_intake_judgment', async () => {
  const repo = await makeGitRepoWithStory();
  const prepare = await prPrepare(repo);
  const blockingIds = (prepare.pr_context.execution_gate?.blocking_gates ?? []).map((gate) => gate.id);
  assert.ok(blockingIds.includes('gate:uiux_intake_judgment'),
    `execution_gate.blocking_gates must contain gate:uiux_intake_judgment, got: ${blockingIds.join(', ')}`);
  assert.equal(prepare.pr_context.execution_gate?.pr_create_allowed, false, 'pr create must not be allowed while the intake judgment is unrecorded');
});

test('UIJ-SCENARIO-009 recorded judgment releases the enforcement surface for this gate', async () => {
  const repo = await makeGitRepoWithStory();
  const decision = await runCli([
    'decision', 'record', repo,
    '--id', STORY,
    '--type', 'intake_not_applicable',
    '--summary', 'CLI-only story',
    '--reason', 'No UI/UX surface in this story',
    '--json'
  ]);
  assert.equal(decision.exitCode, 0, JSON.stringify(decision.result ?? decision.error, null, 2));
  const prepare = await prPrepare(repo);
  const blockingIds = (prepare.pr_context.execution_gate?.blocking_gates ?? []).map((gate) => gate.id);
  assert.ok(!blockingIds.includes('gate:uiux_intake_judgment'),
    'gate:uiux_intake_judgment must leave blocking_gates once the judgment is recorded');
});

test('UIJ-SCENARIO-002 intake coverage artifact under .vibepro/uiux satisfies the gate', async () => {
  const repo = await makeGitRepoWithStory();
  const template = await runCli(['uiux', 'intake', 'template', repo, '--id', STORY, '--json']);
  assert.equal(template.exitCode, 0, JSON.stringify(template.result ?? template.error, null, 2));
  const prepare = await prPrepare(repo);
  const gate = gateNode(prepare, 'gate:uiux_intake_judgment');
  assert.equal(gate.status, 'passed');
  assert.equal(gate.resolved_by, 'intake_coverage_artifact');
  assert.equal(gate.intake_coverage.artifact, `.vibepro/uiux/${STORY}/uiux-intake-coverage.json`);
});

test('UIJ-SCENARIO-003 intake coverage artifact under .vibepro/design-modernize satisfies the gate', async () => {
  const repo = await makeGitRepoWithStory();
  const dir = path.join(repo, '.vibepro', 'design-modernize', STORY);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'uiux-intake-coverage.json'), JSON.stringify({
    schema_version: '0.1.0',
    workflow: 'uiux-intake-coverage',
    story_id: STORY,
    status: 'needs_intake_detail',
    missing_required_fields: ['target_users']
  }, null, 2));
  const prepare = await prPrepare(repo);
  const gate = gateNode(prepare, 'gate:uiux_intake_judgment');
  assert.equal(gate.status, 'passed');
  assert.equal(gate.resolved_by, 'intake_coverage_artifact');
  assert.equal(gate.intake_coverage.status, 'needs_intake_detail');
  assert.equal(gate.intake_coverage.missing_required_fields, 1);
});

test('UIJ-SCENARIO-004 accepted intake_not_applicable decision satisfies the gate and carries the reason', async () => {
  const repo = await makeGitRepoWithStory();
  const decision = await runCli([
    'decision', 'record', repo,
    '--id', STORY,
    '--type', 'intake_not_applicable',
    '--summary', 'CLI-only gate change with no UI/UX surface',
    '--reason', 'The story changes pr prepare gate logic only; no screen, route, or visual behavior is touched',
    '--json'
  ]);
  assert.equal(decision.exitCode, 0, JSON.stringify(decision.result ?? decision.error, null, 2));
  const prepare = await prPrepare(repo);
  const gate = gateNode(prepare, 'gate:uiux_intake_judgment');
  assert.equal(gate.status, 'passed');
  assert.equal(gate.resolved_by, 'intake_not_applicable_decision');
  assert.equal(gate.decision.type, 'intake_not_applicable');
  assert.match(gate.decision.reason, /no screen, route, or visual behavior/);
});

test('UIJ-SCENARIO-005 intake_not_applicable without --reason is rejected', async () => {
  const repo = await makeGitRepoWithStory();
  const decision = await runCli([
    'decision', 'record', repo,
    '--id', STORY,
    '--type', 'intake_not_applicable',
    '--summary', 'skip without reason',
    '--json'
  ]);
  assert.notEqual(decision.exitCode, 0, 'reasonless intake_not_applicable must be rejected');
});

test('UIJ-SCENARIO-006 corrupt coverage artifact does not satisfy the gate', async () => {
  const repo = await makeGitRepoWithStory();
  const dir = path.join(repo, '.vibepro', 'uiux', STORY);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'uiux-intake-coverage.json'), 'not json');
  const prepare = await prPrepare(repo);
  const gate = gateNode(prepare, 'gate:uiux_intake_judgment');
  assert.equal(gate.status, 'needs_evidence');
  assert.equal(gate.resolved_by, null);
});

test('UIJ-SCENARIO-007 waiver decision against gate:uiux_intake_judgment satisfies the gate', async () => {
  const repo = await makeGitRepoWithStory();
  const decision = await runCli([
    'decision', 'record', repo,
    '--id', STORY,
    '--type', 'waiver',
    '--source', 'gate:uiux_intake_judgment',
    '--summary', 'Waive intake judgment for emergency fix',
    '--reason', 'Emergency production fix approved by owner; intake judgment deferred to follow-up story',
    '--json'
  ]);
  assert.equal(decision.exitCode, 0, JSON.stringify(decision.result ?? decision.error, null, 2));
  const prepare = await prPrepare(repo);
  const gate = gateNode(prepare, 'gate:uiux_intake_judgment');
  assert.equal(gate.status, 'passed');
  assert.equal(gate.resolved_by, 'waiver_decision');
});
