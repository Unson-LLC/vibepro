import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir } from './workspace.js';
import { assertCommandMatchesVerificationKind } from './verification-evidence.js';
import { getAgentReviewStatus } from './agent-review.js';

export const VALIDATION_SEQUENCE_MODEL = 'vibepro-risk-adaptive-validation-sequencing-v1';
export const VALIDATION_PHASES = [
  'targeted_validation',
  'preflight_review',
  'code_frozen',
  'expensive_verification',
  'final_review'
];

const PREFLIGHT_SENSITIVE_SURFACES = new Set([
  'auth_boundary',
  'server_api',
  'core_workflow_state',
  'gate_orchestration',
  'review_lifecycle',
  'database_state'
]);

// Preflight is one aggregate architecture-boundary review. The review prompt is
// scoped by every sensitive surface below, rather than inventing per-surface
// roles that the canonical Agent Review lifecycle cannot produce.
const PREFLIGHT_REVIEW = { stage: 'architecture_spec', role: 'architecture_boundary' };

const TERMINAL_PREFLIGHT_DISPOSITIONS = new Set([
  'accepted',
  'rejected',
  'duplicate',
  'deferred',
  'false_positive',
  'resolved'
]);

export function buildValidationSequencePlan({ storyId, riskProfile = 'light', riskSurfaces = [] } = {}) {
  const preflightSurfaces = [...new Set(riskSurfaces.filter((surface) => PREFLIGHT_SENSITIVE_SURFACES.has(surface)))];
  const boundarySensitive = preflightSurfaces.length > 0;
  const required = riskProfile === 'workflow_heavy' || riskProfile === 'api_contract' || boundarySensitive;
  const reviews = required ? [{ ...PREFLIGHT_REVIEW, surfaces: preflightSurfaces }] : [];
  return {
    model: VALIDATION_SEQUENCE_MODEL,
    story_id: storyId ?? null,
    required,
    risk_profile: riskProfile,
    risk_surfaces: [...new Set(riskSurfaces)],
    preflight_roles: reviews.map((review) => review.role),
    preflight_reviews: reviews,
    preflight_surfaces: preflightSurfaces,
    phases: VALIDATION_PHASES
  };
}

export function createValidationSequenceState({ plan, headSha = null, testFingerprint = null, verificationCommand = null, createdAt = new Date().toISOString() } = {}) {
  return {
    schema_version: '0.1.0',
    model: VALIDATION_SEQUENCE_MODEL,
    story_id: plan?.story_id ?? null,
    created_at: createdAt,
    updated_at: createdAt,
    plan,
    frozen_binding: null,
    phases: Object.fromEntries(VALIDATION_PHASES.map((phase) => [phase, {
      status: 'pending',
      head_sha: null,
      reason: null,
      evidence: []
    }])),
    proposed_binding: { head_sha: headSha, test_fingerprint: testFingerprint, verification_command: verificationCommand },
    invalidations: []
  };
}

export function reconcileValidationSequenceState(state, { storyId, riskProfile = 'light', riskSurfaces = [], headSha = null, reconciledAt = new Date().toISOString() } = {}) {
  const currentPlan = buildValidationSequencePlan({ storyId, riskProfile, riskSurfaces });
  if (!state) return createValidationSequenceState({ plan: currentPlan, headSha, createdAt: reconciledAt });
  if (samePlan(state.plan, currentPlan)) {
    if (!headSha || state.proposed_binding?.head_sha === headSha) return state;
    const next = invalidateValidationSequence(state, {
      changedSurfaces: ['unknown'],
      reason: 'current HEAD differs from the persisted validation binding',
      invalidatedAt: reconciledAt
    });
    next.proposed_binding = { ...next.proposed_binding, head_sha: headSha };
    return next;
  }

  const next = invalidateValidationSequence(state, {
    changedSurfaces: ['unknown'],
    reason: 'current change-risk classification differs from the persisted validation plan',
    invalidatedAt: reconciledAt
  });
  next.story_id = currentPlan.story_id;
  next.plan = currentPlan;
  next.proposed_binding = { ...next.proposed_binding, head_sha: headSha };
  return next;
}

export function recordValidationPhase(state, { phase, status = 'passed', headSha = null, testFingerprint = null, verificationCommand = null, evidence = null, evidenceValidation = null, reviewProvenance = null, findings = [], dispositions = [], reason = null, source = 'local', recordedAt = new Date().toISOString() } = {}) {
  requirePhase(phase);
  const binding = { head_sha: headSha, test_fingerprint: testFingerprint, verification_command: verificationCommand };
  if (!isCompleteBinding(binding)) {
    throw new Error(`${phase} requires HEAD, verification command, and test fingerprint; run vibepro sequence plan with --head, --command, and --test-fingerprint first`);
  }
  const requiresVerifiedEvidence = ['targeted_validation', 'expensive_verification'].includes(phase)
    || (phase === 'preflight_review' && ['passed', 'dispositioned'].includes(status));
  if (requiresVerifiedEvidence
    && (!evidence || evidenceValidation?.status !== 'verified')) {
    throw new Error(`${phase} requires a verified evidence artifact; assertion-only phase completion is not allowed`);
  }
  const next = structuredClone(state);
  if (phase === 'expensive_verification'
    && evaluateExpensiveVerificationReuse(next, binding).reusable) {
    throw new Error('expensive verification already passed at the exact frozen binding; reuse existing evidence instead of recording or executing it again');
  }
  if (phase === 'final_review') {
    assertFinalReviewProvenance({ source, evidence, reviewProvenance, storyId: state.story_id, headSha });
  }
  if (phase === 'preflight_review') {
    next.phases[phase] = {
      status,
      head_sha: headSha,
      reason,
      evidence: appendEvidence(next.phases[phase]?.evidence, evidence),
      record_type: 'advisory_preflight',
      findings,
      dispositions,
      satisfies_final_review: false,
      recorded_at: recordedAt,
      review_provenance: reviewProvenance,
      binding
    };
  } else if (phase === 'code_frozen') {
    assertFreezeAllowed(next, binding);
    if (next.frozen_binding && !sameBinding(next.frozen_binding, binding)) {
      for (const downstream of ['expensive_verification', 'final_review']) {
        next.phases[downstream] = {
          ...next.phases[downstream],
          status: 'invalidated',
          reason: 'code freeze binding changed; downstream evidence must be recorded again'
        };
      }
    }
    next.frozen_binding = binding;
    next.phases[phase] = { status: 'passed', head_sha: headSha, reason, evidence: appendEvidence(next.phases[phase]?.evidence, evidence), recorded_at: recordedAt, binding };
  } else {
    if (['expensive_verification', 'final_review'].includes(phase)) assertFrozenBinding(next, binding);
    if (phase === 'final_review') assertExpensiveVerificationComplete(next, binding);
    next.phases[phase] = {
      status,
      head_sha: headSha,
      reason,
      evidence: appendEvidence(next.phases[phase]?.evidence, evidence),
      source,
      recorded_at: recordedAt,
      ...(phase === 'final_review' ? { review_provenance: reviewProvenance } : {}),
      binding
    };
  }
  next.updated_at = recordedAt;
  return next;
}

export async function readFinalReviewProvenance(repoRoot, evidencePath) {
  if (!evidencePath) throw new Error('final_review requires an Agent Review evidence path');
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, evidencePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error('final_review evidence must resolve inside the repository');
  }
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  const expectedPrefix = `.vibepro/reviews/`;
  const expectedStory = relative.split('/')[2];
  if (!relative.startsWith(expectedPrefix)
    || !/^\.vibepro\/reviews\/[^/]+\/[^/]+\/review-result-[^/]+\.json$/.test(relative)) {
    throw new Error('final_review evidence must be a canonical VibePro review-result artifact');
  }
  let review;
  try {
    review = JSON.parse(await readFile(absolute, 'utf8'));
  } catch (error) {
    throw new Error(`final_review evidence is not a readable Agent Review JSON: ${error.message}`);
  }
  if (review.schema_version !== '0.1.0'
    || !review.inspection?.summary
    || !Array.isArray(review.inspection?.inputs)
    || !review.agent_provenance?.request_artifact
    || !review.agent_provenance?.transcript_artifact
    || review.story_id !== expectedStory) {
    throw new Error('final_review evidence is not a complete canonical VibePro review result');
  }
  const status = await getAgentReviewStatus(root, { storyId: review.story_id, stage: review.stage });
  const canonical = (status.stages ?? []).flatMap((item) => item.roles ?? [])
    .find((item) => item.role === review.role && item.artifact === relative);
  if (!canonical || canonical.effective_status !== 'pass' || canonical.lifecycle?.effective_status !== 'closed') {
    throw new Error('final_review evidence is not a current passing result in the canonical Agent Review lifecycle');
  }
  return {
    status: review.status ?? null,
    story_id: review.story_id ?? null,
    head_sha: review.git_context?.head_sha ?? null,
    system: review.agent_provenance?.system ?? null,
    execution_mode: review.agent_provenance?.execution_mode ?? null,
    evidence_strength: review.agent_provenance?.evidence_strength ?? null,
    agent_closed: review.agent_provenance?.lifecycle?.agent_closed === true,
    role: review.role ?? null,
    stage: review.stage ?? null,
    inspection_summary: review.inspection.summary,
    inspection_inputs: review.inspection.inputs
  };
}

export async function validateValidationPhaseEvidence(repoRoot, evidencePath, { storyId, phase, headSha, verificationCommand, testFingerprint, notBefore = null } = {}) {
  if (!evidencePath) throw new Error('phase requires an evidence artifact path');
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, evidencePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error('phase evidence must resolve inside the repository');
  }
  const canonicalPath = path.resolve(getWorkspaceDir(root), 'pr', storyId, 'verification-evidence.json');
  if (absolute !== canonicalPath) {
    throw new Error(`phase evidence must be the canonical VibePro verification store: ${path.relative(root, canonicalPath).replaceAll('\\', '/')}`);
  }
  let artifact;
  try {
    artifact = JSON.parse(await readFile(absolute, 'utf8'));
  } catch (error) {
    throw new Error(`phase evidence is not a readable JSON artifact: ${error.message}`);
  }
  const commands = Array.isArray(artifact.commands) ? artifact.commands : [];
  const canonicalVerification = artifact.schema_version === '0.1.0'
    && artifact.story_id === storyId
    && commands.some((item) => {
      if (!['pass', 'passed', 'success', 'ok'].includes(item.status)) return false;
      try {
        assertCommandMatchesVerificationKind(item.kind, item.command, item.status, item.observation, item.artifact_check, item.artifact_observed_values);
      } catch {
        return false;
      }
      return item.git_context?.head_sha === headSha
      && item.command === verificationCommand
      && item.observation?.values?.test_fingerprint === testFingerprint
      && item.observation?.values?.validation_phase === phase
      && Number.isFinite(Date.parse(item.executed_at))
      && Date.parse(item.executed_at) <= Date.now() + 5000
      && item.artifact_check?.status === 'verified'
      && item.observation_check?.status === 'recorded'
      && item.content_binding?.schema_version === '0.1.0'
      && item.content_binding?.recorded_head_sha === headSha
      && (!notBefore || Date.parse(item.executed_at) >= Date.parse(notBefore));
    });
  if (!canonicalVerification) {
    throw new Error('phase evidence must be passing canonical evidence bound to the Story, HEAD, verification command, and test fingerprint');
  }
  return { status: 'verified', artifact: path.relative(root, absolute).replaceAll('\\', '/') };
}

export async function validatePreflightReviewEvidence(repoRoot, evidencePath, { storyId, headSha, roles = [], reviews = [] } = {}) {
  const provenance = await readFinalReviewProvenance(repoRoot, evidencePath);
  if (provenance.story_id !== storyId || provenance.head_sha !== headSha
    || provenance.status !== 'pass' || !roles.includes(provenance.role)) {
    throw new Error('preflight_review requires a current passing canonical Agent Review for a planned preflight role');
  }
  const planned = reviews.find((review) => review.stage === provenance.stage && review.role === provenance.role);
  const requiredSurfaces = planned?.surfaces ?? [];
  const coverageMarker = `risk_surfaces=${[...requiredSurfaces].sort().join(',')}`;
  if (!planned || !provenance.inspection_summary.includes(coverageMarker)) {
    throw new Error(`preflight_review requires canonical inspection coverage metadata: ${coverageMarker}`);
  }
  validatePreflightInspectionInputs(provenance.inspection_inputs);
  return { evidenceValidation: { status: 'verified' }, reviewProvenance: provenance };
}

export function validatePreflightInspectionInputs(inputs = []) {
  const normalized = [...new Set(inputs.map((input) => String(input).replaceAll('\\', '/').replace(/^\.\//, '')))].filter(Boolean);
  const hasDesignInput = normalized.some((input) => /^(docs\/management\/stories|docs\/architecture|docs\/specs)\//.test(input));
  const hasRuntimeInput = normalized.some((input) => /^(src|bin|lib|app|apps|packages)\//.test(input));
  const hasTestInput = normalized.some((input) => /^(test|tests|__tests__)\//.test(input) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(input));
  if (!hasDesignInput || !hasRuntimeInput || !hasTestInput) {
    throw new Error('preflight_review inspection inputs must cover design, runtime, and test surfaces; generated review artifacts or marker text alone are insufficient');
  }
  return normalized;
}

function assertFinalReviewProvenance({ source, evidence, reviewProvenance, storyId, headSha }) {
  if (source !== 'agent_review' || !evidence || !reviewProvenance) {
    throw new Error('final_review requires source=agent_review and validated review evidence');
  }
  if (reviewProvenance.status !== 'pass') throw new Error('final_review Agent Review evidence must have status=pass');
  if (reviewProvenance.story_id !== storyId) throw new Error('final_review Agent Review evidence must match the validation Story');
  if (reviewProvenance.head_sha !== headSha) throw new Error('final_review Agent Review evidence must bind to the frozen HEAD');
  if (reviewProvenance.stage !== 'implementation' || reviewProvenance.role !== 'runtime_contract') {
    throw new Error('final_review requires implementation:runtime_contract Agent Review provenance');
  }
  if (!['codex', 'claude_code'].includes(reviewProvenance.system)
    || reviewProvenance.execution_mode !== 'parallel_subagent'
    || reviewProvenance.evidence_strength !== 'strong'
    || reviewProvenance.agent_closed !== true) {
    throw new Error('final_review requires strong closed parallel-subagent Agent Review provenance');
  }
}

export function evaluateExpensiveVerificationReuse(state, binding = {}) {
  const phase = state?.phases?.expensive_verification;
  const exact = phase?.status === 'passed'
    && sameBinding(state?.frozen_binding, binding)
    && sameBinding(phase?.binding, binding);
  return {
    reusable: exact,
    action: exact ? 'reuse' : 'run',
    reason: exact
      ? 'expensive verification already passed for the exact frozen HEAD, test fingerprint, and command'
      : 'expensive verification requires an exact frozen binding match'
  };
}

export function invalidateValidationSequence(state, { changedSurfaces = [], changedFiles = [], reason = 'working tree mutated', invalidatedAt = new Date().toISOString() } = {}) {
  const next = structuredClone(state);
  const derivedSurfaces = changedFiles.length > 0
    ? changedFiles.map(classifyChangedFileSurface)
    : changedSurfaces.length > 0 ? [] : ['unknown'];
  const surfaces = [...new Set([...changedSurfaces, ...derivedSurfaces])];
  const unknown = surfaces.length === 0 || surfaces.some((surface) => ['runtime_source', 'tests', 'repo_control', 'other', 'unknown'].includes(surface));
  const invalidated = unknown
    ? VALIDATION_PHASES
    : surfaces.some((surface) => ['story_docs', 'spec_docs', 'architecture_docs', 'contract_metadata'].includes(surface))
      ? ['preflight_review', 'code_frozen', 'expensive_verification', 'final_review']
      : ['targeted_validation', 'preflight_review', 'code_frozen', 'expensive_verification', 'final_review'];
  for (const phase of invalidated) {
    next.phases[phase] = { ...next.phases[phase], status: 'invalidated', reason };
  }
  if (invalidated.includes('code_frozen')) next.frozen_binding = null;
  next.invalidations.push({ changed_surfaces: surfaces.length ? surfaces : ['unknown'], changed_files: changedFiles, invalidated_phases: invalidated, reason, invalidated_at: invalidatedAt });
  next.updated_at = invalidatedAt;
  return next;
}

export function classifyChangedFileSurface(file) {
  const normalized = String(file ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (/^docs\/management\/stories\//.test(normalized)) return 'story_docs';
  if (/^docs\/specs\//.test(normalized)) return 'spec_docs';
  if (/^docs\/(architecture|adr)\//.test(normalized)) return 'architecture_docs';
  if (/^(docs\/contracts|contracts)\//.test(normalized)) return 'contract_metadata';
  if (/^(test|tests|__tests__)\//.test(normalized) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized)) return 'tests';
  if (/^(src|bin|lib|app|apps|packages)\//.test(normalized)) return 'runtime_source';
  if (/^(\.github|\.gitlab|\.circleci)\//.test(normalized)
    || /^(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|Dockerfile|Makefile|AGENTS\.md|CLAUDE\.md)$/.test(normalized)) return 'repo_control';
  return 'unknown';
}

export function evaluateValidationSequence(state, { currentHeadSha = null } = {}) {
  const required = state?.plan?.required === true;
  if (!required) return { status: 'not_applicable', ready_for_final_gate: true, blocking_phases: [] };
  const blocking = VALIDATION_PHASES.filter((phase) => {
    if (phase === 'preflight_review') return !isPreflightClosed(state?.phases?.[phase]);
    return state?.phases?.[phase]?.status !== 'passed';
  });
  const candidateHeadSha = state?.frozen_binding?.head_sha ?? state?.proposed_binding?.head_sha ?? null;
  const finalReview = state?.phases?.final_review;
  const candidateHeadDrifted = Boolean(candidateHeadSha && currentHeadSha && candidateHeadSha !== currentHeadSha);
  const completedFinalReviewDrifted = finalReview?.status === 'passed'
    && Boolean(currentHeadSha)
    && finalReview.head_sha !== currentHeadSha;
  if (candidateHeadDrifted || completedFinalReviewDrifted) blocking.push('current_head_binding');
  if (state?.frozen_binding) {
    for (const phase of VALIDATION_PHASES) {
      const phaseBinding = state?.phases?.[phase]?.binding;
      const matchesFreeze = ['expensive_verification', 'final_review'].includes(phase)
        ? sameFrozenIdentity(state.frozen_binding, phaseBinding)
        : sameBinding(state.frozen_binding, phaseBinding);
      if (!matchesFreeze) blocking.push(`${phase}_binding`);
    }
  }
  const uniqueBlocking = [...new Set(blocking)];
  return {
    status: uniqueBlocking.length === 0 ? 'passed' : 'needs_evidence',
    ready_for_final_gate: uniqueBlocking.length === 0,
    blocking_phases: uniqueBlocking,
    next_required_action: buildNextRequiredAction(state, uniqueBlocking),
    preflight_is_advisory: state?.phases?.preflight_review?.satisfies_final_review === false
  };
}

export async function readValidationSequence(repoRoot, storyId) {
  try {
    return JSON.parse(await readFile(getValidationSequencePath(repoRoot, storyId), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeValidationSequence(repoRoot, state) {
  const target = getValidationSequencePath(repoRoot, state.story_id);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(state, null, 2)}\n`);
  return target;
}

export function getValidationSequencePath(repoRoot, storyId) {
  if (typeof storyId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(storyId)) {
    throw new Error('validation sequence story id must be a single safe path segment');
  }
  return path.join(getWorkspaceDir(path.resolve(repoRoot)), 'validation-sequencing', storyId, 'state.json');
}

export function fingerprintValidationCommand(command, targets = []) {
  return createHash('sha256').update(JSON.stringify({ command, targets: [...targets].sort() })).digest('hex');
}

function assertFreezeAllowed(state, binding) {
  const targeted = state?.phases?.targeted_validation?.status === 'passed';
  const preflight = state?.phases?.preflight_review;
  const preflightClosed = isPreflightClosed(preflight);
  if (!targeted || !preflightClosed) throw new Error('code_frozen requires passed targeted validation and passed or fully dispositioned advisory preflight');
  if (!sameBinding(state?.phases?.targeted_validation?.binding, binding)
    || !sameBinding(preflight?.binding, binding)) {
    throw new Error('code_frozen requires targeted validation and advisory preflight at the exact freeze binding');
  }
}

function buildNextRequiredAction(state, blocking) {
  if (!state?.frozen_binding && !isCompleteBinding(state?.proposed_binding)) {
    const surfaces = (state?.plan?.risk_surfaces ?? []).map((surface) => ` --surface ${surface}`).join('');
    return {
      phase: 'plan',
      command: `vibepro sequence plan . --id ${state.story_id} --head ${state?.proposed_binding?.head_sha ?? '<current-head>'} --risk-profile ${state?.plan?.risk_profile ?? 'light'}${surfaces} --command "<verification-command>" --test-fingerprint "<test-fingerprint>"`
    };
  }
  if (state?.frozen_binding && blocking.includes('current_head_binding')) {
    return {
      phase: 'invalidate',
      command: `vibepro sequence invalidate . --id ${state.story_id} --surface unknown --reason "HEAD changed; invalidate stale bindings before re-validation"`
    };
  }
  const phase = VALIDATION_PHASES.find((candidate) => blocking.includes(candidate) || blocking.includes(`${candidate}_binding`));
  if (phase) {
    if (['targeted_validation', 'expensive_verification'].includes(phase)) {
      const kind = phase === 'targeted_validation' ? 'unit' : 'e2e';
      const binding = state.frozen_binding ?? state.proposed_binding;
      const command = phase === 'expensive_verification'
        ? '<expensive-verification-command>'
        : binding.verification_command;
      return {
        phase,
        command: `vibepro verify record . --id ${state.story_id} --kind ${kind} --status pass --command ${JSON.stringify(command)} --artifact '<test-result.json>' --target '<tested-path>' --scenario "${phase} passed" --observed test_fingerprint=${binding.test_fingerprint} --observed validation_phase=${phase} --strict-head-binding`,
        follow_up_command: `vibepro sequence record . --id ${state.story_id} --phase ${phase} --command ${JSON.stringify(command)} --test-fingerprint ${binding.test_fingerprint} --evidence .vibepro/pr/${state.story_id}/verification-evidence.json`
      };
    }
    if (phase === 'preflight_review') {
      const review = state.plan?.preflight_reviews?.[0] ?? PREFLIGHT_REVIEW;
      const scope = (review.surfaces ?? []).join(',') || 'declared high-risk boundaries';
      const result = `.vibepro/reviews/${state.story_id}/${review.stage}/review-result-${review.role}.json`;
      return {
        phase,
        required_review: { ...review, surfaces: review.surfaces ?? [] },
        instruction: `Complete one aggregate ${review.role} Agent Review covering: ${scope}. Do not record the sequence phase until the review is closed and recorded as pass.`,
        command: `vibepro review prepare . --id ${state.story_id} --stage ${review.stage} --role ${review.role}`,
        ordered_actions: [
          `vibepro review prepare . --id ${state.story_id} --stage ${review.stage} --role ${review.role}`,
          `vibepro review authorize . --id ${state.story_id} --stage ${review.stage} --role ${review.role} --review-kind preflight --closes-risk "${scope}" --expected-judgment-delta "identify boundary risks before freeze" --reusable-evidence <ref>`,
          `vibepro review start . --id ${state.story_id} --stage ${review.stage} --role ${review.role} --agent-system <codex|claude_code> --agent-id <agent-id> --agent-thread-id '<agent-thread-id>' --agent-session-id '<agent-session-id>' --dispatch-authorization <authorization-id>`,
          `vibepro review close . --id ${state.story_id} --stage ${review.stage} --role ${review.role} --agent-id <agent-id> --close-reason completed --close-evidence <transcript-path>`,
          `vibepro review record . --id ${state.story_id} --stage ${review.stage} --role ${review.role} --status pass --summary "aggregate boundary review passed" --inspection-input '<design-story-spec-path>' --inspection-input '<runtime-source-path>' --inspection-input '<test-path>' --inspection-summary "reviewed ${scope}; risk_surfaces=${[...(review.surfaces ?? [])].sort().join(',')}" --judgment-delta "no blocking findings" --agent-system '<codex|claude_code>' --agent-id '<agent-id>' --agent-thread-id '<agent-thread-id>' --agent-session-id '<agent-session-id>' --implementation-session-id '<implementation-session-id>' --reviewer-identity separate_session --execution-mode parallel_subagent --agent-transcript '<transcript-path>' --agent-closed --agent-close-evidence '<transcript-path>'`,
          `vibepro sequence record . --id ${state.story_id} --phase preflight_review --evidence ${result}`
        ]
      };
    }
    if (phase === 'final_review') {
      const review = { stage: 'implementation', role: 'runtime_contract' };
      const result = `.vibepro/reviews/${state.story_id}/${review.stage}/review-result-${review.role}.json`;
      return {
        phase,
        required_review: review,
        instruction: 'Complete a current-HEAD final Agent Review and record the sequence phase only after its canonical lifecycle is closed with a passing result.',
        command: `vibepro review prepare . --id ${state.story_id} --stage ${review.stage} --role ${review.role}`,
        ordered_actions: [
          `vibepro review prepare . --id ${state.story_id} --stage ${review.stage} --role ${review.role}`,
          `vibepro review authorize . --id ${state.story_id} --stage ${review.stage} --role ${review.role} --review-kind final --closes-risk "runtime contract regression" --expected-judgment-delta "confirm frozen release candidate" --freeze source,spec,test,review_surface`,
          `vibepro review start . --id ${state.story_id} --stage ${review.stage} --role ${review.role} --agent-system <codex|claude_code> --agent-id <agent-id> --agent-thread-id '<agent-thread-id>' --agent-session-id '<agent-session-id>' --dispatch-authorization <authorization-id>`,
          `vibepro review close . --id ${state.story_id} --stage ${review.stage} --role ${review.role} --agent-id <agent-id> --close-reason completed --close-evidence <transcript-path>`,
          `vibepro review record . --id ${state.story_id} --stage ${review.stage} --role ${review.role} --status pass --summary "final current-HEAD runtime contract review passed" --inspection-input '<reviewed-path>' --inspection-summary "reviewed final frozen-HEAD runtime contract" --judgment-delta "no blocking findings" --agent-system <codex|claude_code> --agent-id <agent-id> --agent-thread-id '<agent-thread-id>' --agent-session-id '<agent-session-id>' --implementation-session-id '<implementation-session-id>' --reviewer-identity separate_session --execution-mode parallel_subagent --agent-transcript '<transcript-path>' --agent-closed --agent-close-evidence '<transcript-path>' --strict-head-binding --strict-head-reason "bind final review to the frozen release candidate"`,
          `vibepro sequence record . --id ${state.story_id} --phase final_review --source agent_review --evidence ${result}`
        ]
      };
    }
    const extra = ['targeted_validation', 'preflight_review', 'expensive_verification'].includes(phase)
      ? ` --evidence .vibepro/pr/${state.story_id}/verification-evidence.json`
      : '';
    return {
      phase,
      command: `vibepro sequence record . --id ${state.story_id} --phase ${phase}${extra}`
    };
  }
  return null;
}

function isPreflightClosed(preflight) {
  const findings = preflight?.findings ?? [];
  const everyFindingDispositioned = findings.every((finding) => (preflight?.dispositions ?? []).some((item) => (
      item.finding_id === finding.id && TERMINAL_PREFLIGHT_DISPOSITIONS.has(item.status)
  )));
  return (preflight?.status === 'passed' && findings.length === 0)
    || (['passed', 'dispositioned'].includes(preflight?.status) && everyFindingDispositioned);
}

function assertFrozenBinding(state, binding) {
  if (!sameFrozenIdentity(state?.frozen_binding, binding)) throw new Error('phase evidence does not match the frozen HEAD and test fingerprint');
}

function assertExpensiveVerificationComplete(state, binding) {
  if (state?.phases?.expensive_verification?.status !== 'passed'
    || !sameFrozenIdentity(state?.phases?.expensive_verification?.binding, binding)) {
    throw new Error('final_review requires passed expensive_verification at the frozen HEAD and test fingerprint');
  }
}

function sameFrozenIdentity(left, right) {
  return Boolean(left?.head_sha && left.head_sha === right?.head_sha
    && left.test_fingerprint && left.test_fingerprint === right?.test_fingerprint);
}

function sameBinding(left, right) {
  return Boolean(isCompleteBinding(left) && left.head_sha === right?.head_sha
    && left.test_fingerprint && left.test_fingerprint === right?.test_fingerprint
    && left.verification_command && left.verification_command === right?.verification_command);
}

function isCompleteBinding(binding) {
  return Boolean(binding?.head_sha && binding?.test_fingerprint && binding?.verification_command);
}

function samePlan(left, right) {
  return left?.model === right?.model
    && left?.story_id === right?.story_id
    && left?.required === right?.required
    && left?.risk_profile === right?.risk_profile
    && sameStringSet(left?.risk_surfaces, right?.risk_surfaces)
    && sameStringSet(left?.preflight_roles, right?.preflight_roles)
    && sameStringSet(left?.preflight_surfaces, right?.preflight_surfaces);
}

function sameStringSet(left = [], right = []) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function appendEvidence(current = [], evidence) {
  return evidence ? [...(current ?? []), evidence] : [...(current ?? [])];
}

function requirePhase(phase) {
  if (!VALIDATION_PHASES.includes(phase)) throw new Error(`unknown validation phase: ${phase}`);
}
