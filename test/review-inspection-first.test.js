import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  INVESTIGATION_GUIDELINES_BLOCK,
  prepareAgentReview,
  recordAgentReview,
  getAgentReviewStatus,
  startAgentReviewLifecycle
} from '../src/agent-review.js';
import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-inspection-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await writeFile(path.join(root, 'README.md'), '# test');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'init']);
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', selected_story_id: 'story-test' })
  );
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(
    path.join(root, 'docs', 'management', 'stories', 'active', 'story-test.md'),
    '---\nstory_id: story-test\ntitle: Test\n---\n\n# Story\n\n## Background\nTest.\n\n## Acceptance Criteria\n- Test.\n'
  );
  return root;
}

async function startCloseable(root) {
  return startAgentReviewLifecycle(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    agentSystem: 'claude_code',
    agentId: 'task-test-1',
    timeoutMs: 600000
  });
}

test('INVESTIGATION_GUIDELINES_BLOCK exports a non-empty string mentioning read-only checks', () => {
  assert.equal(typeof INVESTIGATION_GUIDELINES_BLOCK, 'string');
  assert.ok(INVESTIGATION_GUIDELINES_BLOCK.length > 0);
  assert.match(INVESTIGATION_GUIDELINES_BLOCK, /read-only/i);
  assert.match(INVESTIGATION_GUIDELINES_BLOCK, /inspection/i);
  assert.match(INVESTIGATION_GUIDELINES_BLOCK, /--inspection-summary/);
});

test('review request markdown emits Investigation Guidelines between Mandatory Review Lenses and Instructions (INV-RIF-1)', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'] });
  const requestPath = path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'review-request-gate_evidence.md');
  const content = await readFile(requestPath, 'utf8');
  const lensesIdx = content.indexOf('## Mandatory Review Lenses');
  const guidelinesIdx = content.indexOf('## Investigation Guidelines');
  const instructionsIdx = content.indexOf('## Instructions');
  assert.ok(lensesIdx >= 0);
  assert.ok(guidelinesIdx >= 0, 'Investigation Guidelines section must be present');
  assert.ok(instructionsIdx >= 0);
  assert.ok(guidelinesIdx > lensesIdx, 'Investigation Guidelines must come after Mandatory Review Lenses');
  assert.ok(guidelinesIdx < instructionsIdx, 'Investigation Guidelines must come before Instructions');
  assert.ok(content.includes(INVESTIGATION_GUIDELINES_BLOCK), 'block must be interpolated verbatim');
  assert.match(content, /--inspection-summary "<inspection-summary>"/);
  assert.match(content, /--inspection-evidence <inspection-evidence>/);
  assert.match(content, /inspection_summary/);
  assert.match(content, /inspection_evidence/);
});

test('parallel dispatch record command and prompt include inspection fields', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'] });
  const dispatchPath = path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'parallel-dispatch.md');
  const content = await readFile(dispatchPath, 'utf8');
  assert.match(content, /--inspection-summary "<inspection-summary>"/);
  assert.match(content, /--inspection-evidence <inspection-evidence>/);
  assert.match(content, /inspection_summary/);
  assert.match(content, /inspection_evidence/);
});

test('recordAgentReview without inspection flags rejects gate_evidence pass (INV-RIF-2)', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'] });
  await startCloseable(root);
  await assert.rejects(recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'no findings',
    agentSystem: 'claude_code',
    executionMode: 'parallel_subagent',
    agentId: 'task-test-1',
    agentClosed: true
  }), /requires --inspection-summary/);
});

test('recordAgentReview persists inspection.summary verbatim (INV-RIF-3)', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'] });
  await startCloseable(root);
  const summaryText = 'ran node --test test/foo.test.js, read src/foo.js:1-100; no destructive paths touched';
  const { review } = await recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'ok',
    inspectionSummary: summaryText,
    inspectionEvidence: 'test/foo.test.js',
    agentSystem: 'claude_code',
    executionMode: 'parallel_subagent',
    agentId: 'task-test-1',
    agentClosed: true
  });
  assert.equal(review.inspection.summary, summaryText);
  assert.equal(review.inspection.evidence, 'test/foo.test.js');
});

test('recordAgentReview rejects whitespace-only inspection for gate_evidence pass', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'] });
  await startCloseable(root);
  await assert.rejects(recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'ok',
    inspectionSummary: '   ',
    inspectionEvidence: '',
    agentSystem: 'claude_code',
    executionMode: 'parallel_subagent',
    agentId: 'task-test-1',
    agentClosed: true
  }), /requires --inspection-summary/);
});

test('getAgentReviewStatus surfaces the inspection block per role', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'] });
  await startCloseable(root);
  await recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'ok',
    inspectionSummary: 'verified contract via test suite',
    agentSystem: 'claude_code',
    executionMode: 'parallel_subagent',
    agentId: 'task-test-1',
    agentClosed: true
  });
  const status = await getAgentReviewStatus(root, { storyId: 'story-test', stage: 'gate' });
  const role = status.stages[0].roles.find((r) => r.role === 'gate_evidence');
  assert.ok(role, 'gate_evidence role missing from status');
  assert.deepEqual(role.inspection, { summary: 'verified contract via test suite', evidence: null });
});

test('review record CLI persists inspection summary and evidence', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'] });
  await startCloseable(root);
  await runCli([
    'review',
    'record',
    root,
    '--id',
    'story-test',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'ok',
    '--inspection-summary',
    'read src/agent-review.js and ran focused review tests',
    '--inspection-evidence',
    'test/review-inspection-first.test.js',
    '--agent-system',
    'claude_code',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'task-test-1',
    '--agent-closed'
  ]);
  const review = JSON.parse(await readFile(
    path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'review-result-gate_evidence.json'),
    'utf8'
  ));
  assert.deepEqual(review.inspection, {
    summary: 'read src/agent-review.js and ran focused review tests',
    evidence: 'test/review-inspection-first.test.js'
  });
});
