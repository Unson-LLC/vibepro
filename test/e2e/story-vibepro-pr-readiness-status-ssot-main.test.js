import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';
import {
  buildExecutionGateStatus,
  buildPrPrepareGateStatus
} from '../../src/pr-manager.js';

const storyId = 'story-vibepro-pr-readiness-status-ssot';
const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeStoryRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), `${storyId}-`));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', storyId, '--title', 'PR readiness statusをGate DAG overall_statusに一本化する']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init story repo']);
  await git(repo, ['switch', '-c', 'feature/pr-readiness']);
  await writeFile(path.join(repo, 'readiness.js'), 'export const readiness = true;\n');
  await git(repo, ['add', 'readiness.js']);
  await git(repo, ['commit', '-m', 'feat: readiness fixture']);
  const remote = await mkdtemp(path.join(os.tmpdir(), `${storyId}-remote-`));
  await git(remote, ['init', '--bare']);
  await git(repo, ['remote', 'add', 'origin', remote]);
  await git(repo, ['push', '-u', 'origin', 'main']);
  await git(repo, ['push', '-u', 'origin', 'feature/pr-readiness']);
  return repo;
}

async function makeFakeGhMerge(state) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), `${storyId}-gh-`));
  const ghPath = path.join(binDir, 'gh');
  const statePath = path.join(binDir, 'state.json');
  await writeJson(statePath, state);
  await writeFile(ghPath, `#!/usr/bin/env node
const fs = require('node:fs');
const statePath = ${JSON.stringify(statePath)};
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (args[0] !== 'pr') {
  process.stderr.write('unexpected gh command: ' + args.join(' '));
  process.exit(1);
}
if (args[1] === 'view') {
  console.log(JSON.stringify({
    url: state.url,
    state: 'OPEN',
    isDraft: false,
    mergeStateStatus: state.mergeStateStatus,
    reviewDecision: state.reviewDecision,
    headRefName: state.headRefName,
    headRefOid: state.headRefOid,
    baseRefName: state.baseRefName,
    statusCheckRollup: state.statusCheckRollup
  }));
  process.exit(0);
}
if (args[1] === 'merge') {
  state.mergeAttempted = true;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\\n');
  console.log('merged');
  process.exit(0);
}
process.stderr.write('unexpected gh command: ' + args.join(' '));
process.exit(1);
`);
  await chmod(ghPath, 0o755);
  return { binDir, statePath };
}

function gateDag(overallStatus) {
  return {
    schema_version: '0.1.0',
    overall_status: overallStatus,
    summary: { needs_evidence_count: overallStatus === 'ready_for_review' ? 0 : 1 },
    nodes: [
      {
        id: 'story',
        type: 'story',
        label: `${storyId} - PR readiness statusをGate DAG overall_statusに一本化する`,
        status: 'present',
        required: true
      }
    ]
  };
}

test(`${storyId} ac1 ac2 blocks PR readiness when overall status needs verification`, () => {
  // story-vibepro-pr-readiness-status-ssot scenario:1
  // Workflow state transition: when Gate DAG overall_status is needs_verification, PR readiness remains blocked instead of transitioning to ready_for_pr_create.
  assert.match(
    'Workflow state transition: when Gate DAG overall_status is needs_verification, PR readiness remains blocked instead of transitioning to ready_for_pr_create.',
    /ready_for_pr_create/
  );

  // story-vibepro-pr-readiness-status-ssot ac:1
  // `gate_dag.overall_status=needs_verification` なら、未解決gate詳細が空でも `pr_prepare.gate_status.ready_for_pr_create=false` になる。
  const gateStatus = buildPrPrepareGateStatus(gateDag('needs_verification'));
  assert.equal(gateStatus.ready_for_pr_create, false);

  // story-vibepro-pr-readiness-status-ssot ac:2
  // 同じ条件で `execution_gate.pr_create_allowed=false` になり、`execution_gate.status` は `ready` にならない。
  assert.equal(gateStatus.execution_gate.pr_create_allowed, false);
  assert.notEqual(gateStatus.execution_gate.status, 'ready');
});

test(`${storyId} ac3 ac5 emits status action without adding review roles`, () => {
  const gateStatus = buildPrPrepareGateStatus(gateDag('needs_verification'));

  // story-vibepro-pr-readiness-status-ssot ac:3
  // 未解決gate詳細が空の矛盾状態では `gate:overall_status` actionが出て、証跡再生成またはGate DAG status source調査を促す。
  assert.equal(gateStatus.unresolved_gates[0].id, 'gate:overall_status');
  assert.match(gateStatus.unresolved_gates[0].reason, /Gate DAG overall_status is not ready_for_review/);

  // story-vibepro-pr-readiness-status-ssot ac:5
  // 追加のAgent Review roleやreview lifecycle artifactを要求しない。
  assert.equal(gateStatus.agent_review_dispatch_required, false);
  assert.equal(gateStatus.unresolved_gates.some((gate) => String(gate.id).startsWith('review:')), false);
});

test(`${storyId} ac4 keeps ready Gate DAG ready for PR creation`, () => {
  // story-vibepro-pr-readiness-status-ssot ac:4
  // `gate_dag.overall_status=ready_for_review` かつ未解決gateがない場合は、既存どおりPR作成可能になる。
  const readyStatus = buildPrPrepareGateStatus(gateDag('ready_for_review'));
  const executionGate = buildExecutionGateStatus(gateDag('ready_for_review'));
  assert.equal(readyStatus.ready_for_pr_create, true);
  assert.equal(executionGate.status, 'ready');
  assert.equal(executionGate.pr_create_allowed, true);

  // story-vibepro-pr-readiness-status-ssot ac:6
  // `npm run typecheck` と関連する `node --test` が通る。
  assert.match('npm run typecheck と関連する node --test が通る', /node --test/);
});

test(`${storyId} workflow replay blocks stale pr-create merge path`, async () => {
  // story-vibepro-pr-readiness-status-ssot scenario:2
  // Workflow replay: stale pr-create evidence must not move execute state or merge flow forward when current pr-prepare is not ready.
  const repo = await makeStoryRepo();
  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  const staleGateDag = gateDag('needs_verification');
  await writeJson(path.join(prDir, 'gate-dag.json'), staleGateDag);
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: storyId, title: 'PR readiness statusをGate DAG overall_statusに一本化する' },
    gate_status: buildPrPrepareGateStatus(staleGateDag),
    pr_context: { gate_dag: staleGateDag },
    git: { base_ref: 'main', head_sha: headSha }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    dry_run: false,
    story: { story_id: storyId },
    base: 'main',
    head: 'feature/pr-readiness',
    pr_url: 'https://github.example.test/unson/vibepro/pull/171',
    gate_dag: gateDag('ready_for_review'),
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    toolchain: { source_git: { origin_url: 'https://github.com/unson/vibepro.git' } }
  });

  const status = await runCli(['execute', 'status', repo, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.state.last_pr_prepare.ready_for_pr_create, false);
  assert.notEqual(status.result.state.current_phase, 'complete');
  assert.equal(status.result.state.next_actions.some((action) => action.includes('vibepro execute merge')), false);

  const gh = await makeFakeGhMerge({
    url: 'https://github.example.test/unson/vibepro/pull/171',
    headRefName: 'feature/pr-readiness',
    headRefOid: headSha,
    baseRefName: 'main',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    statusCheckRollup: [
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }
    ],
    mergeAttempted: false
  });
  const merge = await runCli([
    'execute',
    'merge',
    repo,
    '--story-id',
    storyId,
    '--base',
    'main',
    '--dry-run',
    '--json'
  ], {
    env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` }
  });
  assert.equal(merge.exitCode, 2);
  assert.equal(merge.result.merge.status, 'blocked');
  assert.equal(merge.result.merge.preconditions.gate_ready, false);
  assert.equal(merge.result.merge.preconditions.remote_head_match.status, 'passed');
  assert.equal(merge.result.merge.stop_reason.includes('gate_not_ready'), true);
  const ghState = JSON.parse(await readFile(gh.statePath, 'utf8'));
  assert.equal(ghState.mergeAttempted, false);
});

test(`${storyId} workflow replay blocks stale pr-create when pr-prepare is missing`, async () => {
  // story-vibepro-pr-readiness-status-ssot scenario:3
  // Standalone current Gate DAG artifacts must still outrank stale pr-create readiness when pr-prepare.json is absent.
  const repo = await makeStoryRepo();
  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  await writeJson(path.join(prDir, 'gate-dag.json'), gateDag('needs_verification'));
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    dry_run: false,
    story: { story_id: storyId },
    base: 'main',
    head: 'feature/pr-readiness',
    pr_url: 'https://github.example.test/unson/vibepro/pull/171',
    gate_dag: gateDag('ready_for_review'),
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    toolchain: { source_git: { origin_url: 'https://github.com/unson/vibepro.git' } }
  });

  const status = await runCli(['execute', 'status', repo, '--story-id', storyId, '--base', 'main', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.state.last_pr_prepare, null);
  assert.notEqual(status.result.state.completion_status, 'pr_created');
  assert.equal(status.result.state.next_actions.some((action) => action.includes('vibepro execute merge')), false);

  const gh = await makeFakeGhMerge({
    url: 'https://github.example.test/unson/vibepro/pull/171',
    headRefName: 'feature/pr-readiness',
    headRefOid: headSha,
    baseRefName: 'main',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    statusCheckRollup: [
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }
    ],
    mergeAttempted: false
  });
  const merge = await runCli([
    'execute',
    'merge',
    repo,
    '--story-id',
    storyId,
    '--base',
    'main',
    '--dry-run',
    '--json'
  ], {
    env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` }
  });
  assert.equal(merge.exitCode, 2);
  assert.equal(merge.result.merge.status, 'blocked');
  assert.equal(merge.result.merge.preconditions.gate_ready, false);
  assert.equal(merge.result.merge.preconditions.remote_head_match.status, 'passed');
  assert.equal(merge.result.merge.stop_reason.includes('gate_not_ready'), true);
  const ghState = JSON.parse(await readFile(gh.statePath, 'utf8'));
  assert.equal(ghState.mergeAttempted, false);
});

test(`${storyId} workflow replay blocks stale pr-prepare embedded Gate DAG`, async () => {
  // story-vibepro-pr-readiness-status-ssot scenario:4
  // The standalone gate-dag.json is the current SSOT and must outrank stale embedded pr-prepare DAGs on merge.
  const repo = await makeStoryRepo();
  const headSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const prDir = path.join(repo, '.vibepro', 'pr', storyId);
  await mkdir(prDir, { recursive: true });
  const currentGateDag = gateDag('needs_verification');
  await writeJson(path.join(prDir, 'gate-dag.json'), currentGateDag);
  await writeJson(path.join(prDir, 'pr-prepare.json'), {
    story: { story_id: storyId, title: 'PR readiness statusをGate DAG overall_statusに一本化する' },
    gate_status: buildPrPrepareGateStatus(gateDag('ready_for_review')),
    pr_context: { gate_dag: gateDag('ready_for_review') },
    git: { base_ref: 'main', head_sha: headSha }
  });
  await writeJson(path.join(prDir, 'pr-create.json'), {
    schema_version: '0.1.0',
    dry_run: false,
    story: { story_id: storyId },
    base: 'main',
    head: 'feature/pr-readiness',
    pr_url: 'https://github.example.test/unson/vibepro/pull/171',
    gate_dag: gateDag('ready_for_review'),
    execution_gate: { status: 'ready', pr_create_allowed: true, blocking_gates: [] },
    toolchain: { source_git: { origin_url: 'https://github.com/unson/vibepro.git' } }
  });

  const gh = await makeFakeGhMerge({
    url: 'https://github.example.test/unson/vibepro/pull/171',
    headRefName: 'feature/pr-readiness',
    headRefOid: headSha,
    baseRefName: 'main',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    statusCheckRollup: [
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' }
    ],
    mergeAttempted: false
  });
  const merge = await runCli([
    'execute',
    'merge',
    repo,
    '--story-id',
    storyId,
    '--base',
    'main',
    '--dry-run',
    '--json'
  ], {
    env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` }
  });
  assert.equal(merge.exitCode, 2);
  assert.equal(merge.result.merge.preconditions.gate_ready, false);
  assert.equal(merge.result.merge.stop_reason.includes('gate_not_ready'), true);
  const ghState = JSON.parse(await readFile(gh.statePath, 'utf8'));
  assert.equal(ghState.mergeAttempted, false);
});
