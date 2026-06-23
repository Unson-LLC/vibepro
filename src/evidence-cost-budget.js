export const EVIDENCE_DEPTHS = new Set(['summary', 'standard', 'full']);

export const DEFAULT_EVIDENCE_COST_BUDGET = {
  normal: {
    canonical_artifact_lines: 500,
    artifact_code_ratio: 1
  },
  high: {
    canonical_artifact_lines: 1500,
    artifact_code_ratio: 3
  }
};

const HIGH_RISK_PROFILES = new Set([
  'workflow_heavy',
  'security',
  'production_path',
  'release',
  'network',
  'migration',
  'high'
]);

export function normalizeEvidenceDepth(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return EVIDENCE_DEPTHS.has(normalized) ? normalized : null;
}

export function parseNumstat(output = '') {
  const stats = {};
  for (const line of String(output).split('\n')) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!match || match[3].includes(' => ')) continue;
    stats[match[3]] = {
      additions: match[1] === '-' ? null : Number(match[1]),
      deletions: match[2] === '-' ? null : Number(match[2])
    };
  }
  return stats;
}

export function classifyChangedPath(filePath) {
  const normalized = String(filePath ?? '').replaceAll('\\', '/');
  if (normalized.startsWith('docs/management/audit-artifacts/')) return 'audit_artifacts';
  if (normalized.startsWith('src/')) return 'src';
  if (normalized.startsWith('test/') || normalized.startsWith('tests/') || /(^|\/)__tests__\//.test(normalized)) return 'test';
  if (
    normalized.startsWith('docs/management/stories/')
    || normalized.startsWith('docs/specs/')
    || normalized.startsWith('docs/architecture/')
  ) {
    return 'story_spec_architecture_docs';
  }
  return 'other';
}

export function summarizeDiffLineStats(diffStats = null) {
  const summary = {
    total_changed_lines: 0,
    unknown_file_count: 0,
    buckets: {
      src: emptyLineBucket(),
      test: emptyLineBucket(),
      story_spec_architecture_docs: emptyLineBucket(),
      audit_artifacts: emptyLineBucket(),
      other: emptyLineBucket()
    }
  };
  if (!diffStats || typeof diffStats !== 'object') return summary;

  for (const [filePath, stats] of Object.entries(diffStats)) {
    const bucketName = classifyChangedPath(filePath);
    const bucket = summary.buckets[bucketName] ?? summary.buckets.other;
    bucket.files += 1;
    bucket.paths.push(filePath);
    const changedLines = changedLineCount(stats);
    if (changedLines === null) {
      bucket.unknown_files += 1;
      summary.unknown_file_count += 1;
      continue;
    }
    bucket.changed_lines += changedLines;
    summary.total_changed_lines += changedLines;
  }

  for (const bucket of Object.values(summary.buckets)) {
    bucket.paths.sort();
  }
  return summary;
}

export function buildCanonicalEvidenceCostSummary({
  artifactLineCount = 0,
  diffStats = null,
  riskProfile = null,
  triggerSignals = [],
  requestedDepth = null,
  budget = DEFAULT_EVIDENCE_COST_BUDGET
} = {}) {
  const changed_lines = summarizeDiffLineStats(diffStats);
  const productChangedLines = (
    changed_lines.buckets.src.changed_lines
    + changed_lines.buckets.test.changed_lines
    + changed_lines.buckets.story_spec_architecture_docs.changed_lines
    + changed_lines.buckets.other.changed_lines
  );
  const highRisk = isHighRiskProfile(riskProfile) || triggerSignals.length > 0;
  const thresholds = highRisk ? budget.high : budget.normal;
  const ratio = productChangedLines > 0 ? artifactLineCount / productChangedLines : null;
  const lineBudgetExceeded = artifactLineCount > thresholds.canonical_artifact_lines;
  const ratioBudgetExceeded = ratio !== null && ratio > thresholds.artifact_code_ratio;
  const explicitDepth = normalizeEvidenceDepth(requestedDepth);
  const budgetExceeded = lineBudgetExceeded || ratioBudgetExceeded;
  const persistenceDepth = explicitDepth
    ?? (budgetExceeded ? 'standard' : (highRisk ? 'full' : 'standard'));

  return {
    schema_version: '0.1.0',
    evidence_depth: persistenceDepth,
    risk_profile: riskProfile ?? (highRisk ? 'high' : 'normal'),
    trigger_signals: [...new Set(triggerSignals.filter(Boolean))],
    artifact_lines: artifactLineCount,
    changed_lines,
    product_changed_lines: productChangedLines,
    artifact_code_ratio: ratio === null ? null : Number(ratio.toFixed(3)),
    budget: {
      profile: highRisk ? 'high' : 'normal',
      canonical_artifact_lines: thresholds.canonical_artifact_lines,
      artifact_code_ratio: thresholds.artifact_code_ratio
    },
    budget_status: budgetExceeded ? 'exceeded' : 'within_budget',
    budget_exceeded_reasons: [
      lineBudgetExceeded ? 'canonical_artifact_lines_exceeded' : null,
      ratioBudgetExceeded ? 'artifact_code_ratio_exceeded' : null
    ].filter(Boolean),
    token_accounting: {
      status: 'unavailable',
      total_tokens: null,
      reason: 'session token logs were not provided to canonical audit promotion'
    },
    elapsed_time_accounting: {
      status: 'unavailable',
      elapsed_ms: null,
      reason: 'elapsed-time logs were not provided to canonical audit promotion'
    }
  };
}

export function shouldUseCompactCanonicalEvidence(costSummary) {
  return costSummary?.budget_status === 'exceeded' && costSummary?.evidence_depth !== 'full';
}

function changedLineCount(stats) {
  const additions = stats?.additions;
  const deletions = stats?.deletions;
  if (!Number.isFinite(additions) || !Number.isFinite(deletions)) return null;
  return additions + deletions;
}

function emptyLineBucket() {
  return {
    files: 0,
    changed_lines: 0,
    unknown_files: 0,
    paths: []
  };
}

function isHighRiskProfile(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (HIGH_RISK_PROFILES.has(normalized)) return true;
  return /security|release|workflow|migration|network|production|high/.test(normalized);
}
