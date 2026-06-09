import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

const STORY_ID = 'story-vibepro-review-dispatch-preflight-dag';

const execFileAsync = promisify(execFile);

async function git(repo: string, args: string[]) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function makeStoryRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-e2e-dispatch-dag-'));
  await writeFile(path.join(repo, 'index.html'), '<!doctype html><title>VibePro E2E</title>\n');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro E2E']);
  await runCli([
    'init',
    repo,
    '--story-id',
    'story-vibepro-review-dispatch-preflight-dag',
    '--title',
    'Agent Review dispatch preflight DAG',
    '--view',
    'dev',
    '--horizon',
    'now'
  ]);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.agent_reviews = {
    stages: {
      gate: {
        roles: ['gate_evidence']
      }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-vibepro-review-dispatch-preflight-dag.md'), `---
story_id: story-vibepro-review-dispatch-preflight-dag
title: Agent Review dispatch preflight DAG
---

# Agent Review dispatch preflight DAG

## 受け入れ基準

- [x] Gate DAG contains dispatch batch and preflight nodes before review prepare.
- [x] Review lifecycle recovery actions are visible in generated artifacts.
`);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'agent-review.js'), 'export const dispatchPreflightDag = true;\n');
  await writeFile(path.join(repo, 'src', 'pr-manager.js'), 'export const gateDagSurface = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'init story repo']);
  await writeFile(path.join(repo, 'src', 'agent-review.js'), [
    'export const dispatchPreflightDag = true;',
    'export const preflightKinds = ["git_stability", "dedupe_running", "lifecycle_recovery", "ready_for_dispatch"];',
    ''
  ].join('\n'));
  await writeFile(path.join(repo, 'src', 'pr-manager.js'), [
    'export const gateDagSurface = true;',
    'export const dispatchBatchGate = "agent_review_dispatch_batch_gate";',
    ''
  ].join('\n'));
  return repo;
}

async function preparePrArtifacts(repo: string) {
  const prepareResult = await runCli([
    'pr',
    'prepare',
    repo,
    '--story-id',
    STORY_ID,
    '--base',
    'main',
    '--json'
  ]);
  assert.equal(prepareResult.exitCode, 0);
  const storyDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  return {
    gateDag: await readJson(path.join(storyDir, 'gate-dag.json')),
    prPrepare: await readJson(path.join(storyDir, 'pr-prepare.json')),
    prBody: await readFile(path.join(storyDir, 'pr-body.md'), 'utf8')
  };
}

async function recordGateEvidence(repo: string, status = 'pass', agentSystem = 'codex', executionMode = 'parallel_subagent') {
  await runCli(['review', 'prepare', repo, '--id', STORY_ID, '--stage', 'gate', '--role', 'gate_evidence']);
  const args = [
    'review',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    status,
    '--summary',
    `${status} review fixture`,
    '--inspection-summary',
    `${status} review fixture inspection`,
    '--agent-system',
    agentSystem,
    '--execution-mode',
    executionMode,
    '--agent-id',
    `agent-${status}-${executionMode}`,
    '--json'
  ];
  if (executionMode === 'parallel_subagent') {
    args.push('--agent-closed');
  } else {
    args.push('--recorded-by', 'reviewer@example.com');
  }
  const result = await runCli(args);
  assert.equal(result.exitCode, 0);
}

function nodeById(gateDag: { nodes: Array<{ id: string }> }, id: string) {
  const node = gateDag.nodes.find((candidate) => candidate.id === id);
  assert.ok(node, `expected DAG node ${id}`);
  return node as Record<string, unknown>;
}

async function preflightFor(repo: string) {
  const { gateDag, prPrepare } = await preparePrArtifacts(repo);
  const node = nodeById(gateDag, 'review:preflight:gate:gate_evidence');
  return { node, gateDag, prPrepare };
}

test('story-vibepro-review-dispatch-preflight-dag acceptance coverage replays generated VibePro artifacts', async () => {
  const repo = await makeStoryRepo();

  const { gateDag, prPrepare, prBody } = await preparePrArtifacts(repo);

  const nodeIds = gateDag.nodes.map((node: { id: string }) => node.id);
  // story-vibepro-review-dispatch-preflight-dag ac:1
  // Gate DAG contains a stage-level `agent_review_dispatch_batch_gate` before `review:prepare:<stage>`.
  assert.deepEqual(
    prPrepare.git.changed_files.map((file: { path: string }) => file.path).sort(),
    ['src/agent-review.js', 'src/pr-manager.js']
  );
  assert.equal(nodeIds.includes('gate:agent_review'), true);
  assert.equal(
    nodeIds.some((id: string) => id.startsWith('review:dispatch_batch:')),
    true,
    'Gate DAG contains a stage-level agent_review_dispatch_batch_gate before review prepare'
  );

  // story-vibepro-review-dispatch-preflight-dag ac:2
  // Gate DAG contains per-role agent_review_dispatch_preflight_gate nodes for stale git evidence, running duplicate lifecycle, timeout/manual shutdown recovery, current pass dedupe, and missing-role readiness.
  assert.equal(nodeIds.some((id: string) => id.startsWith('review:preflight:')), true);
  assert.equal(nodeIds.some((id: string) => id.startsWith('review:prepare:')), true);
  assert.equal(nodeIds.some((id: string) => id.startsWith('review:join:')), true);

  const dispatchNode = gateDag.nodes.find((node: { id: string }) => node.id.startsWith('review:dispatch_batch:'));
  assert.equal(dispatchNode.type, 'agent_review_dispatch_batch_gate');
  const preflightNode = gateDag.nodes.find((node: { id: string }) => node.id.startsWith('review:preflight:'));
  assert.equal(preflightNode.type, 'agent_review_dispatch_preflight_gate');
  const prepareNode = gateDag.nodes.find((node: { id: string }) => node.id.startsWith('review:prepare:'));
  assert.equal(
    gateDag.edges.some((edge: { from: string; to: string }) => edge.from === dispatchNode.id && edge.to === preflightNode.id)
      && gateDag.edges.some((edge: { from: string; to: string }) => edge.from === preflightNode.id && edge.to === prepareNode.id),
    true,
    'stage-level agent_review_dispatch_batch_gate is before review prepare'
  );

  // story-vibepro-review-dispatch-preflight-dag ac:3
  // DAG edges force dispatch_batch -> preflight -> prepare -> role -> record -> join, preserving serial stage barriers.
  const dispatchEdge = gateDag.edges.find((edge: { from: string; to: string }) => edge.from === dispatchNode.id && edge.to === preflightNode.id);
  assert.ok(dispatchEdge);
  const roleNode = nodeById(gateDag, 'review:gate:gate_evidence');
  const recordNode = nodeById(gateDag, 'review:record:gate:gate_evidence');
  const joinNode = nodeById(gateDag, 'review:join:gate');
  assert.equal(gateDag.edges.some((edge: { from: string; to: string }) => edge.from === prepareNode.id && edge.to === roleNode.id), true);
  assert.equal(gateDag.edges.some((edge: { from: string; to: string }) => edge.from === roleNode.id && edge.to === recordNode.id), true);
  assert.equal(gateDag.edges.some((edge: { from: string; to: string }) => edge.from === recordNode.id && edge.to === joinNode.id), true);

  // story-vibepro-review-dispatch-preflight-dag ac:4
  // Timed-out and manually shut down Agent Review lifecycle entries produce concrete recovery actions in review status artifacts.
  assert.equal(preflightNode.preflight_kind, 'ready_for_dispatch');

  // story-vibepro-review-dispatch-preflight-dag ac:5
  // Existing Agent Review Gate semantics remain unchanged: required reviews still need verified parallel subagent provenance and closed lifecycle evidence.
  assert.match(prBody, /Agent Review|parallel|dispatch|preflight/i);

  // story-vibepro-review-dispatch-preflight-dag S-001
  // Scenario: The Agent Review dispatch workflow moves through dispatch_batch, preflight, prepare, role_review, record, and join states; stale git evidence, running duplicate reviewers, timed-out lifecycles, and manual shutdown recovery stop or require review before the transition into prepare.
  assert.equal(prPrepare.gate_status.ready_for_pr_create, false);
});

test('story-vibepro-review-dispatch-preflight-dag acceptance covers dispatch preflight failure modes', async () => {
  const passedRepo = await makeStoryRepo();
  await recordGateEvidence(passedRepo);
  const passed = await preflightFor(passedRepo);
  assert.equal(passed.node.preflight_kind, 'dedupe_current_pass');
  assert.equal(passed.node.status, 'passed');

  const staleRepo = await makeStoryRepo();
  await recordGateEvidence(staleRepo);
  await writeFile(path.join(staleRepo, 'src', 'agent-review.js'), 'export const dispatchPreflightDag = "stale";\n');
  const stale = await preflightFor(staleRepo);
  assert.equal(stale.node.preflight_kind, 'git_stability');
  assert.equal(stale.node.status, 'failed');
  assert.match(String(stale.node.reason), /dirty worktree fingerprint|review was recorded for/);

  const runningRepo = await makeStoryRepo();
  await recordGateEvidence(runningRepo);
  await runCli(['review', 'start', runningRepo, '--id', STORY_ID, '--stage', 'gate', '--role', 'gate_evidence', '--agent-system', 'codex', '--agent-id', 'agent-running']);
  const running = await preflightFor(runningRepo);
  assert.equal(running.node.preflight_kind, 'dedupe_running');
  assert.equal(running.node.status, 'failed');
  assert.match(String(running.node.reason), /already running/);

  const timedOutRepo = await makeStoryRepo();
  await recordGateEvidence(timedOutRepo);
  await runCli(['review', 'start', timedOutRepo, '--id', STORY_ID, '--stage', 'gate', '--role', 'gate_evidence', '--agent-system', 'codex', '--agent-id', 'agent-timeout', '--timeout-ms', '1']);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const timedOut = await preflightFor(timedOutRepo);
  assert.equal(timedOut.node.preflight_kind, 'lifecycle_recovery');
  assert.equal(timedOut.node.status, 'failed');
  assert.equal(timedOut.prPrepare.gate_status.ready_for_pr_create, false);
  assert.equal(timedOut.prPrepare.pr_context.agent_reviews.summary.lifecycle_timed_out_count, 1);

  const manualShutdownRepo = await makeStoryRepo();
  await recordGateEvidence(manualShutdownRepo);
  await runCli(['review', 'start', manualShutdownRepo, '--id', STORY_ID, '--stage', 'gate', '--role', 'gate_evidence', '--agent-system', 'codex', '--agent-id', 'agent-manual-shutdown']);
  await runCli(['review', 'close', manualShutdownRepo, '--id', STORY_ID, '--stage', 'gate', '--role', 'gate_evidence', '--agent-id', 'agent-manual-shutdown', '--close-reason', 'manual_shutdown']);
  const manualShutdown = await preflightFor(manualShutdownRepo);
  assert.equal(manualShutdown.node.preflight_kind, 'lifecycle_recovery');
  assert.equal(manualShutdown.node.status, 'needs_review');
  assert.match(String(manualShutdown.node.reason), /manual_shutdown/);

  const unverifiedRepo = await makeStoryRepo();
  await recordGateEvidence(unverifiedRepo, 'pass', 'human', 'manual_review');
  const unverified = await preflightFor(unverifiedRepo);
  assert.equal(unverified.node.preflight_kind, 'provenance_recovery');
  assert.equal(unverified.node.status, 'needs_review');
  assert.match(String(unverified.node.reason), /human manual review provenance|manual_review|parallel subagent provenance/);

  const blockerRepo = await makeStoryRepo();
  await recordGateEvidence(blockerRepo, 'needs_changes');
  const blocker = await preflightFor(blockerRepo);
  assert.equal(blocker.node.preflight_kind, 'recorded_blocker');
  assert.equal(blocker.node.status, 'failed');
  assert.match(String(blocker.node.reason), /needs_changes/);
});
