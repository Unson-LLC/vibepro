import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

const STORY_DOC = `---
story_id: story-independence
title: Independence story
---

# Story

## Background
Reviewer identity must be auditable.

## Acceptance Criteria
- provenance carries reviewer identity.
`;

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-independence-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-independence', '--title', 'Independence story']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-independence.md'), STORY_DOC);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/independence']);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'independence.js'), 'export const independence = true;\n');
  await git(root, ['add', 'src/independence.js']);
  await git(root, ['commit', '-m', 'feat: add source']);
  return root;
}

async function recordGateEvidenceReview(root, extraArgs = []) {
  const transcriptDir = path.join(root, '.vibepro', 'reviews', 'story-independence', 'gate', 'transcripts');
  await mkdir(transcriptDir, { recursive: true });
  const transcript = path.join(transcriptDir, 'gate-evidence.md');
  await writeFile(transcript, '# transcript\npass\n');
  return runCli([
    'review', 'record', root,
    '--id', 'story-independence',
    '--stage', 'gate',
    '--role', 'gate_evidence',
    '--status', 'pass',
    '--summary', 'evidence current and bound',
    '--inspection-summary', 'inspected diff and evidence bindings',
    '--inspection-input', 'src/independence.js',
    '--judgment-delta', 'initial doubt -> pass because evidence current',
    '--agent-system', 'claude_code',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', 'reviewer-1',
    '--agent-transcript', '.vibepro/reviews/story-independence/gate/transcripts/gate-evidence.md',
    '--agent-closed',
    ...extraArgs,
    '--json'
  ]);
}

test('review record persists explicit reviewer identity declaration', async () => {
  const root = await setupRepo();
  const result = await recordGateEvidenceReview(root, [
    '--reviewer-identity', 'same_session',
    '--implementation-session-id', 'session-impl-1',
    '--agent-session-id', 'session-impl-1'
  ]);
  assert.equal(result.exitCode, 0);
  const review = await readJson(path.join(root, '.vibepro', 'reviews', 'story-independence', 'gate', 'review-result-gate_evidence.json'));
  const identity = review.agent_provenance.reviewer_identity;
  assert.equal(identity.relation, 'same_session');
  assert.equal(identity.source, 'cli_flag');
  assert.equal(identity.reviewer_session_id, 'session-impl-1');
  assert.equal(identity.implementation_session_id, 'session-impl-1');
  // Identity must not change provenance strength grading (INV-ARIP-2).
  assert.equal(review.agent_provenance.evidence_strength, 'strong');
});

test('review record derives reviewer identity from session ids and defaults to unknown', async () => {
  const root = await setupRepo();
  await recordGateEvidenceReview(root, [
    '--implementation-session-id', 'session-impl-1',
    '--agent-session-id', 'session-review-2'
  ]);
  let review = await readJson(path.join(root, '.vibepro', 'reviews', 'story-independence', 'gate', 'review-result-gate_evidence.json'));
  assert.equal(review.agent_provenance.reviewer_identity.relation, 'separate_session');
  assert.equal(review.agent_provenance.reviewer_identity.source, 'derived_session_ids');

  await recordGateEvidenceReview(root, [
    '--implementation-session-id', 'session-impl-1',
    '--agent-session-id', 'session-impl-1'
  ]);
  review = await readJson(path.join(root, '.vibepro', 'reviews', 'story-independence', 'gate', 'review-result-gate_evidence.json'));
  assert.equal(review.agent_provenance.reviewer_identity.relation, 'same_session');

  await recordGateEvidenceReview(root);
  review = await readJson(path.join(root, '.vibepro', 'reviews', 'story-independence', 'gate', 'review-result-gate_evidence.json'));
  assert.equal(review.agent_provenance.reviewer_identity.relation, 'unknown');
  assert.equal(review.agent_provenance.reviewer_identity.source, 'undeclared');
});

test('review record rejects an invalid reviewer identity value', async () => {
  const root = await setupRepo();
  let stderr = '';
  const result = await runCli([
    'review', 'record', root,
    '--id', 'story-independence',
    '--stage', 'gate',
    '--role', 'gate_evidence',
    '--status', 'pass',
    '--summary', 'evidence current and bound',
    '--inspection-summary', 'inspected',
    '--inspection-input', 'src/independence.js',
    '--judgment-delta', 'doubt -> pass',
    '--agent-system', 'claude_code',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', 'reviewer-1',
    '--agent-closed',
    '--reviewer-identity', 'self_review',
    '--json'
  ], {
    stderr: { write(chunk) { stderr += chunk; } }
  });
  assert.notEqual(result.exitCode, 0);
  assert.match(stderr + String(result.error ?? ''), /same_session, separate_session, unknown/);
});

test('pr prepare warns (without failing the gate) when a recorded review is same_session', async () => {
  const root = await setupRepo();
  await recordGateEvidenceReview(root, ['--reviewer-identity', 'same_session']);

  const result = await runCli(['pr', 'prepare', root, '--base', 'main', '--story-id', 'story-independence', '--json']);
  assert.equal(result.exitCode, 0);
  const prepare = await readJson(path.join(root, '.vibepro', 'pr', 'story-independence', 'pr-prepare.json'));
  const gate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:agent_review');
  assert.ok(gate.reviewer_independence, 'gate must expose reviewer_independence');
  assert.equal(gate.reviewer_independence.enforcement, 'warning_only');
  assert.equal(gate.reviewer_independence.same_session_review_count, 1);
  assert.equal(gate.reviewer_independence.same_session_reviews.includes('gate:gate_evidence'), true);
  assert.equal((gate.warnings ?? []).some((w) => /same session|independence/i.test(w)), true);

  const note = prepare.gate_status.agent_review_independence;
  assert.ok(note, 'gate_status must carry the independence note');
  assert.equal(note.status, 'same_session_warning');
  assert.equal(note.same_session_reviews.includes('gate:gate_evidence'), true);

  // Warning-only: the same_session review must not appear as a blocking reason.
  const agentReviewUnresolved = prepare.gate_status.unresolved_gates.find((g) => g.id === 'gate:agent_review');
  if (agentReviewUnresolved) {
    assert.doesNotMatch(agentReviewUnresolved.reason ?? '', /same_session/);
  }
});

test('pr prepare stays silent about independence for legacy reviews without reviewer_identity', async () => {
  const root = await setupRepo();
  await recordGateEvidenceReview(root);
  const reviewPath = path.join(root, '.vibepro', 'reviews', 'story-independence', 'gate', 'review-result-gate_evidence.json');
  const review = await readJson(reviewPath);
  delete review.agent_provenance.reviewer_identity; // simulate a pre-change artifact
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);

  const result = await runCli(['pr', 'prepare', root, '--base', 'main', '--story-id', 'story-independence', '--json']);
  assert.equal(result.exitCode, 0);
  const prepare = await readJson(path.join(root, '.vibepro', 'pr', 'story-independence', 'pr-prepare.json'));
  const gate = prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:agent_review');
  assert.equal(gate.reviewer_independence.same_session_review_count, 0);
  assert.equal(gate.reviewer_independence.unknown_identity_review_count >= 1, true);
  assert.equal((gate.warnings ?? []).some((w) => /same session/i.test(w)), false);
  const note = prepare.gate_status.agent_review_independence;
  assert.equal(note.status, 'no_same_session_reviews');
});
