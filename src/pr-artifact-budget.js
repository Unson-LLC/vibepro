import crypto from 'node:crypto';

import { projectDecisionOutcomeSummary } from './decision-outcome-ledger.js';

/**
 * Per-artifact size budget for `pr prepare`.
 *
 * `pr prepare` keeps emitting every full-fidelity JSON artifact unchanged as the
 * machine-readable source of truth. This module adds a post-emission budget pass:
 * any emitted JSON artifact whose serialized size exceeds a configurable per-file
 * byte budget gets a generated bounded sibling `<name>.summary.json`, and the LLM
 * handoff surfaces reference the summary instead of the full file. Gate evaluation
 * is deliberately excluded — gates keep reading the in-memory full artifacts, so
 * budget enforcement can never change a gate verdict.
 */

export const DEFAULT_PR_ARTIFACT_BYTES = 16384;
export const ARTIFACT_SUMMARY_SCHEMA_VERSION = '0.1.0';
export const ARTIFACT_SUMMARY_KIND = 'artifact_summary';
const SUMMARY_MAX_FRACTION = 0.1;
const MAX_HIGHLIGHTS = 12;

export function resolvePrArtifactBudgetBytes(config) {
  const value = config?.budgets?.pr_artifact_bytes;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return DEFAULT_PR_ARTIFACT_BYTES;
}

export function summaryFilenameFor(filename) {
  return filename.replace(/\.json$/i, '') + '.summary.json';
}

function sha256(content) {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

/**
 * Generic conclusion extractor: top-level status-like fields, array lengths, and
 * count fields. Deliberately conservative so the summary stays tiny.
 */
function extractGenericConclusion(parsed) {
  const statusFields = {};
  const topLevelCounts = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        topLevelCounts[`${key}_count`] = value.length;
      } else if (typeof value === 'number' && /count|total|_n$|bytes/i.test(key)) {
        topLevelCounts[key] = value;
      } else if (typeof value === 'string'
        && /status|state|conclusion|decision|result|verdict|route|depth|strategy|model/i.test(key)
        && value.length <= 120) {
        statusFields[key] = value;
      } else if (typeof value === 'boolean'
        && /status|ready|ok|pass|complete|allowed|required|stale/i.test(key)) {
        statusFields[key] = value;
      }
    }
  }
  return { status_fields: statusFields, top_level_counts: topLevelCounts };
}

function pick(object, keys) {
  const out = {};
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) {
      out[key] = object[key];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Per-known-artifact extractors for the measured offenders so their summaries
 * carry the actual decision-relevant conclusions.
 */
const KNOWN_EXTRACTORS = {
  'design-ssot-reconciliation.json'(parsed) {
    const coverage = parsed?.coverage ?? {};
    return {
      status_fields: {
        ...(parsed?.status !== undefined ? { status: parsed.status } : {}),
        ...(parsed?.workflow !== undefined ? { workflow: parsed.workflow } : {}),
        ...(coverage.status !== undefined ? { coverage_status: coverage.status } : {})
      },
      top_level_counts: {
        action_items_count: Array.isArray(parsed?.action_items) ? parsed.action_items.length : 0,
        changed_paths_count: Array.isArray(parsed?.changed_paths) ? parsed.changed_paths.length : 0,
        unregistered_changed_docs_count: Array.isArray(coverage.unregistered_changed_docs)
          ? coverage.unregistered_changed_docs.length
          : 0
      }
    };
  },
  'decision-index.json'(parsed) {
    const gate = parsed?.gate_summary ?? {};
    const judgment = parsed?.engineering_judgment ?? {};
    return {
      status_fields: {
        ...pick(parsed, ['evidence_depth']),
        ...(gate.overall_status !== undefined ? { overall_status: gate.overall_status } : {}),
        ...(gate.ready_for_pr_create !== undefined ? { ready_for_pr_create: gate.ready_for_pr_create } : {}),
        ...(parsed?.scope?.status !== undefined ? { scope_status: parsed.scope.status } : {}),
        ...(judgment.route_type !== undefined ? { route_type: judgment.route_type } : {}),
        ...(judgment.confidence !== undefined ? { judgment_confidence: judgment.confidence } : {})
      },
      top_level_counts: {
        unresolved_gate_count: gate.unresolved_gate_count ?? 0,
        critical_unresolved_gate_count: gate.critical_unresolved_gate_count ?? 0,
        risk_signal_count: Array.isArray(parsed?.risk_signals) ? parsed.risk_signals.length : 0,
        active_axis_count: judgment.active_axis_count ?? 0
      }
    };
  },
  'senior-gap-judgment.json'(parsed) {
    const ledger = parsed?.cost_context?.artifact_value_ledger ?? {};
    return {
      status_fields: pick(parsed, ['status', 'route_type', 'confidence']) ?? {},
      top_level_counts: {
        decision_changed_count: ledger.decision_changed_count ?? 0,
        decision_change_unconfirmed_count: ledger.decision_change_unconfirmed_count ?? 0,
        unused_artifact_count: ledger.unused_artifact_count ?? 0
      }
    };
  },
  'decision-outcome-ledger.json'(parsed, { detailLimit = 5 } = {}) {
    const projection = projectDecisionOutcomeSummary(parsed, { limit: detailLimit });
    return {
      status_fields: {
        model: parsed?.model ?? null,
        ledger_path: projection?.ledger_path ?? null,
        ledger_digest: projection?.ledger_digest ?? null,
        evidence_head_sha: projection?.evidence_head_sha ?? null
      },
      top_level_counts: {
        total_count: projection?.total_count ?? 0,
        returned_count: projection?.returned_count ?? 0,
        omitted_count: projection?.omitted_count ?? 0
      },
      details: {
        status_counts: projection?.status_counts ?? {},
        entries: projection?.entries ?? []
      }
    };
  }
};

function buildConclusion(filename, parsed, options = {}) {
  const extractor = KNOWN_EXTRACTORS[filename];
  if (extractor) {
    const known = extractor(parsed, options);
    const generic = extractGenericConclusion(parsed);
    return {
      status_fields: { ...generic.status_fields, ...known.status_fields },
      top_level_counts: { ...generic.top_level_counts, ...known.top_level_counts },
      ...(known.details ? { details: known.details } : {})
    };
  }
  return extractGenericConclusion(parsed);
}

function buildSummaryObject({
  filename,
  parsed,
  content,
  bytes,
  budgetBytes,
  highlightLimit = MAX_HIGHLIGHTS,
  detailLimit = 5
}) {
  const { details, ...conclusion } = buildConclusion(filename, parsed, { detailLimit });
  const highlights = Object.entries(conclusion.status_fields)
    .slice(0, highlightLimit)
    .map(([key, value]) => `${key}=${value}`);
  return {
    schema_version: ARTIFACT_SUMMARY_SCHEMA_VERSION,
    kind: ARTIFACT_SUMMARY_KIND,
    source_artifact: filename,
    source_bytes: bytes,
    source_content_hash: sha256(content),
    conclusion,
    ...(details ? { details } : {}),
    highlights,
    over_budget_reason: `source_bytes exceeds budget ${budgetBytes}`,
    full_artifact_path: filename
  };
}

function serializeSummary(summary) {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

/**
 * Build the bounded summary for one over-budget artifact, guaranteeing the
 * serialized summary is at most 10% of the source bytes. Returns null when the
 * summary cannot be produced within the size bound (caller treats as failed).
 */
export function buildArtifactSummaryContent({ filename, content, bytes, budgetBytes }) {
  const parsed = JSON.parse(content);
  const maxSummaryBytes = Math.floor(bytes * SUMMARY_MAX_FRACTION);
  for (const detailLimit of [5, 4, 3, 2, 1, 0]) {
    for (const highlightLimit of [MAX_HIGHLIGHTS, 4, 0]) {
      const summary = buildSummaryObject({
        filename,
        parsed,
        content,
        bytes,
        budgetBytes,
        highlightLimit,
        detailLimit
      });
      const serialized = serializeSummary(summary);
      if (Buffer.byteLength(serialized, 'utf8') <= maxSummaryBytes) {
        return serialized;
      }
    }
  }
  return null;
}

/**
 * Budget pass over a set of emitted JSON artifacts.
 *
 * @param {object} params
 * @param {Array<{ filename: string, content: string }>} params.artifacts serialized content as written
 * @param {number} params.budgetBytes per-file byte budget
 * @returns {{
 *   budget_bytes: number,
 *   over_budget: Array<{ artifact: string, bytes: number, summary_filename: string|null, summary_status: string }>,
 *   summaries: Array<{ filename: string, content: string }>,
 *   resolver: Map<string, { over_budget: boolean, summary_status: string, summary_filename: string|null }>
 * }}
 */
export function planArtifactBudget({ artifacts, budgetBytes }) {
  const overBudget = [];
  const summaries = [];
  const resolver = new Map();
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact.content !== 'string') continue;
    const bytes = Buffer.byteLength(artifact.content, 'utf8');
    if (bytes <= budgetBytes) continue;
    const summaryFilename = summaryFilenameFor(artifact.filename);
    let summaryStatus = 'generated';
    let summaryContent = null;
    try {
      summaryContent = buildArtifactSummaryContent({
        filename: artifact.filename,
        content: artifact.content,
        bytes,
        budgetBytes
      });
      if (summaryContent === null) {
        summaryStatus = 'failed';
      }
    } catch {
      summaryStatus = 'failed';
      summaryContent = null;
    }
    const generated = summaryStatus === 'generated';
    overBudget.push({
      artifact: artifact.filename,
      bytes,
      summary_filename: generated ? summaryFilename : null,
      summary_status: summaryStatus
    });
    if (generated) {
      summaries.push({ filename: summaryFilename, content: summaryContent });
    }
    resolver.set(artifact.filename, {
      over_budget: true,
      summary_status: summaryStatus,
      summary_filename: generated ? summaryFilename : null
    });
  }
  return { budget_bytes: budgetBytes, over_budget: overBudget, summaries, resolver };
}

/**
 * Resolve which path a handoff surface should reference for an artifact.
 * When a bounded summary exists it becomes the default; the full artifact path
 * is always returned as a deep-dive pointer, and handoff must never dangle.
 */
export function resolveHandoffArtifact(plan, filename, dir) {
  const fullPath = joinDir(dir, filename);
  const entry = plan?.resolver instanceof Map ? plan.resolver.get(filename) : plan?.resolver?.[filename];
  if (entry && entry.over_budget && entry.summary_status === 'generated' && entry.summary_filename) {
    return {
      path: joinDir(dir, entry.summary_filename),
      full_path: fullPath,
      is_summary: true
    };
  }
  return { path: fullPath, full_path: fullPath, is_summary: false };
}

function joinDir(dir, filename) {
  if (!dir) return filename;
  return `${dir.replace(/\/$/, '')}/${filename}`;
}

/**
 * Look up the bounded summary for an artifact from a persisted `artifact_budget`
 * report section (as stored in pr-prepare.json).
 */
export function findBudgetSummaryPath(artifactBudget, filename) {
  const overBudget = Array.isArray(artifactBudget?.over_budget) ? artifactBudget.over_budget : [];
  const entry = overBudget.find((item) => item.artifact === filename);
  if (entry && entry.summary_status === 'generated' && entry.summary_path) {
    return entry.summary_path;
  }
  return null;
}
