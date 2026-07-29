import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, initWorkspace, normalizeActiveStories, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';
import { resolvePrArtifactFile } from './artifact-routing.js';

const SCHEMA_VERSION = '0.1.0';
const COMPLETED_STATUS = 'completed';
const INCOMPLETE_STATUSES = new Set([
  'blocked',
  'needs_review',
  'timeout',
  'auth_required',
  'resource_unavailable',
  'unknown'
]);
const EVIDENCE_SOURCE_TYPES = new Set([
  'server_log',
  'browser_e2e',
  'api_log',
  'client_marker',
  'manual_observation'
]);
const USER_PERCEIVED_SOURCES = new Set(['browser_e2e', 'client_marker', 'manual_observation']);

export async function definePerformanceMetric(repoRoot, options = {}) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const storyId = requiredOption(options.storyId, '--id <story-id>');
  const metricId = requiredOption(options.metricId, '--metric-id <id>');
  const configPath = path.join(getWorkspaceDir(root), 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const rawStories = Array.isArray(config.brainbase?.stories) ? config.brainbase.stories : [];
  const stories = rawStories.length > 0 ? rawStories : normalizeActiveStories(config.brainbase?.stories);
  const story = stories.find((item) => item.story_id === storyId && item.status !== 'archived');
  if (!story) throw new Error(`Story not found: ${storyId}`);

  const metric = normalizeMetricDefinition({
    metricId,
    userStory: options.userStory ?? story.title ?? storyId,
    startCondition: requiredOption(options.startCondition, '--start-condition <text>'),
    completionCondition: requiredOption(options.completionCondition, '--completion-condition <text>'),
    intermediateMarkers: normalizeList(options.intermediateMarkers),
    timeoutMs: normalizeTimeout(options.timeoutMs),
    failureClassifications: normalizeFailureClassifications(options.failureClassifications),
    evidenceSources: normalizeEvidenceSourceDefinitions(options.evidenceSources),
    comparisonPolicy: normalizeComparisonPolicy(options.comparisonPolicy),
    readinessKind: options.readinessKind
  });

  const nextStories = stories.map((item) => {
    if (item.story_id !== storyId) return item;
    const existing = Array.isArray(item.performanceMetrics) ? item.performanceMetrics : [];
    return {
      ...item,
      performanceMetrics: [
        metric,
        ...existing.filter((candidate) => candidate.metricId !== metric.metricId)
      ]
    };
  });
  config.brainbase = {
    ...(config.brainbase ?? {}),
    stories: nextStories,
    current_story_id: config.brainbase?.current_story_id ?? storyId
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  return {
    story_id: storyId,
    metric,
    artifacts: {
      config: toWorkspaceRelative(root, configPath)
    }
  };
}

export async function recordPerformanceRun(repoRoot, options = {}) {
  await initWorkspace(repoRoot);
  const root = path.resolve(repoRoot);
  const storyId = requiredOption(options.storyId, '--id <story-id>');
  const metricId = requiredOption(options.metricId, '--metric-id <id>');
  const metric = await readPerformanceMetric(root, storyId, metricId);
  const runId = options.runId ?? createRunId();
  const runDir = await getPerformanceRunDir(root, storyId);
  await mkdir(runDir, { recursive: true });

  const status = normalizeStatus(options.status ?? COMPLETED_STATUS);
  const durationMs = normalizeDuration(options.durationMs, {
    startedAt: options.startedAt,
    completedAt: options.completedAt,
    status
  });
  const completionCondition = options.completionCondition ?? metric.completionCondition.description;
  const markers = normalizeObservedMarkers(options.markers);
  const evidenceSources = normalizeEvidenceSources(options.evidenceSources);
  const run = {
    schema_version: SCHEMA_VERSION,
    story_id: storyId,
    metric_id: metricId,
    run_id: runId,
    label: options.label ?? metric.comparisonPolicy.afterLabel,
    recorded_at: new Date().toISOString(),
    status,
    status_classification: status === COMPLETED_STATUS ? null : status,
    user_story: metric.userStory,
    metric_definition: metric,
    measurement_definition: {
      start_condition: metric.startCondition,
      completion_condition: {
        ...metric.completionCondition,
        description: completionCondition,
        matches_metric_definition: completionCondition === metric.completionCondition.description
      },
      intermediate_markers: metric.intermediateMarkers,
      timeout_ms: metric.timeoutMs
    },
    observation: {
      started_at: options.startedAt ?? null,
      completed_at: options.completedAt ?? null,
      duration_ms: durationMs,
      intermediate_markers: markers,
      evidence_sources: evidenceSources,
      notes: options.notes ?? null
    },
    comparison_key: {
      metric_id: metricId,
      completion_condition: completionCondition
    },
    quality: evaluateRunQuality(metric, { status, durationMs, completionCondition, markers, evidenceSources })
  };

  const jsonPath = path.join(runDir, `${safeFileName(runId)}.json`);
  await writeFile(jsonPath, `${JSON.stringify(run, null, 2)}\n`);
  const summary = await summarizeStoryPerformanceEvidence(root, storyId);
  await updatePerformanceManifest(root, storyId, run, jsonPath, summary);
  return {
    run,
    summary,
    artifacts: {
      json: toWorkspaceRelative(root, jsonPath)
    }
  };
}

export async function compareStoryPerformance(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requiredOption(options.storyId, '--id <story-id>');
  const summary = await summarizeStoryPerformanceEvidence(root, storyId, {
    metricId: options.metricId,
    beforeLabel: options.beforeLabel,
    afterLabel: options.afterLabel
  });
  return {
    comparison: summary,
    markdown: renderPerformanceEvidenceSummary(summary)
  };
}

export async function summarizeStoryPerformanceEvidence(repoRoot, storyId, options = {}) {
  const root = path.resolve(repoRoot);
  const definitions = await readPerformanceMetrics(root, storyId);
  const allRuns = await readPerformanceRuns(root, storyId);
  const targetDefinitions = options.metricId
    ? definitions.metrics.filter((metric) => metric.metricId === options.metricId)
    : definitions.metrics;
  const metrics = targetDefinitions.map((metric) => summarizeMetric(metric, allRuns.runs, {
    beforeLabel: options.beforeLabel,
    afterLabel: options.afterLabel
  }));
  const orphanMetricIds = [...new Set(allRuns.runs
    .map((run) => run.metric_id)
    .filter((metricId) => metricId && !definitions.metrics.some((metric) => metric.metricId === metricId)))];
  return {
    schema_version: SCHEMA_VERSION,
    story_id: storyId,
    generated_at: new Date().toISOString(),
    metric_count: metrics.length,
    run_count: allRuns.runs.length,
    comparable_count: metrics.filter((metric) => metric.comparison.status === 'comparable').length,
    not_comparable_count: metrics.filter((metric) => metric.comparison.status !== 'comparable').length,
    metrics,
    orphan_metric_ids: orphanMetricIds,
    load_errors: [
      ...definitions.errors,
      ...allRuns.errors
    ]
  };
}

export function renderPerformanceDefineSummary(result) {
  return [
    '# VibePro Performance Metric',
    '',
    `Story: ${result.story_id}`,
    `Metric: ${result.metric.metricId}`,
    `Readiness: ${result.metric.readinessKind}`,
    `Start: ${result.metric.startCondition.description}`,
    `Complete: ${result.metric.completionCondition.description}`,
    `Completion kind: ${result.metric.completionCondition.kind}`,
    `Evidence sources: ${result.metric.evidenceSources.map((source) => source.type).join(', ') || '-'}`,
    ''
  ].join('\n');
}

export function renderPerformanceRecordSummary(result) {
  const run = result.run;
  return [
    '# VibePro Performance Run',
    '',
    `Story: ${run.story_id}`,
    `Metric: ${run.metric_id}`,
    `Run: ${run.run_id}`,
    `Label: ${run.label}`,
    `Status: ${run.status}`,
    `Duration: ${formatMs(run.observation.duration_ms)}`,
    `Artifact: ${result.artifacts.json}`,
    '',
    '## Quality',
    ...(run.quality.issues.length === 0
      ? ['- No schema-level issues.']
      : run.quality.issues.map((issue) => `- ${issue}`)),
    ''
  ].join('\n');
}

export function renderPerformanceEvidenceSummary(summary) {
  const lines = [
    '# VibePro Performance Evidence',
    '',
    `Story: ${summary.story_id}`,
    `Metrics: ${summary.metric_count}`,
    `Runs: ${summary.run_count}`,
    `Comparable: ${summary.comparable_count}`,
    `Not comparable: ${summary.not_comparable_count}`,
    ''
  ];
  for (const metric of summary.metrics) {
    lines.push(`## ${metric.metric_id}`);
    lines.push(`- user story: ${metric.user_story}`);
    lines.push(`- readiness: ${metric.readiness_kind}`);
    lines.push(`- start: ${metric.start_condition.description}`);
    lines.push(`- complete: ${metric.completion_condition.description}`);
    lines.push(`- completion kind: ${metric.completion_condition.kind}`);
    lines.push(`- comparison: ${metric.comparison.status}`);
    if (metric.comparison.status !== 'comparable') {
      lines.push(`- improvement: unknown`);
      for (const reason of metric.comparison.not_comparable_reasons) {
        lines.push(`- not comparable: ${reason}`);
      }
    } else {
      lines.push(`- p50: ${formatMs(metric.comparison.delta.p50_ms)} (${formatPercent(metric.comparison.delta.p50_change_ratio)})`);
      lines.push(`- p90: ${formatMs(metric.comparison.delta.p90_ms)} (${formatPercent(metric.comparison.delta.p90_change_ratio)})`);
      lines.push(`- max: ${formatMs(metric.comparison.delta.max_ms)} (${formatPercent(metric.comparison.delta.max_change_ratio)})`);
    }
    lines.push(`- before samples: ${metric.before.sample_count}, incomplete: ${metric.before.incomplete_count} (${formatPercent(metric.before.incomplete_rate)})`);
    lines.push(`- after samples: ${metric.after.sample_count}, incomplete: ${metric.after.incomplete_count} (${formatPercent(metric.after.incomplete_rate)})`);
    for (const missing of metric.missing_evidence) {
      lines.push(`- missing ${missing.label}: ${missing.items.join(', ')}`);
    }
    lines.push('');
  }
  if (summary.metrics.length === 0) {
    lines.push('- No performanceMetrics are defined for this story.', '');
  }
  if (summary.load_errors.length > 0) {
    lines.push('## Load Errors');
    for (const error of summary.load_errors) lines.push(`- ${error.file}: ${error.error}`);
    lines.push('');
  }
  return `${lines.join('\n')}`;
}

export function renderPerformancePrSection(summary) {
  if (!summary || summary.metric_count === 0) {
    return `## Performance Evidence
- status: not_configured
- reason: このStoryには performanceMetrics が定義されていません`;
  }
  const rows = summary.metrics.map((metric) => {
    if (metric.comparison.status !== 'comparable') {
      return `| ${metric.metric_id} | ${metric.readiness_kind} | ${metric.completion_condition.kind} | 改善率不明 | ${metric.comparison.not_comparable_reasons.join('; ') || '-'} |`;
    }
    return `| ${metric.metric_id} | ${metric.readiness_kind} | ${metric.completion_condition.kind} | p50 ${formatMs(metric.comparison.delta.p50_ms)}, p90 ${formatMs(metric.comparison.delta.p90_ms)}, max ${formatMs(metric.comparison.delta.max_ms)} | before ${metric.before.sample_count} / after ${metric.after.sample_count} |`;
  });
  const missing = summary.metrics.flatMap((metric) => metric.missing_evidence
    .map((item) => `- ${metric.metric_id}: missing ${item.label}: ${item.items.join(', ')}`));
  return `## Performance Evidence
| Metric | Readiness | Complete kind | Comparison | Evidence |
| ------ | --------- | ------------- | ---------- | -------- |
${rows.join('\n') || '| - | - | - | - | - |'}

${missing.length > 0 ? missing.join('\n') : '- missing evidence: none'}`;
}

async function readPerformanceMetric(repoRoot, storyId, metricId) {
  const definitions = await readPerformanceMetrics(repoRoot, storyId);
  const metric = definitions.metrics.find((item) => item.metricId === metricId);
  if (!metric) throw new Error(`Performance metric not found for ${storyId}: ${metricId}`);
  return metric;
}

async function readPerformanceMetrics(repoRoot, storyId) {
  const configPath = path.join(getWorkspaceDir(repoRoot), 'config.json');
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const rawStories = Array.isArray(config.brainbase?.stories) ? config.brainbase.stories : [];
    const stories = rawStories.length > 0 ? rawStories : normalizeActiveStories(config.brainbase?.stories);
    const story = stories.find((item) => item.story_id === storyId && item.status !== 'archived');
    const metrics = (story?.performanceMetrics ?? []).map((metric) => normalizeMetricDefinition(metric));
    return { metrics, errors: [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { metrics: [], errors: [] };
    return { metrics: [], errors: [{ file: toWorkspaceRelative(repoRoot, configPath), error: error.message }] };
  }
}

async function readPerformanceRuns(repoRoot, storyId) {
  const runDir = await getPerformanceRunDir(repoRoot, storyId);
  let files;
  try {
    files = (await readdir(runDir)).filter((file) => file.endsWith('.json')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return { runs: [], errors: [] };
    throw error;
  }
  const runs = [];
  const errors = [];
  for (const file of files) {
    const filePath = path.join(runDir, file);
    try {
      const run = JSON.parse(await readFile(filePath, 'utf8'));
      runs.push({ ...run, artifact: toWorkspaceRelative(repoRoot, filePath) });
    } catch (error) {
      errors.push({ file: toWorkspaceRelative(repoRoot, filePath), error: error.message });
    }
  }
  return { runs, errors };
}

function summarizeMetric(metric, allRuns, options = {}) {
  const beforeLabel = options.beforeLabel ?? metric.comparisonPolicy.beforeLabel;
  const afterLabel = options.afterLabel ?? metric.comparisonPolicy.afterLabel;
  const metricRuns = allRuns.filter((run) => run.metric_id === metric.metricId);
  const beforeRuns = metricRuns.filter((run) => run.label === beforeLabel);
  const afterRuns = metricRuns.filter((run) => run.label === afterLabel);
  const before = summarizeRunGroup(metric, beforeRuns);
  const after = summarizeRunGroup(metric, afterRuns);
  const comparison = compareRunGroups(metric, before, after, { beforeLabel, afterLabel, beforeRuns, afterRuns });
  return {
    metric_id: metric.metricId,
    user_story: metric.userStory,
    readiness_kind: metric.readinessKind,
    start_condition: metric.startCondition,
    completion_condition: metric.completionCondition,
    intermediate_markers: metric.intermediateMarkers,
    timeout_ms: metric.timeoutMs,
    evidence_sources: metric.evidenceSources,
    comparison_policy: {
      ...metric.comparisonPolicy,
      beforeLabel,
      afterLabel
    },
    before,
    after,
    comparison,
    missing_evidence: collectMissingEvidence(metric, { beforeRuns, afterRuns })
  };
}

function summarizeRunGroup(metric, runs) {
  const completionCondition = metric.completionCondition.description;
  const completed = runs.filter((run) => isCompletedComparableRun(run, completionCondition));
  const durations = completed.map((run) => run.observation?.duration_ms).filter((value) => Number.isFinite(value));
  const incompleteRuns = runs.filter((run) => run.status !== COMPLETED_STATUS);
  return {
    label: runs[0]?.label ?? null,
    run_count: runs.length,
    sample_count: durations.length,
    incomplete_count: incompleteRuns.length,
    incomplete_rate: runs.length > 0 ? roundRatio(incompleteRuns.length / runs.length) : null,
    p50_ms: percentile(durations, 0.5),
    p90_ms: percentile(durations, 0.9),
    max_ms: durations.length > 0 ? Math.max(...durations) : null,
    status_classifications: countBy(incompleteRuns.map((run) => run.status_classification ?? run.status ?? 'unknown')),
    artifacts: runs.map((run) => run.artifact).filter(Boolean)
  };
}

function compareRunGroups(metric, before, after, context) {
  const reasons = [];
  if (before.run_count === 0) reasons.push(`missing baseline label "${context.beforeLabel}"`);
  if (after.run_count === 0) reasons.push(`missing after label "${context.afterLabel}"`);
  if (before.sample_count === 0 && before.run_count > 0) reasons.push('baseline has no completed duration samples');
  if (after.sample_count === 0 && after.run_count > 0) reasons.push('after has no completed duration samples');
  const mismatches = [...context.beforeRuns, ...context.afterRuns]
    .filter((run) => run.comparison_key?.completion_condition !== metric.completionCondition.description);
  if (mismatches.length > 0) reasons.push('completionCondition mismatch exists in recorded runs');
  if (metric.readinessKind === 'user_perceived') {
    if (!hasUserPerceivedEvidence(context.beforeRuns)) reasons.push('baseline user-perceived evidence is missing; server logs alone cannot prove user experience');
    if (!hasUserPerceivedEvidence(context.afterRuns)) reasons.push('after user-perceived evidence is missing; server logs alone cannot prove user experience');
  }
  const status = reasons.length === 0 ? 'comparable' : 'not_comparable';
  return {
    status,
    not_comparable_reasons: reasons,
    delta: status === 'comparable' ? {
      p50_ms: nullableDelta(after.p50_ms, before.p50_ms),
      p90_ms: nullableDelta(after.p90_ms, before.p90_ms),
      max_ms: nullableDelta(after.max_ms, before.max_ms),
      p50_change_ratio: nullableRatioDelta(after.p50_ms, before.p50_ms),
      p90_change_ratio: nullableRatioDelta(after.p90_ms, before.p90_ms),
      max_change_ratio: nullableRatioDelta(after.max_ms, before.max_ms)
    } : {
      p50_ms: null,
      p90_ms: null,
      max_ms: null,
      p50_change_ratio: null,
      p90_change_ratio: null,
      max_change_ratio: null
    }
  };
}

function collectMissingEvidence(metric, { beforeRuns, afterRuns }) {
  return [
    missingForLabel(metric, 'before', beforeRuns),
    missingForLabel(metric, 'after', afterRuns)
  ].filter((item) => item.items.length > 0);
}

function missingForLabel(metric, label, runs) {
  const completedRuns = runs.filter((run) => run.status === COMPLETED_STATUS);
  const markerIds = new Set(completedRuns.flatMap((run) => (run.observation?.intermediate_markers ?? []).map((marker) => marker.markerId)));
  const sourceTypes = new Set(completedRuns.flatMap((run) => (run.observation?.evidence_sources ?? []).map((source) => source.type)));
  const missingMarkers = metric.intermediateMarkers
    .map((marker) => marker.markerId)
    .filter((markerId) => !markerIds.has(markerId));
  const missingSources = metric.evidenceSources
    .map((source) => source.type)
    .filter((type) => !sourceTypes.has(type));
  return {
    label,
    items: [
      ...missingMarkers.map((markerId) => `marker:${markerId}`),
      ...missingSources.map((type) => `source:${type}`)
    ]
  };
}

function evaluateRunQuality(metric, { status, durationMs, completionCondition, markers, evidenceSources }) {
  const issues = [];
  if (status === COMPLETED_STATUS && !Number.isFinite(durationMs)) {
    issues.push('completed run requires duration_ms or started_at/completed_at');
  }
  if (completionCondition !== metric.completionCondition.description) {
    issues.push('completionCondition differs from metric definition; this run will not be used for before/after comparison');
  }
  const markerIds = new Set(markers.map((marker) => marker.markerId));
  for (const marker of metric.intermediateMarkers) {
    if (!markerIds.has(marker.markerId)) issues.push(`missing intermediate marker: ${marker.markerId}`);
  }
  const sourceTypes = new Set(evidenceSources.map((source) => source.type));
  for (const source of metric.evidenceSources) {
    if (!sourceTypes.has(source.type)) issues.push(`missing evidence source: ${source.type}`);
  }
  if (metric.readinessKind === 'user_perceived' && !evidenceSources.some((source) => USER_PERCEIVED_SOURCES.has(source.type))) {
    issues.push('user_perceived metric requires browser_e2e, client_marker, or manual_observation evidence');
  }
  return {
    status: issues.length === 0 ? 'ok' : 'needs_review',
    issues
  };
}

function normalizeMetricDefinition(raw) {
  const startDescription = typeof raw.startCondition === 'string'
    ? raw.startCondition
    : raw.startCondition?.description;
  const completionDescription = typeof raw.completionCondition === 'string'
    ? raw.completionCondition
    : raw.completionCondition?.description;
  const readinessKind = normalizeReadinessKind(raw.readinessKind ?? raw.readiness_kind ?? inferReadinessKind(raw.metricId, raw.evidenceSources));
  return {
    schema_version: SCHEMA_VERSION,
    metricId: requiredOption(raw.metricId ?? raw.metric_id, 'metricId'),
    userStory: requiredOption(raw.userStory ?? raw.user_story, 'userStory'),
    readinessKind,
    startCondition: {
      description: requiredOption(startDescription, 'startCondition'),
      kind: classifyStartCondition(startDescription)
    },
    completionCondition: {
      description: requiredOption(completionDescription, 'completionCondition'),
      kind: raw.completionCondition?.kind ?? classifyCompletionCondition(completionDescription)
    },
    intermediateMarkers: normalizeMarkers(raw.intermediateMarkers ?? raw.intermediate_markers),
    timeoutMs: normalizeTimeout(raw.timeoutMs ?? raw.timeout_ms),
    failureClassifications: normalizeFailureClassifications(raw.failureClassifications ?? raw.failure_classifications),
    evidenceSources: normalizeEvidenceSourceDefinitions(raw.evidenceSources ?? raw.evidence_sources),
    comparisonPolicy: normalizeComparisonPolicy(raw.comparisonPolicy ?? raw.comparison_policy)
  };
}

function normalizeMarkers(markers) {
  return normalizeList(markers).map((marker) => {
    if (typeof marker === 'object' && marker) {
      return {
        markerId: requiredOption(marker.markerId ?? marker.marker_id ?? marker.id, 'markerId'),
        description: marker.description ?? marker.markerId ?? marker.id
      };
    }
    const markerId = String(marker).trim();
    return { markerId, description: markerId };
  }).filter((marker) => marker.markerId);
}

function normalizeObservedMarkers(markers) {
  return normalizeList(markers).map((marker) => {
    if (typeof marker === 'object' && marker) return marker;
    const text = String(marker);
    const separator = text.lastIndexOf('=');
    const rawId = separator === -1 ? text : text.slice(0, separator);
    const rawValue = separator === -1 ? '' : text.slice(separator + 1);
    const elapsedMs = rawValue === '' ? null : Number(rawValue);
    return {
      markerId: rawId.trim(),
      elapsed_ms: Number.isFinite(elapsedMs) ? elapsedMs : null
    };
  }).filter((marker) => marker.markerId);
}

function normalizeEvidenceSourceDefinitions(sources) {
  return normalizeList(sources).map((source) => {
    if (typeof source === 'object' && source) {
      return {
        type: normalizeEvidenceSourceType(source.type),
        description: source.description ?? source.type
      };
    }
    const type = normalizeEvidenceSourceType(source);
    return { type, description: type };
  });
}

function normalizeEvidenceSources(sources) {
  return normalizeList(sources).map((source) => {
    if (typeof source === 'object' && source) {
      return {
        type: normalizeEvidenceSourceType(source.type),
        ref: source.ref ?? source.path ?? null,
        summary: source.summary ?? null
      };
    }
    const [rawType, rawRef = '', rawSummary = ''] = String(source).split(':');
    return {
      type: normalizeEvidenceSourceType(rawType),
      ref: rawRef || null,
      summary: rawSummary || null
    };
  });
}

function normalizeEvidenceSourceType(value) {
  const type = String(value ?? '').trim();
  if (!EVIDENCE_SOURCE_TYPES.has(type)) {
    throw new Error(`Unsupported evidence source type: ${type}. Use one of ${[...EVIDENCE_SOURCE_TYPES].join(', ')}`);
  }
  return type;
}

function normalizeComparisonPolicy(policy) {
  if (typeof policy === 'string' && policy.trim().startsWith('{')) {
    return normalizeComparisonPolicy(JSON.parse(policy));
  }
  if (typeof policy === 'string' && policy.trim()) {
    return {
      mode: policy,
      beforeLabel: 'before',
      afterLabel: 'after',
      statistic: 'p50_p90_max',
      compareOnlySameCompletionCondition: true
    };
  }
  return {
    mode: policy?.mode ?? 'before_after',
    beforeLabel: policy?.beforeLabel ?? policy?.before_label ?? 'before',
    afterLabel: policy?.afterLabel ?? policy?.after_label ?? 'after',
    statistic: policy?.statistic ?? 'p50_p90_max',
    compareOnlySameCompletionCondition: policy?.compareOnlySameCompletionCondition ?? policy?.compare_only_same_completion_condition ?? true
  };
}

function normalizeFailureClassifications(values) {
  const classifications = normalizeList(values);
  const required = ['blocked', 'needs_review', 'timeout', 'auth_required', 'resource_unavailable', 'unknown'];
  return [...new Set([...classifications, ...required])];
}

function normalizeStatus(status) {
  const normalized = String(status).trim();
  if (normalized === 'pass') return COMPLETED_STATUS;
  if (normalized === COMPLETED_STATUS || INCOMPLETE_STATUSES.has(normalized)) return normalized;
  throw new Error(`Unsupported performance run status: ${status}`);
}

function normalizeReadinessKind(value) {
  const kind = String(value ?? 'user_perceived').trim();
  if (['server_side', 'user_perceived', 'external_dependency', 'system_internal'].includes(kind)) return kind;
  throw new Error(`Unsupported readiness kind: ${kind}`);
}

function inferReadinessKind(metricId, evidenceSources) {
  const id = String(metricId ?? '').toLowerCase();
  if (/server|internal/.test(id)) return 'server_side';
  const sources = normalizeList(evidenceSources).map((source) => typeof source === 'object' ? source.type : source);
  if (sources.length > 0 && sources.every((source) => source === 'server_log' || source === 'api_log')) return 'server_side';
  return 'user_perceived';
}

function normalizeDuration(value, { startedAt, completedAt, status }) {
  if (value !== null && value !== undefined) {
    const duration = Number(value);
    if (!Number.isFinite(duration) || duration < 0) throw new Error('--duration-ms must be a non-negative number');
    return Math.round(duration);
  }
  if (startedAt && completedAt) {
    const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (Number.isFinite(duration) && duration >= 0) return duration;
  }
  return status === COMPLETED_STATUS ? null : null;
}

function normalizeTimeout(value) {
  const timeout = Number(value ?? 30000);
  if (!Number.isFinite(timeout) || timeout < 1) throw new Error('timeoutMs must be a positive number');
  return Math.floor(timeout);
}

function normalizeList(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => normalizeList(item));
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [value];
}

function classifyStartCondition(description) {
  const text = String(description ?? '').toLowerCase();
  if (/click|tap|keypress|input|操作/.test(text)) return 'user_action';
  if (/request|api|handleupgrade|websocket|server/.test(text)) return 'server_event';
  if (/marker|client/.test(text)) return 'client_marker';
  return 'custom';
}

function classifyCompletionCondition(description) {
  const text = String(description ?? '').toLowerCase();
  if (/snapshot/.test(text)) return 'snapshot_visible';
  if (/dom|visible|render|表示|host/.test(text)) return 'dom_visible';
  if (/api|response|request.*complete|完了/.test(text)) return 'api_completed';
  if (/inputready|interactive|clickable|操作可能|ready=true|owner/.test(text)) return 'interactive_ready';
  if (/tmux|running=true|wsstate|server|backend/.test(text)) return 'server_ready';
  return 'custom';
}

function isCompletedComparableRun(run, completionCondition) {
  return run.status === COMPLETED_STATUS
    && Number.isFinite(run.observation?.duration_ms)
    && run.comparison_key?.completion_condition === completionCondition;
}

function hasUserPerceivedEvidence(runs) {
  return runs.some((run) => (run.observation?.evidence_sources ?? [])
    .some((source) => USER_PERCEIVED_SOURCES.has(source.type)));
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * ratio) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
}

function nullableDelta(after, before) {
  if (!Number.isFinite(after) || !Number.isFinite(before)) return null;
  return after - before;
}

function nullableRatioDelta(after, before) {
  if (!Number.isFinite(after) || !Number.isFinite(before) || before === 0) return null;
  return roundRatio((after - before) / before);
}

function roundRatio(value) {
  return Math.round(value * 10000) / 10000;
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function formatMs(value) {
  if (value === null || value === undefined) return '-';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (absolute >= 1000) return `${sign}${(absolute / 1000).toFixed(2)}s`;
  return `${sign}${absolute}ms`;
}

function formatPercent(value) {
  if (value === null || value === undefined) return '-';
  return `${Math.round(value * 1000) / 10}%`;
}

function requiredOption(value, name) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function getPerformanceRunDir(repoRoot, storyId) {
  const sentinel = await resolvePrArtifactFile(repoRoot, storyId, path.join('performance-runs', '.route'));
  return path.dirname(sentinel);
}

function safeFileName(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '') || createRunId();
}

function createRunId() {
  return `${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '')}-${process.pid}`;
}

async function updatePerformanceManifest(repoRoot, storyId, run, jsonPath, summary) {
  const manifest = await readManifest(repoRoot);
  manifest.performance_evidence = {
    ...(manifest.performance_evidence ?? {}),
    [storyId]: {
      latest_run: run.run_id,
      latest_metric_id: run.metric_id,
      latest_run_artifact: toWorkspaceRelative(repoRoot, jsonPath),
      latest_summary: {
        generated_at: summary.generated_at,
        metric_count: summary.metric_count,
        run_count: summary.run_count,
        comparable_count: summary.comparable_count,
        not_comparable_count: summary.not_comparable_count
      }
    }
  };
  await writeManifest(repoRoot, manifest);
}
