import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-workflow-pre-pr-evidence-gate';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function makeWorkflowRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-workflow-pre-pr-e2e-'));
  await writeFile(path.join(repo, 'index.html'), '<!doctype html><title>Workflow gate</title>\n');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro E2E']);
  await runCli([
    'init',
    repo,
    '--story-id',
    STORY_ID,
    '--title',
    'Workflow pre-PR evidence gate',
    '--view',
    'dev',
    '--horizon',
    'now'
  ]);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: Workflow pre-PR evidence gate
architecture_docs:
  reason: workflow state and review dispatch surfaces are documented
---

# Workflow pre-PR evidence gate

## 背景

Sample generation must run a preflight workflow, start detection, poll status, and keep Agent Review dispatch artifacts reconstructable without requiring a pre-PR preview smoke.

## 受け入れ基準

- [ ] workflow state scenario clause is asserted before PR readiness
- [ ] PR prepare artifacts list only required pre-PR review roles
`);
  await mkdir(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'components'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'batch-jobs', '[id]', 'generate-samples'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'workers'), { recursive: true });
  await mkdir(path.join(repo, 'tests', 'e2e'), { recursive: true });
  await mkdir(path.join(repo, 'artifacts'), { recursive: true });
  await writeFile(path.join(repo, 'artifacts', 'workflow-pre-pr-replay.json'), JSON.stringify({ status: 'pass', replay: 'artifact' }, null, 2));
  await writeFile(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'components', 'PlanTab.tsx'), 'export function PlanTab(){ return <button>Start sample</button>; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'batch-jobs', '[id]', 'generate-samples', 'route.ts'), 'export async function POST(){ return Response.json({ status: "preflight" }); }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'workflowService.ts'), 'export function replayWorkflow(){ return "poll-detection-status"; }\n');
  await writeFile(path.join(repo, 'src', 'workers', 'workflowWorker.ts'), 'export function enqueueWorkflow(){ return "queued"; }\n');
  await writeFile(path.join(repo, 'tests', 'e2e', 'workflow-pre-pr.spec.ts'), `
import { expect, test } from '@playwright/test';
test('workflow pre-PR replay exercises the state transition', async () => {
  // ${STORY_ID} S-001
  // workflow state scenario clause was asserted before PR readiness
  // ${STORY_ID} ac:1
  // workflow state scenario clause is asserted before PR readiness
  expect('poll-detection-status').toContain('status');
  expect('workflow state scenario clause').toContain('scenario');
});
`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'init workflow story']);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'workflowService.ts'), [
    'export function replayWorkflow(){',
    '  return "poll-detection-status-with-required-review-summary";',
    '}',
    ''
  ].join('\n'));
  return repo;
}

test('story-vibepro-workflow-pre-pr-evidence-gate exercises PR prepare artifact replay', async () => {
  const repo = await makeWorkflowRepo();

  const evidenceDepthArgs = [
    '--evidence-depth', 'standard',
    '--evidence-depth-reason', 'exercise persisted pre-PR evidence replay artifacts',
    '--evidence-depth-consumer', 'workflow-pre-pr-e2e',
    '--evidence-depth-target', 'gate-dag.json',
    '--evidence-depth-target', 'pr-prepare.html',
    '--evidence-depth-target', 'review-cockpit.html'
  ];
  const firstPrepare = await runCli([
    'pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json', ...evidenceDepthArgs
  ]);
  assert.equal(firstPrepare.exitCode, 0, firstPrepare.stderr);
  const agentReviews = firstPrepare.result.preparation.pr_context.agent_reviews;
  assert.deepEqual(
    agentReviews.required_reviews.map((item) => `${item.stage}:${item.role}`).sort(),
    [
      'gate:gate_evidence',
      'gate:release_risk'
    ]
  );
  const previewStage = agentReviews.stages.find((stage) => stage.stage === 'preview');
  assert.equal(previewStage, undefined);
  const previewDispatch = agentReviews.parallel_dispatch.required_stages.find((stage) => stage.stage === 'preview');
  assert.equal(previewDispatch, undefined);
  const firstPrDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  const firstPersistedPrepare = await readJson(path.join(firstPrDir, 'pr-prepare.json'));
  const firstPersistedPreviewStage = firstPersistedPrepare.pr_context.agent_reviews.stages.find((stage) => stage.stage === 'preview');
  assert.equal(firstPersistedPreviewStage, undefined);
  assert.equal(
    firstPersistedPrepare.pr_context.agent_reviews.parallel_dispatch.required_stages
      .find((stage) => stage.stage === 'preview'),
    undefined
  );

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
    'npx playwright test tests/e2e/workflow-pre-pr.spec.ts',
    '--summary',
    'Playwright replay exercised the workflow transition and scenario clause before PR readiness',
    '--artifact',
    'artifacts/workflow-pre-pr-replay.json',
    '--scenario',
    'flow_replay: pre-PR Playwright exercised the workflow transition path',
    '--scenario',
    'scenario_clause_e2e: workflow state scenario clause was asserted',
    '--scenario',
    'path_surface:service',
    '--target',
    'tests/e2e/workflow-pre-pr.spec.ts',
    '--target',
    'src/app/api/batch-jobs/[id]/generate-samples/route.ts',
    '--target',
    'src/lib/services/workflowService.ts',
    '--observed',
    'flow_replay=true',
    '--observed',
    'scenario_clause_e2e=true',
    '--observed',
    'surface=service',
    '--observed',
    'api_surface=covered'
  ]);

  await runCli([
    'verify',
    'record',
    repo,
    '--id',
    STORY_ID,
    '--kind',
    'integration',
    '--status',
    'pass',
    '--command',
    'node --test test/risk-adaptive-gate.test.js --test-name-pattern integration',
    '--summary',
    'Artifact replay verified PR prepare review summaries and dispatch commands are required-only',
    '--artifact',
    'artifacts/workflow-pre-pr-replay.json',
    '--scenario',
    'artifact_replay: generated pr prepare artifacts exclude preview_smoke from actionable pre-PR review outputs',
    '--target',
    `.vibepro/pr/${STORY_ID}/pr-prepare.json`,
    '--observed',
    'artifact_replay=covered'
  ]);

  const replayPrepare = await runCli([
    'pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json', ...evidenceDepthArgs
  ]);
  assert.equal(replayPrepare.exitCode, 0, replayPrepare.stderr);
  const gateDag = replayPrepare.result.preparation.pr_context.gate_dag;
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:workflow_flow_replay').status, 'passed');
  const spine = gateDag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  assert.equal(spine.subchecks.find((check) => check.id === 'done_evidence').status, 'passed');
  assert.equal(gateDag.nodes.find((node) => node.id === 'gate:path_surface_matrix').status, 'passed');
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  const persistedPrepare = await readJson(path.join(prDir, 'pr-prepare.json'));
  const persistedGateDag = await readJson(path.join(prDir, 'gate-dag.json'));
  const prBody = await readFile(path.join(prDir, 'pr-body.md'), 'utf8');
  const prPrepareHtml = await readFile(path.join(prDir, 'pr-prepare.html'), 'utf8');
  const cockpitHtml = await readFile(path.join(prDir, 'review-cockpit.html'), 'utf8');
  assert.equal(persistedGateDag.nodes.find((node) => node.id === 'gate:workflow_flow_replay').status, 'passed');
  assert.equal(
    persistedPrepare.pr_context.agent_reviews.parallel_dispatch.required_stages
      .find((stage) => stage.stage === 'preview'),
    undefined
  );
  assert.match(prBody, /\.vibepro\/pr\/story-vibepro-workflow-pre-pr-evidence-gate\/pr-prepare\.json/);
  assert.doesNotMatch(prBody, /preview:network_runtime/);
  assert.doesNotMatch(prBody, /preview:preview_smoke\(missing\)|--role preview_smoke/);
  assert.doesNotMatch(prPrepareHtml, /network_runtime/);
  assert.doesNotMatch(prPrepareHtml, /--role preview_smoke/);
  assert.match(cockpitHtml, /agent review|Agent Review|review/i);
  assert.match(cockpitHtml, /agent-closed|close\/shutdown|close/i);
});
