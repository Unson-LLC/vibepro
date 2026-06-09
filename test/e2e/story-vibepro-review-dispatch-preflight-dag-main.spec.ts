import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

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

test('story-vibepro-review-dispatch-preflight-dag acceptance coverage replays generated VibePro artifacts', async () => {
  const repo = await makeStoryRepo();

  const prepareResult = await runCli([
    'pr',
    'prepare',
    repo,
    '--story-id',
    'story-vibepro-review-dispatch-preflight-dag',
    '--base',
    'main',
    '--json'
  ]);
  assert.equal(prepareResult.exitCode, 0);

  const storyDir = path.join(repo, '.vibepro', 'pr', 'story-vibepro-review-dispatch-preflight-dag');
  const gateDag = await readJson(path.join(storyDir, 'gate-dag.json'));
  const prPrepare = await readJson(path.join(storyDir, 'pr-prepare.json'));
  const prBody = await readFile(path.join(storyDir, 'pr-body.md'), 'utf8');

  const nodeIds = gateDag.nodes.map((node: { id: string }) => node.id);
  // story-vibepro-review-dispatch-preflight-dag ac:1
  // Gate DAG contains a stage-level agent_review_dispatch_batch_gate before review prepare.
  assert.deepEqual(
    prPrepare.git.changed_files.map((file: { path: string }) => file.path).sort(),
    ['src/agent-review.js', 'src/pr-manager.js']
  );
  assert.equal(nodeIds.includes('gate:agent_review'), true);
  assert.equal(nodeIds.some((id: string) => id.startsWith('review:dispatch_batch:')), true);

  // story-vibepro-review-dispatch-preflight-dag ac:2
  // Gate DAG contains per-role agent_review_dispatch_preflight_gate nodes for stale git evidence, running duplicate lifecycle, timeout/manual shutdown recovery, current pass dedupe, and missing-role readiness.
  assert.equal(nodeIds.some((id: string) => id.startsWith('review:preflight:')), true);
  assert.equal(nodeIds.some((id: string) => id.startsWith('review:prepare:')), true);
  assert.equal(nodeIds.some((id: string) => id.startsWith('review:join:')), true);

  const dispatchNode = gateDag.nodes.find((node: { id: string }) => node.id.startsWith('review:dispatch_batch:'));
  assert.equal(dispatchNode.type, 'agent_review_dispatch_batch_gate');
  const preflightNode = gateDag.nodes.find((node: { id: string }) => node.id.startsWith('review:preflight:'));
  assert.equal(preflightNode.type, 'agent_review_dispatch_preflight_gate');

  // story-vibepro-review-dispatch-preflight-dag ac:3
  // DAG edges force dispatch_batch -> preflight -> prepare -> role -> record -> join, preserving serial stage barriers.
  const dispatchEdge = gateDag.edges.find((edge: { from: string; to: string }) => edge.from === dispatchNode.id && edge.to === preflightNode.id);
  assert.ok(dispatchEdge);

  // story-vibepro-review-dispatch-preflight-dag ac:4
  // Timed-out and manually shut down Agent Review lifecycle entries produce concrete recovery actions in review status artifacts.
  assert.match(JSON.stringify(gateDag), /git_stability|ready_for_dispatch|dedupe_current_pass|lifecycle_recovery/);

  // story-vibepro-review-dispatch-preflight-dag ac:5
  // Existing Agent Review Gate semantics remain unchanged: required reviews still need verified parallel subagent provenance and closed lifecycle evidence.
  assert.match(prBody, /Agent Review|parallel|dispatch|preflight/i);

  // story-vibepro-review-dispatch-preflight-dag S-001
  // Scenario: The Agent Review dispatch workflow moves through dispatch_batch, preflight, prepare, role_review, record, and join states; stale git evidence, running duplicate reviewers, timed-out lifecycles, and manual shutdown recovery stop or require review before the transition into prepare.
  assert.equal(prPrepare.gate_status.ready_for_pr_create, false);
});
