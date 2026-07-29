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
import { buildArtifactValueLedger } from '../src/evidence-reuse.js';

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

test('ERM-CONTRACT-001 ERM-CONTRACT-003 pr prepare reuses fresh summary/index and keeps full evidence generation count at one', async () => {
  const repo = await setupReuseRepo();

  const first = await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(first.exitCode, 0);
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  const firstReuse = await readJson(path.join(prDir, 'evidence-reuse.json'));
  assert.equal(firstReuse.status, 'miss');
  assert.equal(firstReuse.full_evidence.status, 'generated');
  assert.equal(firstReuse.artifact_value_ledger.status, 'present');
  assert.equal(firstReuse.artifact_value_ledger.summary.decision_bound_count, 4);
  assert.equal(firstReuse.artifact_value_ledger.summary.decision_changed_count, 0);
  assert.equal(firstReuse.artifact_value_ledger.summary.decision_change_unconfirmed_count, 4);
  assert.equal(firstReuse.artifact_value_ledger.summary.unused_artifact_count, 0);
  for (const entry of firstReuse.artifact_value_ledger.entries) {
    assert.match(entry.decision_id, /^story-evidence-reuse:/);
    assert.match(entry.consumer_gate, /^gate:/);
    assert.equal(entry.decision_changed, null);
  }
  assert.equal(firstReuse.artifact_value_ledger.session_attribution_status, 'not_collected_in_pr_prepare');
  assert.equal(firstReuse.session_attribution_ledger.status, 'not_collected_in_pr_prepare');
  assert.equal(firstReuse.full_evidence.generation_count_scope, 'same_evidence_key');
  assert.equal(firstReuse.full_evidence.generation_count, 1);
  assert.equal(firstReuse.full_evidence.same_key_generation_count, 1);
  assert.equal(firstReuse.full_evidence.cumulative_generation_count, 1);

  const second = await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(second.exitCode, 0);
  const secondReuse = await readJson(path.join(prDir, 'evidence-reuse.json'));
  const plan = await readJson(path.join(prDir, 'evidence-plan.json'));
  const index = await readJson(path.join(prDir, 'decision-index.json'));
  assert.equal(secondReuse.status, 'hit');
  assert.equal(secondReuse.full_evidence.status, 'reused');
  assert.equal(secondReuse.full_evidence.generation_count_scope, 'same_evidence_key');
  assert.equal(secondReuse.full_evidence.generation_count, 1);
  assert.equal(secondReuse.full_evidence.same_key_generation_count, 1);
  assert.equal(secondReuse.full_evidence.cumulative_generation_count, 1);
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
  assert.equal(report.evidence_reuse.by_story[0].artifact_value_ledger_status, 'present');
  assert.equal(report.evidence_reuse.by_story[0].artifact_value_decision_bound_count, 4);
  assert.equal(report.evidence_reuse.by_story[0].artifact_value_decision_changed_count, 0);
  assert.equal(report.evidence_reuse.by_story[0].artifact_value_decision_change_unconfirmed_count, 4);
  assert.equal(report.evidence_reuse.by_story[0].artifact_value_unused_artifact_count, 0);
  assert.equal(report.evidence_reuse.by_story[0].artifact_value_linked_consumer_count, 4);
  assert.equal(report.evidence_reuse.by_story[0].session_attribution_status, 'not_collected_in_pr_prepare');
  assert.equal(report.evidence_reuse.by_story[0].full_evidence_generation_count_scope, 'same_evidence_key');
  assert.equal(report.evidence_reuse.by_story[0].same_key_full_evidence_generation_count, 1);
  assert.equal(report.evidence_reuse.by_story[0].cumulative_full_evidence_generation_count, 1);
  assert.match(renderUsageReport(report), /Evidence Reuse/);
  assert.match(renderUsageReport(report), /artifact_value=present/);
  assert.match(renderUsageReport(report), /decision_unconfirmed=4/);
  assert.match(renderUsageReport(report), /session_attribution=not_collected_in_pr_prepare/);
  assert.match(renderUsageReport(report), /same_key_full_generation_count=1/);
  assert.match(renderUsageReport(report), /cumulative_full_generation_count=1/);
});

test('GDL-S-6 review, pr prepare, and usage report preserve one bounded projection with stable and collision selectors', async () => {
  const repo = await setupReuseRepo();
  for (const role of ['runtime_contract', 'code_spec_alignment']) {
    assert.equal((await runCli([
      'review', 'record', repo,
      '--id', STORY_ID,
      '--stage', 'implementation',
      '--role', role,
      '--status', 'needs_changes',
      '--summary', `${role} found the shared boundary defect`,
      '--finding', 'medium:shared-boundary:defect reproduced at the shared boundary',
      '--agent-system', 'codex',
      '--execution-mode', 'parallel_subagent',
      '--agent-id', `fixture-${role}`,
      '--agent-closed',
      '--json'
    ])).exitCode, 0);
  }
  assert.equal((await runCli([
    'review', 'record', repo,
    '--id', STORY_ID,
    '--stage', 'test_plan',
    '--role', 'gate_coverage',
    '--status', 'needs_changes',
    '--summary', 'gate coverage found a separate stable defect',
    '--finding', 'medium:stable-gate-gap:one independently addressable gate gap',
    '--agent-system', 'codex',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', 'fixture-stable-gate-gap',
    '--agent-closed',
    '--json'
  ])).exitCode, 0);

  const prepared = await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(prepared.exitCode, 0);
  const prSummary = prepared.result.preparation.decision_outcome_summary;
  const collisionEntries = prSummary.entries.filter((entry) => entry.decision_trace_id === null);
  assert.ok(prSummary.entries.some((entry) => entry.decision_trace_id));
  assert.equal(collisionEntries.length, 2);
  assert.ok(collisionEntries.every((entry) => entry.collision_group && entry.trace_source_ref));

  const review = await runCli([
    'review', 'prepare', repo, '--id', STORY_ID,
    '--stage', 'gate', '--role', 'gate_evidence', '--json'
  ]);
  assert.equal(review.exitCode, 0);
  const reviewSummary = review.result.plan.evidence_reuse.decision_outcome_summary;
  const usage = await createUsageReport(repo, { language: 'ja' });
  const usageSummary = usage.decision_outcomes.find((entry) => entry.story_id === STORY_ID);

  assert.deepEqual(reviewSummary, prSummary);
  assert.deepEqual(usageSummary, prSummary);
  assert.equal(reviewSummary.total_count, prSummary.total_count);
  assert.equal(reviewSummary.ledger_path, prSummary.ledger_path);
  assert.equal(reviewSummary.ledger_digest, prSummary.ledger_digest);
});

test('EDL-S2 confirmed no-change evidence is counted as unused rather than unconfirmed', () => {
  const ledger = buildArtifactValueLedger({
    storyId: STORY_ID,
    summaryArtifacts: { evidence_reuse: '.vibepro/pr/story/evidence-reuse.json' },
    decisionUsage: { evidence_reuse: { decision_changed: false } }
  });

  assert.equal(ledger.summary.decision_change_unconfirmed_count, 0);
  assert.equal(ledger.summary.unused_artifact_count, 1);
  assert.equal(ledger.entries[0].consumer_gate, 'gate:review_prepare');
});

test('EDL-S2 pr prepare persists confirmed unused evidence and usage report exposes it', async () => {
  const repo = await setupReuseRepo();
  const usage = JSON.stringify({ evidence_reuse: { decision_changed: false } });
  const result = await runCli([
    'pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main',
    '--evidence-decision-usage', usage, '--json'
  ]);
  assert.equal(result.exitCode, 0);

  const reuse = await readJson(path.join(repo, '.vibepro', 'pr', STORY_ID, 'evidence-reuse.json'));
  assert.equal(reuse.artifact_value_ledger.summary.unused_artifact_count, 1);
  assert.equal(reuse.artifact_value_ledger.summary.decision_change_unconfirmed_count, 3);
  assert.equal(reuse.artifact_value_ledger.entries[0].decision_changed, false);

  const report = await createUsageReport(repo, { language: 'ja' });
  assert.equal(report.evidence_reuse.by_story[0].artifact_value_unused_artifact_count, 1);
  assert.equal(report.evidence_reuse.by_story[0].artifact_value_decision_change_unconfirmed_count, 3);
});

test('ERM-CONTRACT-001 ERM-CONTRACT-002 head changes mark previous summary/index stale without changing same-key count semantics', async () => {
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
  assert.equal(reuse.full_evidence.generation_count_scope, 'same_evidence_key');
  assert.equal(reuse.full_evidence.generation_count, 1);
  assert.equal(reuse.full_evidence.same_key_generation_count, 1);
  assert.equal(reuse.full_evidence.cumulative_generation_count, 2);

  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const reusedAfterStale = await readJson(path.join(repo, '.vibepro', 'pr', STORY_ID, 'evidence-reuse.json'));
  assert.equal(reusedAfterStale.status, 'hit');
  assert.equal(reusedAfterStale.full_evidence.status, 'reused');
  assert.equal(reusedAfterStale.full_evidence.generation_count, 1);
  assert.equal(reusedAfterStale.full_evidence.same_key_generation_count, 1);
  assert.equal(reusedAfterStale.full_evidence.cumulative_generation_count, 2);
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

test('ESR-CONTRACT-005 review prepare rejects stale reuse when verification evidence changes after pr prepare', async () => {
  const repo = await setupReuseRepo();
  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const prDir = path.join(repo, '.vibepro', 'pr', STORY_ID);
  await writeFile(path.join(prDir, 'verification-evidence.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    updated_at: '2026-06-23T12:00:00.000Z',
    warnings: [],
    commands: [
      {
        kind: 'unit',
        status: 'pass',
        command: 'node --test test/evidence-summary-reuse.test.js',
        executed_at: '2026-06-23T12:00:00.000Z',
        git_context: {
          head_sha: 'head-a',
          recorded_at: '2026-06-23T12:00:01.000Z'
        },
        artifact_check: { status: 'unrecognized' },
        observation_check: { status: 'recorded' }
      }
    ]
  }, null, 2));

  const staleReview = await runCli(['review', 'prepare', repo, '--id', STORY_ID, '--stage', 'gate', '--role', 'gate_evidence', '--json']);
  assert.equal(staleReview.exitCode, 0);
  assert.equal(staleReview.result.plan.evidence_reuse.status, 'stale');
  assert.equal(staleReview.result.plan.evidence_reuse.first_input, false);
  assert.ok(staleReview.result.plan.evidence_reuse.stale_reasons.some((reason) => reason.field === 'verification_evidence_updated_at'));
  assert.ok(staleReview.result.plan.evidence_reuse.stale_reasons.some((reason) => reason.field === 'verification_command_timestamps'));
  const staleRequest = await readFile(path.join(repo, '.vibepro', 'reviews', STORY_ID, 'gate', 'review-request-gate_evidence.md'), 'utf8');
  assert.match(staleRequest, /current_verification_evidence_updated_at: 2026-06-23T12:00:00\.000Z/);
  assert.match(staleRequest, /verification_summary_fingerprint/);
  assert.doesNotMatch(staleRequest, /preferred_order: \.vibepro\/pr\/story-evidence-reuse\/evidence-reuse\.json/);
  assert.ok(staleReview.result.plan.evidence_reuse.decision_outcome_summary);
  assert.match(staleRequest, /Decision Outcome Ledger Summary/);
  assert.match(staleRequest, /- ledger: \.vibepro\/pr\/story-evidence-reuse\/decision-outcome-ledger\.json/);

  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const reuse = await readJson(path.join(prDir, 'evidence-reuse.json'));
  assert.equal(reuse.key_inputs.verification_evidence_updated_at, '2026-06-23T12:00:00.000Z');
  assert.equal(reuse.key_inputs.verification_command_timestamps[0].executed_at, '2026-06-23T12:00:00.000Z');

  const freshReview = await runCli(['review', 'prepare', repo, '--id', STORY_ID, '--stage', 'gate', '--role', 'gate_evidence', '--json']);
  assert.equal(freshReview.exitCode, 0);
  assert.equal(freshReview.result.plan.evidence_reuse.status, 'fresh');
  const freshRequest = await readFile(path.join(repo, '.vibepro', 'reviews', STORY_ID, 'gate', 'review-request-gate_evidence.md'), 'utf8');
  assert.match(freshRequest, /verification_evidence_updated_at: 2026-06-23T12:00:00\.000Z/);
  const dispatch = await readFile(path.join(repo, '.vibepro', 'reviews', STORY_ID, 'gate', 'parallel-dispatch.md'), 'utf8');
  assert.match(dispatch, /verification_summary_fingerprint/);
  assert.match(dispatch, /2026-06-23T12:00:00\.000Z/);

  const report = await createUsageReport(repo, { language: 'ja' });
  assert.equal(report.evidence_reuse.by_story[0].verification_evidence_updated_at, '2026-06-23T12:00:00.000Z');
  assert.equal(report.evidence_reuse.by_story[0].same_key_full_evidence_generation_count, 1);
  assert.equal(report.evidence_reuse.by_story[0].cumulative_full_evidence_generation_count, 2);
  assert.match(renderUsageReport(report), /verification_updated_at=2026-06-23T12:00:00\.000Z/);
  assert.match(renderUsageReport(report), /same_key_full_generation_count=1/);
  assert.match(renderUsageReport(report), /cumulative_full_generation_count=2/);
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

test('summary artifact references omit explicitly skipped full artifacts', () => {
  const reuse = buildEvidenceReuse({
    story: { story_id: STORY_ID },
    git: { base_ref: 'main', base_sha: 'base', head_ref: 'HEAD', head_sha: 'head-a' },
    evidencePlan: { story_id: STORY_ID, planner_version: '0.1.0', evidence_depth: 'summary' },
    decisionIndex: { story_id: STORY_ID, evidence_depth: 'summary' },
    artifacts: {
      evidenceReusePath: `/repo/.vibepro/pr/${STORY_ID}/evidence-reuse.json`,
      evidencePlanPath: `/repo/.vibepro/pr/${STORY_ID}/evidence-plan.json`,
      decisionIndexPath: `/repo/.vibepro/pr/${STORY_ID}/decision-index.json`,
      jsonPath: `/repo/.vibepro/pr/${STORY_ID}/pr-prepare.json`,
      gateDagJsonPath: null
    }
  });

  assert.equal(reuse.summary_artifacts.gate_dag, null);
  assert.equal(reuse.review_input_summary.preferred_order.includes(null), false);
  assert.equal(
    reuse.review_input_summary.preferred_order.some((artifact) => artifact.endsWith('/gate-dag.json')),
    false
  );
  assert.equal(
    reuse.artifact_value_ledger.entries.some((entry) => entry.artifact_key === 'gate_dag'),
    false
  );
});

test('explicit session attribution is preserved in the artifact value ledger', () => {
  const reuse = buildEvidenceReuse({
    story: { story_id: STORY_ID },
    git: { base_ref: 'main', base_sha: 'base', head_ref: 'HEAD', head_sha: 'head-a' },
    prContext: {
      session_attribution: {
        sessions: [
          {
            session_id: 'session-1',
            repo: '/repo/a',
            story_id: STORY_ID,
            status: 'attributed',
            confidence: 'high',
            source: 'session_index',
            tokens: 1200,
            elapsed_ms: 60000
          },
          {
            session_id: 'session-2',
            repo: '/repo/a',
            status: 'unattributed',
            confidence: 'low',
            source: 'session_index',
            tokens: 300,
            elapsed_ms: 10000
          }
        ]
      }
    },
    evidencePlan: { story_id: STORY_ID, planner_version: '0.1.0', evidence_depth: 'summary' },
    decisionIndex: { story_id: STORY_ID, evidence_depth: 'summary' }
  });

  assert.equal(reuse.session_attribution_ledger.status, 'explicit');
  assert.equal(reuse.session_attribution_ledger.confidence, 'high');
  assert.equal(reuse.session_attribution_ledger.sessions.length, 2);
  assert.equal(reuse.session_attribution_ledger.unattributed_count, 1);
  assert.equal(reuse.session_attribution_ledger.sessions[0].session_id, 'session-1');
  assert.equal(reuse.session_attribution_ledger.sessions[0].tokens, 1200);
  assert.equal(reuse.artifact_value_ledger.session_attribution_status, 'explicit');
  assert.equal(reuse.artifact_value_ledger.session_attribution_confidence, 'high');
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
