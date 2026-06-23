import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCanonicalEvidenceCostSummary,
  classifyChangedPath,
  parseNumstat,
  shouldUseCompactCanonicalEvidence,
  summarizeDiffLineStats
} from '../src/evidence-cost-budget.js';

test('classifies changed lines into product and audit buckets', () => {
  const stats = parseNumstat([
    '10\t2\tsrc/canonical-audit.js',
    '3\t1\ttest/canonical-audit.test.js',
    '5\t0\tdocs/specs/vibepro-evidence-cost-budget.md',
    '800\t0\tdocs/management/audit-artifacts/story-x/pr/pr-prepare.json',
    '1\t1\tREADME.md'
  ].join('\n'));

  assert.equal(classifyChangedPath('src/canonical-audit.js'), 'src');
  assert.equal(classifyChangedPath('docs/management/audit-artifacts/story-x/audit-bundle.json'), 'audit_artifacts');

  const summary = summarizeDiffLineStats(stats);
  assert.equal(summary.buckets.src.changed_lines, 12);
  assert.equal(summary.buckets.test.changed_lines, 4);
  assert.equal(summary.buckets.story_spec_architecture_docs.changed_lines, 5);
  assert.equal(summary.buckets.audit_artifacts.changed_lines, 800);
  assert.equal(summary.buckets.other.changed_lines, 2);
});

test('canonical evidence cost budget selects compact persistence on artifact/code overflow', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 1200,
    diffStats: {
      'src/canonical-audit.js': { additions: 20, deletions: 5 },
      'test/canonical-audit.test.js': { additions: 10, deletions: 0 }
    }
  });

  assert.equal(cost.budget_status, 'exceeded');
  assert.equal(cost.artifact_code_ratio, 34.286);
  assert.equal(cost.budget_exceeded_reasons.includes('canonical_artifact_lines_exceeded'), true);
  assert.equal(cost.budget_exceeded_reasons.includes('artifact_code_ratio_exceeded'), true);
  assert.equal(shouldUseCompactCanonicalEvidence(cost), true);
});

test('canonical evidence cost budget counts docs-only changes as product context', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 20,
    diffStats: {
      'docs/specs/vibepro-canonical-audit-diff-stats.md': { additions: 12, deletions: 3 },
      'docs/architecture/vibepro-canonical-audit-diff-stats.md': { additions: 7, deletions: 1 }
    },
    diffStatsProvenance: {
      status: 'available',
      source: 'git diff --numstat origin/main...HEAD',
      refs: { base_ref: 'origin/main', head_ref: 'HEAD' },
      collected_at: '2026-06-23T00:00:00.000Z'
    }
  });

  assert.equal(cost.diff_stats_status, 'available');
  assert.equal(cost.changed_lines.buckets.story_spec_architecture_docs.changed_lines, 23);
  assert.equal(cost.product_changed_lines, 23);
  assert.equal(cost.artifact_code_ratio, 0.87);
});

test('canonical evidence cost budget keeps audit-only changes out of product ratio denominator', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 75,
    diffStats: {
      'docs/management/audit-artifacts/story-x/audit-bundle.json': { additions: 70, deletions: 5 }
    },
    diffStatsProvenance: {
      status: 'available',
      source: 'git diff --numstat origin/main...HEAD',
      refs: { base_ref: 'origin/main', head_ref: 'HEAD' },
      collected_at: '2026-06-23T00:00:00.000Z'
    }
  });

  assert.equal(cost.diff_stats_status, 'available');
  assert.equal(cost.changed_lines.buckets.audit_artifacts.changed_lines, 75);
  assert.equal(cost.product_changed_lines, 0);
  assert.equal(cost.artifact_code_ratio, null);
  assert.equal(cost.artifact_code_ratio_reason, 'product_changed_lines_zero');
});

test('canonical evidence cost budget preserves unavailable diff stats instead of fake zeroes', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 120,
    diffStats: null,
    diffStatsProvenance: {
      status: 'unavailable',
      source: 'git diff --numstat origin/main...HEAD',
      refs: {
        base_ref: 'origin/main',
        head_ref: 'HEAD',
        base_sha: null,
        head_sha: null,
        merge_commit_sha: null
      },
      collected_at: '2026-06-23T00:00:00.000Z',
      reason: 'base ref missing'
    }
  });

  assert.equal(cost.diff_stats_status, 'unavailable');
  assert.equal(cost.product_changed_lines, null);
  assert.equal(cost.product_changed_lines_status, 'unavailable');
  assert.equal(cost.artifact_code_ratio, null);
  assert.equal(cost.artifact_code_ratio_reason, 'diff_stats_unavailable');
  assert.equal(cost.changed_lines.status, 'unavailable');
});
