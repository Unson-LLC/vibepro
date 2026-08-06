import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { buildEvidenceReuse, buildEvidenceReuseGate, buildRoleContentDigests, evaluateEvidenceReuseForReview } from '../src/evidence-reuse.js';
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

// Records a canonical current-head "pass" review whose content_binding is
// bound to `inspectionInput` -- the minimum viable fixture for exercising the
// per-role evidence-reuse digest (CRK-S-2/CRK-S-3/CRK-S-5), mirroring the
// pattern used by test/agent-review-independence.test.js and
// test/content-scoped-evidence-freshness.test.js.
async function recordPassReview(root, { stage, role, inspectionInput, agentId }) {
  const result = await runCli([
    'review', 'record', root,
    '--id', STORY_ID,
    '--stage', stage,
    '--role', role,
    '--status', 'pass',
    '--summary', `${role} reviewed ${inspectionInput}`,
    '--inspection-summary', `inspected ${inspectionInput}`,
    '--inspection-input', inspectionInput,
    '--judgment-delta', 'initial check -> pass because evidence is current',
    '--agent-system', 'codex',
    '--execution-mode', 'parallel_subagent',
    '--agent-id', agentId,
    '--agent-closed',
    '--json'
  ]);
  assert.equal(result.exitCode, 0, JSON.stringify(result.result ?? result.error ?? result));
  return result;
}

async function configureStrictHeadRole(root, role, reason) {
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.agent_reviews = {
    ...(config.agent_reviews ?? {}),
    roles: {
      ...(config.agent_reviews?.roles ?? {}),
      [role]: { freshness_mode: 'strict_head', freshness_reason: reason }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

test('ERM-CONTRACT-001 ERM-CONTRACT-003 pr prepare reuses fresh summary/index and keeps full evidence generation count at one', async () => {
  const repo = await setupReuseRepo();
  // Give `runtime_contract` a real recorded baseline before the first pr
  // prepare below, so the `review prepare --role runtime_contract` call
  // further down exercises the intended "reuse actually carried forward"
  // path (previous digest === current digest) rather than incidentally
  // landing on a role that has literally never been reviewed (see the
  // dedicated CRK-S-2 "no baseline" consumption test for that branch).
  await recordPassReview(repo, { stage: 'implementation', role: 'runtime_contract', inspectionInput: 'README.md', agentId: 'agent-runtime-baseline' });

  // Record real verification evidence before any pr prepare so
  // buildEvidenceReuse's `verification_evidence_metadata` (the only place
  // CRK-S-1 still carries a wall-clock updated_at/command_timestamps, for
  // descriptive audit/report consumers only -- never for the reuse key) is
  // genuinely non-empty. A current evidence-reuse.json has no top-level
  // `verification_evidence_updated_at` and no
  // `key_inputs.verification_evidence_updated_at` any more, so this is the
  // only branch canonical-audit.js/usage-report.js's consumer fallback
  // chains can resolve from; without this, that fallback path is untested.
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await writeFile(path.join(repo, 'test', 'reuse.test.js'), "import test from 'node:test';\ntest('reuse', () => {});\n");
  assert.equal((await runCli([
    'verify', 'record', repo, '--id', STORY_ID, '--kind', 'unit', '--status', 'pass',
    '--command', 'node --test test/reuse.test.js'
  ])).exitCode, 0);

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
  // usage-report.js's recordEvidenceReuse fallback chain
  // (`?? evidenceReuse.verification_evidence_metadata?.updated_at` /
  // `.command_timestamps`) is the only branch that can resolve on a current
  // evidence-reuse.json -- assert it actually does, through a real pr
  // prepare + createUsageReport, not a hand-built fixture with the legacy
  // key_inputs shape.
  assert.equal(report.evidence_reuse.by_story[0].verification_evidence_updated_at, secondReuse.verification_evidence_metadata.updated_at);
  assert.ok(report.evidence_reuse.by_story[0].verification_evidence_updated_at);
  assert.equal(report.evidence_reuse.by_story[0].verification_command_timestamps.length, 1);
  assert.equal(report.evidence_reuse.by_story[0].verification_command_timestamps[0].kind, 'unit');
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

// Clause binding: story-vibepro-content-scoped-evidence-reuse-key:AC-1
test('CRK-S-1 ERM-CONTRACT-001 ERM-CONTRACT-002 an unrelated head change with no intersecting role surface is a hit, not stale', async () => {
  const repo = await setupReuseRepo();
  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const first = await readJson(path.join(repo, '.vibepro', 'pr', STORY_ID, 'evidence-reuse.json'));
  assert.equal(first.status, 'miss');
  assert.equal(first.full_evidence.generation_count, 1);
  assert.equal(first.full_evidence.cumulative_generation_count, 1);

  // A fix/docs commit that touches no role's inspected content surface must
  // not, by itself, invalidate reuse any more (CRK-S-1): head_sha/head_ref
  // are no longer part of the evidence reuse key. Amend (rather than add) the
  // commit so the base..head diff shape stays constant (one docs-only file
  // changed) between the two pr-prepare calls -- otherwise a second, distinct
  // commit legitimately shifts risk_surface_fingerprint's diff-derived
  // change_classification, which is intentionally still base-invalidating
  // (CRK-S-4) and would confound this head_sha-only assertion.
  await writeFile(path.join(repo, 'README.md'), '# Reuse\n\nUpdated docs again.\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, ['commit', '--amend', '-m', 'docs: update reuse notes']);

  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const reuse = await readJson(path.join(repo, '.vibepro', 'pr', STORY_ID, 'evidence-reuse.json'));
  assert.equal(reuse.status, 'hit');
  assert.deepEqual(reuse.stale_reasons, []);
  assert.notEqual(reuse.recorded_git.head_sha, first.recorded_git.head_sha, 'head actually moved between the two pr prepare calls');
  assert.equal(reuse.evidence_key, first.evidence_key, 'evidence key is unaffected by the head-only change');
  assert.equal(reuse.full_evidence.status, 'reused');
  assert.equal(reuse.full_evidence.generation_count_scope, 'same_evidence_key');
  assert.equal(reuse.full_evidence.generation_count, 1);
  assert.equal(reuse.full_evidence.same_key_generation_count, 1);
  assert.equal(reuse.full_evidence.cumulative_generation_count, 1);
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
  // Give `gate_evidence` a real recorded baseline up front so the
  // `review prepare --stage gate --role gate_evidence` calls below exercise
  // "does verification drift alone flip an otherwise-fresh role to stale"
  // (this test's actual subject), not the unrelated "role has never been
  // reviewed at all" branch covered by the CRK-S-2 "no baseline" test.
  await recordPassReview(repo, { stage: 'gate', role: 'gate_evidence', inspectionInput: 'README.md', agentId: 'agent-gate-baseline' });
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
  // CRK-S-1/D2: verification content (not wall-clock timestamps) drives the
  // key now, so the only stale reason is the content fingerprint; the
  // removed timestamp fields must not appear as stale reasons any more.
  assert.ok(staleReview.result.plan.evidence_reuse.stale_reasons.some((reason) => reason.field === 'verification_summary_fingerprint'));
  assert.equal(staleReview.result.plan.evidence_reuse.stale_reasons.some((reason) => reason.field === 'verification_evidence_updated_at'), false);
  assert.equal(staleReview.result.plan.evidence_reuse.stale_reasons.some((reason) => reason.field === 'verification_command_timestamps'), false);
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
  // Wall-clock verification metadata is still persisted, but as descriptive
  // (non-key) data now -- see verification_evidence_metadata, not key_inputs.
  assert.equal(reuse.verification_evidence_metadata.updated_at, '2026-06-23T12:00:00.000Z');
  assert.equal(reuse.verification_evidence_metadata.command_timestamps[0].executed_at, '2026-06-23T12:00:00.000Z');
  assert.equal(Object.hasOwn(reuse.key_inputs, 'verification_evidence_updated_at'), false);
  assert.equal(Object.hasOwn(reuse.key_inputs, 'verification_command_timestamps'), false);
  assert.equal(Object.hasOwn(reuse.key_inputs, 'head_sha'), false);
  assert.equal(Object.hasOwn(reuse.key_inputs, 'head_ref'), false);

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

  // D2: a pure timestamp re-run with identical command content must not
  // invalidate reuse any more.
  await writeFile(path.join(prDir, 'verification-evidence.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    updated_at: '2026-06-23T13:00:00.000Z',
    warnings: [],
    commands: [
      {
        kind: 'unit',
        status: 'pass',
        command: 'node --test test/evidence-summary-reuse.test.js',
        executed_at: '2026-06-23T13:00:00.000Z',
        git_context: {
          head_sha: 'head-b',
          recorded_at: '2026-06-23T13:00:01.000Z'
        },
        artifact_check: { status: 'unrecognized' },
        observation_check: { status: 'recorded' }
      }
    ]
  }, null, 2));
  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const timestampOnlyReuse = await readJson(path.join(prDir, 'evidence-reuse.json'));
  assert.equal(timestampOnlyReuse.status, 'hit');
  assert.deepEqual(timestampOnlyReuse.stale_reasons, []);
  assert.equal(timestampOnlyReuse.evidence_key, reuse.evidence_key);
  assert.equal(timestampOnlyReuse.verification_evidence_metadata.updated_at, '2026-06-23T13:00:00.000Z');

  // A genuine content change (different command outcome) still invalidates.
  await writeFile(path.join(prDir, 'verification-evidence.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    updated_at: '2026-06-23T14:00:00.000Z',
    warnings: [],
    commands: [
      {
        kind: 'unit',
        status: 'fail',
        command: 'node --test test/evidence-summary-reuse.test.js',
        executed_at: '2026-06-23T14:00:00.000Z',
        git_context: {
          head_sha: 'head-b',
          recorded_at: '2026-06-23T14:00:01.000Z'
        },
        artifact_check: { status: 'unrecognized' },
        observation_check: { status: 'recorded' }
      }
    ]
  }, null, 2));
  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const contentChangedReuse = await readJson(path.join(prDir, 'evidence-reuse.json'));
  assert.equal(contentChangedReuse.status, 'stale');
  assert.ok(contentChangedReuse.stale_reasons.some((reason) => reason.field === 'verification_summary_fingerprint'));
});

test('ESR-CONTRACT-005 D2 verification content changes invalidate reuse while timestamp-only changes do not', () => {
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
  // Same command identity/outcome, only wall-clock timestamps and HEAD moved
  // (a re-run of the same verification at a later commit): must be a hit.
  const timestampOnly = buildEvidenceReuse({
    ...base,
    git: { ...base.git, head_sha: 'head-b' },
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
            head_sha: 'head-b',
            recorded_at: '2026-06-23T00:05:00.000Z'
          },
          artifact_check: { status: 'unrecognized' },
          observation_check: { status: 'recorded' }
        }
      ]
    },
    previousReuse: first
  });

  assert.equal(first.status, 'miss');
  assert.equal(timestampOnly.status, 'hit');
  assert.deepEqual(timestampOnly.stale_reasons, []);
  assert.equal(timestampOnly.evidence_key, first.evidence_key);
  assert.equal(timestampOnly.verification_evidence_metadata.updated_at, '2026-06-23T00:05:00.000Z');
  assert.equal(Object.hasOwn(timestampOnly.key_inputs, 'verification_evidence_updated_at'), false);
  assert.equal(Object.hasOwn(timestampOnly.key_inputs, 'head_sha'), false);

  // A genuinely different verification outcome still invalidates.
  const contentChanged = buildEvidenceReuse({
    ...base,
    git: { ...base.git, head_sha: 'head-b' },
    verificationEvidence: {
      schema_version: '0.1.0',
      story_id: STORY_ID,
      updated_at: '2026-06-23T00:10:00.000Z',
      commands: [
        {
          kind: 'unit',
          status: 'fail',
          command: 'node --test test/evidence-summary-reuse.test.js',
          executed_at: '2026-06-23T00:10:00.000Z',
          git_context: {
            head_sha: 'head-b',
            recorded_at: '2026-06-23T00:10:00.000Z'
          },
          artifact_check: { status: 'unrecognized' },
          observation_check: { status: 'recorded' }
        }
      ]
    },
    previousReuse: timestampOnly
  });
  const gate = buildEvidenceReuseGate(contentChanged);

  assert.equal(contentChanged.status, 'stale');
  assert.notEqual(timestampOnly.evidence_key, contentChanged.evidence_key);
  assert.ok(contentChanged.stale_reasons.some((reason) => reason.field === 'verification_summary_fingerprint'));
  assert.equal(contentChanged.stale_reasons.some((reason) => reason.field === 'verification_evidence_updated_at'), false);
  assert.equal(contentChanged.stale_reasons.some((reason) => reason.field === 'verification_command_timestamps'), false);
  assert.equal(gate.status, 'passed');
  assert.equal(gate.evidence.verification_evidence_updated_at, '2026-06-23T00:10:00.000Z');
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
  // CRK-S-1 removed head_sha from the key, so a bare head_sha change alone no
  // longer staleifies reuse (see the "unrelated head change ... is a hit"
  // test above). Use a CRK-S-4 base-invalidating trigger instead
  // (planner_version drift) to force staleness for this gate-failure check.
  const staleMisuse = buildEvidenceReuse({
    story: { story_id: STORY_ID },
    git: { base_ref: 'main', base_sha: 'base', head_ref: 'HEAD', head_sha: 'head-a' },
    evidencePlan: { story_id: STORY_ID, planner_version: '0.2.0', evidence_depth: 'summary' },
    decisionIndex: { story_id: STORY_ID, evidence_depth: 'summary' },
    previousReuse: first,
    usedAsFresh: true
  });
  const gate = buildEvidenceReuseGate(staleMisuse);
  assert.equal(staleMisuse.status, 'stale');
  assert.ok(staleMisuse.stale_reasons.some((reason) => reason.field === 'planner_version'));
  assert.equal(gate.status, 'failed');
});

// Clause binding: story-vibepro-content-scoped-evidence-reuse-key:AC-2
// Clause binding: story-vibepro-content-scoped-evidence-reuse-key:AC-6 — inspected surface変更 → 該当ロールのみmiss is one of CRK-S-6's three named contract behaviors
test("CRK-S-2 a fix commit touching only one role's inspected surface misses only that role's reuse", async () => {
  const repo = await setupReuseRepo();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'widget.js'), 'export const widget = 1;\n');
  await git(repo, ['add', 'src/widget.js']);
  await git(repo, ['commit', '-m', 'feat: add widget']);

  await recordPassReview(repo, { stage: 'implementation', role: 'runtime_contract', inspectionInput: 'src/widget.js', agentId: 'agent-runtime' });
  await recordPassReview(repo, { stage: 'implementation', role: 'code_spec_alignment', inspectionInput: 'README.md', agentId: 'agent-spec' });

  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const baseline = await readJson(path.join(repo, '.vibepro', 'pr', STORY_ID, 'evidence-reuse.json'));
  assert.equal(baseline.status, 'hit');
  assert.equal(baseline.role_reuse['implementation:runtime_contract'].status, 'hit');
  assert.equal(baseline.role_reuse['implementation:code_spec_alignment'].status, 'hit');

  // Fix commit touches only runtime_contract's inspected surface.
  await writeFile(path.join(repo, 'src', 'widget.js'), 'export const widget = 2;\n');
  await git(repo, ['add', 'src/widget.js']);
  await git(repo, ['commit', '-m', 'fix: adjust widget behavior']);

  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const afterFix = await readJson(path.join(repo, '.vibepro', 'pr', STORY_ID, 'evidence-reuse.json'));
  assert.equal(afterFix.status, 'stale');
  assert.equal(afterFix.role_reuse['implementation:runtime_contract'].status, 'miss');
  assert.equal(afterFix.role_reuse['implementation:code_spec_alignment'].status, 'hit');
  assert.ok(afterFix.stale_reasons.some((reason) => reason.field === 'role_surface:implementation:runtime_contract'));
  assert.equal(afterFix.stale_reasons.some((reason) => reason.field === 'role_surface:implementation:code_spec_alignment'), false);
  assert.notEqual(
    afterFix.role_reuse['implementation:runtime_contract'].digest,
    afterFix.role_reuse['implementation:runtime_contract'].previous_digest
  );
  assert.equal(
    afterFix.role_reuse['implementation:code_spec_alignment'].digest,
    afterFix.role_reuse['implementation:code_spec_alignment'].previous_digest
  );

  // Consumption side (`review prepare`), not just the persisted artifact: the
  // untouched role must still get to treat the cached evidence bundle as
  // fresh first input, even though the OTHER role's drift made the
  // artifact's own aggregate `status` 'stale'. Regression coverage for the
  // bug where evaluateEvidenceReuseForReview gated every role's freshness on
  // the aggregate `status`/`fresh_use_allowed` instead of the base-only
  // verdict, silently defeating CRK-S-2 at the point evidence is actually
  // reused.
  const review = await runCli([
    'review', 'prepare', repo, '--id', STORY_ID, '--stage', 'implementation',
    '--role', 'runtime_contract', '--role', 'code_spec_alignment', '--json'
  ]);
  assert.equal(review.exitCode, 0);
  const byRole = review.result.plan.evidence_reuse.by_role;
  assert.equal(byRole.runtime_contract.fresh, false);
  assert.equal(byRole.runtime_contract.status, 'stale');
  assert.equal(byRole.code_spec_alignment.fresh, true);
  assert.equal(byRole.code_spec_alignment.status, 'fresh');
  assert.equal(byRole.code_spec_alignment.first_input, true);
  assert.deepEqual(byRole.code_spec_alignment.stale_reasons, []);
});

// Clause binding: story-vibepro-content-scoped-evidence-reuse-key:AC-3
test('CRK-S-3 a strict_head role misses on head change while a content_surface role with unchanged content hits', async () => {
  const repo = await setupReuseRepo();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'widget.js'), 'export const widget = 1;\n');
  await git(repo, ['add', 'src/widget.js']);
  await git(repo, ['commit', '-m', 'feat: add widget']);
  await configureStrictHeadRole(repo, 'runtime_contract', 'runtime contract spans the full release head');

  await recordPassReview(repo, { stage: 'implementation', role: 'runtime_contract', inspectionInput: 'src/widget.js', agentId: 'agent-runtime' });
  await recordPassReview(repo, { stage: 'implementation', role: 'code_spec_alignment', inspectionInput: 'README.md', agentId: 'agent-spec' });

  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const baseline = await readJson(path.join(repo, '.vibepro', 'pr', STORY_ID, 'evidence-reuse.json'));
  assert.equal(baseline.role_reuse['implementation:runtime_contract'].mode, 'strict_head');
  assert.equal(baseline.role_reuse['implementation:code_spec_alignment'].mode, 'content_surface');
  assert.equal(baseline.role_reuse['implementation:runtime_contract'].status, 'hit');
  assert.equal(baseline.role_reuse['implementation:code_spec_alignment'].status, 'hit');

  // Unrelated commit: touches neither src/widget.js nor README.md, only HEAD.
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'unrelated.md'), '# unrelated\n');
  await git(repo, ['add', 'docs/unrelated.md']);
  await git(repo, ['commit', '-m', 'docs: unrelated note']);

  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  const afterHeadMove = await readJson(path.join(repo, '.vibepro', 'pr', STORY_ID, 'evidence-reuse.json'));
  // CRK-S-3: the strict_head role must still re-review on any head change...
  assert.equal(afterHeadMove.role_reuse['implementation:runtime_contract'].status, 'miss');
  assert.ok(afterHeadMove.stale_reasons.some((reason) => reason.field === 'role_surface:implementation:runtime_contract'
    && /strict HEAD/.test(reason.reason)));
  // ...while the content_surface role with identical content is unaffected
  // by the head-only change (CRK-S-1's "same content, different head -> hit").
  assert.equal(afterHeadMove.role_reuse['implementation:code_spec_alignment'].status, 'hit');

  // Consumption side: same distinction must hold when `review prepare`
  // actually evaluates freshness, not just on the persisted artifact.
  const review = await runCli([
    'review', 'prepare', repo, '--id', STORY_ID, '--stage', 'implementation',
    '--role', 'runtime_contract', '--role', 'code_spec_alignment', '--json'
  ]);
  assert.equal(review.exitCode, 0);
  const byRole = review.result.plan.evidence_reuse.by_role;
  assert.equal(byRole.runtime_contract.fresh, false);
  assert.ok(byRole.runtime_contract.stale_reasons.some((reason) => /strict HEAD/.test(reason.reason)));
  assert.equal(byRole.code_spec_alignment.fresh, true);
  assert.deepEqual(byRole.code_spec_alignment.stale_reasons, []);
});

// Clause binding: story-vibepro-content-scoped-evidence-reuse-key:AC-5
test('CRK-S-5 role_reuse records reconstructable per-role hit/miss reasons in evidence-reuse.json', async () => {
  const repo = await setupReuseRepo();
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'widget.js'), 'export const widget = 1;\n');
  await git(repo, ['add', 'src/widget.js']);
  await git(repo, ['commit', '-m', 'feat: add widget']);

  await recordPassReview(repo, { stage: 'implementation', role: 'runtime_contract', inspectionInput: 'src/widget.js', agentId: 'agent-runtime' });
  await recordPassReview(repo, { stage: 'implementation', role: 'code_spec_alignment', inspectionInput: 'README.md', agentId: 'agent-spec' });
  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);
  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);

  await writeFile(path.join(repo, 'src', 'widget.js'), 'export const widget = 2;\n');
  await git(repo, ['add', 'src/widget.js']);
  await git(repo, ['commit', '-m', 'fix: adjust widget behavior']);
  assert.equal((await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json'])).exitCode, 0);

  const reuse = await readJson(path.join(repo, '.vibepro', 'pr', STORY_ID, 'evidence-reuse.json'));
  const runtimeEntry = reuse.role_reuse['implementation:runtime_contract'];
  const specEntry = reuse.role_reuse['implementation:code_spec_alignment'];

  assert.equal(runtimeEntry.status, 'miss');
  assert.equal(runtimeEntry.mode, 'content_surface');
  assert.equal(typeof runtimeEntry.digest, 'string');
  assert.equal(typeof runtimeEntry.previous_digest, 'string');
  assert.notEqual(runtimeEntry.digest, runtimeEntry.previous_digest);
  assert.equal(runtimeEntry.stale_reasons.length, 1);
  assert.equal(runtimeEntry.stale_reasons[0].field, 'role_surface:implementation:runtime_contract');
  assert.equal(runtimeEntry.stale_reasons[0].previous, runtimeEntry.previous_digest);
  assert.equal(runtimeEntry.stale_reasons[0].current, runtimeEntry.digest);
  assert.match(runtimeEntry.stale_reasons[0].reason, /inspected content surface changed/);

  assert.equal(specEntry.status, 'hit');
  assert.deepEqual(specEntry.stale_reasons, []);
  assert.equal(specEntry.digest, specEntry.previous_digest);

  // Reconstructable from the artifact alone: the top-level stale_reasons
  // entry for the only role that actually changed matches the per-role entry.
  const topLevelRoleReason = reuse.stale_reasons.find((reason) => reason.field === 'role_surface:implementation:runtime_contract');
  assert.ok(topLevelRoleReason);
  assert.deepEqual(topLevelRoleReason, runtimeEntry.stale_reasons[0]);
});

// Clause binding: story-vibepro-content-scoped-evidence-reuse-key:AC-4
// Clause binding: story-vibepro-content-scoped-evidence-reuse-key:AC-6 — spec drift → 全miss is the third of CRK-S-6's three named contract behaviors
test("CRK-S-4 CRK-S-6 spec fingerprint drift invalidates every role's reuse, not only the aggregate status", () => {
  const agentReviewsStages = [
    {
      stage: 'implementation',
      roles: [
        {
          role: 'runtime_contract',
          freshness_policy: { effective_mode: 'content_surface' },
          content_binding: { current_surface_hash: 'aaaa', recorded_surface_hash: 'aaaa' }
        },
        {
          role: 'code_spec_alignment',
          freshness_policy: { effective_mode: 'content_surface' },
          content_binding: { current_surface_hash: 'bbbb', recorded_surface_hash: 'bbbb' }
        }
      ]
    }
  ];
  const base = {
    story: { story_id: STORY_ID },
    git: { base_ref: 'main', base_sha: 'base', head_ref: 'HEAD', head_sha: 'head-a' },
    prContext: { agent_reviews: { stages: agentReviewsStages }, inferred_spec: { statement: 'v1' } },
    evidencePlan: { story_id: STORY_ID, planner_version: '0.1.0', evidence_depth: 'summary' },
    decisionIndex: { story_id: STORY_ID, evidence_depth: 'summary' }
  };
  const first = buildEvidenceReuse(base);
  // Same role digests as `first` (nothing any role inspected changed), but
  // the shared spec_fingerprint drifted -- CRK-S-4 says this must still
  // invalidate every role, not just the top-level aggregate.
  const second = buildEvidenceReuse({
    ...base,
    prContext: { agent_reviews: { stages: agentReviewsStages }, inferred_spec: { statement: 'v2 changed' } },
    previousReuse: first
  });

  assert.equal(first.status, 'miss');
  assert.equal(second.status, 'stale');
  assert.ok(second.stale_reasons.some((reason) => reason.field === 'spec_fingerprint'));
  assert.equal(second.role_reuse['implementation:runtime_contract'].status, 'miss');
  assert.equal(second.role_reuse['implementation:code_spec_alignment'].status, 'miss');
  assert.equal(
    second.role_reuse['implementation:runtime_contract'].stale_reasons[0].field,
    'role_surface:implementation:runtime_contract'
  );
  assert.equal(
    second.role_reuse['implementation:code_spec_alignment'].stale_reasons[0].field,
    'role_surface:implementation:code_spec_alignment'
  );

  // Consumption side: base_reuse must gate both roles too, even though
  // neither role's OWN digest moved -- CRK-S-4 applies uniformly at the
  // point evidence is actually reused, not only on the persisted artifact.
  const currentRoleDigests = {
    'implementation:runtime_contract': { mode: 'content_surface', digest: 'sha256:aaaa' },
    'implementation:code_spec_alignment': { mode: 'content_surface', digest: 'sha256:bbbb' }
  };
  const reviewEvaluation = evaluateEvidenceReuseForReview({
    reuse: second,
    gitContext: { head_sha: 'head-a' },
    verificationEvidence: null,
    stage: 'implementation',
    roles: ['runtime_contract', 'code_spec_alignment'],
    currentRoleDigests
  });
  assert.equal(reviewEvaluation.by_role.runtime_contract.fresh, false);
  assert.equal(reviewEvaluation.by_role.code_spec_alignment.fresh, false);
  assert.ok(reviewEvaluation.by_role.runtime_contract.stale_reasons.some((reason) => reason.field === 'spec_fingerprint'));
  assert.ok(reviewEvaluation.by_role.code_spec_alignment.stale_reasons.some((reason) => reason.field === 'spec_fingerprint'));
});

// Clause binding: story-vibepro-content-scoped-evidence-reuse-key:AC-2
test("CRK-S-2 consumption a role with no evidence-reuse baseline is not treated as spuriously fresh", () => {
  // Role `code_spec_alignment` gets a real baseline; `runtime_contract` is
  // reviewed for the first time only AFTER this artifact was built (so it is
  // absent from key_inputs.role_surface_digests, but current_role_digests --
  // freshly recomputed at review-prepare time -- now has real content for
  // it). It must not default to fresh just because the shared base is clean.
  const agentReviewsStages = [
    {
      stage: 'implementation',
      roles: [
        {
          role: 'code_spec_alignment',
          freshness_policy: { effective_mode: 'content_surface' },
          content_binding: { current_surface_hash: 'bbbb', recorded_surface_hash: 'bbbb' }
        }
      ]
    }
  ];
  const base = {
    story: { story_id: STORY_ID },
    git: { base_ref: 'main', base_sha: 'base', head_ref: 'HEAD', head_sha: 'head-a' },
    prContext: { agent_reviews: { stages: agentReviewsStages }, inferred_spec: { statement: 'v1' } },
    evidencePlan: { story_id: STORY_ID, planner_version: '0.1.0', evidence_depth: 'summary' },
    decisionIndex: { story_id: STORY_ID, evidence_depth: 'summary' }
  };
  const first = buildEvidenceReuse(base);
  const second = buildEvidenceReuse({ ...base, previousReuse: first });
  assert.equal(second.status, 'hit');
  assert.equal(second.base_reuse.status, 'hit');
  assert.equal(second.role_reuse['implementation:code_spec_alignment'].status, 'hit');
  assert.equal(second.role_reuse['implementation:runtime_contract'], undefined);

  const reviewEvaluation = evaluateEvidenceReuseForReview({
    reuse: second,
    gitContext: { head_sha: 'head-a' },
    verificationEvidence: null,
    stage: 'implementation',
    roles: ['code_spec_alignment', 'runtime_contract'],
    currentRoleDigests: {
      'implementation:code_spec_alignment': { mode: 'content_surface', digest: 'sha256:bbbb' },
      'implementation:runtime_contract': { mode: 'content_surface', digest: 'sha256:cccc' }
    }
  });
  assert.equal(reviewEvaluation.by_role.code_spec_alignment.fresh, true);
  assert.equal(reviewEvaluation.by_role.runtime_contract.fresh, false);
  assert.ok(reviewEvaluation.by_role.runtime_contract.stale_reasons.some((reason) => /no previous evidence-reuse baseline/.test(reason.reason)));
});

// Clause binding: story-vibepro-content-scoped-evidence-reuse-key:AC-2
test("CRK-S-2 consumption a role with neither a current digest nor a previous baseline is not treated as spuriously fresh", () => {
  // Distinct from the "no evidence-reuse baseline" test above: there,
  // `runtime_contract` WAS just reviewed (`currentRoleDigests` has real
  // content for it), it is only missing from the artifact's OWN previous
  // key_inputs. Here, `runtime_contract` has NEITHER a previous baseline NOR
  // a freshly recomputed current digest -- e.g. it is requested at
  // `review prepare` time but has literally never been reviewed even once
  // (buildRoleContentDigests has nothing to report for it because there is
  // no recorded review result to hash a content_binding from at all). The
  // shared base being clean must not, by itself, resolve this to
  // fresh/first_input: true -- there is zero positive evidence in either
  // direction for this specific role. This is the exact branch an
  // independent architecture_boundary review flagged as silently fail-open
  // (see docs/architecture/story-vibepro-content-scoped-evidence-reuse-key.md,
  // "Per-role digest source").
  const agentReviewsStages = [
    {
      stage: 'implementation',
      roles: [
        {
          role: 'code_spec_alignment',
          freshness_policy: { effective_mode: 'content_surface' },
          content_binding: { current_surface_hash: 'bbbb', recorded_surface_hash: 'bbbb' }
        }
      ]
    }
  ];
  const base = {
    story: { story_id: STORY_ID },
    git: { base_ref: 'main', base_sha: 'base', head_ref: 'HEAD', head_sha: 'head-a' },
    prContext: { agent_reviews: { stages: agentReviewsStages }, inferred_spec: { statement: 'v1' } },
    evidencePlan: { story_id: STORY_ID, planner_version: '0.1.0', evidence_depth: 'summary' },
    decisionIndex: { story_id: STORY_ID, evidence_depth: 'summary' }
  };
  const first = buildEvidenceReuse(base);
  const second = buildEvidenceReuse({ ...base, previousReuse: first });
  assert.equal(second.status, 'hit');
  assert.equal(second.base_reuse.status, 'hit');
  assert.equal(second.role_reuse['implementation:runtime_contract'], undefined);

  const reviewEvaluation = evaluateEvidenceReuseForReview({
    reuse: second,
    gitContext: { head_sha: 'head-a' },
    verificationEvidence: null,
    stage: 'implementation',
    roles: ['code_spec_alignment', 'runtime_contract'],
    currentRoleDigests: {
      'implementation:code_spec_alignment': { mode: 'content_surface', digest: 'sha256:bbbb' }
      // Deliberately no entry for runtime_contract: it has never been
      // reviewed, so there is nothing to compute a current digest from.
    }
  });
  // Regression guard: the role that DOES have a matching baseline in both
  // directions must stay fresh -- this fix must not regress the
  // already-covered "untouched role stays fresh" behavior (CRK-S-2).
  assert.equal(reviewEvaluation.by_role.code_spec_alignment.fresh, true);
  assert.equal(reviewEvaluation.by_role.code_spec_alignment.status, 'fresh');
  // The actual fix under test: zero positive evidence in either direction
  // must not resolve to fresh/first_input just because the shared base
  // happens to be clean.
  assert.equal(reviewEvaluation.by_role.runtime_contract.fresh, false);
  assert.equal(reviewEvaluation.by_role.runtime_contract.first_input, false);
  assert.equal(reviewEvaluation.by_role.runtime_contract.status, 'stale');
  assert.equal(reviewEvaluation.by_role.runtime_contract.stale_reasons.length, 1);
  assert.equal(reviewEvaluation.by_role.runtime_contract.stale_reasons[0].field, 'role_surface:implementation:runtime_contract');
  assert.equal(reviewEvaluation.by_role.runtime_contract.stale_reasons[0].previous, null);
  assert.equal(reviewEvaluation.by_role.runtime_contract.stale_reasons[0].current, null);
  assert.match(
    reviewEvaluation.by_role.runtime_contract.stale_reasons[0].reason,
    /neither a current inspected content surface nor a previous evidence-reuse baseline/
  );

  // Aggregate must also flip to stale: `review prepare`'s stage-level
  // aggregate is fresh only if every requested role's own verdict is fresh,
  // matching the historical "one verdict per prepare call" semantics for
  // callers that only look at the top-level status, not by_role.
  assert.equal(reviewEvaluation.status, 'stale');
  assert.equal(reviewEvaluation.fresh, false);
  assert.equal(reviewEvaluation.first_input, false);
});

// Clause binding: story-vibepro-content-scoped-evidence-reuse-key:AC-2
test('buildRoleContentDigests omits a role whose content_binding shape is unrecognized, so a future field rename cannot make review prepare fail open', () => {
  // buildRoleContentDigests duck-types role.content_binding.{current_surface_hash,
  // recorded_surface_hash,surface_hash} and role.freshness_policy.effective_mode.
  // If that shape ever changes (field renamed or restructured upstream in
  // src/agent-review.js / src/content-binding.js), this role must be OMITTED
  // from the digest map -- landing on evaluateEvidenceReuseForReview's
  // `!current && !previous` "no positive evidence" branch above -- rather
  // than silently producing a digest that happens to make every role
  // inherit `baseFresh` (the systemic fail-open risk the same review flagged
  // alongside the primary branch-coverage gap).
  const stageSummariesWithUnexpectedShape = [
    {
      stage: 'implementation',
      roles: [
        {
          role: 'runtime_contract',
          freshness_policy: { effective_mode: 'content_surface' },
          // None of the hash keys buildRoleContentDigests actually reads
          // (current_surface_hash/recorded_surface_hash/surface_hash) are
          // present -- simulates a renamed/restructured content_binding.
          content_binding: { hash: 'zzzz', unexpected_field: true }
        }
      ]
    }
  ];
  const digests = buildRoleContentDigests(stageSummariesWithUnexpectedShape, { headSha: 'head-a' });
  assert.deepEqual(digests, {}, 'a role with an unrecognized content_binding shape must be omitted, not hashed into a false digest');

  const first = buildEvidenceReuse({
    story: { story_id: STORY_ID },
    git: { base_ref: 'main', base_sha: 'base', head_ref: 'HEAD', head_sha: 'head-a' },
    evidencePlan: { story_id: STORY_ID, planner_version: '0.1.0', evidence_depth: 'summary' },
    decisionIndex: { story_id: STORY_ID, evidence_depth: 'summary' }
  });
  // Second call re-derives the same (empty) base with no previousReuse role
  // baseline either -- simulating a shape drift discovered on the very next
  // pr prepare, before any role has a recorded baseline under the new shape.
  const second = buildEvidenceReuse({
    story: { story_id: STORY_ID },
    git: { base_ref: 'main', base_sha: 'base', head_ref: 'HEAD', head_sha: 'head-a' },
    evidencePlan: { story_id: STORY_ID, planner_version: '0.1.0', evidence_depth: 'summary' },
    decisionIndex: { story_id: STORY_ID, evidence_depth: 'summary' },
    previousReuse: first
  });
  assert.equal(second.base_reuse.status, 'hit');

  const reviewEvaluation = evaluateEvidenceReuseForReview({
    reuse: second,
    gitContext: { head_sha: 'head-a' },
    verificationEvidence: null,
    stage: 'implementation',
    roles: ['runtime_contract'],
    currentRoleDigests: digests
  });
  assert.equal(reviewEvaluation.by_role.runtime_contract.fresh, false);
  assert.equal(reviewEvaluation.by_role.runtime_contract.first_input, false);
  assert.ok(reviewEvaluation.by_role.runtime_contract.stale_reasons.some(
    (reason) => /neither a current inspected content surface nor a previous evidence-reuse baseline/.test(reason.reason)
  ));
});

// Clause binding: story-vibepro-content-scoped-evidence-reuse-key:AC-2
test("buildRoleContentDigests does not resurrect a stale recorded digest when a role's entire inspected surface is deleted, so the whole artifact cannot report a false hit", () => {
  // Real shape produced by evaluateContentBinding (src/content-binding.js)
  // when every file in a role's recorded surface is now missing:
  // current_surface_hash becomes null and missing_files is populated, but
  // recorded_surface_hash still unconditionally carries the OLD hash (it is
  // a summary of what was recorded, not what is current). Before this fix,
  // buildRoleContentDigests's `current_surface_hash ?? recorded_surface_hash
  // ?? surface_hash` fallback chain would slide through the null and report
  // the stale recorded hash as the role's CURRENT digest -- an independent
  // final_review (implementation:runtime_contract) caught this by
  // reproducing it directly against buildEvidenceReuse().
  const roleFullyPresent = [
    {
      stage: 'implementation',
      roles: [
        {
          role: 'runtime_contract',
          freshness_policy: { effective_mode: 'content_surface' },
          content_binding: {
            current_surface_hash: 'aaaa',
            recorded_surface_hash: 'aaaa',
            surface_files: ['src/deleted-module.js'],
            missing_files: []
          }
        }
      ]
    }
  ];
  const roleSurfaceDeleted = [
    {
      stage: 'implementation',
      roles: [
        {
          role: 'runtime_contract',
          freshness_policy: { effective_mode: 'content_surface' },
          content_binding: {
            // The one recorded file is gone: evaluateContentBinding sets
            // current_surface_hash to null and status to 'stale', while
            // recorded_surface_hash keeps reporting the pre-deletion hash.
            current_surface_hash: null,
            recorded_surface_hash: 'aaaa',
            surface_files: ['src/deleted-module.js'],
            missing_files: ['src/deleted-module.js']
          }
        }
      ]
    }
  ];

  // Direct unit check on buildRoleContentDigests: the deleted-surface round
  // must omit the role's digest entirely (landing in the existing "absent"
  // branch), not report a digest at all -- least of all the stale one.
  const digestsBeforeDeletion = buildRoleContentDigests(roleFullyPresent, { headSha: 'head-a' });
  assert.deepEqual(digestsBeforeDeletion, { 'implementation:runtime_contract': { mode: 'content_surface', digest: 'sha256:aaaa' } });
  const digestsAfterDeletion = buildRoleContentDigests(roleSurfaceDeleted, { headSha: 'head-a' });
  assert.deepEqual(digestsAfterDeletion, {}, "a role whose entire recorded surface is missing must be omitted, not hashed into its stale recorded digest");

  // End-to-end through the real buildEvidenceReuse() export, mirroring how
  // an independent reviewer reproduced the defect: build once with the
  // surface present, then again after deletion with previousReuse carried
  // forward and every other input held constant.
  const base = {
    story: { story_id: STORY_ID },
    git: { base_ref: 'main', base_sha: 'base', head_ref: 'HEAD', head_sha: 'head-a' },
    evidencePlan: { story_id: STORY_ID, planner_version: '0.1.0', evidence_depth: 'summary' },
    decisionIndex: { story_id: STORY_ID, evidence_depth: 'summary' }
  };
  const first = buildEvidenceReuse({ ...base, prContext: { agent_reviews: { stages: roleFullyPresent } } });
  assert.equal(first.role_reuse['implementation:runtime_contract'].digest, 'sha256:aaaa');

  const second = buildEvidenceReuse({
    ...base,
    prContext: { agent_reviews: { stages: roleSurfaceDeleted } },
    previousReuse: first
  });
  // The actual fix under test: the artifact must not resurrect the deleted
  // role's stale digest as if it were current. Before the fix, evidence_key
  // stayed byte-identical to `first` and status was 'hit' with
  // stale_reasons: [] -- a false whole-artifact hit for a state
  // evaluateContentBinding itself independently classifies as 'stale'.
  assert.notEqual(second.evidence_key, first.evidence_key, 'evidence_key must change once the role surface is deleted, not stay byte-identical to the pre-deletion build');
  assert.notEqual(second.status, 'hit', 'the aggregate status must not report a hit once a previously-tracked role has lost its entire recorded surface');
  assert.equal(second.role_reuse['implementation:runtime_contract'], undefined, "the deleted-surface role must be absent from role_reuse, not silently marked 'hit'");
});
