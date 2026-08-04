import '../support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY = 'story-uiux-intake-judgment-e2e';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function makeGitRepoWithStory() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-uiux-intake-judgment-e2e-'));
  await writeFile(path.join(repo, 'index.html'), '<!doctype html><title>Test</title>');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', STORY, '--title', 'UI/UX intake judgment e2e story', '--view', 'dev']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init test repo']);
  await git(repo, ['switch', '-c', 'feature/e2e-story']);
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

function gateNode(prepare) {
  return prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:uiux_intake_judgment');
}

test('story-vibepro-uiux-intake-judgment-gate ac:1 gate always present and blocks without a recorded judgment', async () => {
  const repo = await makeGitRepoWithStory();
  const prepare = await prPrepare(repo);
  // story-vibepro-uiux-intake-judgment-gate ac:1 pr prepare のgate DAGに gate:uiux_intake_judgment が常に含まれ、判断記録が無いstoryでは needs_evidence でblockする
  const gate = gateNode(prepare);
  assert.ok(gate, 'gate:uiux_intake_judgment must always be present in the pr prepare gate DAG');
  assert.equal(gate.status, 'needs_evidence', 'gate:uiux_intake_judgment blocks with needs_evidence when no intake judgment is recorded for the story');
  assert.equal(gate.required, true, 'gate:uiux_intake_judgment is a required gate');
  const blockingIds = (prepare.pr_context.execution_gate?.blocking_gates ?? []).map((entry) => entry.id);
  assert.ok(blockingIds.includes('gate:uiux_intake_judgment'),
    'the unrecorded judgment must block on the enforcement surface (execution_gate.blocking_gates), not only on the node status');
});

test('story-vibepro-uiux-intake-judgment-gate ac:2 intake coverage artifact resolves the gate', async () => {
  const repo = await makeGitRepoWithStory();
  const template = await runCli(['uiux', 'intake', 'template', repo, '--id', STORY, '--json']);
  assert.equal(template.exitCode, 0, JSON.stringify(template.result ?? template.error, null, 2));
  const prepare = await prPrepare(repo);
  // story-vibepro-uiux-intake-judgment-gate ac:2 .vibepro/uiux/<story-id>/uiux-intake-coverage.json が存在するstoryではgateがpassedになる
  const gate = gateNode(prepare);
  assert.equal(gate.status, 'passed', 'gate is passed when .vibepro/uiux/<story-id>/uiux-intake-coverage.json exists');
  assert.equal(gate.resolved_by, 'intake_coverage_artifact', 'uiux-intake-coverage.json is surfaced as the resolving intake coverage artifact');
});

test('story-vibepro-uiux-intake-judgment-gate ac:3 intake_not_applicable decision with reason resolves the gate and reasonless is rejected', async () => {
  const repo = await makeGitRepoWithStory();
  const reasonless = await runCli([
    'decision', 'record', repo, '--id', STORY,
    '--type', 'intake_not_applicable',
    '--summary', 'skip without reason', '--json'
  ]);
  // story-vibepro-uiux-intake-judgment-gate ac:3 vibepro decision record --type intake_not_applicable --reason <text> が受理され、accepted状態でgateがpassedになる。reason無しはエラーで拒否される
  assert.notEqual(reasonless.exitCode, 0, 'intake_not_applicable without --reason is rejected with an error');
  const decision = await runCli([
    'decision', 'record', repo, '--id', STORY,
    '--type', 'intake_not_applicable',
    '--summary', 'CLI-only change with no UI/UX surface',
    '--reason', 'No screen, route, or visual behavior is touched by this story',
    '--json'
  ]);
  assert.equal(decision.exitCode, 0, JSON.stringify(decision.result ?? decision.error, null, 2));
  const prepare = await prPrepare(repo);
  const gate = gateNode(prepare);
  assert.equal(gate.status, 'passed', 'accepted intake_not_applicable decision record resolves the gate as passed');
  assert.equal(gate.resolved_by, 'intake_not_applicable_decision', 'gate surfaces intake_not_applicable_decision as the resolving judgment');
});

test('story-vibepro-uiux-intake-judgment-gate ac:4 recovery guidance names both honest closures', async () => {
  const repo = await makeGitRepoWithStory();
  const prepare = await prPrepare(repo);
  // story-vibepro-uiux-intake-judgment-gate ac:4 gate未解決時のrecovery planに、intake validate実行と intake_not_applicable decision 記録の両方の閉じ方が案内される
  const gate = gateNode(prepare);
  assert.match(gate.reason, /vibepro uiux intake validate/, 'unresolved gate recovery guidance names the intake validate closure');
  assert.match(gate.reason, /intake_not_applicable/, 'unresolved gate recovery guidance names the intake_not_applicable decision closure');
  assert.match(gate.reason, /vibepro decision record/, 'the gate reason carries the full decision-record command as recovery guidance');
  assert.match(gate.reason, /--reason/, 'the recovery guidance states that the intake_not_applicable closure requires a reason');
});
