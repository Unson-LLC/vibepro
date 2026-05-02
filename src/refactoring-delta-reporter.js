const SCHEMA_VERSION = '0.1.0';

export function buildRefactoringDelta({ beforeEvidence = null, afterEvidence = null, beforeRun = null } = {}) {
  const afterRunId = afterEvidence?.run_id ?? null;
  const beforeRunId = beforeEvidence?.run_id ?? beforeRun?.run_id ?? null;
  if (!beforeEvidence) {
    return {
      schema_version: SCHEMA_VERSION,
      status: 'no_baseline',
      before_run_id: beforeRunId,
      after_run_id: afterRunId,
      summary: emptySummary(),
      items: [],
      top_improvements: [],
      top_regressions: []
    };
  }

  const beforeItems = indexOpportunities(beforeEvidence.refactoring_opportunities);
  const afterItems = indexOpportunities(afterEvidence?.refactoring_opportunities);
  if (beforeItems.size === 0 && afterItems.size === 0) {
    return {
      schema_version: SCHEMA_VERSION,
      status: 'no_refactoring_opportunities',
      before_run_id: beforeRunId,
      after_run_id: afterRunId,
      summary: emptySummary(),
      items: [],
      top_improvements: [],
      top_regressions: []
    };
  }

  const keys = [...new Set([...beforeItems.keys(), ...afterItems.keys()])].sort();
  const items = keys.map((key) => buildDeltaItem(key, beforeItems.get(key), afterItems.get(key)));
  const summary = summarizeItems(items, beforeItems.size, afterItems.size);
  return {
    schema_version: SCHEMA_VERSION,
    status: 'available',
    before_run_id: beforeRunId,
    after_run_id: afterRunId,
    summary,
    items,
    top_improvements: items
      .filter((item) => ['improved', 'removed'].includes(item.status))
      .sort(compareImprovements)
      .slice(0, 10),
    top_regressions: items
      .filter((item) => ['regressed', 'new'].includes(item.status))
      .sort(compareRegressions)
      .slice(0, 10)
  };
}

export function renderRefactoringDelta(delta, { limit = 10 } = {}) {
  if (!delta || delta.status === 'no_baseline') {
    return `# VibePro リファクタリング差分

- status: no_baseline
- before: -
- after: ${delta?.after_run_id ?? '-'}

前回の同一Story診断runがないため、差分はまだ算出していません。
`;
  }
  if (delta.status === 'no_refactoring_opportunities') {
    return `# VibePro リファクタリング差分

- status: no_refactoring_opportunities
- before: ${delta.before_run_id ?? '-'}
- after: ${delta.after_run_id ?? '-'}

比較対象の両runにリファクタリング機会はありません。
`;
  }

  const improvements = delta.top_improvements?.slice(0, limit) ?? [];
  const regressions = delta.top_regressions?.slice(0, limit) ?? [];
  return `# VibePro リファクタリング差分

| 項目 | 内容 |
|------|------|
| Status | ${delta.status} |
| Before run | ${delta.before_run_id ?? '-'} |
| After run | ${delta.after_run_id ?? '-'} |
| Before機会 | ${delta.summary?.total_before ?? 0}件 |
| After機会 | ${delta.summary?.total_after ?? 0}件 |
| 改善 | ${delta.summary?.improved ?? 0}件 |
| 解消 | ${delta.summary?.removed ?? 0}件 |
| 悪化 | ${delta.summary?.regressed ?? 0}件 |
| 新規 | ${delta.summary?.new ?? 0}件 |

## 改善・解消

${renderDeltaTable(improvements)}

## 悪化・新規

${renderDeltaTable(regressions)}
`;
}

export function renderRefactoringDeltaCompact(delta, { limit = 5 } = {}) {
  if (!delta || delta.status === 'no_baseline') {
    return '- 前回の同一Story診断runがないため、差分は未算出';
  }
  if (delta.status === 'no_refactoring_opportunities') {
    return '- 比較対象の両runにリファクタリング機会なし';
  }
  const lines = [
    `- before: ${delta.before_run_id ?? '-'} / after: ${delta.after_run_id ?? '-'}`,
    `- 改善: ${delta.summary?.improved ?? 0}件 / 解消: ${delta.summary?.removed ?? 0}件 / 悪化: ${delta.summary?.regressed ?? 0}件 / 新規: ${delta.summary?.new ?? 0}件`
  ];
  const improvements = delta.top_improvements?.slice(0, limit) ?? [];
  if (improvements.length === 0) {
    lines.push('- 主な改善: なし');
  } else {
    for (const item of improvements) {
      lines.push(`- ${formatDeltaItemLabel(item)}: ${formatCounts(item.before)} -> ${formatCounts(item.after)} (${formatStatus(item.status)})`);
    }
  }
  return lines.join('\n');
}

export function formatCounts(counts) {
  return `${counts?.target_file_count ?? 0}ファイル / ${counts?.occurrence_count ?? 0}出現`;
}

function indexOpportunities(opportunities) {
  const indexed = new Map();
  for (const opportunity of Array.isArray(opportunities) ? opportunities : []) {
    const key = buildOpportunityKey(opportunity);
    const existing = indexed.get(key);
    if (!existing) {
      indexed.set(key, normalizeOpportunity(opportunity, key));
      continue;
    }
    indexed.set(key, mergeOpportunity(existing, opportunity));
  }
  return indexed;
}

function buildOpportunityKey(opportunity) {
  const source = opportunity?.source ?? 'unknown';
  const refs = opportunity?.evidence_refs ?? {};
  if (source === 'duplicate_query_shape' && refs.signature) return `${source}:${refs.signature}`;
  if (source === 'responsibility_hotspot' && refs.file) return `${source}:${normalizePath(refs.file)}`;
  const title = opportunity?.title ?? 'untitled';
  const files = uniqueStrings(opportunity?.target_files ?? []).join(',');
  return `${source}:${title}:${files}`;
}

function normalizeOpportunity(opportunity, key) {
  const targetFiles = uniqueStrings(opportunity?.target_files ?? []);
  const refs = opportunity?.evidence_refs ?? {};
  const occurrenceCount = Number.isFinite(refs.occurrence_count)
    ? refs.occurrence_count
    : Number.isFinite(refs.file_count)
      ? refs.file_count
      : targetFiles.length;
  return {
    key,
    source: opportunity?.source ?? null,
    title: opportunity?.title ?? key,
    refactoring_intent: opportunity?.refactoring_intent ?? null,
    finding_id: opportunity?.finding_id ?? null,
    evidence_refs: refs,
    counts: {
      target_file_count: Number.isFinite(opportunity?.target_count) ? opportunity.target_count : targetFiles.length,
      occurrence_count: occurrenceCount,
      rank: opportunity?.rank ?? null,
      score_total: opportunity?.score?.total ?? null
    },
    target_files: targetFiles
  };
}

function mergeOpportunity(existing, opportunity) {
  const next = normalizeOpportunity(opportunity, existing.key);
  const targetFiles = uniqueStrings([...existing.target_files, ...next.target_files]);
  return {
    ...existing,
    title: existing.title ?? next.title,
    counts: {
      target_file_count: targetFiles.length,
      occurrence_count: existing.counts.occurrence_count + next.counts.occurrence_count,
      rank: existing.counts.rank ?? next.counts.rank,
      score_total: (existing.counts.score_total ?? 0) + (next.counts.score_total ?? 0)
    },
    target_files: targetFiles
  };
}

function buildDeltaItem(key, before, after) {
  const beforeCounts = before?.counts ?? zeroCounts();
  const afterCounts = after?.counts ?? zeroCounts();
  const targetFilesBefore = before?.target_files ?? [];
  const targetFilesAfter = after?.target_files ?? [];
  const targetFilesRemoved = targetFilesBefore.filter((file) => !targetFilesAfter.includes(file));
  const targetFilesAdded = targetFilesAfter.filter((file) => !targetFilesBefore.includes(file));
  const occurrenceDelta = afterCounts.occurrence_count - beforeCounts.occurrence_count;
  const targetFileDelta = afterCounts.target_file_count - beforeCounts.target_file_count;
  return {
    key,
    source: after?.source ?? before?.source ?? null,
    title: after?.title ?? before?.title ?? key,
    refactoring_intent: after?.refactoring_intent ?? before?.refactoring_intent ?? null,
    finding_id: after?.finding_id ?? before?.finding_id ?? null,
    before: beforeCounts,
    after: afterCounts,
    occurrence_delta: occurrenceDelta,
    target_file_delta: targetFileDelta,
    target_files_removed: targetFilesRemoved,
    target_files_added: targetFilesAdded,
    status: classifyStatus({ before, after, occurrenceDelta, targetFileDelta })
  };
}

function classifyStatus({ before, after, occurrenceDelta, targetFileDelta }) {
  if (before && !after) return 'removed';
  if (!before && after) return 'new';
  if (occurrenceDelta < 0 || targetFileDelta < 0) return 'improved';
  if (occurrenceDelta > 0 || targetFileDelta > 0) return 'regressed';
  return 'unchanged';
}

function summarizeItems(items, totalBefore, totalAfter) {
  return {
    total_before: totalBefore,
    total_after: totalAfter,
    improved: items.filter((item) => item.status === 'improved').length,
    removed: items.filter((item) => item.status === 'removed').length,
    regressed: items.filter((item) => item.status === 'regressed').length,
    new: items.filter((item) => item.status === 'new').length,
    unchanged: items.filter((item) => item.status === 'unchanged').length
  };
}

function emptySummary() {
  return {
    total_before: 0,
    total_after: 0,
    improved: 0,
    removed: 0,
    regressed: 0,
    new: 0,
    unchanged: 0
  };
}

function renderDeltaTable(items) {
  if (!Array.isArray(items) || items.length === 0) return '- なし';
  const rows = items.map((item) => (
    `| ${escapeTable(formatDeltaItemLabel(item))} | ${item.refactoring_intent ?? '-'} | ${formatCounts(item.before)} | ${formatCounts(item.after)} | ${item.target_files_removed.join('<br>') || '-'} | ${formatStatus(item.status)} |`
  ));
  return `| 対象 | Intent | Before | After | 減ったファイル | Status |
|------|--------|--------|-------|--------------|--------|
${rows.join('\n')}`;
}

function formatDeltaItemLabel(item) {
  const keyTail = item.key.includes(':') ? item.key.slice(item.key.indexOf(':') + 1) : item.key;
  return item.title && item.title !== item.key ? item.title : keyTail;
}

function formatStatus(status) {
  return {
    improved: '改善',
    removed: '解消',
    regressed: '悪化',
    new: '新規',
    unchanged: '変化なし'
  }[status] ?? status;
}

function compareImprovements(a, b) {
  return improvementMagnitude(b) - improvementMagnitude(a)
    || a.key.localeCompare(b.key);
}

function compareRegressions(a, b) {
  return regressionMagnitude(b) - regressionMagnitude(a)
    || a.key.localeCompare(b.key);
}

function improvementMagnitude(item) {
  return Math.max(0, -item.occurrence_delta) + Math.max(0, -item.target_file_delta);
}

function regressionMagnitude(item) {
  return Math.max(0, item.occurrence_delta) + Math.max(0, item.target_file_delta);
}

function zeroCounts() {
  return {
    target_file_count: 0,
    occurrence_count: 0,
    rank: null,
    score_total: null
  };
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => normalizePath(value)).filter(Boolean))].sort();
}

function normalizePath(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function escapeTable(value) {
  return String(value).replace(/\|/g, '\\|');
}
