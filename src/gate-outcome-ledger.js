import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

export const GATE_OUTCOMES = new Set([
  'source_fix',
  'evidence_added',
  'rewording_only',
  'waiver',
  'unclassified'
]);

// The subset an operator can be asked to choose from when the classifier could
// not derive an outcome. `unclassified` stays a valid ledger value (legacy rows
// keep it) but is never offered as a classification input.
export const CLASSIFIABLE_GATE_OUTCOMES = ['source_fix', 'evidence_added', 'rewording_only', 'waiver'];

// Rate of newly recorded entries that may stay unclassified before
// `usage report --gate-roi` raises a value signal. MIN_SAMPLE keeps a single
// noisy gate/story from tripping the signal.
export const GATE_ROI_UNCLASSIFIED_RATE_THRESHOLD = 0.5;
export const GATE_ROI_UNCLASSIFIED_MIN_SAMPLE = 5;

const LEDGER_SCHEMA_VERSION = '0.1.0';
const LEDGER_MODEL = 'vibepro-gate-outcome-ledger-v3';
const LEGACY_LEDGER_MODELS = new Set([
  'vibepro-gate-outcome-ledger-v1',
  'vibepro-gate-outcome-ledger-v2'
]);
export const UNRESOLVED_STATUSES = new Set([
  'block',
  'blocked',
  'failed',
  'needs_evidence',
  'needs_review',
  'needs_verification',
  'missing',
  'pending',
  'stale_evidence',
  'story_source_mismatch'
]);
const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?|mjs|cjs|ts|tsx|jsx|go|rs|py|rb|php|java|kt|swift|c|cc|cpp|h|hpp|cs|scala|sql|prisma)$/i;
const DOC_FILE_RE = /(?:^|\/)(?:docs|README|CHANGELOG|NOTICE|LICENSE|agent-instructions|skills)(?:\/|$)|\.(?:md|mdx|txt|rst)$/i;
// Paths that describe the workspace/tooling rather than the change under review.
// Leaving them in the diff shape made doc-only resolutions look "mixed" and fall
// through to unclassified, which is the bulk of the legacy ledger backlog.
const WORKSPACE_INTERNAL_PATH_RE = /^(?:\.vibepro|\.worktrees|\.git|node_modules|dist|coverage)(?:\/|$)/;
// A gate closed by an accepted blocker waiver (see buildJudgmentAxisGates) is a
// waiver by construction, not a fix.
const ACCEPTED_FOLLOWUP_STATUSES = new Set(['accepted_followup', 'active_accepted_followup']);

export const CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH = path.join('docs', 'management', 'roi-ledger', 'ledger.json');

export function getGateOutcomeLedgerPath(repoRoot) {
  return path.join(getWorkspaceDir(repoRoot), 'gate-outcomes', 'ledger.json');
}

export function getCentralGateOutcomeLedgerPath(repoRoot) {
  return path.join(path.resolve(repoRoot), CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH);
}

// Promotion is a delivery-time boundary, so it must distinguish a genuinely
// absent/empty ledger from one whose contents cannot be trusted. The regular
// readGateOutcomeLedger path remains tolerant for existing local consumers.
export async function readPromotableGateOutcomeEntries(repoRoot, storyId) {
  const ledgerPath = getGateOutcomeLedgerPath(repoRoot);
  let text;
  try {
    text = await readFile(ledgerPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return promotionSourceResult('absent', 'local_gate_outcome_ledger_absent', []);
    }
    throw error;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return promotionSourceResult('failed', 'local_gate_outcome_ledger_parse_failed', []);
    }
    throw error;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return promotionSourceResult('failed', 'local_gate_outcome_ledger_shape_invalid', []);
  }
  if (data.schema_version !== LEDGER_SCHEMA_VERSION) {
    return promotionSourceResult('failed', 'local_gate_outcome_ledger_schema_invalid', []);
  }
  if (LEGACY_LEDGER_MODELS.has(data.model)) {
    return promotionSourceResult('empty', 'legacy_gate_outcome_ledger_not_promotable', []);
  }
  if (data.model !== LEDGER_MODEL) {
    return promotionSourceResult('failed', 'local_gate_outcome_ledger_model_invalid', []);
  }
  if (!Array.isArray(data.entries)) {
    return promotionSourceResult('failed', 'local_gate_outcome_ledger_shape_invalid', []);
  }
  const entryValidation = validateGateOutcomeEntries(data.entries);
  if (!entryValidation.valid) {
    return promotionSourceResult('failed', entryValidation.duplicate
      ? 'local_gate_outcome_ledger_entry_duplicate'
      : 'local_gate_outcome_ledger_entry_invalid', []);
  }

  const entries = data.entries.filter((entry) => entry?.story_id === storyId);
  return promotionSourceResult(
    entries.length > 0 ? 'ok' : 'empty',
    entries.length > 0 ? null : 'no_local_decision_outcomes',
    entries
  );
}

// Collects the local ledger entries that belong to a single story so they can be
// promoted into the tracked central ledger during execute merge.
export async function collectPromotableGateOutcomeEntries(repoRoot, storyId) {
  const result = await readPromotableGateOutcomeEntries(repoRoot, storyId);
  if (result.status === 'failed') {
    const error = new Error(result.reason);
    error.code = result.reason;
    throw error;
  }
  return result.entries;
}

// Deterministic serialization of the central ledger: entries sorted by entry_key
// and updated_at derived from the entries themselves (max resolved_at) so that
// identical logical content always yields byte-identical output (RML-CONTRACT-003).
export function serializeCentralGateOutcomeLedger(entries) {
  const sorted = [...(entries ?? [])].sort((a, b) =>
    String(a?.entry_key ?? '').localeCompare(String(b?.entry_key ?? '')));
  const updatedAt = sorted.reduce((max, entry) => latestIso(max, entry?.resolved_at), null);
  const doc = {
    schema_version: LEDGER_SCHEMA_VERSION,
    model: LEDGER_MODEL,
    updated_at: updatedAt,
    entries: sorted
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// Pure promotion computation: merge local (story-scoped) entries into the existing
// central ledger by entry_key. Missing/empty local entries => no_entries; an
// unparseable central ledger => failed (never silently overwritten).
export function computeCentralLedgerPromotion({ localEntries = [], centralText = null } = {}) {
  const centralPath = CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH;
  if (!Array.isArray(localEntries) || localEntries.length === 0) {
    return {
      status: 'no_entries',
      reason: 'no_local_ledger_entries_for_story',
      promoted_count: 0,
      duplicate_count: 0,
      central_ledger_path: centralPath,
      serialized: null
    };
  }

  const localValidation = validateGateOutcomeEntries(localEntries);
  if (!localValidation.valid) {
    return failedPromotion(localValidation.duplicate
      ? 'local_gate_outcome_ledger_entry_duplicate'
      : 'local_gate_outcome_ledger_entry_invalid', centralPath);
  }

  let existing = [];
  if (centralText !== null && String(centralText).trim() !== '') {
    let parsed;
    try {
      parsed = JSON.parse(centralText);
    } catch {
      return {
        status: 'failed',
        reason: 'central_ledger_parse_failed',
        promoted_count: 0,
        duplicate_count: 0,
        central_ledger_path: centralPath,
        serialized: null
      };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.entries)) {
      return failedPromotion('central_ledger_shape_invalid', centralPath);
    }
    if (parsed.schema_version !== LEDGER_SCHEMA_VERSION) {
      return failedPromotion('central_ledger_schema_invalid', centralPath);
    }
    if (parsed.model !== LEDGER_MODEL) {
      return failedPromotion('central_ledger_model_invalid', centralPath);
    }
    const centralValidation = validateGateOutcomeEntries(parsed.entries);
    if (!centralValidation.valid) {
      return failedPromotion(centralValidation.duplicate
        ? 'central_ledger_entry_duplicate'
        : 'central_ledger_entry_invalid', centralPath);
    }
    existing = parsed.entries;
  }

  const seen = new Set(existing.map((entry) => entry?.entry_key));
  const merged = [...existing];
  let promoted = 0;
  let duplicate = 0;
  for (const entry of localEntries) {
    if (seen.has(entry.entry_key)) {
      duplicate += 1;
      continue;
    }
    seen.add(entry.entry_key);
    merged.push(entry);
    promoted += 1;
  }
  return {
    status: 'promoted',
    reason: null,
    promoted_count: promoted,
    duplicate_count: duplicate,
    central_ledger_path: centralPath,
    serialized: serializeCentralGateOutcomeLedger(merged)
  };
}

function validateGateOutcomeEntries(entries) {
  if (!Array.isArray(entries)) return { valid: false, duplicate: false };
  const keys = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { valid: false, duplicate: false };
    }
    const requiredText = ['entry_key', 'story_id', 'gate_id', 'classification'];
    if (entry.schema_version !== LEDGER_SCHEMA_VERSION
      || requiredText.some((field) => typeof entry[field] !== 'string' || entry[field].trim() === '')
      || !GATE_OUTCOMES.has(entry.outcome)
      || typeof entry.resolved_at !== 'string'
      || !Number.isFinite(Date.parse(entry.resolved_at))) {
      return { valid: false, duplicate: false };
    }
    if (keys.has(entry.entry_key)) return { valid: false, duplicate: true };
    keys.add(entry.entry_key);
  }
  return { valid: true, duplicate: false };
}

function failedPromotion(reason, centralPath) {
  return {
    status: 'failed',
    reason,
    promoted_count: 0,
    duplicate_count: 0,
    central_ledger_path: centralPath,
    serialized: null
  };
}

export async function readCentralGateOutcomeLedger(repoRoot) {
  const ledgerPath = getCentralGateOutcomeLedgerPath(repoRoot);
  try {
    const data = JSON.parse(await readFile(ledgerPath, 'utf8'));
    return { status: 'ok', ledger: normalizeLedger(data) };
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'absent', ledger: emptyLedger() };
    if (error instanceof SyntaxError) return { status: 'unparseable', ledger: emptyLedger() };
    throw error;
  }
}

// Gate ROI summary read from the central ledger for `usage report --gate-roi`.
// unclassified_count is always reported explicitly and missing classification
// data is counted as unclassified rather than silently dropped (RML-CONTRACT-005).
export function summarizeGateRoi(ledger, options = {}) {
  const { since = null } = options;
  const rateThreshold = Number.isFinite(options.unclassifiedRateThreshold)
    ? options.unclassifiedRateThreshold
    : GATE_ROI_UNCLASSIFIED_RATE_THRESHOLD;
  const minSample = Number.isFinite(options.unclassifiedMinSample)
    ? options.unclassifiedMinSample
    : GATE_ROI_UNCLASSIFIED_MIN_SAMPLE;
  const sinceDate = since instanceof Date ? since : null;
  const entries = (ledger?.entries ?? []).filter((entry) => isWithinSince(entry.resolved_at, sinceDate));
  const byGate = new Map();
  const byStory = new Map();
  let unclassifiedTotal = 0;
  for (const entry of entries) {
    const outcome = GATE_OUTCOMES.has(String(entry.outcome ?? '').trim())
      ? String(entry.outcome).trim()
      : 'unclassified';
    tallyRoiBucket(byGate, 'gate_id', entry.gate_id ?? 'unknown_gate', outcome);
    tallyRoiBucket(byStory, 'story_id', entry.story_id ?? 'unknown_story', outcome);
    if (outcome === 'unclassified') unclassifiedTotal += 1;
  }
  const gates = finalizeRoiBuckets(byGate, 'gate_id');
  const stories = finalizeRoiBuckets(byStory, 'story_id');
  const unclassifiedRate = entries.length > 0 ? unclassifiedTotal / entries.length : 0;
  const thresholds = {
    unclassified_rate: rateThreshold,
    min_sample: minSample
  };
  const breaches = [
    ...(entries.length >= minSample && unclassifiedRate > rateThreshold
      ? [{ scope: 'overall', id: 'all_gates', count: entries.length, unclassified_count: unclassifiedTotal, unclassified_rate: unclassifiedRate }]
      : []),
    ...collectRoiBreaches(gates, 'gate', 'gate_id', rateThreshold, minSample),
    ...collectRoiBreaches(stories, 'story', 'story_id', rateThreshold, minSample)
  ];
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    entry_count: entries.length,
    unclassified_count: unclassifiedTotal,
    unclassified_rate: unclassifiedRate,
    thresholds,
    unclassified_threshold_breaches: breaches,
    gates,
    stories
  };
}

function tallyRoiBucket(map, key, id, outcome) {
  if (!map.has(id)) {
    map.set(id, {
      [key]: id,
      count: 0,
      classifications: Object.fromEntries([...GATE_OUTCOMES].map((name) => [name, 0])),
      unclassified_count: 0
    });
  }
  const item = map.get(id);
  item.count += 1;
  item.classifications[outcome] += 1;
  if (outcome === 'unclassified') item.unclassified_count += 1;
}

function finalizeRoiBuckets(map, key) {
  return [...map.values()]
    .map((item) => ({
      ...item,
      unclassified_rate: item.count > 0 ? item.unclassified_count / item.count : 0
    }))
    .sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

function collectRoiBreaches(items, scope, key, rateThreshold, minSample) {
  return items
    .filter((item) => item.count >= minSample && item.unclassified_rate > rateThreshold)
    .map((item) => ({
      scope,
      id: item[key],
      count: item.count,
      unclassified_count: item.unclassified_count,
      unclassified_rate: item.unclassified_rate
    }))
    .sort((a, b) => b.unclassified_rate - a.unclassified_rate || String(a.id).localeCompare(String(b.id)));
}

export async function readGateOutcomeLedger(repoRoot) {
  const ledgerPath = getGateOutcomeLedgerPath(repoRoot);
  try {
    const data = JSON.parse(await readFile(ledgerPath, 'utf8'));
    return normalizeLedger(data);
  } catch (error) {
    if (error.code === 'ENOENT') return emptyLedger();
    throw error;
  }
}

export async function recordResolvedGateOutcomes(repoRoot, options = {}) {
  normalizeOutcome(options.overrideOutcome);
  const overrides = options.overrides ?? parseGateOutcomeOverrides(options.gateOutcomes);
  const entries = buildResolvedGateOutcomeEntries(repoRoot, { ...options, overrides });
  const storyId = options.storyId ?? null;
  if (entries.length === 0) {
    return {
      schema_version: LEDGER_SCHEMA_VERSION,
      status: 'no_resolved_gates',
      artifact: toWorkspaceRelative(repoRoot, getGateOutcomeLedgerPath(repoRoot)),
      entries: [],
      classification: await buildLedgerClassificationReport(repoRoot, storyId, [])
    };
  }

  const ledgerPath = getGateOutcomeLedgerPath(repoRoot);
  const existing = await readGateOutcomeLedger(repoRoot);
  const seen = new Set(existing.entries.map((entry) => entry.entry_key));
  const nextEntries = [...existing.entries];
  for (const entry of entries) {
    if (seen.has(entry.entry_key)) continue;
    seen.add(entry.entry_key);
    nextEntries.unshift(entry);
  }
  const next = {
    schema_version: LEDGER_SCHEMA_VERSION,
    model: LEDGER_MODEL,
    updated_at: new Date().toISOString(),
    entries: nextEntries
  };
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, `${JSON.stringify(next, null, 2)}\n`);
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    status: entries.length === 0 ? 'no_resolved_gates' : 'recorded',
    artifact: toWorkspaceRelative(repoRoot, ledgerPath),
    entries,
    classification: buildLedgerClassificationReportFrom(nextEntries, storyId, entries)
  };
}

async function buildLedgerClassificationReport(repoRoot, storyId, entries) {
  const ledger = await readGateOutcomeLedger(repoRoot);
  return buildLedgerClassificationReportFrom(ledger.entries, storyId, entries);
}

// Combines "what this run left unclassified" (the backlog to answer now) with
// "what is still unclassified for this story" (the debt that would be promoted).
function buildLedgerClassificationReportFrom(ledgerEntries, storyId, recordedEntries) {
  const backlog = buildGateOutcomeClassificationBacklog(recordedEntries, { storyId });
  const storyEntries = (ledgerEntries ?? []).filter((entry) => !storyId || entry?.story_id === storyId);
  const storyPending = storyEntries.filter((entry) => entry?.outcome === 'unclassified' && entry?.overridden !== true);
  return {
    ...backlog,
    story_entry_count: storyEntries.length,
    story_unclassified_count: storyPending.length,
    story_unclassified_rate: storyEntries.length > 0 ? storyPending.length / storyEntries.length : 0,
    story_unclassified_gate_ids: [...new Set(storyPending.map((entry) => entry.gate_id).filter(Boolean))],
    next_command: backlog.next_command
      ?? (storyPending.length > 0 ? buildClassificationCommand(storyId, storyPending) : null)
  };
}

export function buildResolvedGateOutcomeEntries(repoRoot, options = {}) {
  const previousGateDag = options.previousGateDag;
  const currentGateDag = options.currentGateDag;
  if (!previousGateDag || !currentGateDag) return [];

  const previousNodes = new Map((previousGateDag.nodes ?? []).map((node) => [node.id, node]));
  const currentNodes = new Map((currentGateDag.nodes ?? []).map((node) => [node.id, node]));
  const createdAt = options.createdAt ?? new Date().toISOString();
  const storyId = currentGateDag.story_id ?? options.storyId ?? previousGateDag.story_id ?? null;
  const previousPrepareCreatedAt = options.previousPrepareCreatedAt ?? null;
  const entries = [];
  for (const [gateId, previousNode] of previousNodes.entries()) {
    const currentNode = currentNodes.get(gateId);
    if (!currentNode) continue;
    if (!isRequiredGate(previousNode)) continue;
    if (!isUnresolvedGateStatus(previousNode.status)) continue;
    if (isUnresolvedGateStatus(currentNode.status)) continue;
    const classification = classifyGateOutcome({
      repoRoot,
      gate: currentNode,
      previousGate: previousNode,
      previousPrepareCreatedAt,
      git: options.git,
      fileGroups: options.fileGroups,
      verificationEvidence: options.verificationEvidence,
      agentReviews: options.agentReviews,
      decisionRecords: options.decisionRecords,
      overrideOutcome: options.overrideOutcome,
      overrides: options.overrides
    });
    const entryKey = [
      storyId ?? 'unknown-story',
      gateId,
      previousNode.status ?? 'unknown',
      currentNode.status ?? 'unknown',
      previousGateDag.summary?.run_id ?? previousPrepareCreatedAt ?? 'unknown-previous',
      currentGateDag.summary?.run_id ?? createdAt
    ].join('|');
    entries.push({
      schema_version: LEDGER_SCHEMA_VERSION,
      entry_key: entryKey,
      story_id: storyId,
      gate_id: gateId,
      gate_type: currentNode.type ?? previousNode.type ?? null,
      previous_status: previousNode.status ?? null,
      resolved_status: currentNode.status ?? null,
      outcome: classification.outcome,
      classification: classification.reason,
      overridden: classification.overridden,
      evidence_refs: classification.evidence_refs,
      decision_refs: classification.decision_refs,
      previous_prepare_created_at: previousPrepareCreatedAt,
      resolved_at: createdAt,
      git: {
        base_ref: options.git?.base_ref ?? null,
        head_ref: options.git?.head_ref ?? null,
        head_sha: options.git?.head_sha ?? null,
        changed_files: (options.git?.changed_files ?? []).map((file) => file.path ?? file)
      }
    });
  }
  return entries;
}

export function classifyGateOutcome(options = {}) {
  const gate = options.gate ?? null;
  const overrideOutcome = normalizeOutcome(
    resolveGateOutcomeOverride(options.overrides, gate?.id) ?? options.overrideOutcome
  );
  if (overrideOutcome) {
    return {
      outcome: overrideOutcome,
      reason: 'operator_override',
      overridden: true,
      evidence_refs: [],
      decision_refs: []
    };
  }

  const previousPrepareCreatedAt = options.previousPrepareCreatedAt ?? null;
  const waiverRefs = collectRecentWaiverDecisionRefs(options.decisionRecords, previousPrepareCreatedAt, gate);
  if (waiverRefs.length > 0) {
    return {
      outcome: 'waiver',
      reason: 'accepted_waiver_decision_record',
      overridden: false,
      evidence_refs: [],
      decision_refs: waiverRefs
    };
  }

  // The resolved status itself can carry the decision: a gate that lands on
  // accepted_followup was closed by an accepted blocker waiver, never by a fix.
  if (ACCEPTED_FOLLOWUP_STATUSES.has(String(gate?.status ?? ''))) {
    return {
      outcome: 'waiver',
      reason: 'resolved_as_accepted_followup',
      overridden: false,
      evidence_refs: [],
      decision_refs: []
    };
  }

  const evidenceRefs = collectRecentEvidenceRefs({
    verificationEvidence: options.verificationEvidence,
    agentReviews: options.agentReviews,
    since: previousPrepareCreatedAt,
    gate
  });
  if (evidenceRefs.length > 0) {
    return {
      outcome: 'evidence_added',
      reason: 'new_verification_or_review_evidence',
      overridden: false,
      evidence_refs: evidenceRefs,
      decision_refs: []
    };
  }

  // Evidence-shaped gates (adjudication, definition_of_done, responsibility
  // authority) carry their own evidence surface on the gate node. Comparing the
  // blocked node with the resolved node attributes the resolution to that gate
  // without depending on free-text token matching against global evidence logs.
  const nodeEvidenceRefs = collectGateNodeEvidenceDelta(options.previousGate, gate);
  if (nodeEvidenceRefs.length > 0) {
    return {
      outcome: 'evidence_added',
      reason: 'gate_node_evidence_surface_expanded',
      overridden: false,
      evidence_refs: nodeEvidenceRefs,
      decision_refs: []
    };
  }

  if (hasSourceChanges(options.git, options.fileGroups) && isSourceResolutionCandidate(gate)) {
    return {
      outcome: 'source_fix',
      reason: 'resolving_diff_contains_source_changes_for_source_sensitive_gate',
      overridden: false,
      evidence_refs: [],
      decision_refs: []
    };
  }

  if (hasOnlyRewordingChanges(options.git)) {
    return {
      outcome: 'rewording_only',
      reason: 'resolving_diff_contains_only_documentation_or_story_text',
      overridden: false,
      evidence_refs: [],
      decision_refs: []
    };
  }

  return {
    outcome: 'unclassified',
    reason: 'ambiguous_resolution_surface',
    overridden: false,
    evidence_refs: [],
    decision_refs: []
  };
}

export function summarizeGateOutcomeLedger(ledger, options = {}) {
  const since = options.since instanceof Date ? options.since : null;
  const entries = (ledger?.entries ?? []).filter((entry) => isWithinSince(entry.resolved_at, since));
  const byGate = new Map();
  for (const entry of entries) {
    const gateId = entry.gate_id ?? 'unknown_gate';
    if (!byGate.has(gateId)) {
      byGate.set(gateId, {
        gate_id: gateId,
        total_count: 0,
        outcomes: Object.fromEntries([...GATE_OUTCOMES].map((outcome) => [outcome, 0])),
        rewording_only_rate: 0,
        waiver_rate: 0,
        latest_resolved_at: null
      });
    }
    const item = byGate.get(gateId);
    const outcome = normalizeOutcome(entry.outcome) ?? 'unclassified';
    item.total_count += 1;
    item.outcomes[outcome] = (item.outcomes[outcome] ?? 0) + 1;
    item.latest_resolved_at = latestIso(item.latest_resolved_at, entry.resolved_at);
  }
  const distributions = [...byGate.values()].map((item) => ({
    ...item,
    rewording_only_rate: item.total_count > 0 ? item.outcomes.rewording_only / item.total_count : 0,
    waiver_rate: item.total_count > 0 ? item.outcomes.waiver / item.total_count : 0
  })).sort((a, b) => a.gate_id.localeCompare(b.gate_id));
  const demotionCandidates = distributions
    .filter((item) => item.total_count >= 2 && item.rewording_only_rate >= 0.6)
    .map((item) => ({
      gate_id: item.gate_id,
      reason: 'high_rewording_only_resolution_rate',
      rewording_only_rate: item.rewording_only_rate,
      total_count: item.total_count
    }));
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    entry_count: entries.length,
    distributions,
    demotion_candidates: demotionCandidates
  };
}

// Accepts the legacy repo-wide form (`source_fix`) and the gate-scoped form
// (`gate:agent_review=source_fix`) so an operator can answer several pending
// classifications in one command. Invalid outcomes throw, as before.
export function parseGateOutcomeOverrides(values) {
  const list = values == null ? [] : Array.isArray(values) ? values : [values];
  const byGate = new Map();
  let global = null;
  for (const raw of list) {
    if (raw == null) continue;
    const text = String(raw).trim();
    if (text === '') continue;
    const separator = text.lastIndexOf('=');
    if (separator === -1) {
      global = normalizeOutcome(text);
      continue;
    }
    const gateId = text.slice(0, separator).trim();
    const outcome = normalizeOutcome(text.slice(separator + 1).trim());
    if (gateId === '') {
      global = outcome;
      continue;
    }
    byGate.set(gateId, outcome);
  }
  return { global, by_gate: byGate };
}

export function resolveGateOutcomeOverride(overrides, gateId) {
  if (!overrides) return null;
  const byGate = overrides.by_gate instanceof Map
    ? overrides.by_gate
    : new Map(Object.entries(overrides.by_gate ?? {}));
  if (gateId && byGate.has(gateId)) return byGate.get(gateId);
  return overrides.global ?? null;
}

// GOC-S-2: the entries this run could not classify, with the exact command that
// closes them. Operator-supplied outcomes are never re-asked, even when the
// operator explicitly chose `unclassified`.
export function buildGateOutcomeClassificationBacklog(entries = [], options = {}) {
  const storyId = options.storyId ?? null;
  const recorded = Array.isArray(entries) ? entries : [];
  const pending = recorded
    .filter((entry) => entry?.outcome === 'unclassified' && entry?.overridden !== true)
    .map((entry) => ({
      entry_key: entry.entry_key ?? null,
      gate_id: entry.gate_id ?? null,
      gate_type: entry.gate_type ?? null,
      previous_status: entry.previous_status ?? null,
      resolved_status: entry.resolved_status ?? null,
      undecidable_reason: entry.classification ?? null,
      resolved_at: entry.resolved_at ?? null
    }));
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    status: pending.length > 0 ? 'classification_input_required' : 'complete',
    recorded_count: recorded.length,
    classified_count: recorded.length - pending.length,
    newly_unclassified_count: pending.length,
    newly_unclassified_rate: recorded.length > 0 ? pending.length / recorded.length : 0,
    classification_outcomes: [...CLASSIFIABLE_GATE_OUTCOMES],
    pending,
    next_command: pending.length > 0 ? buildClassificationCommand(storyId, pending) : null
  };
}

function buildClassificationCommand(storyId, pending, maxGates = 5) {
  const gateIds = [...new Set(pending.map((item) => item.gate_id).filter(Boolean))];
  const shown = gateIds.slice(0, maxGates);
  const args = shown.map((gateId) => `--outcome ${gateId}=<${CLASSIFIABLE_GATE_OUTCOMES.join('|')}>`);
  if (gateIds.length > shown.length) args.push(`# +${gateIds.length - shown.length} more gate(s)`);
  return [
    'npx vibepro pr classify .',
    storyId ? `--story-id ${storyId}` : null,
    ...args
  ].filter(Boolean).join(' ');
}

// GOC-S-2: applies operator classifications to entries that are still
// unclassified. Only the local ledger is touched; promotion into the central
// ledger stays owned by `execute merge`, so classify before merging.
export async function applyGateOutcomeClassifications(repoRoot, options = {}) {
  const storyId = options.storyId ?? null;
  const overrides = options.overrides ?? parseGateOutcomeOverrides(options.outcomes);
  const recordedAt = options.recordedAt ?? new Date().toISOString();
  const note = options.note ?? null;
  const ledgerPath = getGateOutcomeLedgerPath(repoRoot);
  const artifact = toWorkspaceRelative(repoRoot, ledgerPath);
  const ledger = await readGateOutcomeLedger(repoRoot);

  const scoped = ledger.entries.filter((entry) => !storyId || entry?.story_id === storyId);
  const pending = scoped.filter((entry) => entry?.outcome === 'unclassified' && entry?.overridden !== true);
  const updated = [];
  const nextEntries = ledger.entries.map((entry) => {
    if (!pending.includes(entry)) return entry;
    const outcome = resolveGateOutcomeOverride(overrides, entry.gate_id);
    if (!outcome) return entry;
    const next = {
      ...entry,
      outcome,
      classification: 'operator_classification_input',
      overridden: true,
      classified_at: recordedAt,
      ...(note ? { classification_note: note } : {})
    };
    updated.push({
      entry_key: next.entry_key ?? null,
      gate_id: next.gate_id ?? null,
      previous_outcome: 'unclassified',
      outcome
    });
    return next;
  });

  const requestedGateIds = [...(overrides?.by_gate instanceof Map
    ? overrides.by_gate.keys()
    : Object.keys(overrides?.by_gate ?? {}))];
  const matchedGateIds = new Set(updated.map((item) => item.gate_id));
  const unmatched = requestedGateIds.filter((gateId) => !matchedGateIds.has(gateId));
  const remaining = nextEntries.filter((entry) => (!storyId || entry?.story_id === storyId)
    && entry?.outcome === 'unclassified'
    && entry?.overridden !== true);

  if (updated.length > 0) {
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    await writeFile(ledgerPath, `${JSON.stringify({
      schema_version: LEDGER_SCHEMA_VERSION,
      model: LEDGER_MODEL,
      updated_at: recordedAt,
      entries: nextEntries
    }, null, 2)}\n`);
  }

  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    status: updated.length > 0 ? 'classified' : 'no_matching_entries',
    story_id: storyId,
    artifact,
    updated_count: updated.length,
    updated,
    unmatched_gate_ids: unmatched,
    remaining_unclassified_count: remaining.length,
    remaining_gate_ids: [...new Set(remaining.map((entry) => entry.gate_id).filter(Boolean))]
  };
}

export function normalizeOutcome(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!GATE_OUTCOMES.has(normalized)) {
    throw new Error(`gate outcome must be one of: ${[...GATE_OUTCOMES].join(', ')}`);
  }
  return normalized;
}

function normalizeLedger(data) {
  if (data?.model && data.model !== LEDGER_MODEL) return emptyLedger();
  return {
    schema_version: data?.schema_version ?? LEDGER_SCHEMA_VERSION,
    model: data?.model ?? LEDGER_MODEL,
    updated_at: data?.updated_at ?? null,
    entries: Array.isArray(data?.entries) ? data.entries : []
  };
}

function emptyLedger() {
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    model: LEDGER_MODEL,
    updated_at: null,
    entries: []
  };
}

function promotionSourceResult(status, reason, entries) {
  return {
    status,
    reason,
    source_ledger: '.vibepro/gate-outcomes/ledger.json',
    entries
  };
}

function isRequiredGate(node) {
  return node?.required !== false;
}

function isUnresolvedGateStatus(status) {
  return UNRESOLVED_STATUSES.has(String(status ?? ''));
}

// Normalizes the resolving diff to the files that describe the change under
// review: drops directory markers emitted for untracked trees and workspace or
// tooling paths that are not part of the reviewed surface.
export function normalizeResolvingDiffFiles(git = null) {
  return (git?.changed_files ?? [])
    .map((file) => file?.path ?? file)
    .filter((file) => typeof file === 'string' && file.trim() !== '')
    .filter((file) => !file.endsWith('/'))
    .filter((file) => !WORKSPACE_INTERNAL_PATH_RE.test(file));
}

function hasSourceChanges(git = null, fileGroups = null) {
  if ((fileGroups?.source?.count ?? 0) > 0) return true;
  return normalizeResolvingDiffFiles(git).some((file) => SOURCE_FILE_RE.test(file));
}

function hasOnlyRewordingChanges(git = null) {
  const changed = normalizeResolvingDiffFiles(git);
  if (changed.length === 0) return false;
  return changed.every((file) => DOC_FILE_RE.test(file));
}

// Stable identities for the evidence a gate node carries inline. Only refs that
// are absent from the blocked node count as newly added evidence.
function collectGateNodeEvidenceDelta(previousGate = null, currentGate = null) {
  if (!currentGate) return [];
  const previousKeys = new Set(collectGateNodeEvidenceRefs(previousGate).map((ref) => ref.key));
  return collectGateNodeEvidenceRefs(currentGate)
    .filter((ref) => !previousKeys.has(ref.key))
    .map((ref) => ({ kind: 'gate_node_evidence', gate_evidence: ref.kind, ref: ref.label }));
}

function collectGateNodeEvidenceRefs(gate = null) {
  if (!gate || typeof gate !== 'object') return [];
  const refs = [];
  const push = (kind, value) => {
    const label = gateEvidenceLabel(value);
    if (!label) return;
    refs.push({ kind, label, key: `${kind}|${label}` });
  };
  for (const evidence of asArray(gate.evidence)) push('evidence', evidence);
  for (const evidence of asArray(gate.matched_evidence)) push('matched_evidence', evidence);
  for (const evidence of asArray(gate.evidence_refs)) push('evidence_ref', evidence);
  for (const item of asArray(gate.definition_items)) {
    for (const evidence of asArray(item?.evidence)) push('definition_item_evidence', evidence);
  }
  for (const responsibility of asArray(gate.matched_responsibilities)) {
    if (responsibility?.evidence_status !== 'passed') continue;
    push('responsibility_evidence', responsibility?.id ?? responsibility);
  }
  return refs.filter((ref, index, all) => all.findIndex((other) => other.key === ref.key) === index);
}

function gateEvidenceLabel(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object') return null;
  const label = value.artifact ?? value.command ?? value.ref ?? value.id ?? value.path ?? value.summary ?? null;
  return typeof label === 'string' && label.trim() !== '' ? label.trim() : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectRecentWaiverDecisionRefs(decisionRecords = null, since = null, gate = null) {
  return (decisionRecords?.decisions ?? [])
    .filter((decision) => decision?.type === 'waiver')
    .filter((decision) => decision.status !== 'rejected')
    .filter((decision) => isAfter(decision.recorded_at, since))
    .filter((decision) => isGateRelatedRecord(decision, gate))
    .map((decision) => ({
      decision_id: decision.decision_id ?? null,
      source: decision.source ?? null,
      artifact: decision.artifact ?? null,
      recorded_at: decision.recorded_at ?? null
    }));
}

function collectRecentEvidenceRefs({ verificationEvidence = null, agentReviews = null, since = null, gate = null } = {}) {
  const refs = [];
  for (const command of verificationEvidence?.commands ?? []) {
    if (!isAfter(command.recorded_at ?? command.created_at ?? verificationEvidence.updated_at, since)) continue;
    if (!isPassingEvidenceStatus(command.status)) continue;
    if (!isGateRelatedRecord(command, gate)) continue;
    refs.push({
      kind: 'verification_command',
      command: command.command ?? null,
      status: command.status ?? null,
      recorded_at: command.recorded_at ?? command.created_at ?? verificationEvidence.updated_at ?? null
    });
  }
  for (const stage of agentReviews?.stages ?? []) {
    for (const role of stage.roles ?? []) {
      if (!isAfter(role.recorded_at ?? role.updated_at ?? stage.updated_at, since)) continue;
      if (!isPassingEvidenceStatus(role.status)) continue;
      if (!isGateRelatedRecord({ ...role, stage: stage.stage }, gate)) continue;
      refs.push({
        kind: 'agent_review',
        stage: stage.stage ?? null,
        role: role.role ?? null,
        status: role.status ?? null,
        recorded_at: role.recorded_at ?? role.updated_at ?? stage.updated_at ?? null
      });
    }
  }
  return refs;
}

function isPassingEvidenceStatus(status) {
  return ['pass', 'passed', 'success', 'ok'].includes(String(status ?? '').toLowerCase());
}

function isSourceResolutionCandidate(gate = null) {
  const haystack = [
    gate?.id,
    gate?.type,
    gate?.label,
    gate?.reason
  ].filter(Boolean).join(' ').toLowerCase();
  if (!haystack) return true;
  return !/(agent|review|evidence|verification|spec|design|decision|split|scope|lifecycle|definition_of_done|senior_gap|responsibility_authority|runtime_cost|telemetry)/.test(haystack);
}

function isGateRelatedRecord(record = null, gate = null) {
  if (!gate?.id && !gate?.type && !gate?.label) return true;
  const tokens = gateTokens(gate);
  if (tokens.length === 0) return true;
  const haystack = JSON.stringify(record ?? {}).toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function gateTokens(gate) {
  return [
    gate?.id,
    gate?.type,
    gate?.label,
    gate?.responsibility_id,
    gate?.contract_id
  ]
    .filter(Boolean)
    .flatMap((value) => {
      const raw = String(value).toLowerCase();
      return [raw, raw.replace(/^gate:/, '')];
    })
    .filter((value) => value.includes(':') || value.includes('_') || value.length >= 6)
    .filter((value, index, values) => value && values.indexOf(value) === index);
}

function isAfter(value, since) {
  if (!value) return !since;
  if (!since) return true;
  const time = new Date(value).getTime();
  const sinceTime = new Date(since).getTime();
  if (!Number.isFinite(time) || !Number.isFinite(sinceTime)) return false;
  return time > sinceTime;
}

function isWithinSince(value, since) {
  if (!since) return true;
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= since.getTime();
}

function latestIso(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}
