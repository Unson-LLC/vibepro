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
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
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
  assert.match(content, /--inspection-input <ref>/);
  assert.match(content, /--judgment-delta/);
  assert.match(content, /inspection_summary/);
  assert.match(content, /inspection_evidence/);
  assert.match(content, /inspection_inputs/);
  assert.match(content, /judgment_delta/);
});

test('parallel dispatch record command and prompt include inspection fields', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  const dispatchPath = path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'parallel-dispatch.md');
  const content = await readFile(dispatchPath, 'utf8');
  assert.match(content, /--inspection-summary "<inspection-summary>"/);
  assert.match(content, /--inspection-evidence <inspection-evidence>/);
  assert.match(content, /--inspection-input <ref>/);
  assert.match(content, /--judgment-delta/);
  assert.match(content, /inspection_summary/);
  assert.match(content, /inspection_evidence/);
  assert.match(content, /inspection_inputs/);
  assert.match(content, /judgment_delta/);
});

test('recordAgentReview without inspection flags rejects gate_evidence pass (INV-RIF-2)', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
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
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
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
  assert.deepEqual(review.inspection.inputs, []);
  assert.deepEqual(review.judgment_delta, []);
});

test('recordAgentReview persists inspection inputs and judgment delta for handoff', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  await startCloseable(root);
  const { review, summary } = await recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'ok',
    inspectionSummary: 'read review request, PR artifacts, and focused tests',
    inspectionEvidence: 'test/review-inspection-first.test.js',
    inspectionInputs: [
      'src/agent-review.js',
      ' .vibepro/reviews/story-test/gate/review-request-gate_evidence.md ',
      'src/agent-review.js'
    ],
    judgmentDeltas: [
      'generic pass concern -> acceptable because concrete inspection inputs are listed',
      'handoff unclear -> clear because judgment delta is recorded'
    ],
    agentSystem: 'claude_code',
    executionMode: 'parallel_subagent',
    agentId: 'task-test-1',
    agentClosed: true
  });
  assert.deepEqual(review.inspection.inputs, [
    'src/agent-review.js',
    '.vibepro/reviews/story-test/gate/review-request-gate_evidence.md'
  ]);
  assert.deepEqual(review.judgment_delta, [
    'generic pass concern -> acceptable because concrete inspection inputs are listed',
    'handoff unclear -> clear because judgment delta is recorded'
  ]);
  const role = summary.roles.find((item) => item.role === 'gate_evidence');
  assert.deepEqual(role.inspection.inputs, review.inspection.inputs);
  assert.deepEqual(role.judgment_delta, review.judgment_delta);
  const markdown = await readFile(path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'review-summary.md'), 'utf8');
  assert.match(markdown, /inputs=src\/agent-review\.js/);
  assert.match(markdown, /judgment_delta=generic pass concern -> acceptable/);
});

test('recordAgentReview rejects whitespace-only inspection for gate_evidence pass', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
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
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
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
  assert.deepEqual(role.inspection, { summary: 'verified contract via test suite', evidence: null, inputs: [] });
  assert.deepEqual(role.judgment_delta, []);
});

test('review record CLI persists inspection summary and evidence', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
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
    '--inspection-input',
    'src/agent-review.js',
    '--inspection-input',
    '.vibepro/reviews/story-test/gate/review-request-gate_evidence.md',
    '--judgment-delta',
    'initial uncertainty -> pass because focused inspection was recorded',
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
    evidence: 'test/review-inspection-first.test.js',
    inputs: [
      'src/agent-review.js',
      '.vibepro/reviews/story-test/gate/review-request-gate_evidence.md'
    ]
  });
  assert.deepEqual(review.judgment_delta, [
    'initial uncertainty -> pass because focused inspection was recorded'
  ]);
});
