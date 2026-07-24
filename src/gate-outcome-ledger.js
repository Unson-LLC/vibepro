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
export function summarizeGateRoi(ledger, { since = null } = {}) {
  const sinceDate = since instanceof Date ? since : null;
  const entries = (ledger?.entries ?? []).filter((entry) => isWithinSince(entry.resolved_at, sinceDate));
  const byGate = new Map();
  let unclassifiedTotal = 0;
  for (const entry of entries) {
    const gateId = entry.gate_id ?? 'unknown_gate';
    if (!byGate.has(gateId)) {
      byGate.set(gateId, {
        gate_id: gateId,
        count: 0,
        classifications: Object.fromEntries([...GATE_OUTCOMES].map((outcome) => [outcome, 0])),
        unclassified_count: 0
      });
    }
    const item = byGate.get(gateId);
    const rawOutcome = entry.outcome ?? null;
    const outcome = rawOutcome && GATE_OUTCOMES.has(String(rawOutcome).trim())
      ? String(rawOutcome).trim()
      : 'unclassified';
    item.count += 1;
    item.classifications[outcome] += 1;
    if (outcome === 'unclassified') {
      item.unclassified_count += 1;
      unclassifiedTotal += 1;
    }
  }
  const gates = [...byGate.values()].sort((a, b) => a.gate_id.localeCompare(b.gate_id));
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    entry_count: entries.length,
    unclassified_count: unclassifiedTotal,
    gates
  };
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
  const entries = buildResolvedGateOutcomeEntries(repoRoot, options);
  if (entries.length === 0) {
    return {
      schema_version: LEDGER_SCHEMA_VERSION,
      status: 'no_resolved_gates',
      artifact: toWorkspaceRelative(repoRoot, getGateOutcomeLedgerPath(repoRoot)),
      entries: []
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
    entries
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
      overrideOutcome: options.overrideOutcome
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
  const overrideOutcome = normalizeOutcome(options.overrideOutcome);
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
  const gate = options.gate ?? null;
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

function hasSourceChanges(git = null, fileGroups = null) {
  if ((fileGroups?.source?.count ?? 0) > 0) return true;
  return (git?.changed_files ?? []).some((file) => SOURCE_FILE_RE.test(file.path ?? file));
}

function hasOnlyRewordingChanges(git = null) {
  const changed = (git?.changed_files ?? [])
    .map((file) => file.path ?? file)
    .filter(Boolean)
    .filter((file) => !file.startsWith('.vibepro/'));
  if (changed.length === 0) return false;
  return changed.every((file) => DOC_FILE_RE.test(file));
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
