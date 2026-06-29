import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const VIBEPRO_BIN = path.resolve('bin/vibepro.js');
const STORY_ID = 'story-vibepro-pr-route-gate-dag';

async function run(command, args, cwd) {
  const { stdout } = await execFileAsync(command, args, { cwd, encoding: 'utf8' });
  return stdout;
}

async function runVibepro(repo, args) {
  const stdout = await run(process.execPath, [VIBEPRO_BIN, ...args, '--json'], repo);
  return JSON.parse(stdout);
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-route-e2e-'));
  await run('git', ['init', '-b', 'main'], repo);
  await run('git', ['config', 'user.email', 'test@example.com'], repo);
  await run('git', ['config', 'user.name', 'Test User'], repo);
  await run(process.execPath, [VIBEPRO_BIN, 'init', repo, '--story-id', STORY_ID, '--title', 'PR Route Gate DAG'], repo);
  await run('git', ['add', '.gitignore'], repo);
  await run('git', ['commit', '-m', 'chore: initialize repo'], repo);
  await run('git', ['switch', '-c', 'feature/route-gate'], repo);
  return repo;
}

function nodeById(prepare, id) {
  return prepare.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

test('story-vibepro-pr-route-gate-dag ac1 ac2 ac6 executes docs-only route classification and PR body contract', async () => {
  // story-vibepro-pr-route-gate-dag ac:1
  // `vibepro pr prepare` はPR routeを `gate:pr_route_classification` としてGate DAGに出す。
  // story-vibepro-pr-route-gate-dag ac:2
  // `vibepro pr prepare` はroute別のPR本文契約を `gate:pr_body_contract` としてGate DAGに出す。
  // story-vibepro-pr-route-gate-dag ac:6
  // PR本文はroute/body templateの詳細を本文に展開せず、VibePro artifactへの導線を表示する。
  // story-vibepro-oss-engineering-judgment-pr-message ac:1
  // Engineering Judgment DAGの詳細はGitHub本文ではなくVibePro artifactに残す。
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'review-guide.md'), '# Review Guide\n');
  await run('git', ['add', 'docs/review-guide.md'], repo);
  await run('git', ['commit', '-m', 'docs: add review guide'], repo);

  const prepare = await runVibepro(repo, ['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID]);

  assert.equal(prepare.pr_context.pr_route.route_type, 'docs_only');
  assert.equal(prepare.pr_context.engineering_judgment.route_type, 'agent_workflow');
  assert.equal(nodeById(prepare, 'gate:engineering_judgment_route').status, 'passed');
  assert.equal(nodeById(prepare, 'gate:common_judgment_spine').status, 'needs_evidence');
  assert.equal(
    nodeById(prepare, 'gate:common_judgment_spine').subchecks.some((check) => check.id === 'current_reality' && check.status === 'needs_evidence'),
    true
  );
  assert.equal(nodeById(prepare, 'gate:judgment_agent_workflow_context_acquisition').status, 'passed');
  assert.equal(nodeById(prepare, 'gate:dag_connectivity').status, 'passed');
  assert.deepEqual(nodeById(prepare, 'gate:dag_connectivity').unreachable_nodes, []);
  assert.deepEqual(nodeById(prepare, 'gate:dag_connectivity').dead_end_nodes, []);
  assert.equal(nodeById(prepare, 'gate:pr_route_classification').status, 'passed');
  assert.equal(nodeById(prepare, 'gate:pr_body_contract').status, 'passed');
  assert.equal(prepare.pr_context.gate_dag.summary.engineering_judgment_dag, 'agent_workflow_dag');
  assert.equal(prepare.pr_context.gate_dag.summary.pr_body_template, 'documentation_decision_review');
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.doesNotMatch(prBody, /Engineering Judgment: agent_workflow \/ dag=agent_workflow_dag/);
  assert.doesNotMatch(prBody, /PR Route: docs_only \/ body=documentation_decision_review/);
  assert.match(prBody, /\.vibepro\/pr\/story-vibepro-pr-route-gate-dag\/pr-prepare\.json/);
  assert.match(prBody, /証跡: \.vibepro\/pr\/story-vibepro-pr-route-gate-dag\//);
  assert.doesNotMatch(prBody, /### Engineering Judgment の判断過程/);
  assert.match('`vibepro pr prepare` はPR routeを `gate:pr_route_classification` としてGate DAGに出す。', /gate:pr_route_classification/);
  assert.match('`vibepro pr prepare` はroute別のPR本文契約を `gate:pr_body_contract` としてGate DAGに出す。', /gate:pr_body_contract/);
  assert.match('PR本文の判断グラフにrouteとbody templateが表示される。', /判断グラフ|body template/);
});

test('story-vibepro-pr-route-gate-dag ac3 executes mirror and release routes with source and CI gates', async () => {
  // story-vibepro-pr-route-gate-dag ac:3
  // mirror/release routeではsource traceabilityとCI/waiverのGateが必須になる。
  const mirrorRepo = await makeRepo();
  await mkdir(path.join(mirrorRepo, 'src'), { recursive: true });
  await writeFile(path.join(mirrorRepo, 'src', 'mirror.js'), 'export const mirror = true;\n');
  await run('git', ['add', 'src/mirror.js'], mirrorRepo);
  await run('git', ['commit', '-m', 'sync: deploy mirror'], mirrorRepo);
  const mirrorPrepare = await runVibepro(mirrorRepo, ['pr', 'prepare', mirrorRepo, '--base', 'main', '--story-id', STORY_ID]);
  assert.equal(mirrorPrepare.pr_context.engineering_judgment.route_type, 'release_engineering');
  assert.equal(mirrorPrepare.pr_context.pr_route.route_type, 'mirror_sync');
  assert.equal(nodeById(mirrorPrepare, 'gate:judgment_release_engineering_release_traceability').status, 'passed');
  assert.equal(nodeById(mirrorPrepare, 'gate:dag_connectivity').status, 'passed');
  assert.equal(nodeById(mirrorPrepare, 'gate:mirror_source_traceability').status, 'needs_evidence');
  assert.equal(nodeById(mirrorPrepare, 'gate:ci_status_or_waiver').status, 'needs_evidence');

  const releaseRepo = await makeRepo();
  await mkdir(path.join(releaseRepo, 'src'), { recursive: true });
  await writeFile(path.join(releaseRepo, 'src', 'release.js'), 'export const release = true;\n');
  await run('git', ['add', 'src/release.js'], releaseRepo);
  await run('git', ['commit', '-m', 'release: promote merge'], releaseRepo);
  const releasePrepare = await runVibepro(releaseRepo, ['pr', 'prepare', releaseRepo, '--base', 'main', '--story-id', STORY_ID]);
  assert.equal(releasePrepare.pr_context.pr_route.route_type, 'release_merge');
  assert.equal(nodeById(releasePrepare, 'gate:mirror_source_traceability').status, 'needs_evidence');
  assert.equal(nodeById(releasePrepare, 'gate:ci_status_or_waiver').status, 'needs_evidence');
  assert.match('mirror/release routeではsource traceabilityとCI/waiverのGateが必須になる。', /source traceability|CI\/waiver/);
});

test('story-vibepro-pr-route-gate-dag ac4 ac5 executes artifact and split gates before and after decisions', async () => {
  // story-vibepro-pr-route-gate-dag ac:4
  // `.vibepro/` artifactが差分に含まれる場合はartifact policy Gateが必須になる。
  // story-vibepro-pr-route-gate-dag ac:5
  // `needs_clean_branch` のscopeではsplit resolution Gateが必須になる。
  const repo = await makeRepo();
  await mkdir(path.join(repo, '.vibepro', 'diagnostics'), { recursive: true });
  await mkdir(path.join(repo, '.claude', 'commands'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'diagnostics', 'note.json'), '{"status":"sample"}\n');
  await writeFile(path.join(repo, '.claude', 'commands', 'commit.md'), '# Commit\n');
  await writeFile(path.join(repo, 'src', 'runtime.js'), 'export const runtime = true;\n');
  await run('git', ['add', '-f', '.vibepro/diagnostics/note.json'], repo);
  await run('git', ['add', '.claude/commands/commit.md', 'src/runtime.js'], repo);
  await run('git', ['commit', '-m', 'feat: route gate workflow'], repo);

  const blocked = await runVibepro(repo, ['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--max-files', '1']);
  assert.equal(nodeById(blocked, 'gate:vibepro_artifact_policy').status, 'needs_review');
  assert.equal(nodeById(blocked, 'gate:split_resolution').status, 'needs_review');
  assert.equal(blocked.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:split_resolution'), true);

  await runVibepro(repo, [
    'decision',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--type',
    'waiver',
    '--status',
    'accepted',
    '--source',
    'gate:vibepro_artifact_policy',
    '--summary',
    'Artifact intentionally committed as review evidence.',
    '--reason',
    'Small non-secret artifact proves policy gate behavior.',
    '--reviewer',
    'codex'
  ]);
  await runVibepro(repo, [
    'decision',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--type',
    'waiver',
    '--status',
    'accepted',
    '--source',
    'gate:split_resolution',
    '--summary',
    'Keep route gate workflow atomic.',
    '--reason',
    'The route DAG, enforcement, and tests are one workflow contract.',
    '--reviewer',
    'codex'
  ]);

  const resolved = await runVibepro(repo, ['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--max-files', '1']);
  assert.equal(nodeById(resolved, 'gate:vibepro_artifact_policy').status, 'passed');
  assert.equal(nodeById(resolved, 'gate:split_resolution').status, 'passed');
  assert.match('`.vibepro/` artifactが差分に含まれる場合はartifact policy Gateが必須になる。', /artifact policy/);
  assert.match('`needs_clean_branch` のscopeではsplit resolution Gateが必須になる。', /split resolution/);
});
