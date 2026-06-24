import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { promoteCanonicalAuditArtifacts } from '../src/canonical-audit.js';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
  assert.equal(bundle.raw_artifacts.some((item) => item.kind === 'pr_prepare' && item.persisted === false), true);
  const auditIndex = await readJson(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-index.json'));
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
});
