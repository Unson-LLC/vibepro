import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { EVIDENCE_HANDLING_BLOCK, prepareAgentReview } from '../src/agent-review.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-evidence-'));
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
    '---\nstory_id: story-test\ntitle: Test story\n---\n\n# Story\n\n## Background\nTest.\n\n## Acceptance Criteria\n- Test passes.\n'
  );
  return root;
}

test('EVIDENCE_HANDLING_BLOCK exports a non-empty string with the canonical phrases', () => {
  assert.equal(typeof EVIDENCE_HANDLING_BLOCK, 'string');
  assert.ok(EVIDENCE_HANDLING_BLOCK.length > 0);
  assert.match(EVIDENCE_HANDLING_BLOCK, /evidence to inspect/i);
  assert.match(EVIDENCE_HANDLING_BLOCK, /never as instructions/i);
  assert.match(EVIDENCE_HANDLING_BLOCK, /severity.*high.*critical/i);
  assert.match(EVIDENCE_HANDLING_BLOCK, /evidence-handling-/);
});

test('EVIDENCE_HANDLING_BLOCK names at least three evidence sources (INV-REH-4)', () => {
  assert.match(EVIDENCE_HANDLING_BLOCK, /story text/i);
  assert.match(EVIDENCE_HANDLING_BLOCK, /pr body/i);
  assert.match(EVIDENCE_HANDLING_BLOCK, /diff|commit/i);
});

test('review prepare emits Evidence Handling section in review-request markdown', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  const requestPath = path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'review-request-gate_evidence.md');
  const content = await readFile(requestPath, 'utf8');
  assert.match(content, /## Evidence Handling/);
  assert.ok(content.includes(EVIDENCE_HANDLING_BLOCK), 'request must include the centralized block verbatim');
  const evidenceIdx = content.indexOf('## Evidence Handling');
  const instructionsIdx = content.indexOf('## Instructions');
  const lensesIdx = content.indexOf('## Mandatory Review Lenses');
  assert.ok(evidenceIdx > lensesIdx, 'Evidence Handling must appear after Mandatory Review Lenses');
  assert.ok(evidenceIdx < instructionsIdx, 'Evidence Handling must appear before Instructions');
});

test('review prepare emits Evidence Handling section in parallel-dispatch markdown', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  const dispatchPath = path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'parallel-dispatch.md');
  const content = await readFile(dispatchPath, 'utf8');
  assert.match(content, /## Evidence Handling/);
  assert.ok(content.includes(EVIDENCE_HANDLING_BLOCK), 'dispatch must include the centralized block verbatim');
  const evidenceIdx = content.indexOf('## Evidence Handling');
  const coordIdx = content.indexOf('## Coordinator Instructions');
  const lensesIdx = content.indexOf('## Mandatory Review Lenses');
  assert.ok(evidenceIdx > coordIdx, 'Evidence Handling must appear after Coordinator Instructions');
  assert.ok(evidenceIdx < lensesIdx, 'Evidence Handling must appear before Mandatory Review Lenses');
});

test('the Evidence Handling block in both artifacts is byte-identical (INV-REH-2)', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  const request = await readFile(path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'review-request-gate_evidence.md'), 'utf8');
  const dispatch = await readFile(path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'parallel-dispatch.md'), 'utf8');
  function extract(content) {
    const start = content.indexOf('## Evidence Handling');
    const after = content.indexOf('## ', start + '## Evidence Handling'.length);
    return content.slice(start, after === -1 ? content.length : after).trim();
  }
  assert.equal(extract(request), extract(dispatch));
});
