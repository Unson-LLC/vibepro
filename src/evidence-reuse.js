import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

export const EVIDENCE_REUSE_VERSION = '0.1.0';
export const EVIDENCE_REUSE_MODEL = 'vibepro-evidence-summary-reuse-v1';

const FRESH_REUSE_STATUSES = new Set(['hit', 'miss']);

export async function readEvidenceReuseIfExists(repoRoot, storyId) {
  if (!storyId) return null;
  const filePath = getEvidenceReusePath(repoRoot, storyId);
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function getEvidenceReusePath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(path.resolve(repoRoot)), 'pr', storyId, 'evidence-reuse.json');
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
