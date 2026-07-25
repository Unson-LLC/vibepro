import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyEvidenceChangeSurface,
  detectDocsOnlyChange,
  isDocsOnlyChange
} from '../src/docs-only-change.js';
import {
  DEFAULT_EVIDENCE_COST_BUDGET,
  buildCanonicalEvidenceCostSummary,
  parseNumstat
} from '../src/evidence-cost-budget.js';
import { buildEvidencePlan } from '../src/evidence-depth-planner.js';

const DOCS_ONLY_NUMSTAT = parseNumstat([
  '49\t0\tdocs/management/stories/active/story-vibepro-docs-only-evidence-profile.md',
  '31\t1\tdocs/management/roadmap/autonomy-roadmap.md',
  '38\t1\t.vibepro/config.json',
  '4\t0\tdesign-ssot.json'
].join('\n'));

const IMPLEMENTATION_NUMSTAT = parseNumstat([
  '120\t14\tsrc/evidence-cost-budget.js',
  '86\t3\ttest/evidence-cost-budget.test.js',
  '40\t0\tdocs/management/stories/active/story-vibepro-example.md'
].join('\n'));

// --- DOE-S-1: deterministic docs-only detection -----------------------------

test('DOE-S-1 classifies each changed path into a single evidence change surface', () => {
  assert.equal(classifyEvidenceChangeSurface('src/merge-manager.js'), 'product_code');
  assert.equal(classifyEvidenceChangeSurface('test/e2e/story.spec.ts'), 'product_code');
  assert.equal(classifyEvidenceChangeSurface('bin/vibepro.js'), 'product_code');
  assert.equal(classifyEvidenceChangeSurface('package.json'), 'product_code');
  assert.equal(classifyEvidenceChangeSurface('.github/workflows/ci.yml'), 'product_code');
  assert.equal(classifyEvidenceChangeSurface('docs/management/roadmap/autonomy.md'), 'docs');
  assert.equal(classifyEvidenceChangeSurface('README.md'), 'docs');
  assert.equal(classifyEvidenceChangeSurface('.vibepro/config.json'), 'evidence_artifacts');
  assert.equal(classifyEvidenceChangeSurface('design-ssot.json'), 'evidence_artifacts');
  assert.equal(classifyEvidenceChangeSurface('docs/management/audit-artifacts/story-x/audit-bundle.json'), 'evidence_artifacts');
  // `docs/` outranks the product prefixes so a spec never reads as code.
  assert.equal(classifyEvidenceChangeSurface('docs/specs/story.vibepro.json'), 'docs');
  assert.equal(classifyEvidenceChangeSurface('unmapped/thing.bin'), 'unknown');
});

test('DOE-S-1 detects a docs/roadmap change with no src or test diff as docs-only', () => {
  const detection = detectDocsOnlyChange({ diffStats: DOCS_ONLY_NUMSTAT });

  assert.equal(detection.status, 'docs_only');
  assert.equal(detection.reason, 'no_product_code_paths_changed');
  assert.equal(detection.source, 'diff_line_stats');
  assert.equal(detection.product_code_path_count, 0);
  assert.equal(detection.product_code_changed_lines, 0);
  assert.equal(detection.docs_changed_lines, 81);
  assert.equal(isDocsOnlyChange(detection), true);
});

test('DOE-S-1 keeps any src or test diff on the implementation path', () => {
  const detection = detectDocsOnlyChange({ diffStats: IMPLEMENTATION_NUMSTAT });

  assert.equal(detection.status, 'product_change');
  assert.equal(detection.reason, 'product_code_paths_changed');
  assert.equal(detection.product_code_changed_lines, 223);
  assert.equal(isDocsOnlyChange(detection), false);
});

test('DOE-S-1 refuses to call an unclassified or empty change set docs-only', () => {
  const unclassified = detectDocsOnlyChange({
    diffStats: parseNumstat(['3\t0\tdocs/foo.md', '2\t2\tvendor/blob.dat'].join('\n'))
  });
  assert.equal(unclassified.status, 'unknown');
  assert.equal(unclassified.reason, 'unclassified_paths_present');
  assert.deepEqual(unclassified.sample_unknown_paths, ['vendor/blob.dat']);

  // An empty numstat is what a lost pre-merge diff base looks like. Reading it
  // as "only docs changed" is exactly the misclassification DOE-S-3 removes.
  const emptyDiff = detectDocsOnlyChange({ diffStats: {} });
  assert.equal(emptyDiff.status, 'unknown');
  assert.equal(emptyDiff.reason, 'no_changed_paths_observed');

  const noObservation = detectDocsOnlyChange({});
  assert.equal(noObservation.status, 'unknown');
  assert.equal(noObservation.reason, 'change_surface_unavailable');

  const unavailableStats = detectDocsOnlyChange({
    diffStats: DOCS_ONLY_NUMSTAT,
    diffStatsStatus: 'unavailable'
  });
  assert.equal(unavailableStats.status, 'unknown');
  assert.equal(unavailableStats.reason, 'diff_stats_unavailable');

  // VibePro bookkeeping alone is too weak a signal to lighten evidence on.
  const recordsOnly = detectDocsOnlyChange({
    diffStats: parseNumstat('12\t1\t.vibepro/config.json')
  });
  assert.equal(recordsOnly.status, 'unknown');
  assert.equal(recordsOnly.reason, 'no_docs_paths_changed');
});

test('DOE-S-1 falls back to changed_files when per-file line stats are absent', () => {
  const detection = detectDocsOnlyChange({
    changedFiles: [
      { path: 'docs/management/stories/active/story-x.md' },
      '.vibepro/config.json'
    ]
  });

  assert.equal(detection.status, 'docs_only');
  assert.equal(detection.source, 'changed_files');
  // Line counts were never measured, so they must not be reported as zero.
  assert.equal(detection.product_code_changed_lines, null);
  assert.equal(detection.docs_changed_lines, null);
});

test('DOE-S-1 falls back to changed_files when numstat observed nothing measurable', () => {
  // `pr prepare` reports an empty numstat for untracked-only or binary-only
  // changes; the file list is still a usable second observation.
  const detection = detectDocsOnlyChange({
    diffStats: {},
    changedFiles: [{ path: 'src/merge-manager.js' }]
  });

  assert.equal(detection.status, 'product_change');
  assert.equal(detection.source, 'changed_files');
});

test('DOE-S-1 defaults a docs-only change to the lightest persistence depth', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 3814,
    diffStats: DOCS_ONLY_NUMSTAT
  });

  assert.equal(cost.change_surface.status, 'docs_only');
  assert.equal(cost.evidence_depth, 'summary');
});

test('DOE-S-1 keeps an explicit depth escalation authoritative over the docs-only default', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 3814,
    diffStats: DOCS_ONLY_NUMSTAT,
    requestedDepth: 'full'
  });

  assert.equal(cost.change_surface.status, 'docs_only');
  assert.equal(cost.evidence_depth, 'full');
});

test('DOE-S-1 keeps the pre-existing risk escalation above the docs-only default', () => {
  // Non Goal: docs changes must not get weaker evidence requirements. A
  // docs-only change that already escalated for risk keeps its full depth;
  // ordering docs-only above the escalation would silently downgrade exactly
  // the missing-artifact / waived-gate / security-profile cases.
  const highRiskProfile = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 100,
    diffStats: DOCS_ONLY_NUMSTAT,
    riskProfile: 'security'
  });
  assert.equal(highRiskProfile.change_surface.status, 'docs_only');
  assert.equal(highRiskProfile.budget_scope, 'docs_only');
  assert.equal(highRiskProfile.evidence_depth, 'full');

  const triggerSignal = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 100,
    diffStats: DOCS_ONLY_NUMSTAT,
    triggerSignals: ['missing_artifact']
  });
  assert.equal(triggerSignal.change_surface.status, 'docs_only');
  assert.equal(triggerSignal.evidence_depth, 'full');

  // An operator may still escalate or de-escalate explicitly.
  const explicit = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 100,
    diffStats: DOCS_ONLY_NUMSTAT,
    riskProfile: 'security',
    requestedDepth: 'summary'
  });
  assert.equal(explicit.evidence_depth, 'summary');

  // Without a risk signal the docs-only default still applies.
  const lowRisk = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 100,
    diffStats: DOCS_ONLY_NUMSTAT
  });
  assert.equal(lowRisk.evidence_depth, 'summary');
});

test('DOE-S-1 classifies the deployed manual surface under docs/ as product code', () => {
  // `docs/` also holds the site generator config and the deployed static
  // surface; changing what ships is not a documentation change.
  assert.equal(classifyEvidenceChangeSurface('docs/.vitepress/config.mjs'), 'product_code');
  assert.equal(classifyEvidenceChangeSurface('docs/public/_headers'), 'product_code');
  assert.equal(classifyEvidenceChangeSurface('docs/public/_redirects'), 'product_code');
  assert.equal(classifyEvidenceChangeSurface('docs/contracts/vibepro-core-responsibilities.json'), 'product_code');
  assert.equal(classifyEvidenceChangeSurface('docs/build.mjs'), 'product_code');
  // Requirement surfaces stay documentation whatever their extension.
  assert.equal(classifyEvidenceChangeSurface('docs/specs/story-x.vibepro.json'), 'docs');
  assert.equal(classifyEvidenceChangeSurface('docs/management/stories/active/story-x.md'), 'docs');
  assert.equal(classifyEvidenceChangeSurface('docs/architecture/story-x.md'), 'docs');

  const deployedSurface = detectDocsOnlyChange({
    diffStats: parseNumstat([
      '20\t0\tdocs/management/stories/active/story-x.md',
      '4\t1\tdocs/public/_headers'
    ].join('\n'))
  });
  assert.equal(deployedSurface.status, 'product_change');
  assert.deepEqual(deployedSurface.sample_product_code_paths, ['docs/public/_headers']);
});

test('DOE-S-1 names the VibePro-managed records a docs-only verdict tolerated', () => {
  // `.vibepro/config.json` carries review-role policy and evidence budgets
  // alongside the Story catalog, so a docs-only verdict must say which records
  // it accepted rather than absorbing them silently.
  const detection = detectDocsOnlyChange({ diffStats: DOCS_ONLY_NUMSTAT });

  assert.equal(detection.status, 'docs_only');
  assert.equal(detection.evidence_artifact_path_count, 2);
  assert.deepEqual(detection.sample_evidence_artifact_paths, ['.vibepro/config.json', 'design-ssot.json']);
});

test('DOE-S-1 does not lighten an implementation change that touches docs too', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 1400,
    diffStats: IMPLEMENTATION_NUMSTAT
  });

  assert.equal(cost.change_surface.status, 'product_change');
  assert.equal(cost.budget_scope, 'implementation');
  assert.equal(cost.evidence_depth, 'standard');
});

// --- DOE-S-2: docs-only budget is separated from the implementation signal ---

test('DOE-S-2 defines a docs-only budget profile distinct from the implementation profiles', () => {
  assert.equal(DEFAULT_EVIDENCE_COST_BUDGET.docs_only.artifact_code_ratio, null);
  // Non Goal: the global line threshold is not raised for docs-only changes.
  assert.equal(
    DEFAULT_EVIDENCE_COST_BUDGET.docs_only.canonical_artifact_lines,
    DEFAULT_EVIDENCE_COST_BUDGET.normal.canonical_artifact_lines
  );
});

test('DOE-S-2 routes a docs-only overspend away from the implementation budget signal', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 4996,
    diffStats: DOCS_ONLY_NUMSTAT
  });

  assert.equal(cost.budget.profile, 'docs_only');
  assert.equal(cost.budget_scope, 'docs_only');
  // The audit trail still records the overspend (Non Goal: docs-only stories
  // keep their canonical audit), it simply no longer counts as implementation
  // evidence waste.
  assert.equal(cost.budget_status, 'exceeded');
  assert.equal(cost.docs_only_budget_status, 'exceeded');
  assert.equal(cost.implementation_budget_status, 'not_applicable');
  // The artifact/code ratio has no meaningful denominator without product code,
  // so it is measured but not judged.
  assert.equal(cost.budget_exceeded_reasons.includes('artifact_code_ratio_exceeded'), false);
  assert.deepEqual(cost.budget_exceeded_reasons, ['canonical_artifact_lines_exceeded']);
});

test('DOE-S-2 keeps implementation overspend on the implementation budget signal', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 2891,
    diffStats: IMPLEMENTATION_NUMSTAT
  });

  assert.equal(cost.budget.profile, 'normal');
  assert.equal(cost.budget_scope, 'implementation');
  assert.equal(cost.budget_status, 'exceeded');
  assert.equal(cost.implementation_budget_status, 'exceeded');
  assert.equal(cost.docs_only_budget_status, 'not_applicable');
});

test('DOE-S-2 falls back to the normal profile when a caller budget predates docs_only', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 400,
    diffStats: DOCS_ONLY_NUMSTAT,
    budget: {
      normal: { canonical_artifact_lines: 100, artifact_code_ratio: 3 },
      high: { canonical_artifact_lines: 300, artifact_code_ratio: 3 }
    }
  });

  // Thresholds come from `normal`, so the ratio rule applies again — the
  // fallback is conservative, never unbounded.
  assert.equal(cost.budget.canonical_artifact_lines, 100);
  assert.equal(cost.budget.artifact_code_ratio, 3);
  assert.equal(cost.budget_status, 'exceeded');
  assert.equal(cost.budget_exceeded_reasons.includes('artifact_code_ratio_exceeded'), true);
  // The scope separation still holds: this is a documentation change.
  assert.equal(cost.budget_scope, 'docs_only');
  assert.equal(cost.implementation_budget_status, 'not_applicable');
});

// --- DOE-S-3: zero product-code lines are never misrecorded ------------------

test('DOE-S-3 marks a docs-only zero as docs_only, not as a missing measurement', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 320,
    diffStats: DOCS_ONLY_NUMSTAT
  });

  assert.equal(cost.product_code_changed_lines, 0);
  assert.equal(cost.product_code_changed_lines_status, 'available');
  assert.equal(cost.product_code_changed_lines_reason, 'docs_only');
});

test('DOE-S-3 records an unavailable diff base instead of a zero-line change set', () => {
  const cost = buildCanonicalEvidenceCostSummary({
    artifactLineCount: 3606,
    diffStats: null,
    diffStatsProvenance: {
      status: 'unavailable',
      refs: { base_ref: 'origin/main', base_authority: 'unresolved' },
      reason: 'pre-merge diff base is unrecoverable: origin/main already contains 5de00643'
    }
  });

  assert.equal(cost.diff_stats_status, 'unavailable');
  assert.equal(cost.product_changed_lines, null);
  assert.equal(cost.product_code_changed_lines, null);
  assert.equal(cost.product_code_changed_lines_status, 'unavailable');
  assert.equal(cost.product_code_changed_lines_reason, 'diff_stats_unavailable');
  // An unmeasured change set must not be classified as docs-only.
  assert.equal(cost.change_surface.status, 'unknown');
  assert.equal(cost.budget_scope, 'implementation');
  assert.equal(cost.implementation_budget_status, 'exceeded');
});

// --- DOE-S-4: docs-only is an input to the existing planner contract ---------

test('DOE-S-4 records docs-only detection as a planner input without changing the depth contract', () => {
  const plan = buildEvidencePlan({
    story: { story_id: 'story-vibepro-docs-only-evidence-profile' },
    git: {
      base_ref: 'origin/main',
      head_ref: 'HEAD',
      head_sha: 'abc123',
      changed_files: [{ path: 'docs/management/stories/active/story-x.md' }],
      diff_line_stats: DOCS_ONLY_NUMSTAT
    },
    createdAt: '2026-07-25T00:00:00.000Z'
  });

  // The existing contract is untouched: same version, same summary-first
  // default, same artifact policy vocabulary.
  assert.equal(plan.schema_version, '0.1.0');
  assert.equal(plan.default_depth, 'summary');
  assert.equal(plan.evidence_depth, 'summary');
  assert.equal(plan.artifact_policy.write_html_reports, false);
  // docs-only is added as an attributable input.
  assert.equal(plan.docs_only_change.status, 'docs_only');
  assert.equal(plan.planner_inputs.docs_only_status, 'docs_only');
  assert.equal(plan.planner_inputs.docs_only_reason, 'no_product_code_paths_changed');
  assert.equal(plan.default_depth_reason, 'docs_only_change');
});

test('DOE-S-4 attributes the summary default to the pre-existing rule for product changes', () => {
  const plan = buildEvidencePlan({
    story: { story_id: 'story-vibepro-example' },
    git: { diff_line_stats: IMPLEMENTATION_NUMSTAT },
    createdAt: '2026-07-25T00:00:00.000Z'
  });

  assert.equal(plan.default_depth, 'summary');
  assert.equal(plan.default_depth_reason, 'summary_first_default');
  assert.equal(plan.planner_inputs.docs_only_status, 'product_change');
});

test('DOE-S-4 keeps risk escalation intact for a docs-only change', () => {
  const plan = buildEvidencePlan({
    story: { story_id: 'story-vibepro-docs-only-evidence-profile' },
    git: { diff_line_stats: DOCS_ONLY_NUMSTAT },
    prContext: {
      change_classification: { profile: 'security', risk_surfaces: ['auth'] }
    },
    createdAt: '2026-07-25T00:00:00.000Z'
  });

  assert.equal(plan.docs_only_change.status, 'docs_only');
  // Non Goal: docs-only must not weaken risk detection or gate requirements.
  assert.equal(plan.targeted_full_surfaces.length > 0, true);
  assert.equal(plan.risk_signals.some((signal) => signal.value === 'auth'), true);
});

test('DOE-S-4 accepts an externally resolved docs-only verdict as the planner input', () => {
  const plan = buildEvidencePlan({
    story: { story_id: 'story-vibepro-docs-only-evidence-profile' },
    git: { diff_line_stats: IMPLEMENTATION_NUMSTAT },
    docsOnlyChange: detectDocsOnlyChange({ diffStats: DOCS_ONLY_NUMSTAT }),
    createdAt: '2026-07-25T00:00:00.000Z'
  });

  assert.equal(plan.planner_inputs.docs_only_status, 'docs_only');
});
