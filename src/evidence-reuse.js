import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { toWorkspaceRelative } from './workspace.js';
import { resolvePrArtifactFile } from './artifact-routing.js';

export const EVIDENCE_REUSE_VERSION = '0.1.0';
export const EVIDENCE_REUSE_MODEL = 'vibepro-evidence-summary-reuse-v1';
export const ARTIFACT_VALUE_LEDGER_MODEL = 'vibepro-artifact-value-ledger-v1';
export const SESSION_ATTRIBUTION_LEDGER_MODEL = 'vibepro-session-attribution-ledger-v1';

const FRESH_REUSE_STATUSES = new Set(['hit', 'miss']);

export async function readEvidenceReuseIfExists(repoRoot, storyId) {
  if (!storyId) return null;
  const filePath = await getEvidenceReusePath(repoRoot, storyId);
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function getEvidenceReusePath(repoRoot, storyId) {
  return resolvePrArtifactFile(path.resolve(repoRoot), storyId, 'evidence-reuse.json');
}

export function buildEvidenceReuse({
  repoRoot,
  story = null,
  git = null,
  prContext = null,
  evidencePlan = null,
  decisionIndex = null,
  verificationEvidence = null,
  previousReuse = null,
  artifacts = {},
  decisionUsage = null,
  usedAsFresh = false,
  createdAt = new Date().toISOString()
} = {}) {
  const root = repoRoot ? path.resolve(repoRoot) : null;
  const storyId = story?.story_id ?? evidencePlan?.story_id ?? decisionIndex?.story_id ?? previousReuse?.story_id ?? null;
  const keyInputs = buildEvidenceKeyInputs({
    storyId,
    git,
    prContext,
    evidencePlan,
    verificationEvidence
  });
  const evidenceKey = buildEvidenceKey(keyInputs);
  const comparison = compareEvidenceReuse(previousReuse, keyInputs, evidenceKey);
  const fullEvidence = buildFullEvidenceReuse({
    storyId,
    evidenceKey,
    previousReuse,
    decisionIndex,
    evidencePlan,
    prContext,
    artifacts,
    root
  });
  const summaryArtifacts = normalizeSummaryArtifacts({ root, artifacts, storyId });
  const sessionAttribution = buildSessionAttributionLedger({
    storyId,
    git,
    prContext,
    evidencePlan,
    createdAt
  });
  const artifactValueLedger = buildArtifactValueLedger({
    storyId,
    git,
    evidenceKey,
    comparison,
    summaryArtifacts,
    fullEvidence,
    sessionAttribution,
    decisionUsage,
    createdAt
  });
  const freshness = buildFreshnessStatus(comparison, { usedAsFresh });

  return {
    schema_version: EVIDENCE_REUSE_VERSION,
    model: EVIDENCE_REUSE_MODEL,
    story_id: storyId,
    created_at: createdAt,
    evidence_key: evidenceKey,
    key_inputs: keyInputs,
    status: comparison.status,
    reason: comparison.reason,
    stale_reasons: comparison.stale_reasons,
    fresh_use_allowed: freshness.fresh_use_allowed,
    used_as_fresh: usedAsFresh === true,
    gate_status: freshness.gate_status,
    summary_artifacts: summaryArtifacts,
    session_attribution_ledger: sessionAttribution,
    artifact_value_ledger: artifactValueLedger,
    review_input_summary: {
      preferred_order: [
        summaryArtifacts.evidence_reuse,
        summaryArtifacts.decision_index,
        summaryArtifacts.evidence_plan,
        summaryArtifacts.pr_prepare,
        summaryArtifacts.gate_dag
      ].filter(Boolean),
      first_class_handoff: true,
      full_artifact_required: evidencePlan?.evidence_depth === 'full' || (evidencePlan?.targeted_full_surfaces?.length ?? 0) > 0
    },
    full_evidence: fullEvidence,
    previous: previousReuse ? {
      evidence_key: previousReuse.evidence_key ?? null,
      status: previousReuse.status ?? null,
      created_at: previousReuse.created_at ?? null
    } : null
  };
}

export function summarizeEvidenceReuse(reuse) {
  if (!reuse) return null;
  return {
    schema_version: EVIDENCE_REUSE_VERSION,
    model: EVIDENCE_REUSE_MODEL,
    story_id: reuse.story_id ?? null,
    evidence_key: reuse.evidence_key ?? null,
    status: reuse.status ?? null,
    reason: reuse.reason ?? null,
    stale_reasons: reuse.stale_reasons ?? [],
    fresh_use_allowed: reuse.fresh_use_allowed === true,
    used_as_fresh: reuse.used_as_fresh === true,
    gate_status: reuse.gate_status ?? null,
    decision_outcome_summary: reuse.decision_outcome_summary ?? null,
    artifact_value_ledger: reuse.artifact_value_ledger ? summarizeArtifactValueLedger(reuse.artifact_value_ledger) : null,
    session_attribution_ledger: reuse.session_attribution_ledger ? summarizeSessionAttributionLedger(reuse.session_attribution_ledger) : null,
    verification_summary_fingerprint: reuse.key_inputs?.verification_summary_fingerprint ?? null,
    verification_evidence_updated_at: reuse.key_inputs?.verification_evidence_updated_at ?? null,
    verification_command_timestamps: reuse.key_inputs?.verification_command_timestamps ?? [],
    full_evidence: reuse.full_evidence ? {
      status: reuse.full_evidence.status ?? null,
      generation_count: reuse.full_evidence.generation_count ?? null,
      generation_count_scope: reuse.full_evidence.generation_count_scope ?? null,
      same_key_generation_count: reuse.full_evidence.same_key_generation_count ?? reuse.full_evidence.generation_count ?? null,
      cumulative_generation_count: reuse.full_evidence.cumulative_generation_count ?? reuse.full_evidence.generation_count ?? null,
      digest: reuse.full_evidence.digest ?? null,
      reference: reuse.full_evidence.reference ?? null
    } : null,
    summary_artifacts: reuse.summary_artifacts ?? null
  };
}

export function buildArtifactValueLedger({
  storyId = null,
  git = null,
  evidenceKey = null,
  comparison = null,
  summaryArtifacts = null,
  fullEvidence = null,
  sessionAttribution = null,
  decisionUsage = null,
  createdAt = new Date().toISOString()
} = {}) {
  const artifacts = [
    {
      key: 'evidence_reuse',
      path: summaryArtifacts?.evidence_reuse,
      value_class: 'reuse_freshness',
      consumer: 'review_prepare',
      decision_supported: 'Use current evidence summary as first review input only when bound to the current evidence key.'
    },
    {
      key: 'decision_index',
      path: summaryArtifacts?.decision_index,
      value_class: 'decision_trace',
      consumer: 'senior_gap_judgment',
      decision_supported: 'Reconstruct the PR decision path without rereading every generated artifact.'
    },
    {
      key: 'evidence_plan',
      path: summaryArtifacts?.evidence_plan,
      value_class: 'evidence_scope',
      consumer: 'gate_dag',
      decision_supported: 'Bound which evidence is intentionally full-depth versus summary-only.'
    },
    {
      key: 'pr_prepare',
      path: summaryArtifacts?.pr_prepare,
      value_class: 'handoff_packet',
      consumer: 'pr_create',
      decision_supported: 'Carry current gate readiness and next commands into PR creation.'
    },
    {
      key: 'gate_dag',
      path: summaryArtifacts?.gate_dag,
      value_class: 'blocking_surface',
      consumer: 'execute_merge',
      decision_supported: 'Prevent merge when required gates are unresolved or stale.'
    }
  ].filter((entry) => entry.path);

  const entries = artifacts.map((entry) => ({
    artifact: entry.path,
    artifact_key: entry.key,
    decision_id: `${storyId ?? 'unknown-story'}:${entry.key}`,
    value_class: entry.value_class,
    consumer: entry.consumer,
    consumer_gate: `gate:${entry.consumer}`,
    decision_supported: entry.decision_supported,
    decision_changed: decisionUsage?.[entry.key]?.decision_changed ?? null,
    head_sha: git?.head_sha ?? null,
    base_sha: git?.base_sha ?? null,
    evidence_key: evidenceKey,
    freshness_status: comparison?.status ?? null,
    semantic_value_status: 'decision_bound',
    artifact_volume_risk: 'bounded_by_linked_canonical_artifact',
    token_estimate: estimateTokenCount(entry),
    line_count: null
  }));

  return {
    schema_version: EVIDENCE_REUSE_VERSION,
    model: ARTIFACT_VALUE_LEDGER_MODEL,
    story_id: storyId,
    generated_at: createdAt,
    head_binding: {
      base_ref: git?.base_ref ?? null,
      base_sha: git?.base_sha ?? null,
      head_ref: git?.head_ref ?? null,
      head_sha: git?.head_sha ?? null,
      status: git?.head_sha ? 'current_head_bound' : 'unknown_head'
    },
    status: entries.length > 0 ? 'present' : 'missing',
    evidence_key: evidenceKey,
    full_evidence_status: fullEvidence?.status ?? null,
    full_evidence_generation_count: fullEvidence?.generation_count ?? null,
    full_evidence_cumulative_generation_count: fullEvidence?.cumulative_generation_count ?? null,
    session_attribution_status: sessionAttribution?.status ?? null,
    session_attribution_confidence: sessionAttribution?.confidence ?? null,
    entries,
    summary: {
      artifact_count: entries.length,
      decision_bound_count: entries.filter((entry) => entry.semantic_value_status === 'decision_bound').length,
      decision_changed_count: entries.filter((entry) => entry.decision_changed === true).length,
      decision_change_unconfirmed_count: entries.filter((entry) => entry.decision_changed == null).length,
      unused_artifact_count: entries.filter((entry) => entry.decision_changed === false).length,
      linked_consumer_count: new Set(entries.map((entry) => entry.consumer).filter(Boolean)).size,
      total_token_estimate: entries.reduce((sum, entry) => sum + (entry.token_estimate ?? 0), 0)
    }
  };
}

export function buildSessionAttributionLedger({
  storyId = null,
  git = null,
  prContext = null,
  evidencePlan = null,
  createdAt = new Date().toISOString()
} = {}) {
  const explicit = prContext?.session_attribution
    ?? prContext?.session_attribution_ledger
    ?? evidencePlan?.session_attribution
    ?? evidencePlan?.session_attribution_ledger
    ?? null;
  const sessions = normalizeSessionAttributionEntries(explicit?.sessions ?? explicit?.entries ?? explicit);
  if (sessions.length > 0) {
    return {
      schema_version: EVIDENCE_REUSE_VERSION,
      model: SESSION_ATTRIBUTION_LEDGER_MODEL,
      story_id: storyId,
      generated_at: createdAt,
      status: 'explicit',
      confidence: 'high',
      reason: 'Explicit session attribution was supplied to PR prepare.',
      head_sha: git?.head_sha ?? null,
      sessions,
      unattributed_count: sessions.filter((session) => session.status === 'unattributed').length
    };
  }
  return {
    schema_version: EVIDENCE_REUSE_VERSION,
    model: SESSION_ATTRIBUTION_LEDGER_MODEL,
    story_id: storyId,
    generated_at: createdAt,
    status: 'not_collected_in_pr_prepare',
    confidence: 'none',
    reason: 'PR prepare did not receive Codex session attribution; downstream usage mentions must not be treated as clean product-value adoption.',
    head_sha: git?.head_sha ?? null,
    sessions: [],
    unattributed_count: 0
  };
}

export function buildEvidenceReuseGate(reuse) {
  const staleUsedAsFresh = reuse?.status === 'stale' && reuse?.used_as_fresh === true;
  return {
    id: 'gate:evidence_reuse_freshness',
    type: 'artifact_freshness_gate',
    label: 'Evidence Summary Reuse Freshness',
    required: true,
    status: staleUsedAsFresh ? 'failed' : 'passed',
    reason: staleUsedAsFresh
      ? 'Stale evidence reuse artifact was marked as used fresh.'
      : reuse?.status === 'stale'
        ? 'Previous reusable evidence was stale and was not used as fresh.'
        : `Evidence reuse status is ${reuse?.status ?? 'unknown'}.`,
    evidence: reuse ? {
      artifact: reuse.summary_artifacts?.evidence_reuse ?? null,
      evidence_key: reuse.evidence_key ?? null,
      status: reuse.status ?? null,
      verification_summary_fingerprint: reuse.key_inputs?.verification_summary_fingerprint ?? null,
      verification_evidence_updated_at: reuse.key_inputs?.verification_evidence_updated_at ?? null,
      verification_command_timestamps: reuse.key_inputs?.verification_command_timestamps ?? [],
      stale_reasons: reuse.stale_reasons ?? []
    } : null
  };
}

export function evaluateEvidenceReuseForReview({ reuse = null, gitContext = null, verificationEvidence = null } = {}) {
  if (!reuse) {
    return {
      status: 'missing',
      fresh: false,
      first_input: false,
      reason: 'No evidence-reuse.json artifact was found.'
    };
  }
  const currentHeadSha = normalizeString(gitContext?.head_sha);
  const artifactHeadSha = normalizeString(reuse.key_inputs?.head_sha);
  const headMatches = Boolean(currentHeadSha && artifactHeadSha && currentHeadSha === artifactHeadSha);
  const staleReasons = [];
  if (!headMatches) {
    staleReasons.push({
      field: 'head_sha',
      previous: artifactHeadSha,
      current: currentHeadSha,
      reason: 'review prepare current HEAD does not match evidence key HEAD'
    });
  }
  const currentVerificationSummary = summarizeVerificationEvidence(verificationEvidence);
  const currentVerificationFingerprint = fingerprintValue(currentVerificationSummary);
  const verificationReasons = [
    staleReason(
      'verification_summary_fingerprint',
      reuse.key_inputs?.verification_summary_fingerprint,
      currentVerificationFingerprint
    ),
    staleReason(
      'verification_evidence_updated_at',
      reuse.key_inputs?.verification_evidence_updated_at,
      currentVerificationSummary.updated_at
    ),
    staleReason(
      'verification_command_timestamps',
      reuse.key_inputs?.verification_command_timestamps,
      currentVerificationSummary.command_timestamps
    )
  ].filter(Boolean).map((reason) => ({
    ...reason,
    reason: `review prepare current ${reason.field} does not match evidence key input`
  }));
  staleReasons.push(...verificationReasons);
  const baseFresh = FRESH_REUSE_STATUSES.has(reuse.status) && reuse.fresh_use_allowed === true;
  const fresh = baseFresh && headMatches && verificationReasons.length === 0;
  return {
    status: fresh ? 'fresh' : 'stale',
    fresh,
    first_input: fresh,
    evidence_key: reuse.evidence_key ?? null,
    verification_summary_fingerprint: reuse.key_inputs?.verification_summary_fingerprint ?? null,
    current_verification_summary_fingerprint: currentVerificationFingerprint,
    verification_evidence_updated_at: reuse.key_inputs?.verification_evidence_updated_at ?? null,
    current_verification_evidence_updated_at: currentVerificationSummary.updated_at,
    verification_command_timestamps: reuse.key_inputs?.verification_command_timestamps ?? [],
    current_verification_command_timestamps: currentVerificationSummary.command_timestamps,
    artifact_status: reuse.status ?? null,
    artifact: reuse.summary_artifacts?.evidence_reuse ?? null,
    preferred_order: fresh ? (reuse.review_input_summary?.preferred_order ?? []) : [],
    // Freshness controls whether the reusable evidence bundle may be the first
    // review input.  The decision-outcome projection is a separate, bounded
    // current-HEAD surface and remains useful when only verification timestamps
    // changed after pr prepare.  Never expose it across a HEAD mismatch.
    decision_outcome_summary: headMatches ? (reuse.decision_outcome_summary ?? null) : null,
    stale_reasons: fresh ? [] : [
      ...(Array.isArray(reuse.stale_reasons) ? reuse.stale_reasons : []),
      ...staleReasons
    ],
    reason: fresh
      ? 'Fresh evidence summary/index can be used as first review input.'
      : 'Evidence reuse artifact is not fresh for the current review context.'
  };
}

export function buildEvidenceKeyInputs({
  storyId = null,
  git = null,
  prContext = null,
  evidencePlan = null,
  verificationEvidence = null
} = {}) {
  const specFingerprint = fingerprintValue({
    inferred_spec: prContext?.inferred_spec ?? null,
    spec_drift: summarizeSpecDrift(prContext?.spec_drift)
  });
  const riskSurfaceFingerprint = fingerprintValue({
    evidence_depth: evidencePlan?.evidence_depth ?? null,
    risk_signals: evidencePlan?.risk_signals ?? [],
    targeted_full_surfaces: evidencePlan?.targeted_full_surfaces ?? [],
    change_classification: {
      profile: prContext?.change_classification?.profile ?? null,
      risk_surfaces: prContext?.change_classification?.risk_surfaces ?? []
    },
    engineering_judgment: {
      route_type: prContext?.engineering_judgment?.route_type ?? null,
      active_axes: prContext?.engineering_judgment?.active_axes ?? []
    },
    pr_route: {
      route_type: prContext?.pr_route?.route_type ?? null,
      required_gates: prContext?.pr_route?.required_gates ?? []
    }
  });
  const verificationSummary = summarizeVerificationEvidence(verificationEvidence);
  const verificationSummaryFingerprint = fingerprintValue(verificationSummary);
  const plannerVersion = evidencePlan?.planner_version ?? null;
  return {
    story_id: storyId,
    base_ref: git?.base_ref ?? null,
    base_sha: git?.base_sha ?? null,
    head_ref: git?.head_ref ?? null,
    head_sha: git?.head_sha ?? null,
    spec_fingerprint: specFingerprint,
    risk_surface_fingerprint: riskSurfaceFingerprint,
    verification_summary_fingerprint: verificationSummaryFingerprint,
    verification_evidence_updated_at: verificationSummary.updated_at,
    verification_command_timestamps: verificationSummary.command_timestamps,
    evidence_depth: evidencePlan?.evidence_depth ?? null,
    planner_version: plannerVersion
  };
}

export function buildEvidenceKey(keyInputs) {
  return `evk_${sha256Hex(stableStringify(keyInputs)).slice(0, 32)}`;
}

function compareEvidenceReuse(previousReuse, keyInputs, evidenceKey) {
  if (!previousReuse) {
    return {
      status: 'miss',
      reason: 'no_previous_reuse_artifact',
      stale_reasons: []
    };
  }
  if (previousReuse.evidence_key === evidenceKey) {
    return {
      status: 'hit',
      reason: 'evidence_key_match',
      stale_reasons: []
    };
  }
  const previousInputs = previousReuse.key_inputs ?? {};
  const staleReasons = [
    staleReason('head_sha', previousInputs.head_sha, keyInputs.head_sha),
    staleReason('spec_fingerprint', previousInputs.spec_fingerprint, keyInputs.spec_fingerprint),
    staleReason('verification_summary_fingerprint', previousInputs.verification_summary_fingerprint, keyInputs.verification_summary_fingerprint),
    staleReason('verification_evidence_updated_at', previousInputs.verification_evidence_updated_at, keyInputs.verification_evidence_updated_at),
    staleReason('verification_command_timestamps', previousInputs.verification_command_timestamps, keyInputs.verification_command_timestamps),
    staleReason('risk_surface_fingerprint', previousInputs.risk_surface_fingerprint, keyInputs.risk_surface_fingerprint),
    staleReason('base_sha', previousInputs.base_sha, keyInputs.base_sha),
    staleReason('planner_version', previousInputs.planner_version, keyInputs.planner_version)
  ].filter(Boolean);
  return {
    status: 'stale',
    reason: staleReasons.length > 0 ? 'evidence_key_inputs_changed' : 'evidence_key_changed',
    stale_reasons: staleReasons.length > 0
      ? staleReasons
      : [{ field: 'evidence_key', previous: previousReuse.evidence_key ?? null, current: evidenceKey, reason: 'evidence key changed' }]
  };
}

function buildFreshnessStatus(comparison, { usedAsFresh = false } = {}) {
  if (comparison.status === 'stale') {
    return {
      fresh_use_allowed: false,
      gate_status: usedAsFresh ? 'failed' : 'needs_refresh'
    };
  }
  return {
    fresh_use_allowed: true,
    gate_status: 'passed'
  };
}

function buildFullEvidenceReuse({ storyId, evidenceKey, previousReuse, decisionIndex, evidencePlan, prContext, artifacts, root }) {
  const digest = `sha256:${sha256Hex(stableStringify({
    story_id: storyId,
    evidence_key: evidenceKey,
    decision_index: summarizeDecisionIndexForDigest(decisionIndex),
    evidence_plan: summarizeEvidencePlanForDigest(evidencePlan),
    gate_summary: prContext?.gate_dag?.summary ?? null
  }))}`;
  const previousFull = previousReuse?.full_evidence ?? null;
  const sameKey = previousReuse?.evidence_key === evidenceKey;
  const previousCumulativeGenerationCount = normalizePositiveInteger(
    previousFull?.cumulative_generation_count ?? previousFull?.generation_count,
    0
  );
  const sameKeyGenerationCount = sameKey && previousFull?.digest
    ? normalizePositiveInteger(previousFull.same_key_generation_count ?? previousFull.generation_count, 1)
    : 1;
  const cumulativeGenerationCount = sameKey && previousFull?.digest
    ? normalizePositiveInteger(previousFull.cumulative_generation_count ?? previousFull.generation_count, sameKeyGenerationCount)
    : previousCumulativeGenerationCount + 1;
  const reference = root && artifacts.decisionIndexPath
    ? toWorkspaceRelative(root, artifacts.decisionIndexPath)
    : artifacts.decision_index ?? null;
  if (sameKey && previousFull?.digest) {
    return {
      status: 'reused',
      generation_count: sameKeyGenerationCount,
      generation_count_scope: 'same_evidence_key',
      same_key_generation_count: sameKeyGenerationCount,
      cumulative_generation_count: cumulativeGenerationCount,
      digest: previousFull.digest,
      reference: previousFull.reference ?? reference,
      reused_from: {
        evidence_key: previousReuse.evidence_key,
        created_at: previousReuse.created_at ?? null,
        digest: previousFull.digest
      }
    };
  }
  return {
    status: 'generated',
    generation_count: 1,
    generation_count_scope: 'same_evidence_key',
    same_key_generation_count: 1,
    cumulative_generation_count: cumulativeGenerationCount,
    digest,
    reference,
    reused_from: null
  };
}

function normalizeSummaryArtifacts({ root, artifacts, storyId }) {
  const workspaceArtifact = (key, fallbackName) => {
    if (Object.prototype.hasOwnProperty.call(artifacts, key) && artifacts[key] == null) return null;
    const value = artifacts[key];
    if (root && value) return toWorkspaceRelative(root, value);
    if (typeof value === 'string') return value;
    return storyId && fallbackName ? `.vibepro/pr/${storyId}/${fallbackName}` : null;
  };
  return {
    evidence_reuse: workspaceArtifact('evidenceReusePath', 'evidence-reuse.json'),
    evidence_plan: workspaceArtifact('evidencePlanPath', 'evidence-plan.json'),
    decision_index: workspaceArtifact('decisionIndexPath', 'decision-index.json'),
    pr_prepare: workspaceArtifact('jsonPath', 'pr-prepare.json'),
    gate_dag: workspaceArtifact('gateDagJsonPath', 'gate-dag.json')
  };
}

function summarizeArtifactValueLedger(ledger) {
  return {
    status: ledger.status ?? null,
    model: ledger.model ?? null,
    head_binding_status: ledger.head_binding?.status ?? null,
    artifact_count: ledger.summary?.artifact_count ?? ledger.entries?.length ?? 0,
    decision_bound_count: ledger.summary?.decision_bound_count ?? null,
    decision_changed_count: ledger.summary?.decision_changed_count ?? null,
    decision_change_unconfirmed_count: ledger.summary?.decision_change_unconfirmed_count ?? null,
    unused_artifact_count: ledger.summary?.unused_artifact_count ?? null,
    linked_consumer_count: ledger.summary?.linked_consumer_count ?? null,
    session_attribution_status: ledger.session_attribution_status ?? null,
    session_attribution_confidence: ledger.session_attribution_confidence ?? null,
    total_token_estimate: ledger.summary?.total_token_estimate ?? null
  };
}

function summarizeSessionAttributionLedger(ledger) {
  return {
    status: ledger.status ?? null,
    model: ledger.model ?? null,
    confidence: ledger.confidence ?? null,
    reason: ledger.reason ?? null,
    session_count: Array.isArray(ledger.sessions) ? ledger.sessions.length : 0,
    unattributed_count: ledger.unattributed_count ?? null
  };
}

function normalizeSessionAttributionEntries(input) {
  if (!input) return [];
  const entries = Array.isArray(input) ? input : [input];
  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      session_id: normalizeString(entry.session_id ?? entry.id),
      repo: normalizeString(entry.repo ?? entry.cwd ?? entry.repository),
      story_id: normalizeString(entry.story_id),
      status: normalizeString(entry.status) ?? (entry.story_id ? 'attributed' : 'unattributed'),
      confidence: normalizeString(entry.confidence) ?? 'medium',
      source: normalizeString(entry.source),
      tokens: Number.isFinite(Number(entry.tokens ?? entry.total_tokens)) ? Number(entry.tokens ?? entry.total_tokens) : null,
      elapsed_ms: Number.isFinite(Number(entry.elapsed_ms)) ? Number(entry.elapsed_ms) : null
    }));
}

function summarizeVerificationEvidence(verificationEvidence) {
  const commands = Array.isArray(verificationEvidence?.commands) ? verificationEvidence.commands : [];
  return {
    schema_version: verificationEvidence?.schema_version ?? null,
    story_id: verificationEvidence?.story_id ?? null,
    updated_at: verificationEvidence?.updated_at ?? null,
    command_count: commands.length,
    command_timestamps: commands.map((command) => ({
      kind: command.kind ?? null,
      executed_at: command.executed_at ?? null,
      git_recorded_at: command.git_context?.recorded_at ?? null
    })),
    commands: commands.map((command) => ({
      kind: command.kind ?? null,
      status: command.status ?? null,
      command: command.command ?? null,
      target: command.target ?? null,
      executed_at: command.executed_at ?? null,
      binding_status: command.binding?.status ?? null,
      head_sha: command.git_context?.head_sha ?? command.binding?.current_head_sha ?? null,
      git_recorded_at: command.git_context?.recorded_at ?? null,
      artifact_check_status: command.artifact_check?.status ?? null,
      observation_check_status: command.observation_check?.status ?? null
    }))
  };
}

function summarizeSpecDrift(specDrift) {
  if (!specDrift) return null;
  return {
    status: specDrift.status ?? null,
    drift_count: specDrift.drift_count ?? specDrift.summary?.drift_count ?? null,
    spec_count: specDrift.spec_count ?? specDrift.summary?.spec_count ?? null
  };
}

function summarizeEvidencePlanForDigest(evidencePlan) {
  if (!evidencePlan) return null;
  return {
    planner_version: evidencePlan.planner_version ?? null,
    evidence_depth: evidencePlan.evidence_depth ?? null,
    risk_signals: evidencePlan.risk_signals ?? [],
    targeted_full_surfaces: evidencePlan.targeted_full_surfaces ?? [],
    generated_artifacts: evidencePlan.generated_artifacts ?? [],
    skipped_artifacts: evidencePlan.skipped_artifacts ?? []
  };
}

function summarizeDecisionIndexForDigest(decisionIndex) {
  if (!decisionIndex) return null;
  return {
    story_id: decisionIndex.story_id ?? null,
    evidence_depth: decisionIndex.evidence_depth ?? null,
    git: decisionIndex.git ?? null,
    gate_summary: decisionIndex.gate_summary ?? null,
    engineering_judgment: decisionIndex.engineering_judgment ?? null,
    traceability_clause_coverage: decisionIndex.traceability_clause_coverage ?? null,
    split_plan: decisionIndex.split_plan ?? null
  };
}

function staleReason(field, previous, current) {
  if (stableStringify(previous) === stableStringify(current)) return null;
  return {
    field,
    previous: previous ?? null,
    current: current ?? null,
    reason: `${field} changed`
  };
}

function fingerprintValue(value) {
  return `sha256:${sha256Hex(stableStringify(value))}`;
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function estimateTokenCount(value) {
  return Math.ceil(stableStringify(value).length / 4);
}

function stableStringify(value) {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value) {
  if (Array.isArray(value)) return value.map(sortForStableStringify);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortForStableStringify(value[key])])
  );
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.trunc(parsed);
}
