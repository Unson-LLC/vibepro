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
  const verificationDescriptive = summarizeVerificationEvidence(verificationEvidence);
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
    // Base-only verdict (CRK-S-4 scope), isolated from the aggregate `status`
    // above so a consumer can tell "shared inputs drifted, invalidate every
    // role" apart from "only some role's own surface drifted" (CRK-S-2).
    // evaluateEvidenceReuseForReview gates each role's freshness on this,
    // not on the aggregate `status`/`fresh_use_allowed`.
    base_reuse: comparison.base_reuse,
    // Per-role reuse detail (CRK-S-5): which role's inspected content surface
    // (or, for a strict_head role, the HEAD) drove a hit/miss verdict this
    // round, keyed by `${stage}:${role}`. This is deliberately kept alongside
    // (not instead of) the top-level status/stale_reasons pair above so every
    // existing consumer of the aggregate fields keeps working unchanged.
    role_reuse: comparison.role_reuse,
    // Descriptive-only git coordinates for this build of the artifact. Not
    // part of buildEvidenceKeyInputs/evidenceKey (see CRK-S-1): a fix commit
    // must not by itself invalidate reuse. Kept here only so a HEAD-bound
    // consumer (e.g. decision_outcome_summary exposure below) can still tell
    // whether the artifact was generated at the reviewer's current HEAD.
    recorded_git: {
      base_ref: git?.base_ref ?? null,
      base_sha: git?.base_sha ?? null,
      head_ref: git?.head_ref ?? null,
      head_sha: git?.head_sha ?? null
    },
    // Descriptive-only verification wall-clock metadata (CRK-S-1/D2). Kept for
    // audit/reporting consumers (usage-report.js, canonical-audit.js) that
    // want to show when verification last ran; never used to decide
    // hit/miss/stale any more (see verification_summary_fingerprint in
    // key_inputs, which is content-only).
    verification_evidence_metadata: {
      updated_at: verificationDescriptive.updated_at,
      command_timestamps: verificationDescriptive.command_timestamps
    },
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
    verification_evidence_updated_at: reuse.verification_evidence_metadata?.updated_at ?? null,
    verification_command_timestamps: reuse.verification_evidence_metadata?.command_timestamps ?? [],
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
      verification_evidence_updated_at: reuse.verification_evidence_metadata?.updated_at ?? null,
      verification_command_timestamps: reuse.verification_evidence_metadata?.command_timestamps ?? [],
      stale_reasons: reuse.stale_reasons ?? []
    } : null
  };
}

// Role-aware freshness for `review prepare` (CRK-S-2/CRK-S-3/CRK-S-5). `reuse`
// is the evidence-reuse.json artifact as it existed at the last `pr prepare`.
// `currentRoleDigests` is freshly recomputed right now (see
// buildRoleContentDigests) from whatever each requested role last actually
// inspected, re-hashed against the CURRENT tree -- exactly the same mechanism
// PR #384's content-scoped review freshness already uses, just reused here
// for the evidence-reuse *key* rather than the review *result*.
export function evaluateEvidenceReuseForReview({
  reuse = null,
  gitContext = null,
  verificationEvidence = null,
  stage = null,
  roles = [],
  currentRoleDigests = {}
} = {}) {
  if (!reuse) {
    return {
      status: 'missing',
      fresh: false,
      first_input: false,
      reason: 'No evidence-reuse.json artifact was found.',
      by_role: {}
    };
  }
  // Gate on the BASE-only verdict (CRK-S-4 scope: base_sha/spec_fingerprint/
  // risk_surface_fingerprint/verification_summary_fingerprint/planner_version),
  // not on the aggregate `reuse.status`/`fresh_use_allowed`. The aggregate
  // folds per-role drift in too (see compareEvidenceReuse), so gating on it
  // here would mark every role stale the moment ANY single role's surface
  // changed -- exactly the full-panel re-review CRK-S-2 exists to prevent.
  // reuse.base_reuse is absent only for an artifact written before this
  // field existed; fall back to the old, more conservative aggregate check
  // rather than assuming freshness for such a legacy artifact.
  const baseFresh = reuse.base_reuse
    ? FRESH_REUSE_STATUSES.has(reuse.base_reuse.status)
    : (FRESH_REUSE_STATUSES.has(reuse.status) && reuse.fresh_use_allowed === true);
  const verificationDescriptive = summarizeVerificationEvidence(verificationEvidence);
  const currentVerificationFingerprint = fingerprintValue(buildVerificationContentSummary(verificationEvidence));
  const verificationStaleReason = staleReason(
    'verification_summary_fingerprint',
    reuse.key_inputs?.verification_summary_fingerprint,
    currentVerificationFingerprint
  );
  const sharedStaleReasons = verificationStaleReason
    ? [{ ...verificationStaleReason, reason: 'review prepare current verification content no longer matches evidence key input' }]
    : [];

  // decision_outcome_summary is a bounded current-HEAD projection, independent
  // of content-surface reuse. It must never be handed out across a HEAD
  // mismatch, so this check stays HEAD-based regardless of role freshness
  // mode (see the doc comment on recorded_git above).
  const currentHeadSha = normalizeString(gitContext?.head_sha);
  const recordedHeadSha = normalizeString(reuse.recorded_git?.head_sha);
  const headMatches = Boolean(currentHeadSha && recordedHeadSha && currentHeadSha === recordedHeadSha);

  const roleList = Array.isArray(roles) && roles.length > 0
    ? [...new Set(roles)]
    : [...new Set(Object.keys(currentRoleDigests ?? {}).map((key) => key.split(':').slice(1).join(':')).filter(Boolean))];

  const byRole = {};
  for (const role of roleList) {
    const roleKey = stage ? `${stage}:${role}` : role;
    const current = currentRoleDigests?.[roleKey] ?? null;
    const previous = reuse.key_inputs?.role_surface_digests?.[roleKey] ?? null;
    // reuse.role_reuse[roleKey] is the artifact's OWN comparison against the
    // PRIOR artifact -- i.e. "did this role's digest drift in the round that
    // produced the artifact now on disk." That is a different time window
    // than the previous/current digest check below (which catches drift
    // AFTER this artifact was built, e.g. `review prepare` running without
    // an intervening `pr prepare`). A role must be fresh in BOTH windows:
    // once `pr prepare` re-bakes the artifact right after a fix commit, its
    // OWN key_inputs already reflect the post-fix digest, so the
    // previous/current check below alone would trivially "match" and miss
    // the very drift role_reuse just recorded -- reusing role_reuse here
    // closes that gap instead of re-deriving a second, weaker signal.
    const artifactRoleReuse = reuse.role_reuse?.[roleKey] ?? null;
    const roleStaleReasons = [
      ...sharedStaleReasons,
      ...(Array.isArray(artifactRoleReuse?.stale_reasons) ? artifactRoleReuse.stale_reasons : [])
    ];
    const isStrictHead = previous?.mode === 'strict_head' || current?.mode === 'strict_head';
    if (current && !previous) {
      // This role now has real inspected content (or, for strict_head, a
      // known HEAD) but the evidence-reuse artifact's own key_inputs never
      // recorded a baseline for it -- e.g. it was reviewed for the first
      // time after the last `pr prepare` ran. There is no positive evidence
      // the cached bundle ever accounted for this role, so do not default it
      // to fresh just because the shared base happens to be clean. A role
      // that has never been reviewed at all (current also absent) is
      // unaffected by this branch and still falls through to baseFresh only.
      roleStaleReasons.push({
        field: `role_surface:${roleKey}`,
        previous: null,
        current: current.digest,
        reason: 'role has no previous evidence-reuse baseline to confirm freshness against'
      });
    } else if (!current && !previous) {
      // Zero positive evidence in EITHER direction: no freshly recomputed
      // inspected-content-surface digest (or HEAD, for strict_head) for this
      // role right now, AND the evidence-reuse artifact's own key_inputs
      // never recorded a baseline for it either -- its literal first-ever
      // review at this stage, or a role newly added to the roster in a round
      // where nothing else happened to drift (see the architecture doc's
      // "Per-role digest source" section). The shared base being clean only
      // means the SHARED inputs did not change; it says nothing about
      // whether this specific role's evidence was ever validated, because
      // there is nothing on either side to compare. Do not default this to
      // fresh just because baseFresh happens to be true -- that would
      // conflate "no drift evidence exists" with "freshness was confirmed".
      // This is also what keeps a future shape change to
      // role.content_binding/freshness_policy (duck-typed in
      // buildRoleContentDigests) fail-closed rather than fail-open: if that
      // shape drift makes every role's digest come back null, every role
      // lands here instead of silently inheriting baseFresh.
      roleStaleReasons.push({
        field: `role_surface:${roleKey}`,
        previous: null,
        current: null,
        reason: 'role has neither a current inspected content surface nor a previous evidence-reuse baseline: there is no positive evidence to confirm this role is fresh'
      });
    } else if (isStrictHead) {
      if (!headMatches) {
        roleStaleReasons.push({
          field: `role_surface:${roleKey}`,
          previous: previous?.digest ?? recordedHeadSha,
          current: current?.digest ?? currentHeadSha,
          reason: 'strict HEAD role: review prepare current HEAD does not match evidence key HEAD'
        });
      }
    } else if (previous && current && previous.digest !== current.digest) {
      roleStaleReasons.push({
        field: `role_surface:${roleKey}`,
        previous: previous.digest,
        current: current.digest,
        reason: 'inspected content surface changed since evidence reuse artifact was generated'
      });
    }
    const roleHeadOk = isStrictHead ? headMatches : true;
    const roleFresh = baseFresh && roleHeadOk && roleStaleReasons.length === 0;
    byRole[role] = {
      status: roleFresh ? 'fresh' : 'stale',
      fresh: roleFresh,
      first_input: roleFresh,
      evidence_key: reuse.evidence_key ?? null,
      verification_summary_fingerprint: reuse.key_inputs?.verification_summary_fingerprint ?? null,
      current_verification_summary_fingerprint: currentVerificationFingerprint,
      verification_evidence_updated_at: reuse.verification_evidence_metadata?.updated_at ?? null,
      current_verification_evidence_updated_at: verificationDescriptive.updated_at,
      verification_command_timestamps: reuse.verification_evidence_metadata?.command_timestamps ?? [],
      current_verification_command_timestamps: verificationDescriptive.command_timestamps,
      artifact_status: reuse.status ?? null,
      artifact: reuse.summary_artifacts?.evidence_reuse ?? null,
      preferred_order: roleFresh ? (reuse.review_input_summary?.preferred_order ?? []) : [],
      decision_outcome_summary: headMatches ? (reuse.decision_outcome_summary ?? null) : null,
      role_freshness_mode: current?.mode ?? previous?.mode ?? null,
      role_digest: current?.digest ?? null,
      role_previous_digest: previous?.digest ?? null,
      stale_reasons: roleFresh ? [] : [
        ...(Array.isArray(reuse.stale_reasons) ? reuse.stale_reasons : []),
        ...roleStaleReasons
      ],
      reason: roleFresh
        ? 'Fresh evidence summary/index can be used as first review input.'
        : 'Evidence reuse artifact is not fresh for the current review context.'
    };
  }

  const roleVerdicts = Object.values(byRole);
  const aggregateFresh = roleVerdicts.length > 0
    ? roleVerdicts.every((entry) => entry.fresh)
    : baseFresh && headMatches && sharedStaleReasons.length === 0;
  const aggregateStaleReasons = roleVerdicts.length > 0
    ? dedupeStaleReasons(roleVerdicts.flatMap((entry) => entry.stale_reasons))
    : sharedStaleReasons;

  return {
    status: aggregateFresh ? 'fresh' : 'stale',
    fresh: aggregateFresh,
    first_input: aggregateFresh,
    evidence_key: reuse.evidence_key ?? null,
    verification_summary_fingerprint: reuse.key_inputs?.verification_summary_fingerprint ?? null,
    current_verification_summary_fingerprint: currentVerificationFingerprint,
    verification_evidence_updated_at: reuse.verification_evidence_metadata?.updated_at ?? null,
    current_verification_evidence_updated_at: verificationDescriptive.updated_at,
    verification_command_timestamps: reuse.verification_evidence_metadata?.command_timestamps ?? [],
    current_verification_command_timestamps: verificationDescriptive.command_timestamps,
    artifact_status: reuse.status ?? null,
    artifact: reuse.summary_artifacts?.evidence_reuse ?? null,
    preferred_order: aggregateFresh ? (reuse.review_input_summary?.preferred_order ?? []) : [],
    decision_outcome_summary: headMatches ? (reuse.decision_outcome_summary ?? null) : null,
    stale_reasons: aggregateFresh ? [] : dedupeStaleReasons([
      ...(Array.isArray(reuse.stale_reasons) ? reuse.stale_reasons : []),
      ...aggregateStaleReasons
    ]),
    reason: aggregateFresh
      ? 'Fresh evidence summary/index can be used as first review input.'
      : 'Evidence reuse artifact is not fresh for the current review context.',
    by_role: byRole
  };
}

function dedupeStaleReasons(reasons) {
  const seen = new Map();
  for (const reason of reasons) {
    if (!reason) continue;
    const key = `${reason.field ?? ''}::${reason.reason ?? ''}::${stableStringify(reason.previous)}::${stableStringify(reason.current)}`;
    if (!seen.has(key)) seen.set(key, reason);
  }
  return [...seen.values()];
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
  // Content-based only (D2): no updated_at/executed_at/git_recorded_at/head_sha.
  // A verification re-run that reproduces the same command/target/status must
  // not, by itself, change this fingerprint -- otherwise every re-run would
  // still force a full reuse miss even after CRK-S-1 removes head_sha/head_ref.
  const verificationSummaryFingerprint = fingerprintValue(buildVerificationContentSummary(verificationEvidence));
  const plannerVersion = evidencePlan?.planner_version ?? null;
  // Per-role content-surface (or, for a strict_head role, HEAD) digest (CRK-S-1
  // / D1 / D3). Sourced from the already-computed per-role content_binding on
  // prContext.agent_reviews.stages[].roles[] -- the same content-scoped
  // freshness machinery PR #384 built for review results (src/content-binding.js
  // via src/agent-review.js buildStageSummary) -- rather than re-deriving a
  // second, independent notion of "what did this role inspect."
  const roleSurfaceDigests = buildRoleContentDigests(prContext?.agent_reviews?.stages, {
    headSha: git?.head_sha ?? null
  });
  return {
    story_id: storyId,
    base_ref: git?.base_ref ?? null,
    base_sha: git?.base_sha ?? null,
    spec_fingerprint: specFingerprint,
    risk_surface_fingerprint: riskSurfaceFingerprint,
    verification_summary_fingerprint: verificationSummaryFingerprint,
    evidence_depth: evidencePlan?.evidence_depth ?? null,
    planner_version: plannerVersion,
    role_surface_digests: roleSurfaceDigests
  };
}

// Extracts a `${stage}:${role}` -> {mode, digest} map from an array of stage
// summaries shaped like buildStageSummary()'s return value (agent-review.js):
// prContext.agent_reviews.stages for the pr-prepare/key-build side, or a
// single freshly-built `[summary]` for the review-prepare/evaluation side.
// A role is included only once it has an established content surface (or, for
// strict_head, once a headSha is available) -- a role with no prior recorded
// review has nothing to reuse yet, so it is intentionally left out and falls
// back to the shared base-only freshness check (see evaluateEvidenceReuseForReview).
export function buildRoleContentDigests(stageSummaries = [], { headSha = null } = {}) {
  const digests = {};
  for (const stageSummary of Array.isArray(stageSummaries) ? stageSummaries : []) {
    const stage = stageSummary?.stage;
    if (!stage) continue;
    for (const role of Array.isArray(stageSummary?.roles) ? stageSummary.roles : []) {
      const roleName = role?.role;
      if (!roleName) continue;
      const key = `${stage}:${roleName}`;
      const effectiveMode = role?.freshness_policy?.effective_mode === 'strict_head' ? 'strict_head' : 'content_surface';
      if (effectiveMode === 'strict_head') {
        const normalizedHead = normalizeString(headSha);
        if (!normalizedHead) continue;
        digests[key] = { mode: 'strict_head', digest: normalizedHead };
        continue;
      }
      const surfaceHash = role?.content_binding?.current_surface_hash
        ?? role?.content_binding?.recorded_surface_hash
        ?? role?.content_binding?.surface_hash
        ?? null;
      if (!surfaceHash) continue;
      digests[key] = { mode: 'content_surface', digest: `sha256:${surfaceHash}` };
    }
  }
  return digests;
}

export function buildEvidenceKey(keyInputs) {
  return `evk_${sha256Hex(stableStringify(keyInputs)).slice(0, 32)}`;
}

function compareEvidenceReuse(previousReuse, keyInputs, evidenceKey) {
  if (!previousReuse) {
    return {
      status: 'miss',
      reason: 'no_previous_reuse_artifact',
      stale_reasons: [],
      // base_reuse isolates the shared/base-only verdict from the aggregate
      // `status` above, which folds in per-role drift too (see the
      // 'stale' branch below). evaluateEvidenceReuseForReview reads this,
      // not the aggregate, to decide whether an UNCHANGED role may still be
      // treated as fresh at review-prepare time even though some OTHER
      // role's drift made the aggregate `status` 'stale' (CRK-S-2).
      base_reuse: { status: 'miss', stale_reasons: [] },
      role_reuse: buildRoleReuseIndex({
        baseInvalidated: true,
        baseInvalidatedReason: 'no previous evidence reuse artifact',
        previousRoleDigests: {},
        currentRoleDigests: keyInputs.role_surface_digests
      })
    };
  }
  if (previousReuse.evidence_key === evidenceKey) {
    return {
      status: 'hit',
      reason: 'evidence_key_match',
      stale_reasons: [],
      base_reuse: { status: 'hit', stale_reasons: [] },
      role_reuse: buildRoleReuseIndex({
        baseInvalidated: false,
        previousRoleDigests: previousReuse.key_inputs?.role_surface_digests ?? {},
        currentRoleDigests: keyInputs.role_surface_digests
      })
    };
  }
  const previousInputs = previousReuse.key_inputs ?? {};
  // Base fields are shared by every role (CRK-S-4): a change to any of these
  // invalidates the whole artifact, including every role's own baseline.
  // head_sha/head_ref and verification wall-clock timestamps are deliberately
  // absent here (CRK-S-1) -- see buildEvidenceKeyInputs.
  const baseStaleReasons = [
    staleReason('base_sha', previousInputs.base_sha, keyInputs.base_sha),
    staleReason('spec_fingerprint', previousInputs.spec_fingerprint, keyInputs.spec_fingerprint),
    staleReason('verification_summary_fingerprint', previousInputs.verification_summary_fingerprint, keyInputs.verification_summary_fingerprint),
    staleReason('risk_surface_fingerprint', previousInputs.risk_surface_fingerprint, keyInputs.risk_surface_fingerprint),
    staleReason('planner_version', previousInputs.planner_version, keyInputs.planner_version)
  ].filter(Boolean);
  const baseInvalidated = baseStaleReasons.length > 0;
  const roleReuse = buildRoleReuseIndex({
    baseInvalidated,
    baseInvalidatedReason: 'shared evidence reuse base inputs changed (spec, risk surface, verification, or planner version)',
    previousRoleDigests: previousInputs.role_surface_digests ?? {},
    currentRoleDigests: keyInputs.role_surface_digests
  });
  // When the base already invalidated everything, per-role reasons would only
  // restate that same fact once per role; keep the top-level list to the base
  // reasons. When the base is unchanged, a role-level-only drift (CRK-S-2) is
  // the whole story, so surface it explicitly.
  const roleStaleReasons = baseInvalidated
    ? []
    : Object.values(roleReuse).flatMap((entry) => entry.stale_reasons);
  const allStaleReasons = [...baseStaleReasons, ...roleStaleReasons];
  return {
    // Aggregate: stale the moment ANYTHING changed, base or any single role.
    // This is deliberately unchanged by the base_reuse split below -- gate
    // evidence (buildEvidenceReuseGate) and misuse detection
    // (fresh_use_allowed/gate_status via buildFreshnessStatus) must stay
    // conservative and keep reading this aggregate, not base_reuse.
    status: 'stale',
    reason: allStaleReasons.length > 0 ? 'evidence_key_inputs_changed' : 'evidence_key_changed',
    stale_reasons: allStaleReasons.length > 0
      ? allStaleReasons
      : [{ field: 'evidence_key', previous: previousReuse.evidence_key ?? null, current: evidenceKey, reason: 'evidence key changed' }],
    // Base-only verdict (CRK-S-4 scope): 'stale' only when a shared field
    // actually drifted. Stays 'hit' when the aggregate above went 'stale'
    // solely because of a role-level-only digest change (CRK-S-2 scope),
    // which is exactly the distinction evaluateEvidenceReuseForReview needs.
    base_reuse: {
      status: baseInvalidated ? 'stale' : 'hit',
      stale_reasons: baseStaleReasons
    },
    role_reuse: roleReuse
  };
}

// Per-role hit/miss projection (CRK-S-2/CRK-S-4/CRK-S-5). `currentRoleDigests`
// enumerates every role this build of the artifact knows about; `previousRoleDigests`
// is what the last artifact recorded for those same `${stage}:${role}` keys.
function buildRoleReuseIndex({ baseInvalidated, baseInvalidatedReason, previousRoleDigests, currentRoleDigests }) {
  const index = {};
  for (const [key, current] of Object.entries(currentRoleDigests ?? {})) {
    const previous = previousRoleDigests?.[key] ?? null;
    if (baseInvalidated) {
      index[key] = {
        status: 'miss',
        mode: current.mode,
        digest: current.digest,
        previous_digest: previous?.digest ?? null,
        stale_reasons: [{
          field: `role_surface:${key}`,
          previous: previous?.digest ?? null,
          current: current.digest,
          reason: baseInvalidatedReason ?? 'evidence reuse base inputs changed'
        }]
      };
      continue;
    }
    if (!previous) {
      // No previous baseline for this role yet (its first tracked review):
      // nothing has "changed" from a prior state, there simply is none.
      index[key] = {
        status: 'miss',
        mode: current.mode,
        digest: current.digest,
        previous_digest: null,
        stale_reasons: []
      };
      continue;
    }
    if (previous.mode !== current.mode || previous.digest !== current.digest) {
      index[key] = {
        status: 'miss',
        mode: current.mode,
        digest: current.digest,
        previous_digest: previous.digest ?? null,
        stale_reasons: [{
          field: `role_surface:${key}`,
          previous: previous.digest ?? null,
          current: current.digest,
          reason: previous.mode !== current.mode
            ? 'role freshness mode changed'
            : previous.mode === 'strict_head'
              ? 'strict HEAD role: head changed since evidence reuse artifact was generated'
              : 'inspected content surface changed since evidence reuse artifact was generated'
        }]
      };
      continue;
    }
    index[key] = {
      status: 'hit',
      mode: current.mode,
      digest: current.digest,
      previous_digest: previous.digest,
      stale_reasons: []
    };
  }
  return index;
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

// Full descriptive verification summary, including wall-clock timestamps.
// Used only for display/audit metadata (verification_evidence_metadata,
// current_verification_evidence_updated_at, ...), never for the reuse key or
// any hit/miss/stale decision -- see buildVerificationContentSummary for that.
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

// Content-only verification summary (D2): same command identity as
// summarizeVerificationEvidence, minus updated_at/executed_at/git_recorded_at
// and minus head_sha. A verification re-run that reproduces the same
// command/target/status at a new HEAD and a new wall-clock time must fingerprint
// identically, or every fix commit would still force a reuse miss even after
// head_sha/head_ref are removed from the key (CRK-S-1).
function buildVerificationContentSummary(verificationEvidence) {
  const commands = Array.isArray(verificationEvidence?.commands) ? verificationEvidence.commands : [];
  return {
    schema_version: verificationEvidence?.schema_version ?? null,
    story_id: verificationEvidence?.story_id ?? null,
    command_count: commands.length,
    commands: commands.map((command) => ({
      kind: command.kind ?? null,
      status: command.status ?? null,
      command: command.command ?? null,
      target: command.target ?? null,
      binding_status: command.binding?.status ?? null,
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
