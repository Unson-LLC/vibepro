import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { createUsageReport } from '../src/usage-report.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function setupRepo({ storyBody, sourceFile, sourceContent }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-fastlane-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-fastlane', '--title', 'Fast lane story']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-fastlane.md'), storyBody);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/fastlane']);
  await mkdir(path.dirname(path.join(root, sourceFile)), { recursive: true });
  await writeFile(path.join(root, sourceFile), sourceContent);
  await git(root, ['add', sourceFile]);
  await git(root, ['commit', '-m', `feat: ${sourceFile}`]);
  return root;
}

function gateNode(prepare, id) {
  return prepare.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

const DOCS_STORY = '---\nstory_id: story-fastlane\ntitle: Fast lane story\n---\n\n# Story\n\n## Background\nUpdate the README documentation only.\n\n## Acceptance Criteria\n- Improve README wording.\n';
const API_STORY = '---\nstory_id: story-fastlane\ntitle: Fast lane story\n---\n\n# Story\n\n## Background\nNew server_api endpoint with auth.\n\n## Acceptance Criteria\n- Add a server_api route that enforces auth and returns 201.\n';

test('docs-only low-risk change engages fast lane and N/As agent review', async () => {
  const root = await setupRepo({ storyBody: DOCS_STORY, sourceFile: 'README.md', sourceContent: '# Hello world\n' });
  await runCli(['pr', 'prepare', root, '--story-id', 'story-fastlane', '--base', 'main', '--json']);
  const prepare = await readJson(path.join(root, '.vibepro', 'pr', 'story-fastlane', 'pr-prepare.json'));

  const fastLane = gateNode(prepare, 'gate:fast_lane');
  assert.ok(fastLane, 'fast_lane node must be present when engaged');
  assert.equal(fastLane.evaluation.applicable, true);

  const agentReview = gateNode(prepare, 'gate:agent_review');
  assert.equal(agentReview.status, 'not_applicable', 'agent review must be typed N/A under fast lane');
  assert.equal(agentReview.required, false);
  assert.match(agentReview.reason, /fast lane/i);

  assert.equal(prepare.gate_status.fast_lane, true);
  // Fast lane waives agent review specifically: it must not appear in the blocking set,
  // and no agent-review dispatch instruction should be required.
  const blockingIds = prepare.gate_status.unresolved_gates.map((gate) => gate.id);
  assert.ok(!blockingIds.includes('gate:agent_review'), 'agent review must not block under fast lane');
  assert.ok(!blockingIds.some((id) => id.startsWith('review:')), 'no review process nodes should block under fast lane');
  assert.equal(prepare.gate_status.agent_review_dispatch_required, false, 'fast lane must not require agent review dispatch');

  // fast lane node must be reachable: dag connectivity stays satisfied
  const edges = prepare.pr_context.gate_dag.edges;
  assert.ok(edges.some((edge) => edge.to === 'gate:fast_lane'), 'gate:fast_lane must have an incoming edge');
  assert.ok(edges.some((edge) => edge.from === 'gate:fast_lane'), 'gate:fast_lane must have an outgoing edge');
  const dagConn = gateNode(prepare, 'gate:dag_connectivity');
  assert.equal(dagConn.status, 'passed', 'fast lane must not break dag connectivity');

  // human review surface is not skipped
  const humanReview = await readJson(path.join(root, '.vibepro', 'pr', 'story-fastlane', 'human-review.json'));
  assert.ok(humanReview, 'human-review.json must still be generated under fast lane');
});

test('risk-surface change does not engage fast lane', async () => {
  const root = await setupRepo({ storyBody: API_STORY, sourceFile: 'src/api/widgets.js', sourceContent: 'export function handler() {}\n' });
  await runCli(['pr', 'prepare', root, '--story-id', 'story-fastlane', '--base', 'main', '--json']);
  const prepare = await readJson(path.join(root, '.vibepro', 'pr', 'story-fastlane', 'pr-prepare.json'));

  const fastLane = gateNode(prepare, 'gate:fast_lane');
  assert.ok(!fastLane || fastLane.evaluation.applicable === false, 'fast lane must not engage on risk surfaces');
  const agentReview = gateNode(prepare, 'gate:agent_review');
  assert.notEqual(agentReview.status, 'not_applicable', 'agent review must remain required on risk surfaces');
  assert.notEqual(prepare.gate_status.fast_lane, true);
});

test('usage report counts fast lane stories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-fastlane-report-'));
  const storyDir = path.join(root, 'docs', 'management', 'stories', 'active');
  await mkdir(storyDir, { recursive: true });
  const prDir = path.join(root, '.vibepro', 'pr', 'story-fl');
  await mkdir(prDir, { recursive: true });
  await writeFile(path.join(storyDir, 'story-fl.md'), '---\nstory_id: story-fl\ntitle: fl\nstatus: active\n---\n\n# s\n');
  await writeFile(path.join(prDir, 'pr-prepare.json'), JSON.stringify({
    schema_version: '0.1.0',
    created_at: '2026-06-12T00:00:00.000Z',
    story: { story_id: 'story-fl' },
    gate_status: { overall_status: 'ready_for_review', ready_for_pr_create: true, fast_lane: true }
  }));
  const report = await createUsageReport(root);
  assert.equal(report.value_signals.fast_lane_story_count, 1);
  const story = report.stories.find((item) => item.story_id === 'story-fl');
  assert.equal(story.fast_lane, true);
});
