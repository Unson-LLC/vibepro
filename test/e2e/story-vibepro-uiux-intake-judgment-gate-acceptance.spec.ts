import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY = 'story-uiux-intake-judgment-acceptance';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function makeGitRepoWithStory() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-uiux-intake-acceptance-'));
  await writeFile(path.join(repo, 'index.html'), '<!doctype html><title>Test</title>');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', STORY, '--title', 'UI/UX intake judgment acceptance story', '--view', 'dev']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init test repo']);
  await git(repo, ['switch', '-c', 'feature/acceptance']);
  await writeFile(path.join(repo, 'src.js'), 'export const value = 1;\n');
  await git(repo, ['add', 'src.js']);
  await git(repo, ['commit', '-m', 'feat: add source']);
  return repo;
}

async function prPrepare(repo) {
  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY, '--json']);
  assert.equal(result.exitCode, 0, JSON.stringify(result.result ?? result.error, null, 2));
  return JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', STORY, 'pr-prepare.json'), 'utf8'));
}

function gateNode(prepare) {
  return prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:uiux_intake_judgment');
}

test('story-vibepro-uiux-intake-judgment-gate ac:5 the gate is always present and blocks unrecorded judgments', async () => {
  // story-vibepro-uiux-intake-judgment-gate ac:5
  const criterion = '`pr prepare` のgate DAGに `gate:uiux_intake_judgment` が常に含まれ、判断記録が無いstoryでは needs_evidence でblockする';
  const repo = await makeGitRepoWithStory();
  const prepare = await prPrepare(repo);
  const gate = gateNode(prepare);
  assert.ok(gate, `ac:5 ${criterion} — gate node must exist in every story's gate DAG`);
  assert.equal(gate.status, 'needs_evidence', `ac:5 ${criterion} — unrecorded judgment must report needs_evidence`);
  const blockingIds = (prepare.pr_context.execution_gate?.blocking_gates ?? []).map((entry) => entry.id);
  assert.ok(blockingIds.includes('gate:uiux_intake_judgment'), `ac:5 ${criterion} — the gate must block on the enforcement surface`);
});

test('story-vibepro-uiux-intake-judgment-gate ac:6 S-001 an intake coverage artifact resolves the gate', async () => {
  // story-vibepro-uiux-intake-judgment-gate ac:6
  // story-vibepro-uiux-intake-judgment-gate S-001
  const criterion = '`.vibepro/uiux/<story-id>/uiux-intake-coverage.json` が存在するstoryではgateがpassedになる';
  const scenario = 'When .vibepro/uiux/<story-id>/uiux-intake-coverage.json or .vibepro/design-modernize/<story-id>/uiux-intake-coverage.json exists and parses as an object, gate:uiux_intake_judgment passes with resolved_by=intake_coverage_artifact and surfaces the artifact path and coverage status.';
  const repo = await makeGitRepoWithStory();
  const template = await runCli(['uiux', 'intake', 'template', repo, '--id', STORY, '--json']);
  assert.equal(template.exitCode, 0, `ac:6 ${criterion} — intake template must create the coverage artifact`);
  const prepare = await prPrepare(repo);
  const gate = gateNode(prepare);
  assert.equal(gate.status, 'passed', `ac:6 S-001 ${criterion} — ${scenario}`);
  assert.equal(gate.resolved_by, 'intake_coverage_artifact', `S-001 ${scenario}`);
  assert.equal(gate.intake_coverage.artifact, `.vibepro/uiux/${STORY}/uiux-intake-coverage.json`, `S-001 ${scenario} — artifact path surfaced`);
  assert.ok(typeof gate.intake_coverage.status === 'string', `S-001 ${scenario} — coverage status surfaced`);
});

test('story-vibepro-uiux-intake-judgment-gate ac:7 S-002 intake_not_applicable requires a reason and resolves the gate', async () => {
  // story-vibepro-uiux-intake-judgment-gate ac:7
  // story-vibepro-uiux-intake-judgment-gate S-002
  const criterion = '`vibepro decision record --type intake_not_applicable --reason <text>` が受理され、accepted状態でgateがpassedになる。reason無しはエラーで拒否される';
  const scenario = 'vibepro decision record --type intake_not_applicable is accepted only with --reason; an accepted intake_not_applicable decision resolves gate:uiux_intake_judgment with resolved_by=intake_not_applicable_decision and the gate surfaces the recorded reason.';
  const repo = await makeGitRepoWithStory();
  const reasonless = await runCli([
    'decision', 'record', repo, '--id', STORY,
    '--type', 'intake_not_applicable', '--summary', 'skip without reason', '--json'
  ]);
  assert.notEqual(reasonless.exitCode, 0, `ac:7 ${criterion} — reasonless record must be rejected`);
  const decision = await runCli([
    'decision', 'record', repo, '--id', STORY,
    '--type', 'intake_not_applicable',
    '--summary', 'CLI-only story with no UI/UX surface',
    '--reason', 'No screen, route, or visual behavior is touched by this story',
    '--json'
  ]);
  assert.equal(decision.exitCode, 0, `ac:7 ${criterion} — reasoned record must be accepted`);
  const prepare = await prPrepare(repo);
  const gate = gateNode(prepare);
  assert.equal(gate.status, 'passed', `ac:7 S-002 ${criterion} — ${scenario}`);
  assert.equal(gate.resolved_by, 'intake_not_applicable_decision', `S-002 ${scenario}`);
  assert.match(gate.decision.reason, /No screen, route, or visual behavior/, `S-002 ${scenario} — recorded reason surfaced`);
});

test('story-vibepro-uiux-intake-judgment-gate ac:8 S-003 recovery guidance and waiver closure', async () => {
  // story-vibepro-uiux-intake-judgment-gate ac:8
  // story-vibepro-uiux-intake-judgment-gate S-003
  const criterion = 'gate未解決時のrecovery planに、intake validate実行と intake_not_applicable decision 記録の両方の閉じ方が案内される';
  const scenario = 'An accepted waiver decision with --source gate:uiux_intake_judgment resolves the gate with resolved_by=waiver_decision, and the unresolved-gate recovery plan names both closures: running uiux intake validate, or recording an intake_not_applicable decision with a reason.';
  const repo = await makeGitRepoWithStory();
  const blocked = await prPrepare(repo);
  const blockedGate = gateNode(blocked);
  assert.match(blockedGate.reason, /vibepro uiux intake validate/, `ac:8 ${criterion} — intake validate closure is named`);
  assert.match(blockedGate.reason, /intake_not_applicable/, `ac:8 ${criterion} — intake_not_applicable decision closure is named`);
  assert.match(blockedGate.reason, /--reason/, `ac:8 ${criterion} — the reason requirement is stated`);
  const waiver = await runCli([
    'decision', 'record', repo, '--id', STORY,
    '--type', 'waiver', '--source', 'gate:uiux_intake_judgment',
    '--summary', 'Waive intake judgment for emergency fix',
    '--reason', 'Emergency fix approved by owner; intake judgment deferred to a follow-up story',
    '--json'
  ]);
  assert.equal(waiver.exitCode, 0, `S-003 ${scenario} — waiver record must be accepted`);
  const prepare = await prPrepare(repo);
  const gate = gateNode(prepare);
  assert.equal(gate.status, 'passed', `S-003 ${scenario}`);
  assert.equal(gate.resolved_by, 'waiver_decision', `S-003 ${scenario}`);
});
