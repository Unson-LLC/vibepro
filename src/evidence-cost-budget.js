export const EVIDENCE_DEPTHS = new Set(['summary', 'standard', 'full']);

export const DEFAULT_EVIDENCE_COST_BUDGET = {
  normal: {
    canonical_artifact_lines: 500,
    artifact_code_ratio: 3
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
    status: diffStats && typeof diffStats === 'object' ? 'available' : 'unavailable',
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
  diffStatsProvenance = null,
  tokenAccounting = null,
  elapsedTimeAccounting = null,
  riskProfile = null,
  triggerSignals = [],
  requestedDepth = null,
  budget = DEFAULT_EVIDENCE_COST_BUDGET
} = {}) {
  const diffStatsStatus = normalizeDiffStatsProvenance(diffStats, diffStatsProvenance);
  const diffStatsAvailable = diffStatsStatus.status === 'available';
  const changed_lines = summarizeDiffLineStats(diffStatsAvailable ? diffStats : null);
  changed_lines.status = diffStatsStatus.status;
  changed_lines.source = diffStatsStatus.source;
  changed_lines.refs = diffStatsStatus.refs;
  changed_lines.collected_at = diffStatsStatus.collected_at;
  changed_lines.reason = diffStatsStatus.reason;
  const productChangedLines = diffStatsAvailable
    ? (
        changed_lines.buckets.src.changed_lines
        + changed_lines.buckets.test.changed_lines
        + changed_lines.buckets.story_spec_architecture_docs.changed_lines
        + changed_lines.buckets.other.changed_lines
      )
    : null;
  const highRisk = isHighRiskProfile(riskProfile) || triggerSignals.length > 0;
  const thresholds = highRisk ? budget.high : budget.normal;
  const ratio = Number.isFinite(productChangedLines) && productChangedLines > 0 ? artifactLineCount / productChangedLines : null;
  const effectiveCanonicalArtifactLines = resolveEffectiveCanonicalArtifactLineBudget(thresholds, productChangedLines);
  const lineBudgetExceeded = artifactLineCount > effectiveCanonicalArtifactLines;
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
    diff_stats_status: diffStatsStatus.status,
    diff_stats_source: diffStatsStatus.source,
    diff_stats_refs: diffStatsStatus.refs,
    diff_stats_collected_at: diffStatsStatus.collected_at,
    diff_stats_reason: diffStatsStatus.reason,
    artifact_lines: artifactLineCount,
    changed_lines,
    product_changed_lines: productChangedLines,
    product_changed_lines_status: diffStatsAvailable ? 'available' : 'unavailable',
    product_changed_lines_reason: diffStatsAvailable ? null : diffStatsStatus.reason,
    artifact_code_ratio: ratio === null ? null : Number(ratio.toFixed(3)),
    artifact_code_ratio_reason: ratio === null
      ? (diffStatsAvailable ? 'product_changed_lines_zero' : 'diff_stats_unavailable')
      : null,
    budget: {
      profile: highRisk ? 'high' : 'normal',
      canonical_artifact_lines: thresholds.canonical_artifact_lines,
      effective_canonical_artifact_lines: effectiveCanonicalArtifactLines,
      artifact_code_ratio: thresholds.artifact_code_ratio
    },
    budget_status: budgetExceeded ? 'exceeded' : 'within_budget',
    budget_exceeded_reasons: [
      lineBudgetExceeded ? 'canonical_artifact_lines_exceeded' : null,
      ratioBudgetExceeded ? 'artifact_code_ratio_exceeded' : null
    ].filter(Boolean),
    token_accounting: normalizeTokenAccounting(tokenAccounting),
    elapsed_time_accounting: normalizeElapsedTimeAccounting(elapsedTimeAccounting)
  };
}

export function shouldUseCompactCanonicalEvidence(costSummary) {
  return costSummary?.budget_status === 'exceeded' && costSummary?.evidence_depth !== 'full';
}

export function resolveEffectiveCanonicalArtifactLineBudget(thresholds = {}, productChangedLines = null) {
  const configuredLines = normalizePositiveNumber(thresholds?.canonical_artifact_lines);
  const ratioLimit = normalizePositiveNumber(thresholds?.artifact_code_ratio);
  if (Number.isFinite(productChangedLines) && productChangedLines > 0 && ratioLimit !== null) {
    return Math.max(configuredLines ?? 0, Math.ceil(productChangedLines * ratioLimit));
  }
  return configuredLines ?? Number.POSITIVE_INFINITY;
}

export function normalizeTokenAccounting(input = null) {
  const totalTokens = normalizeNullableNumber(input?.total_tokens ?? input?.totalTokens);
  const inputTokens = normalizeNullableNumber(input?.input_tokens ?? input?.inputTokens);
  const outputTokens = normalizeNullableNumber(input?.output_tokens ?? input?.outputTokens);
  const cachedInputTokens = normalizeNullableNumber(input?.cached_input_tokens ?? input?.cachedInputTokens);
  const inferredTotal = totalTokens ?? (
    inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null
  );
  const hasPartialTokens = [inputTokens, outputTokens, cachedInputTokens].some((value) => value !== null);
  const explicitStatus = normalizeAccountingStatus(input?.status);
  if (inferredTotal !== null || hasPartialTokens) {
    return {
      status: explicitStatus === 'unavailable' ? (inferredTotal === null ? 'partial' : 'available') : (explicitStatus ?? (inferredTotal === null ? 'partial' : 'available')),
      total_tokens: inferredTotal,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_input_tokens: cachedInputTokens,
      source: input?.source ?? null,
      window: input?.window ?? null,
      reason: inferredTotal === null ? (input?.reason ?? 'token total was not provided') : (input?.reason ?? null)
    };
  }

  return {
    status: explicitStatus ?? 'unavailable',
    total_tokens: null,
    input_tokens: null,
    output_tokens: null,
    cached_input_tokens: null,
    source: input?.source ?? null,
    window: input?.window ?? null,
    reason: input?.reason ?? 'session token logs were not provided to canonical audit promotion'
  };
}

export function normalizeElapsedTimeAccounting(input = null) {
  const explicitElapsedMs = normalizeNullableNumber(input?.elapsed_ms ?? input?.elapsedMs);
  const startedAt = normalizeIsoTimestamp(input?.started_at ?? input?.startedAt ?? input?.task_started_at ?? input?.taskStartedAt);
  const finishedAt = normalizeIsoTimestamp(input?.finished_at ?? input?.finishedAt ?? input?.final_answer_at ?? input?.finalAnswerAt);
  const inferredElapsedMs = explicitElapsedMs ?? inferElapsedMs(startedAt, finishedAt);
  const explicitStatus = normalizeAccountingStatus(input?.status);
  if (inferredElapsedMs !== null) {
    return {
      status: explicitStatus === 'unavailable' ? 'available' : (explicitStatus ?? 'available'),
      elapsed_ms: inferredElapsedMs,
      started_at: startedAt,
      finished_at: finishedAt,
      source: input?.source ?? null,
      window: input?.window ?? null,
      reason: input?.reason ?? null
    };
  }

  return {
    status: explicitStatus ?? 'unavailable',
    elapsed_ms: null,
    started_at: startedAt,
    finished_at: finishedAt,
    source: input?.source ?? null,
    window: input?.window ?? null,
    reason: input?.reason ?? 'elapsed-time logs were not provided to canonical audit promotion'
  };
}

function changedLineCount(stats) {
  const additions = stats?.additions;
  const deletions = stats?.deletions;
  if (!Number.isFinite(additions) || !Number.isFinite(deletions)) return null;
  return additions + deletions;
}

function normalizePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeDiffStatsProvenance(diffStats, provenance) {
  const hasStats = diffStats && typeof diffStats === 'object';
  const status = provenance?.status
    ?? (hasStats ? 'available' : 'unavailable');
  return {
    status: status === 'available' && hasStats ? 'available' : 'unavailable',
    source: provenance?.source ?? null,
    refs: provenance?.refs ?? null,
    collected_at: provenance?.collected_at ?? null,
    reason: status === 'available' && hasStats
      ? null
      : (provenance?.reason ?? 'diff statistics were not provided to canonical audit promotion')
  };
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

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeAccountingStatus(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized || null;
}

function normalizeIsoTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inferElapsedMs(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return null;
  const elapsedMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : null;
}
