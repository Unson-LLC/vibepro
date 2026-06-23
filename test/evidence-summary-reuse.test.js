import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { buildEvidenceReuse, buildEvidenceReuseGate } from '../src/evidence-reuse.js';
import { runCli } from '../src/cli.js';
import { createUsageReport, renderUsageReport } from '../src/usage-report.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-evidence-reuse';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function setupReuseRepo({ withSpec = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-evidence-reuse-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await writeFile(path.join(root, 'README.md'), '# Reuse\n');
  await runCli(['init', root, '--story-id', STORY_ID, '--title', 'Evidence reuse']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: Evidence reuse
---

# Story

## Acceptance Criteria
- Update docs without changing runtime behavior.
`);
  if (withSpec) await writeSpec(root, 'initial spec clause');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/evidence-reuse']);
  await writeFile(path.join(root, 'README.md'), '# Reuse\n\nUpdated docs.\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'docs: update reuse notes']);
  return root;
}

async function writeSpec(root, statement) {
  const specDir = path.join(root, '.vibepro', 'spec', STORY_ID);
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, 'spec.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    generated_at: '2026-06-23T00:00:00.000Z',
    clauses: [
      { id: 'SPEC-001', type: 'scenario', statement }
    ]
  }, null, 2));
}

test('pr prepare reuses fresh summary/index and keeps full evidence generation count at one', async () => {
  const repo = await setupReuseRepo();

  const first = await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(first.exitCode, 0);
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  const firstReuse = await readJson(path.join(prDir, 'evidence-reuse.json'));
  assert.equal(firstReuse.status, 'miss');
  assert.equal(firstReuse.full_evidence.status, 'generated');
  assert.equal(firstReuse.full_evidence.generation_count, 1);

  const second = await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(second.exitCode, 0);
  const secondReuse = await readJson(path.join(prDir, 'evidence-reuse.json'));
  const plan = await readJson(path.join(prDir, 'evidence-plan.json'));
  const index = await readJson(path.join(prDir, 'decision-index.json'));
  assert.equal(secondReuse.status, 'hit');
  assert.equal(secondReuse.full_evidence.status, 'reused');
  assert.equal(secondReuse.full_evidence.generation_count, 1);
  assert.equal(plan.evidence_reuse.evidence_key, secondReuse.evidence_key);
  assert.equal(index.evidence_reuse.evidence_key, secondReuse.evidence_key);

  const review = await runCli(['review', 'prepare', repo, '--id', STORY_ID, '--stage', 'implementation', '--role', 'runtime_contract', '--json']);
  assert.equal(review.exitCode, 0);
  assert.equal(review.result.plan.evidence_reuse.status, 'fresh');
  assert.equal(review.result.plan.evidence_reuse.first_input, true);
  assert.equal(review.result.plan.evidence_reuse.preferred_order[0], `.vibepro/pr/${STORY_ID}/evidence-reuse.json`);
  const request = await readFile(path.join(repo, '.vibepro', 'reviews', STORY_ID, 'implementation', 'review-request-runtime_contract.md'), 'utf8');
  assert.match(request, /Evidence Reuse First Input/);
  assert.match(request, /evidence-reuse\.json/);

  const report = await createUsageReport(repo, { language: 'ja' });
  assert.equal(report.evidence_reuse.hit_count, 1);
  assert.equal(report.evidence_reuse.by_story[0].latest_status, 'hit');
  assert.match(renderUsageReport(report), /Evidence Reuse/);
});

test('head changes mark previous summary/index stale', async () => {
  const repo = await setupReuseRepo();
  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  await writeFile(path.join(repo, 'README.md'), '# Reuse\n\nUpdated docs again.\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, ['commit', '-m', 'docs: update reuse notes again']);

  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const reuse = await readJson(path.join(repo, '.vibepro', 'pr', STORY_ID, 'evidence-reuse.json'));
  assert.equal(reuse.status, 'stale');
  assert.ok(reuse.stale_reasons.some((reason) => reason.field === 'head_sha'));
  assert.equal(reuse.fresh_use_allowed, false);
  assert.equal(reuse.full_evidence.status, 'generated');
  assert.equal(reuse.full_evidence.generation_count, 2);
});

test('spec fingerprint changes mark previous summary/index stale without head changes', async () => {
  const repo = await setupReuseRepo({ withSpec: true });
  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  await writeSpec(repo, 'changed spec clause');

  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const reuse = await readJson(path.join(repo, '.vibepro', 'pr', STORY_ID, 'evidence-reuse.json'));
  assert.equal(reuse.status, 'stale');
  assert.ok(reuse.stale_reasons.some((reason) => reason.field === 'spec_fingerprint'));
});

test('ESR-CONTRACT-005 verification evidence timestamps mark previous summary/index stale without head changes', () => {
  const base = {
    story: { story_id: STORY_ID },
    git: { base_ref: 'main', base_sha: 'base', head_ref: 'HEAD', head_sha: 'head-a' },
    evidencePlan: { story_id: STORY_ID, planner_version: '0.1.0', evidence_depth: 'summary' },
    decisionIndex: { story_id: STORY_ID, evidence_depth: 'summary' }
  };
  const first = buildEvidenceReuse({
    ...base,
    verificationEvidence: {
      schema_version: '0.1.0',
      story_id: STORY_ID,
      updated_at: '2026-06-23T00:00:00.000Z',
      commands: [
        {
          kind: 'unit',
          status: 'pass',
          command: 'node --test test/evidence-summary-reuse.test.js',
          executed_at: '2026-06-23T00:00:00.000Z',
          git_context: {
            head_sha: 'head-a',
            recorded_at: '2026-06-23T00:00:00.000Z'
          },
          artifact_check: { status: 'unrecognized' },
          observation_check: { status: 'recorded' }
        }
      ]
    }
  });
  const second = buildEvidenceReuse({
    ...base,
    verificationEvidence: {
      schema_version: '0.1.0',
      story_id: STORY_ID,
      updated_at: '2026-06-23T00:05:00.000Z',
      commands: [
        {
          kind: 'unit',
          status: 'pass',
          command: 'node --test test/evidence-summary-reuse.test.js',
          executed_at: '2026-06-23T00:05:00.000Z',
          git_context: {
            head_sha: 'head-a',
            recorded_at: '2026-06-23T00:05:00.000Z'
          },
          artifact_check: { status: 'unrecognized' },
          observation_check: { status: 'recorded' }
        }
      ]
    },
    previousReuse: first
  });
  const gate = buildEvidenceReuseGate(second);

  assert.equal(first.status, 'miss');
  assert.equal(second.status, 'stale');
  assert.notEqual(first.evidence_key, second.evidence_key);
  assert.ok(second.stale_reasons.some((reason) => reason.field === 'verification_summary_fingerprint'));
  assert.ok(second.stale_reasons.some((reason) => reason.field === 'verification_evidence_updated_at'));
  assert.ok(second.stale_reasons.some((reason) => reason.field === 'verification_command_timestamps'));
  assert.equal(gate.status, 'passed');
  assert.equal(gate.evidence.verification_evidence_updated_at, '2026-06-23T00:05:00.000Z');
});

test('stale reuse marked as fresh fails the evidence reuse gate', () => {
  const first = buildEvidenceReuse({
    story: { story_id: STORY_ID },
    git: { base_ref: 'main', base_sha: 'base', head_ref: 'HEAD', head_sha: 'head-a' },
    evidencePlan: { story_id: STORY_ID, planner_version: '0.1.0', evidence_depth: 'summary' },
    decisionIndex: { story_id: STORY_ID, evidence_depth: 'summary' }
  });
  const staleMisuse = buildEvidenceReuse({
    story: { story_id: STORY_ID },
    git: { base_ref: 'main', base_sha: 'base', head_ref: 'HEAD', head_sha: 'head-b' },
    evidencePlan: { story_id: STORY_ID, planner_version: '0.1.0', evidence_depth: 'summary' },
    decisionIndex: { story_id: STORY_ID, evidence_depth: 'summary' },
    previousReuse: first,
    usedAsFresh: true
  });
  const gate = buildEvidenceReuseGate(staleMisuse);
  assert.equal(staleMisuse.status, 'stale');
  assert.equal(gate.status, 'failed');
});
