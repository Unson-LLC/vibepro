import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';

import {
  promoteCanonicalAuditArtifacts,
  replayCanonicalAuditBundle
} from '../src/canonical-audit.js';
import { buildCanonicalEvidenceCostSummary } from '../src/evidence-cost-budget.js';

const execFileAsync = promisify(execFile);
const CLI_BIN = fileURLToPath(new URL('../bin/vibepro.js', import.meta.url));

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeLargeVerificationEvidence(root, storyId, count = 700) {
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'verification-evidence.json'), {
    schema_version: '0.1.0',
    story_id: storyId,
    commands: Array.from({ length: count }, (_, index) => ({
      id: `verification-${index}`,
      kind: 'unit',
      status: 'pass',
      command: `node --test test/example-${index}.test.js`,
      summary: `Audit-relevant verification summary ${index}`,
      target: [`src/example-${index}.js`],
      scenario: [`SCOPE-VERIFY-${index}`],
      observed: { result: 'pass' },
      recorded_at: '2026-06-28T00:00:00.000Z'
    }))
  });
}

function argvFromReplayCommand(command) {
  assert.match(command, /^vibepro audit replay \. --story-id [A-Za-z0-9._-]+$/);
  return command.split(/\s+/).slice(1);
}

test('canonical audit bundle copies handoff references and reports unresolved references', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-self-contained-'));
  const storyId = 'story-canonical-self-contained';
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    story: { story_id: storyId },
    review_request: `.vibepro/reviews/${storyId}/gate/review-request-gate_evidence.md`,
    manual_result: `.vibepro/manual-verification/${storyId}/unit-result.json`,
    missing_result: `.vibepro/manual-verification/${storyId}/missing-result.json`
  });
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'gate-dag.json'), {
    story_id: storyId,
    verification: `.vibepro/pr/${storyId}/verification-evidence.json`
  });
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'verification-evidence.json'), {
    story_id: storyId,
    commands: [{
      status: 'pass',
      artifact: `.vibepro/manual-verification/${storyId}/unit-result.json`
    }]
  });
  await mkdir(path.join(root, '.vibepro', 'reviews', storyId, 'gate'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'reviews', storyId, 'gate', 'review-request-gate_evidence.md'),
    '# Review request\n'
  );
  await writeJson(path.join(root, '.vibepro', 'manual-verification', storyId, 'unit-result.json'), {
    status: 'pass'
  });

  const promoted = await promoteCanonicalAuditArtifacts(root, { storyId });
  const bundle = promoted.bundle;
  assert.equal(bundle.handoff_replay_status, 'blocked');
  assert.equal(bundle.artifacts.some((item) => item.kind === 'review_request' && item.source.endsWith('review-request-gate_evidence.md')), true);
  assert.equal(bundle.resolved_references.some((item) => item.source.endsWith('review-request-gate_evidence.md')), true);
  assert.equal(bundle.copied_references.some((item) => item.source.endsWith('unit-result.json')), true);
  assert.equal(bundle.unresolved_references.some((item) => item.source.endsWith('missing-result.json')), true);
  assert.equal(
    await readJson(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'references', 'vibepro', 'manual-verification', storyId, 'unit-result.json')).then((item) => item.status),
    'pass'
  );
});

test('canonical audit bundle promotes review requests even when no JSON references them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-review-request-'));
  const storyId = 'story-review-request-omission';
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    story: { story_id: storyId }
  });
  await mkdir(path.join(root, '.vibepro', 'reviews', storyId, 'gate'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'reviews', storyId, 'gate', 'review-request-gate_evidence.md'),
    '# Gate evidence review request\n'
  );

  const promoted = await promoteCanonicalAuditArtifacts(root, { storyId });
  const bundle = promoted.bundle;
  assert.equal(bundle.handoff_replay_status, 'ready');
  assert.equal(
    bundle.artifacts.some((item) => item.kind === 'review_request' && item.canonical_path.endsWith('review-request-gate_evidence.md')),
    true
  );
  assert.equal(
    await readFile(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'reviews', 'gate', 'review-request-gate_evidence.md'), 'utf8'),
    '# Gate evidence review request\n'
  );
});

test('ERM-CONTRACT-004 canonical audit bundle compacts over-budget evidence instead of copying full raw artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-budget-'));
  const storyId = 'story-over-budget-evidence';
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-23T00:00:00.000Z',
    story: { story_id: storyId },
    gate_status: {
      ready_for_pr_create: true,
      overall_status: 'ready_for_review',
      fast_lane: false,
      critical_unresolved_gates: []
    },
    large_gate_context: Array.from({ length: 1700 }, (_, index) => ({
      id: `gate-${index}`,
      status: 'passed'
    }))
  });
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'evidence-reuse.json'), {
    schema_version: '0.1.0',
    story_id: storyId,
    created_at: '2026-06-23T00:01:00.000Z',
    status: 'hit',
    evidence_key: 'evk_compact',
    key_inputs: {
      verification_summary_fingerprint: 'sha256:compact-verification',
      verification_evidence_updated_at: '2026-06-23T00:02:00.000Z',
      verification_command_timestamps: [
        {
          kind: 'unit',
          executed_at: '2026-06-23T00:02:00.000Z',
          git_recorded_at: '2026-06-23T00:02:01.000Z'
        }
      ]
    },
    stale_reasons: [],
    full_evidence: {
      status: 'reused',
      generation_count: 1,
      generation_count_scope: 'same_evidence_key',
      same_key_generation_count: 1,
      cumulative_generation_count: 3
    }
  });
  await writeLargeVerificationEvidence(root, storyId);

  const promoted = await promoteCanonicalAuditArtifacts(root, {
    storyId,
    merge: {
      status: 'merged',
      merged_at: '2026-06-23T00:05:00.000Z',
      merge_commit_sha: 'abc123',
      pr: { url: 'https://github.com/example/repo/pull/1' }
    }
  });
  const bundle = promoted.bundle;

  assert.equal(bundle.artifact_policy.compacted, true);
  assert.equal(bundle.evidence_depth, 'standard');
  assert.equal(bundle.cost_summary.budget_status, 'exceeded');
  assert.equal(bundle.artifacts.some((item) => item.kind === 'audit_index'), true);
  assert.equal(bundle.artifacts.some((item) => item.kind === 'compressed_replay_bundle'), true);
  assert.equal(bundle.handoff_replay_status, 'ready');
  assert.equal(bundle.raw_artifacts.some((item) => item.kind === 'pr_prepare' && item.persisted === 'compressed'), true);
  assert.equal(bundle.replay_bundle.compression, 'gzip');
  assert.equal(bundle.replay_bundle.included_artifact_kinds.includes('pr_prepare'), true);
  const auditIndex = await readJson(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-index.json'));
  assert.equal(auditIndex.replay_bundle.path, bundle.replay_bundle.path);
  assert.equal(auditIndex.replay_bundle.replay_command, `vibepro audit replay . --story-id ${storyId}`);
  assert.equal(auditIndex.pr_prepare.present, true);
  assert.equal(auditIndex.evidence_reuse.verification_summary_fingerprint, 'sha256:compact-verification');
  assert.equal(auditIndex.evidence_reuse.verification_evidence_updated_at, '2026-06-23T00:02:00.000Z');
  assert.equal(auditIndex.evidence_reuse.verification_command_timestamps[0].executed_at, '2026-06-23T00:02:00.000Z');
  assert.equal(auditIndex.evidence_reuse.full_evidence_generation_count, 1);
  assert.equal(auditIndex.evidence_reuse.full_evidence_generation_count_scope, 'same_evidence_key');
  assert.equal(auditIndex.evidence_reuse.full_evidence_same_key_generation_count, 1);
  assert.equal(auditIndex.evidence_reuse.full_evidence_cumulative_generation_count, 3);
  await assert.rejects(
    () => readFile(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'pr', 'pr-prepare.json'), 'utf8'),
    /ENOENT/
  );
  const replay = await replayCanonicalAuditBundle(root, { storyId });
  assert.equal(replay.status, 'ready');
  assert.equal(replay.verdict.pr_prepare, 'ready_for_review');
  assert.equal(replay.verdict.pr_merge, 'merged');
  assert.equal(replay.included_artifact_kinds.includes('pr_prepare'), true);

  const declaredReplayArgv = argvFromReplayCommand(auditIndex.replay_bundle.replay_command);
  const cliReplay = await execFileAsync(
    process.execPath,
    [CLI_BIN, ...declaredReplayArgv, '--json'],
    { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
  );
  const cliReplayResult = JSON.parse(cliReplay.stdout);
  assert.equal(cliReplayResult.status, 'ready');
  assert.equal(cliReplayResult.handoff_replay_status, 'ready');
  assert.equal(cliReplayResult.verdict.pr_prepare, 'ready_for_review');
  assert.equal(cliReplayResult.verdict.pr_merge, 'merged');
});

test('canonical audit scope prunes debug inventory and duplicate full gate context from persisted audit data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-scope-prune-'));
  const storyId = 'story-audit-scope-pruning';
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-28T00:00:00.000Z',
    story: { story_id: storyId },
    manual_result: `.vibepro/manual-verification/${storyId}/unit-result.json`,
    gate_status: {
      ready_for_pr_create: true,
      overall_status: 'ready_for_review',
      critical_unresolved_gates: []
    },
    pr_context: {
      design_ssot_reconciliation: {
        status: 'passed',
        summary: { unregistered_doc_count: 2, changed_doc_count: 1 },
        coverage: {
          status: 'passed',
          summary: { unregistered_doc_count: 2, changed_doc_count: 1 },
          changed_docs: [{ path: 'docs/architecture/current.md', registered: true }],
          unregistered_docs: [
            { path: 'docs/architecture/old-a.md', registered: false },
            { path: 'docs/architecture/old-b.md', registered: false }
          ],
          registered_docs: [{ path: 'docs/architecture/current.md', registered: true }]
        }
      },
      engineering_judgment: {
        status: 'passed',
        judgment_axes: [
          {
            axis: 'public_contract',
            status: 'active_passed',
            reason: 'contract surface changed',
            matched_evidence: [{
              kind: 'contract_doc',
              ref: 'docs/reference/cli.md',
              strength: 'supporting',
              verbose_debug_payload: 'x'.repeat(1000)
            }]
          },
          {
            axis: 'unused_axis',
            status: 'inactive',
            reason: 'not relevant',
            matched_evidence: [{
              kind: 'debug',
              ref: 'debug-log',
              verbose_debug_payload: 'y'.repeat(1000)
            }]
          }
        ]
      },
      gate_dag: {
        schema_version: '0.1.0',
        story_id: storyId,
        overall_status: 'ready_for_review',
        nodes: [{
          id: 'gate:judgment_axis_public_contract',
          type: 'judgment_axis_gate',
          status: 'passed',
          required: true,
          matched_evidence: [{
            kind: 'contract_doc',
            ref: 'docs/reference/cli.md',
            strength: 'supporting',
            verbose_debug_payload: 'z'.repeat(1000)
          }]
        }],
        edges: []
      }
    }
  });
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'gate-dag.json'), {
    schema_version: '0.1.0',
    story_id: storyId,
    overall_status: 'ready_for_review',
    nodes: [{
      id: 'gate:judgment_axis_public_contract',
      type: 'judgment_axis_gate',
      status: 'passed',
      required: true,
      matched_evidence: [{
        kind: 'contract_doc',
        ref: 'docs/reference/cli.md',
        strength: 'supporting',
        verbose_debug_payload: 'z'.repeat(1000)
      }]
    }],
    edges: []
  });
  await writeJson(path.join(root, '.vibepro', 'manual-verification', storyId, 'unit-result.json'), {
    status: 'pass'
  });

  const promoted = await promoteCanonicalAuditArtifacts(root, { storyId });
  const prPrepareRaw = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), 'utf8');
  const prPrepareCanonical = await readJson(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'pr', 'pr-prepare.json'));
  const canonicalText = JSON.stringify(prPrepareCanonical);

  assert.equal(prPrepareCanonical.artifact_kind, 'canonical_pr_prepare_audit_summary');
  assert.equal(
    prPrepareCanonical.pr_context.design_ssot_reconciliation.coverage.unregistered_doc_count,
    2
  );
  assert.equal(
    Object.hasOwn(prPrepareCanonical.pr_context.design_ssot_reconciliation.coverage, 'unregistered_docs'),
    false
  );
  assert.equal(prPrepareCanonical.pr_context.engineering_judgment.inactive_axis_count, 1);
  assert.equal(prPrepareCanonical.pr_context.engineering_judgment.judgment_axes.length, 1);
  assert.equal(canonicalText.includes('verbose_debug_payload'), false);
  assert.equal(Buffer.byteLength(canonicalText) < Buffer.byteLength(prPrepareRaw), true);
  assert.equal(promoted.bundle.resolved_references.some((item) => item.source.endsWith('unit-result.json')), true);
});

test('compressed canonical audit replay blocks when the bundle is corrupted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-replay-corrupt-'));
  const storyId = 'story-corrupt-replay';
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    story: { story_id: storyId },
    gate_status: { overall_status: 'ready_for_review' },
    large_gate_context: Array.from({ length: 1700 }, (_, index) => ({ id: `gate-${index}` }))
  });
  await writeLargeVerificationEvidence(root, storyId);

  const promoted = await promoteCanonicalAuditArtifacts(root, { storyId });
  await writeFile(path.join(root, promoted.bundle.replay_bundle.path), 'not gzip\n');
  const replay = await replayCanonicalAuditBundle(root, { storyId });
  assert.equal(replay.status, 'blocked');
  assert.equal(replay.reason, 'compressed_hash_mismatch');
});

test('compressed canonical audit replay blocks when hash metadata is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-replay-missing-hash-'));
  const storyId = 'story-missing-replay-hash';
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    story: { story_id: storyId },
    gate_status: { overall_status: 'ready_for_review' },
    large_gate_context: Array.from({ length: 1700 }, (_, index) => ({ id: `gate-${index}` }))
  });
  await writeLargeVerificationEvidence(root, storyId);

  const promoted = await promoteCanonicalAuditArtifacts(root, { storyId });
  const auditIndexPath = path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-index.json');
  const auditBundlePath = path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-bundle.json');
  const auditIndex = await readJson(auditIndexPath);
  const auditBundle = await readJson(auditBundlePath);

  delete auditIndex.replay_bundle.compressed_hash;
  delete auditBundle.replay_bundle.compressed_hash;
  delete auditBundle.decision_index.replay_bundle.compressed_hash;
  await writeJson(auditIndexPath, auditIndex);
  await writeJson(auditBundlePath, auditBundle);
  const missingCompressedHash = await replayCanonicalAuditBundle(root, { storyId });
  assert.equal(missingCompressedHash.status, 'blocked');
  assert.equal(missingCompressedHash.reason, 'compressed_hash_missing');

  auditIndex.replay_bundle.compressed_hash = promoted.bundle.replay_bundle.compressed_hash;
  auditBundle.replay_bundle.compressed_hash = promoted.bundle.replay_bundle.compressed_hash;
  auditBundle.decision_index.replay_bundle.compressed_hash = promoted.bundle.replay_bundle.compressed_hash;
  delete auditIndex.replay_bundle.content_hash;
  delete auditBundle.replay_bundle.content_hash;
  delete auditBundle.decision_index.replay_bundle.content_hash;
  await writeJson(auditIndexPath, auditIndex);
  await writeJson(auditBundlePath, auditBundle);
  const missingContentHash = await replayCanonicalAuditBundle(root, { storyId });
  assert.equal(missingContentHash.status, 'blocked');
  assert.equal(missingContentHash.reason, 'content_hash_missing');
});

test('canonical audit bundle stores diff stats provenance and bucketed changed lines', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-diff-stats-'));
  const storyId = 'story-diff-stats';
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-23T00:00:00.000Z',
    story: { story_id: storyId },
    gate_status: {
      ready_for_pr_create: true,
      overall_status: 'ready_for_review',
      critical_unresolved_gates: []
    }
  });

  const promoted = await promoteCanonicalAuditArtifacts(root, {
    storyId,
    merge: {
      status: 'merged',
      merged_at: '2026-06-23T00:05:00.000Z',
      merge_commit_sha: 'abc123',
      pr: { url: 'https://github.com/example/repo/pull/1' },
      git: {
        diff_stats: {
          status: 'available',
          source: 'git diff --numstat origin/main...abc123',
          refs: {
            base_ref: 'origin/main',
            head_ref: 'abc123',
            base_sha: 'base123',
            head_sha: 'abc123',
            merge_commit_sha: 'abc123'
          },
          collected_at: '2026-06-23T00:04:00.000Z',
          reason: null
        },
        diff_line_stats: {
          'src/canonical-audit.js': { additions: 12, deletions: 3 },
          'test/canonical-audit.test.js': { additions: 5, deletions: 1 },
          'docs/specs/vibepro-canonical-audit-diff-stats.md': { additions: 10, deletions: 0 },
          'docs/management/audit-artifacts/story-x/audit-bundle.json': { additions: 50, deletions: 0 }
        }
      }
    }
  });

  const cost = promoted.bundle.cost_summary;
  assert.equal(cost.diff_stats_status, 'available');
  assert.equal(cost.diff_stats_source, 'git diff --numstat origin/main...abc123');
  assert.equal(cost.changed_lines.buckets.src.changed_lines, 15);
  assert.equal(cost.changed_lines.buckets.test.changed_lines, 6);
  assert.equal(cost.changed_lines.buckets.story_spec_architecture_docs.changed_lines, 10);
  assert.equal(cost.changed_lines.buckets.audit_artifacts.changed_lines, 50);
  assert.equal(cost.product_changed_lines, 31);
  assert.equal(cost.artifact_code_ratio !== null, true);
  assert.equal(promoted.bundle.automation_value_audit.status, 'needs_evidence');
  assert.equal(promoted.bundle.automation_value_audit.allocation.implementation_changed_lines, 15);
  assert.equal(promoted.bundle.automation_value_audit.allocation.audit_evidence_changed_lines, 66);
  assert.equal(promoted.bundle.automation_value_audit.ratios.automation_evidence_to_src, 4.4);
  assert.equal(promoted.bundle.automation_value_audit.cost_controls.status, 'action_required');
  assert.equal(
    promoted.bundle.automation_value_audit.cost_controls.recommendations.some((item) => item.id === 'split_or_shrink_evidence_heavy_story'),
    true
  );
  assert.equal(
    promoted.bundle.automation_value_audit.findings.some((finding) => finding.id === 'evidence_heavy_relative_to_src'),
    true
  );
});

test('canonical evidence cost summary preserves available and unavailable token/time accounting', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 10,
    tokenAccounting: {
      input_tokens: 1000,
      output_tokens: 250,
      cached_input_tokens: 50,
      source: 'session-jsonl',
      window: { session_id: 'session-1' }
    },
    elapsedTimeAccounting: {
      started_at: '2026-06-27T00:00:00.000Z',
      finished_at: '2026-06-27T00:02:30.000Z',
      source: 'session-jsonl'
    }
  });

  assert.equal(cost.token_accounting.status, 'available');
  assert.equal(cost.token_accounting.total_tokens, 1250);
  assert.equal(cost.token_accounting.input_tokens, 1000);
  assert.equal(cost.token_accounting.output_tokens, 250);
  assert.equal(cost.token_accounting.cached_input_tokens, 50);
  assert.equal(cost.token_accounting.source, 'session-jsonl');
  assert.deepEqual(cost.token_accounting.window, { session_id: 'session-1' });
  assert.equal(cost.elapsed_time_accounting.status, 'available');
  assert.equal(cost.elapsed_time_accounting.elapsed_ms, 150000);
  assert.equal(cost.elapsed_time_accounting.started_at, '2026-06-27T00:00:00.000Z');
  assert.equal(cost.elapsed_time_accounting.finished_at, '2026-06-27T00:02:30.000Z');

  const unavailable = buildCanonicalEvidenceCostSummary();
  assert.equal(unavailable.token_accounting.status, 'unavailable');
  assert.equal(unavailable.token_accounting.total_tokens, null);
  assert.equal(unavailable.token_accounting.reason, 'session token logs were not provided to canonical audit promotion');
  assert.equal(unavailable.elapsed_time_accounting.status, 'unavailable');
  assert.equal(unavailable.elapsed_time_accounting.elapsed_ms, null);
  assert.equal(unavailable.elapsed_time_accounting.reason, 'elapsed-time logs were not provided to canonical audit promotion');
});

test('canonical audit promotion persists merge cost accounting in compact artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-canonical-cost-accounting-'));
  const storyId = 'story-cost-accounting';
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    schema_version: '0.1.0',
    created_at: '2026-06-27T00:00:00.000Z',
    story: { story_id: storyId },
    gate_status: {
      ready_for_pr_create: true,
      overall_status: 'ready_for_review',
      critical_unresolved_gates: []
    },
    large_gate_context: Array.from({ length: 1700 }, (_, index) => ({
      id: `gate-${index}`,
      status: 'passed'
    }))
  });
  await writeLargeVerificationEvidence(root, storyId);

  const promoted = await promoteCanonicalAuditArtifacts(root, {
    storyId,
    merge: {
      status: 'merged',
      merged_at: '2026-06-27T00:05:00.000Z',
      merge_commit_sha: 'abc123',
      pr: { url: 'https://github.com/example/repo/pull/2' },
      cost_accounting: {
        token_accounting: {
          status: 'available',
          total_tokens: 3456,
          input_tokens: 3000,
          output_tokens: 456,
          source: 'codex-session-jsonl',
          window: { session_id: '019-cost' }
        },
        elapsed_time_accounting: {
          started_at: '2026-06-27T00:00:00.000Z',
          finished_at: '2026-06-27T00:12:00.000Z',
          source: 'codex-session-jsonl'
        }
      }
    }
  });

  assert.equal(promoted.bundle.artifact_policy.compacted, true);
  assert.equal(promoted.bundle.cost_summary.token_accounting.status, 'available');
  assert.equal(promoted.bundle.cost_summary.token_accounting.total_tokens, 3456);
  assert.equal(promoted.bundle.cost_summary.elapsed_time_accounting.status, 'available');
  assert.equal(promoted.bundle.cost_summary.elapsed_time_accounting.elapsed_ms, 720000);

  const auditIndex = await readJson(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-index.json'));
  assert.equal(auditIndex.cost_summary.token_accounting.total_tokens, 3456);
  assert.equal(auditIndex.cost_summary.elapsed_time_accounting.elapsed_ms, 720000);
  assert.equal(auditIndex.automation_value_audit.status, 'needs_evidence');
  assert.equal(auditIndex.automation_value_audit.session_cost.total_tokens, 3456);
  assert.equal(auditIndex.automation_value_audit.session_cost.elapsed_ms, 720000);
  assert.equal(
    auditIndex.automation_value_audit.findings.some((finding) => finding.id === 'agent_review_not_recorded'),
    true
  );

  const decisionSummary = await readFile(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'decision-summary.md'), 'utf8');
  assert.match(decisionSummary, /token_accounting: available total=3456 source=codex-session-jsonl/);
  assert.match(decisionSummary, /elapsed_time_accounting: available elapsed_ms=720000 source=codex-session-jsonl/);
  assert.match(decisionSummary, /automation_value_audit: needs_evidence/);
  assert.match(decisionSummary, /cost_controls: action_required/);

  const replayText = gunzipSync(await readFile(path.join(root, promoted.bundle.replay_bundle.path))).toString('utf8');
  const replayPayload = JSON.parse(replayText);
  assert.equal(replayPayload.cost_summary.token_accounting.total_tokens, 3456);
  assert.equal(replayPayload.cost_summary.elapsed_time_accounting.elapsed_ms, 720000);
  assert.equal(replayPayload.decision_index.automation_value_audit.session_cost.total_tokens, 3456);
});
