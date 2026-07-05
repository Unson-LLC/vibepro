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
const UNRESOLVED_STATUSES = new Set([
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

export function getGateOutcomeLedgerPath(repoRoot) {
  return path.join(getWorkspaceDir(repoRoot), 'gate-outcomes', 'ledger.json');
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
