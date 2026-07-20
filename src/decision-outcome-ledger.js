import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { atomicReplaceFile } from './atomic-file.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

export const DECISION_OUTCOME_LEDGER_VERSION = '0.1.0';
export const DECISION_OUTCOME_LEDGER_MODEL = 'vibepro-decision-outcome-ledger-v1';
const SUMMARY_STATUS_ORDER = new Map([
  ['conflicting', 0],
  ['incomplete', 1],
  ['partial', 2],
  ['complete', 3]
]);
const VOLATILE_KEYS = new Set([
  'created_at', 'generated_at', 'recorded_at', 'resolved_at', 'updated_at',
  'started_at', 'finished_at', 'timestamp', 'index', 'array_index'
]);
const SENSITIVE_KEY_PATTERN = /(?:authorization|api[_-]?key|password|secret|token)/i;
const SUMMARY_VALUE_KEYS = 8;
const SUMMARY_ARRAY_ITEMS = 5;
const SUMMARY_TEXT_LENGTH = 240;

export function getDecisionOutcomeLedgerPath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(path.resolve(repoRoot)), 'pr', storyId, 'decision-outcome-ledger.json');
}

export async function readDecisionOutcomeLedgerIfExists(repoRoot, storyId) {
  try {
    return JSON.parse(await readFile(getDecisionOutcomeLedgerPath(repoRoot, storyId), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeDecisionOutcomeLedger(repoRoot, storyId, input = {}, options = {}) {
  const artifactPath = getDecisionOutcomeLedgerPath(repoRoot, storyId);
  const ledger = buildDecisionOutcomeLedger({
    ...input,
    storyId,
    artifactPath: toWorkspaceRelative(path.resolve(repoRoot), artifactPath)
  });
  const atomicWrite = options.atomicWrite ?? atomicReplaceFile;
  await atomicWrite(artifactPath, `${JSON.stringify(ledger, null, 2)}\n`);
  return { ledger, artifact_path: artifactPath };
}

export function digestDecisionOutcomeBytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function validateDecisionOutcomeLedger(ledger, { storyId = null } = {}) {
  const invalid = (field, reason) => ({ valid: false, field, reason });
  if (ledger?.schema_version !== DECISION_OUTCOME_LEDGER_VERSION) {
    return invalid('schema_version', 'decision outcome ledger schema is unsupported');
  }
  if (ledger?.model !== DECISION_OUTCOME_LEDGER_MODEL) {
    return invalid('model', 'decision outcome ledger model is unsupported');
  }
  if (typeof ledger.story_id !== 'string' || ledger.story_id.trim() === '') {
    return invalid('story_id', 'decision outcome ledger story is missing');
  }
  if (storyId && ledger.story_id !== storyId) {
    return invalid('story_id', 'decision outcome ledger story does not match the promotion target');
  }
  if (typeof ledger.evidence_head_sha !== 'string' || ledger.evidence_head_sha.trim() === '') {
    return invalid('evidence_head_sha', 'decision outcome ledger current-head binding is invalid');
  }
  if (!validObservedAt(ledger.created_at)) {
    return invalid('created_at', 'decision outcome ledger creation timestamp is invalid');
  }
  if (ledger.artifact_path != null && typeof ledger.artifact_path !== 'string') {
    return invalid('artifact_path', 'decision outcome ledger artifact path is invalid');
  }
  if (!Array.isArray(ledger.traces)) {
    return invalid('traces', 'decision outcome ledger traces must be an array');
  }

  const selectors = new Set();
  for (const trace of ledger.traces) {
    if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
      return invalid('traces', 'decision outcome ledger trace must be an object');
    }
    for (const field of [
      'decision_trace_id', 'collision_group', 'trace_source_ref', 'normalized_subject_key',
      'source_identity', 'evidence_head_sha', 'parent_revision_fingerprint',
      'revision_fingerprint', 'observation_identity',
      'trace_status', 'missing_reason', 'finding', 'gate', 'detector', 'disposition',
      'decision', 'behavior_delta', 'delivery', 'downstream_outcome',
      'eligible_outcome_sources', 'source_errors'
    ]) {
      if (!Object.hasOwn(trace, field)) {
        return invalid(field, `decision outcome trace required field is missing: ${field}`);
      }
    }
    if (trace.evidence_head_sha !== ledger.evidence_head_sha) {
      return invalid('evidence_head_sha', 'decision outcome trace head does not match the ledger current-head binding');
    }
    if (!SUMMARY_STATUS_ORDER.has(trace.trace_status)) {
      return invalid('trace_status', 'decision outcome trace status is unsupported');
    }
    if (trace.normalized_subject_key != null
      && (typeof trace.normalized_subject_key !== 'string' || trace.normalized_subject_key.trim() === '')) {
      return invalid('normalized_subject_key', 'decision outcome normalized subject key is invalid');
    }
    if (!isValidTraceSourceIdentity(trace.source_identity)) {
      return invalid('source_identity', 'decision outcome trace source identity is invalid');
    }
    if (!isValidBehaviorDelta(trace.behavior_delta)) {
      return invalid('behavior_delta', 'decision outcome trace behavior delta is invalid');
    }
    if (!isValidDelivery(trace.delivery)) {
      return invalid('delivery', 'decision outcome trace delivery is invalid');
    }
    if (!isValidDownstreamOutcome(trace.downstream_outcome)) {
      return invalid('downstream_outcome', 'decision outcome trace downstream outcome is invalid');
    }
    if (!isValidEligibleOutcomeSources(trace.eligible_outcome_sources)) {
      return invalid('eligible_outcome_sources', 'decision outcome eligible sources are invalid');
    }
    if (!Array.isArray(trace.source_errors)) {
      return invalid('source_errors', 'decision outcome trace source errors must be an array');
    }
    if (trace.observation_read_aliases != null && !Array.isArray(trace.observation_read_aliases)) {
      return invalid('observation_read_aliases', 'decision outcome trace observation aliases must be an array');
    }
    if (Array.isArray(trace.observation_read_aliases)
      && !trace.observation_read_aliases.every(isValidObservationReadAlias)) {
      return invalid('observation_read_aliases', 'decision outcome trace observation alias is invalid');
    }
    for (const claimField of ['finding', 'gate', 'detector', 'disposition', 'decision']) {
      if (!isValidClaim(trace[claimField])) {
        return invalid(claimField, `decision outcome trace claim is invalid: ${claimField}`);
      }
    }
    if (trace.observation_identity != null
      && (!/^obs_[a-f0-9]{64}$/.test(trace.observation_identity.observation_id ?? '')
        || !/^[a-f0-9]{64}$/.test(trace.observation_identity.source_digest ?? ''))) {
      return invalid('observation_identity', 'decision outcome trace observation identity is invalid');
    }
    if (!isJsonSafeValue(trace)) {
      return invalid('traces', 'decision outcome trace contains unsupported JSON values');
    }
    if (!/^[a-f0-9]{64}$/.test(trace.revision_fingerprint ?? '')) {
      return invalid('revision_fingerprint', 'decision outcome trace revision fingerprint is invalid');
    }
    const hasDecisionTrace = /^dt_[a-f0-9]{64}$/.test(trace.decision_trace_id ?? '');
    const hasCollisionGroup = /^cg_[a-f0-9]{64}$/.test(trace.collision_group ?? '');
    const hasTraceSourceRef = /^tsr_[a-f0-9]{64}$/.test(trace.trace_source_ref ?? '');
    const hasCollisionTrace = trace.decision_trace_id == null && hasCollisionGroup && hasTraceSourceRef;
    if (!hasTraceSourceRef) {
      return invalid('trace_source_ref', 'decision outcome trace source reference is invalid');
    }
    if (hasDecisionTrace && trace.collision_group != null) {
      return invalid('collision_group', 'identified decision outcome traces cannot carry a collision group');
    }
    if (!hasDecisionTrace && !hasCollisionTrace) {
      if (trace.decision_trace_id == null && !hasCollisionGroup) {
        return invalid('collision_group', 'decision outcome collision group is invalid');
      }
      if (trace.decision_trace_id == null && !hasTraceSourceRef) {
        return invalid('trace_source_ref', 'decision outcome trace source reference is invalid');
      }
      return invalid('decision_trace_id', 'decision outcome trace identifier is invalid');
    }
    const selector = hasDecisionTrace
      ? trace.decision_trace_id
      : `${trace.collision_group}|${trace.trace_source_ref}`;
    if (selectors.has(selector)) {
      return invalid('trace_selector', 'decision outcome trace selector is duplicated');
    }
    selectors.add(selector);

    const parentCore = {
      story_id: ledger.story_id,
      decision_trace_id: trace.decision_trace_id,
      collision_group: trace.collision_group,
      trace_source_ref: trace.trace_source_ref,
      normalized_subject_key: trace.normalized_subject_key,
      source_identity: trace.source_identity ?? null,
      evidence_head_sha: trace.evidence_head_sha ?? null,
      behavior_delta: trace.behavior_delta,
      delivery: trace.delivery
    };
    const expectedParent = digestCanonical(stripVolatile(parentCore));
    if (trace.parent_revision_fingerprint !== expectedParent) {
      return invalid('parent_revision_fingerprint', 'decision outcome trace parent fingerprint does not match its content');
    }
    if (!Object.hasOwn(trace, 'observation_identity')) {
      return invalid('observation_identity', 'decision outcome trace observation identity is missing');
    }
    const expectedRevision = digestCanonical({
      parent_revision_fingerprint: expectedParent,
      downstream_outcome: trace.downstream_outcome,
      observation_identity: trace.observation_identity
    });
    if (trace.revision_fingerprint !== expectedRevision) {
      return invalid('revision_fingerprint', 'decision outcome trace revision fingerprint does not match its content');
    }
  }

  if (!/^[a-f0-9]{64}$/.test(ledger.artifact_digest ?? '')) {
    return invalid('artifact_digest', 'decision outcome ledger digest is invalid');
  }
  const ledgerCore = { ...ledger };
  delete ledgerCore.artifact_digest;
  const expectedDigest = digestCanonical(stripVolatile({ ...ledgerCore, created_at: null }));
  if (ledger.artifact_digest !== expectedDigest) {
    return invalid('artifact_digest', 'decision outcome ledger digest does not match its content');
  }
  return { valid: true, field: null, reason: null };
}

function isValidTraceSourceIdentity(identity) {
  return identity && typeof identity === 'object' && !Array.isArray(identity)
    && typeof identity.source_kind === 'string' && identity.source_kind.trim() !== ''
    && (identity.source_ref == null || typeof identity.source_ref === 'string')
    && (identity.native_id == null || typeof identity.native_id === 'string')
    && /^[a-f0-9]{64}$/.test(identity.digest ?? '')
    && Number.isInteger(identity.multiplicity) && identity.multiplicity > 0;
}

function isValidBehaviorDelta(delta) {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)
    || !['observed', 'partial', 'not_observed', 'conflicting'].includes(delta.status)
    || !Array.isArray(delta.change_refs)
    || !Array.isArray(delta.verification_refs)
    || !Array.isArray(delta.verification_sources)
    || !Array.isArray(delta.excluded_sources)
    || !Object.hasOwn(delta, 'before')
    || !Object.hasOwn(delta, 'after')
    || !Object.hasOwn(delta, 'missing_reason')) return false;
  if (delta.status === 'observed') {
    return delta.before != null && delta.after != null && delta.missing_reason == null
      && !Object.hasOwn(delta, 'conflicts');
  }
  if (delta.status === 'conflicting') {
    return delta.before == null && delta.after == null
      && delta.missing_reason === 'behavior_delta_conflict'
      && Array.isArray(delta.conflicts) && delta.conflicts.length > 1
      && delta.conflicts.every((item) => item && typeof item === 'object' && !Array.isArray(item)
        && item.before != null && item.after != null && Array.isArray(item.verification_refs));
  }
  return delta.before == null && delta.after == null
    && typeof delta.missing_reason === 'string' && delta.missing_reason.trim() !== ''
    && !Object.hasOwn(delta, 'conflicts');
}

function isValidDelivery(delivery) {
  return delivery && typeof delivery === 'object' && !Array.isArray(delivery)
    && ['not_delivered', 'pr_created', 'merged', 'conflicting'].includes(delivery.status)
    && (delivery.pr == null || (typeof delivery.pr === 'object' && !Array.isArray(delivery.pr)))
    && (delivery.merge == null || (typeof delivery.merge === 'object' && !Array.isArray(delivery.merge)));
}

function isValidDownstreamOutcome(outcome) {
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)
    || !['observed', 'not_observed', 'not_applicable'].includes(outcome.status)) return false;
  for (const field of ['value', 'reason', 'source_ref', 'missing_reason']) {
    if (!Object.hasOwn(outcome, field)) return false;
  }
  return true;
}

function isValidEligibleOutcomeSources(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.entries)) return false;
  if (![value.total_count, value.returned_count, value.omitted_count].every((count) => Number.isInteger(count) && count >= 0)) return false;
  if (typeof value.truncated !== 'boolean'
    || value.returned_count !== value.entries.length
    || value.total_count !== value.returned_count + value.omitted_count) return false;
  return value.entries.every((entry) => entry && typeof entry.kind === 'string'
    && typeof entry.ref === 'string' && /^[a-f0-9]{64}$/.test(entry.digest ?? ''));
}

function isValidClaim(claim) {
  return claim && typeof claim === 'object' && !Array.isArray(claim)
    && ['observed', 'not_observed'].includes(claim.status)
    && Object.hasOwn(claim, 'value')
    && Array.isArray(claim.provenance);
}

export function reviseDecisionOutcomeLedger(ledger, {
  delivery = null,
  observations = [],
  currentHeadSha = null
} = {}) {
  if (!ledger?.story_id) throw new Error('decision outcome ledger requires story_id');
  const evidenceHeadSha = currentHeadSha ?? ledger.evidence_head_sha ?? null;
  const traces = (ledger.traces ?? []).map((trace) => reviseTrace({
    trace,
    storyId: ledger.story_id,
    delivery,
    observations,
    evidenceHeadSha
  })).sort(compareTraceSelectors);
  const core = {
    ...ledger,
    created_at: new Date().toISOString(),
    evidence_head_sha: evidenceHeadSha,
    traces
  };
  delete core.artifact_digest;
  return {
    ...core,
    artifact_digest: digestCanonical(stripVolatile({ ...core, created_at: null }))
  };
}

export function buildDecisionOutcomeLedger({
  storyId,
  sources = [],
  verificationEvidence = null,
  currentHeadSha = null,
  delivery = null,
  observations = [],
  artifactPath = null,
  createdAt = new Date().toISOString()
} = {}) {
  if (!storyId) throw new Error('decision outcome ledger requires storyId');
  const normalizedSources = collapseDuplicateSources(sources.map((source) => normalizeSource(storyId, source)));
  const bySubject = groupBy(normalizedSources.filter((source) => source.normalized_subject_key), 'normalized_subject_key');
  const traces = [];

  for (const source of normalizedSources.filter((item) => !item.normalized_subject_key)) {
    traces.push(buildTrace({
      storyId,
      source,
      collisionReason: 'stable_source_key_missing',
      verificationEvidence,
      currentHeadSha,
      delivery,
      observations
    }));
  }

  for (const [subjectKey, grouped] of bySubject) {
    const implicitSourceCount = grouped.filter((source) => source.explicit_link !== true).length;
    const hasExplicitLink = grouped.some((source) => source.explicit_link === true);
    const ambiguous = grouped.length > 1 && !(hasExplicitLink && implicitSourceCount <= 1);
    const sourceInputs = grouped.length > 1 && !ambiguous ? [mergeLinkedSources(grouped)] : grouped;
    for (const source of sourceInputs) {
      traces.push(buildTrace({
        storyId,
        source,
        subjectKey,
        collisionReason: ambiguous ? 'ambiguous_subject_instance' : null,
        verificationEvidence,
        currentHeadSha,
        delivery,
        observations
      }));
    }
  }

  traces.sort(compareTraceSelectors);
  const ledgerCore = {
    schema_version: DECISION_OUTCOME_LEDGER_VERSION,
    model: DECISION_OUTCOME_LEDGER_MODEL,
    story_id: storyId,
    evidence_head_sha: currentHeadSha,
    created_at: createdAt,
    artifact_path: artifactPath,
    traces
  };
  return {
    ...ledgerCore,
    artifact_digest: digestCanonical(stripVolatile({ ...ledgerCore, created_at: null }))
  };
}

export function collectDecisionOutcomeSources({ storyId = null, agentReviews = null, decisionRecords = null, gateOutcomeLedger = null } = {}) {
  const sources = [];
  for (const stage of agentReviews?.stages ?? []) {
    for (const role of stage.roles ?? []) {
      for (const sourceError of role.source_errors ?? []) {
        sources.push({
          source_kind: 'review_source_error',
          source_ref: sourceError.source_ref ?? role.artifact ?? null,
          source_head_sha: role.git_context?.head_sha ?? null,
          native_id: null,
          normalized_subject_key: null,
          role: role.role ?? null,
          stage: stage.stage ?? null,
          finding: {
            id: null,
            summary: `Review source ${sourceError.code ?? 'source_unreadable'}`,
            status: 'unknown'
          },
          authority_valid: false,
          source_errors: [sourceError]
        });
      }
      for (const finding of role.findings ?? []) {
        const authorityValid = role.provenance_status === 'verified_agent' && Boolean(role.artifact);
        sources.push({
          source_kind: 'review_finding',
          source_ref: role.artifact ?? null,
          source_head_sha: role.git_context?.head_sha ?? null,
          native_id: finding.id ?? null,
          normalized_subject_key: finding.id ? `finding:${finding.id}` : null,
          role: role.role ?? null,
          stage: stage.stage ?? null,
          finding,
          authority_valid: authorityValid,
          source_errors: authorityValid ? [] : [{
            code: role.artifact ? 'claim_authority_invalid' : 'claim_provenance_missing',
            source_ref: role.artifact ?? null
          }]
        });
      }
      for (const disposition of role.finding_dispositions ?? []) {
        const authorityValid = role.provenance_status === 'verified_agent' && Boolean(role.artifact);
        sources.push({
          source_kind: 'finding_disposition',
          source_ref: role.artifact ?? null,
          source_head_sha: role.git_context?.head_sha ?? null,
          native_id: disposition.finding_id ?? null,
          normalized_subject_key: disposition.finding_id ? `finding:${disposition.finding_id}` : null,
          role: role.role ?? null,
          stage: stage.stage ?? null,
          decision: disposition,
          explicit_link: true,
          authority_valid: authorityValid,
          source_errors: authorityValid ? [] : [{
            code: role.artifact ? 'claim_authority_invalid' : 'claim_provenance_missing',
            source_ref: role.artifact ?? null
          }]
        });
      }
    }
  }
  for (const decision of decisionRecords?.decisions ?? []) {
    const subjectKey = normalizeSubjectKey(decision.source);
    const decisionArtifact = decisionRecords?.artifact ?? null;
    sources.push({
      source_kind: 'decision_record',
      source_ref: decisionArtifact ?? decision.artifact ?? null,
      native_id: decision.decision_id ?? null,
      normalized_subject_key: subjectKey,
      decision,
      explicit_link: Boolean(subjectKey),
      source_digest: decisionRecords?.artifact_digest ?? null,
      authority_valid: decision.status === 'accepted'
        && decision.type === 'waiver'
        && Boolean(storyId)
        && decisionRecords?.story_id === storyId
        && decision.story_id === storyId
        && Boolean(subjectKey)
        && Boolean(decisionArtifact)
        && decision.artifact === decisionArtifact
    });
  }
  for (const entry of gateOutcomeLedger?.entries ?? []) {
    const managedDecisions = new Map((decisionRecords?.decisions ?? []).map((decision) => [decision.decision_id, decision]));
    const decisionArtifact = decisionRecords?.artifact ?? null;
    const authorityErrors = [];
    const linkedSources = [];
    for (const ref of entry.decision_refs ?? []) {
      const decision = managedDecisions.get(ref.decision_id);
      const refSource = normalizeSubjectKey(ref.source);
      const decisionSource = normalizeSubjectKey(decision?.source);
      const valid = decision
        && decision.type === 'waiver'
        && decision.status === 'accepted'
        && Boolean(storyId)
        && decisionRecords?.story_id === storyId
        && decision.story_id === storyId
        && refSource
        && decisionSource === refSource
        && Boolean(ref.artifact)
        && Boolean(decision.artifact)
        && Boolean(decisionArtifact)
        && ref.artifact === decision.artifact
        && ref.artifact === decisionArtifact;
      if (valid) linkedSources.push(refSource);
      else authorityErrors.push({ code: 'decision_authority_invalid', source_ref: gateOutcomeLedger?.artifact ?? '.vibepro/gate-outcomes/ledger.json', decision_id: ref.decision_id ?? null });
    }
    const distinctLinkedSources = uniqueBy(linkedSources, (value) => value);
    const subjectKey = distinctLinkedSources.length === 1 ? distinctLinkedSources[0] : normalizeSubjectKey(entry.gate_id) ?? `gate:${entry.gate_id}`;
    sources.push({
      source_kind: 'gate_outcome',
      source_ref: gateOutcomeLedger?.artifact ?? '.vibepro/gate-outcomes/ledger.json',
      native_id: entry.entry_key ?? entry.gate_id ?? null,
      normalized_subject_key: subjectKey,
      decision: entry,
      source_digest: gateOutcomeLedger?.artifact_digest ?? null,
      explicit_link: distinctLinkedSources.length === 1,
      authority_valid: authorityErrors.length === 0 && distinctLinkedSources.length <= 1,
      source_errors: [
        ...authorityErrors,
        ...(distinctLinkedSources.length > 1
          ? [{ code: 'ambiguous_join', source_ref: gateOutcomeLedger?.artifact ?? '.vibepro/gate-outcomes/ledger.json' }]
          : [])
      ]
    });
  }
  return sources;
}

export function projectDecisionOutcomeSummary(ledger, { limit = 20 } = {}) {
  if (!ledger) return null;
  const boundedLimit = Math.max(0, Math.min(20, Number.isFinite(limit) ? Math.floor(limit) : 20));
  const sorted = [...(ledger.traces ?? [])].sort((a, b) => {
    const statusDiff = (SUMMARY_STATUS_ORDER.get(a.trace_status) ?? 9) - (SUMMARY_STATUS_ORDER.get(b.trace_status) ?? 9);
    return statusDiff || compareTraceSelectors(a, b);
  });
  const selected = sorted.slice(0, boundedLimit);
  const counts = Object.fromEntries([...SUMMARY_STATUS_ORDER.keys()].map((status) => [status, 0]));
  for (const trace of sorted) counts[trace.trace_status] = (counts[trace.trace_status] ?? 0) + 1;
  return {
    schema_version: DECISION_OUTCOME_LEDGER_VERSION,
    story_id: ledger.story_id ?? null,
    ledger_path: ledger.artifact_path ?? null,
    ledger_digest: ledger.artifact_digest ?? digestCanonical(stripVolatile(ledger)),
    evidence_head_sha: ledger.evidence_head_sha ?? null,
    total_count: sorted.length,
    returned_count: selected.length,
    omitted_count: Math.max(0, sorted.length - selected.length),
    truncated: selected.length < sorted.length,
    status_counts: counts,
    entries: selected.map(projectTrace)
  };
}

function buildTrace({ storyId, source, subjectKey = null, collisionReason = null, verificationEvidence, currentHeadSha, delivery, observations }) {
  const sourceRef = buildTraceSourceRef(storyId, source);
  const legacySourceRef = buildLegacyMultiplicityTraceSourceRef(storyId, source);
  const collisionGroup = collisionReason
    ? `cg_${digestCanonical(collisionReason === 'ambiguous_subject_instance'
      ? { story_id: storyId, reason: collisionReason, normalized_subject_key: subjectKey }
      : {
          story_id: storyId,
          reason: collisionReason,
          source_kind: source.source_kind,
          source_ref: source.source_ref,
          native_id: source.native_id
        })}`
    : null;
  const decisionTraceId = collisionReason ? null : `dt_${digestCanonical({ story_id: storyId, normalized_subject_key: subjectKey })}`;
  const behaviorDelta = buildBehaviorDelta({ storyId, subjectKey, verificationEvidence, currentHeadSha });
  const normalizedDelivery = normalizeDelivery(delivery, storyId);
  const sourceErrors = [...(source.source_errors ?? []), ...(normalizedDelivery.source_errors ?? [])];
  const finding = normalizeClaim(source.finding, source, 'finding');
  const decision = normalizeClaim(source.decision, source, 'decision');
  const gate = normalizeClaim(source.gate_claim, source, 'gate');
  const detector = normalizeClaim(source.detector_claim, source, 'detector');
  const disposition = normalizeClaim(source.disposition_claim, source, 'disposition');
  const parentCore = {
    story_id: storyId,
    decision_trace_id: decisionTraceId,
    collision_group: collisionGroup,
    trace_source_ref: sourceRef,
    normalized_subject_key: subjectKey,
    source_identity: {
      source_kind: source.source_kind,
      source_ref: source.source_ref,
      native_id: source.native_id,
      digest: source.source_digest,
      multiplicity: source.source_multiplicity ?? 1
    },
    evidence_head_sha: currentHeadSha,
    behavior_delta: behaviorDelta,
    delivery: normalizedDelivery.value
  };
  const parentRevision = digestCanonical(stripVolatile(parentCore));
  const legacyParentRevision = legacySourceRef === sourceRef
    ? parentRevision
    : digestCanonical(stripVolatile({ ...parentCore, trace_source_ref: legacySourceRef }));
  const selector = decisionTraceId
    ? { decision_trace_id: decisionTraceId }
    : { collision_group: collisionGroup, trace_source_ref: sourceRef };
  const legacySelector = decisionTraceId
    ? selector
    : { collision_group: collisionGroup, trace_source_ref: legacySourceRef };
  const observationResult = resolveObservation({
    observations,
    storyId,
    selector,
    parentRevision,
    selectorAliases: [legacySelector],
    parentRevisionAliases: [legacyParentRevision]
  });
  const observationReadAliases = legacySourceRef === sourceRef
    ? []
    : [{
        trace_selector: legacySelector,
        parent_revision_fingerprint: legacyParentRevision
      }];
  sourceErrors.push(...observationResult.source_errors);
  const eligibleSources = buildEligibleOutcomeSources(behaviorDelta, source);
  const traceStatus = classifyTraceStatus({ collisionReason, sourceErrors, behaviorDelta, delivery: normalizedDelivery.value, observation: observationResult.outcome });
  const revisionFingerprint = digestCanonical({
    parent_revision_fingerprint: parentRevision,
    downstream_outcome: observationResult.outcome,
    observation_identity: observationResult.identity
  });

  return {
    decision_trace_id: decisionTraceId,
    collision_group: collisionGroup,
    trace_source_ref: sourceRef,
    normalized_subject_key: subjectKey,
    source_identity: parentCore.source_identity,
    evidence_head_sha: currentHeadSha,
    parent_revision_fingerprint: parentRevision,
    revision_fingerprint: revisionFingerprint,
    observation_identity: observationResult.identity,
    observation_read_aliases: observationReadAliases,
    trace_status: traceStatus,
    missing_reason: collisionReason ?? observationResult.outcome.missing_reason ?? null,
    finding,
    gate,
    detector,
    disposition,
    decision,
    behavior_delta: behaviorDelta,
    delivery: normalizedDelivery.value,
    downstream_outcome: observationResult.outcome,
    eligible_outcome_sources: boundEligibleSources(eligibleSources),
    source_errors: sourceErrors
  };
}

function reviseTrace({ trace, storyId, delivery, observations, evidenceHeadSha }) {
  const normalizedDelivery = normalizeDelivery(delivery ?? trace.delivery, storyId, trace.delivery);
  const selector = trace.decision_trace_id
    ? { decision_trace_id: trace.decision_trace_id }
    : { collision_group: trace.collision_group, trace_source_ref: trace.trace_source_ref };
  const parentCore = {
    story_id: storyId,
    decision_trace_id: trace.decision_trace_id,
    collision_group: trace.collision_group,
    trace_source_ref: trace.trace_source_ref,
    normalized_subject_key: trace.normalized_subject_key,
    source_identity: trace.source_identity ?? null,
    evidence_head_sha: evidenceHeadSha,
    behavior_delta: trace.behavior_delta,
    delivery: normalizedDelivery.value
  };
  const parentRevision = digestCanonical(stripVolatile(parentCore));
  const readAliases = observationReadAliasesForTrace(trace, storyId);
  const observationResult = resolveObservation({
    observations,
    storyId,
    selector,
    parentRevision,
    selectorAliases: readAliases.map((alias) => alias.trace_selector),
    parentRevisionAliases: readAliases.map((alias) => alias.parent_revision_fingerprint)
  });
  const sourceErrors = [
    ...(trace.source_errors ?? []).filter((error) => !String(error?.code ?? '').startsWith('observation_') && error?.code !== 'delivery_binding_mismatch'),
    ...normalizedDelivery.source_errors,
    ...observationResult.source_errors
  ];
  return {
    ...trace,
    evidence_head_sha: evidenceHeadSha,
    parent_revision_fingerprint: parentRevision,
    revision_fingerprint: digestCanonical({
      parent_revision_fingerprint: parentRevision,
      downstream_outcome: observationResult.outcome,
      observation_identity: observationResult.identity
    }),
    observation_identity: observationResult.identity,
    observation_read_aliases: readAliases,
    trace_status: classifyTraceStatus({
      collisionReason: trace.decision_trace_id ? null : trace.missing_reason,
      sourceErrors,
      behaviorDelta: trace.behavior_delta,
      delivery: normalizedDelivery.value,
      observation: observationResult.outcome
    }),
    missing_reason: trace.decision_trace_id ? (observationResult.outcome.missing_reason ?? null) : trace.missing_reason,
    delivery: normalizedDelivery.value,
    downstream_outcome: observationResult.outcome,
    source_errors: sourceErrors
  };
}

export function matchesDecisionOutcomeObservation(trace, observation) {
  if (!trace || !observation) return false;
  const currentSelector = trace.decision_trace_id
    ? { decision_trace_id: trace.decision_trace_id }
    : { collision_group: trace.collision_group, trace_source_ref: trace.trace_source_ref };
  const bindings = [{
    trace_selector: currentSelector,
    parent_revision_fingerprint: trace.parent_revision_fingerprint
  }, ...observationReadAliasesForTrace(trace, observation.story_id)];
  return bindings.some((binding) => selectorMatches(observation.trace_selector, binding.trace_selector)
    && observation.parent_revision_fingerprint === binding.parent_revision_fingerprint);
}

function observationReadAliasesForTrace(trace, storyId) {
  const persisted = normalizeObservationReadAliases(trace.observation_read_aliases);
  if (persisted.length > 0 || Object.hasOwn(trace, 'observation_read_aliases')) return persisted;
  const hasStableSelector = /^dt_[a-f0-9]{64}$/.test(trace.decision_trace_id ?? '');
  const hasCollisionSelector = trace.decision_trace_id == null
    && /^cg_[a-f0-9]{64}$/.test(trace.collision_group ?? '')
    && /^tsr_[a-f0-9]{64}$/.test(trace.trace_source_ref ?? '');
  if (!storyId || (!hasStableSelector && !hasCollisionSelector) || !trace.source_identity) return [];

  const reconstructedSource = {
    normalized_subject_key: trace.normalized_subject_key ?? null,
    source_kind: trace.source_identity.source_kind ?? 'unknown',
    source_ref: trace.source_identity.source_ref ?? null,
    native_id: trace.source_identity.native_id ?? null,
    role: trace.detector?.value?.detected_by ?? null,
    stage: trace.detector?.value?.stage ?? null,
    source_instance_digest: trace.source_identity.digest ?? null,
    source_multiplicity: trace.source_identity.multiplicity ?? 1
  };
  if (!reconstructedSource.source_instance_digest
    || buildTraceSourceRef(storyId, reconstructedSource) !== trace.trace_source_ref) return [];

  const legacySourceRef = buildLegacyMultiplicityTraceSourceRef(storyId, reconstructedSource);
  if (legacySourceRef === trace.trace_source_ref) return [];
  const legacyParentCore = {
    story_id: storyId,
    decision_trace_id: trace.decision_trace_id,
    collision_group: trace.collision_group,
    trace_source_ref: legacySourceRef,
    normalized_subject_key: trace.normalized_subject_key,
    source_identity: trace.source_identity,
    evidence_head_sha: trace.evidence_head_sha ?? null,
    behavior_delta: trace.behavior_delta,
    delivery: trace.delivery
  };
  return [{
    trace_selector: hasStableSelector
      ? { decision_trace_id: trace.decision_trace_id }
      : { collision_group: trace.collision_group, trace_source_ref: legacySourceRef },
    parent_revision_fingerprint: digestCanonical(stripVolatile(legacyParentCore))
  }];
}

function normalizeObservationReadAliases(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isValidObservationReadAlias);
}

function isValidObservationReadAlias(alias) {
  if (!alias || typeof alias !== 'object' || Array.isArray(alias)
    || !/^[a-f0-9]{64}$/.test(alias.parent_revision_fingerprint ?? '')) return false;
  const selector = alias.trace_selector;
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) return false;
  const keys = Object.keys(selector).sort();
  if (keys.length === 1 && keys[0] === 'decision_trace_id') {
    return /^dt_[a-f0-9]{64}$/.test(selector.decision_trace_id ?? '');
  }
  return keys.length === 2
    && keys[0] === 'collision_group'
    && keys[1] === 'trace_source_ref'
    && /^cg_[a-f0-9]{64}$/.test(selector.collision_group ?? '')
    && /^tsr_[a-f0-9]{64}$/.test(selector.trace_source_ref ?? '');
}

function normalizeSource(storyId, source = {}) {
  const cleaned = stripVolatile(source);
  return {
    ...source,
    story_id: storyId,
    source_kind: source.source_kind ?? 'unknown',
    source_ref: source.source_ref ?? null,
    native_id: source.native_id ?? source.finding?.id ?? source.decision?.decision_id ?? null,
    normalized_subject_key: normalizeSubjectKey(source.normalized_subject_key),
    source_instance_digest: digestCanonical(cleaned),
    source_multiplicity: 1,
    source_digest: source.source_digest ?? digestCanonical(cleaned),
    source_errors: Array.isArray(source.source_errors) ? source.source_errors : [],
    gate_claim: source.gate_claim ?? (source.source_kind === 'gate_outcome' ? { gate_id: source.decision?.gate_id ?? source.native_id ?? null } : null),
    detector_claim: source.detector_claim ?? (source.finding ? { detected_by: source.role ?? null, stage: source.stage ?? null, detected_head_sha: source.source_head_sha ?? null } : null),
    disposition_claim: source.disposition_claim ?? (source.source_kind === 'finding_disposition' ? source.decision ?? null : null)
  };
}

function collapseDuplicateSources(sources) {
  const collapsed = new Map();
  for (const source of sources) {
    const key = canonicalStringify({
      source_kind: source.source_kind,
      source_ref: source.source_ref,
      native_id: source.native_id,
      normalized_subject_key: source.normalized_subject_key,
      role: source.role ?? null,
      stage: source.stage ?? null,
      source_instance_digest: source.source_instance_digest
    });
    const existing = collapsed.get(key);
    if (existing) existing.source_multiplicity += 1;
    else collapsed.set(key, { ...source });
  }
  return [...collapsed.values()];
}

function mergeLinkedSources(sources) {
  const primary = sources[0];
  const decisionSources = sources.filter((source) => source.decision && source.source_kind !== 'gate_outcome');
  const authoritativeDecisionSources = decisionSources.filter(isClaimAuthorityValid);
  const authoritativeFindingSources = sources.filter((source) => source.finding && isClaimAuthorityValid(source));
  const authoritativeGateSources = sources.filter((source) => source.gate_claim && isClaimAuthorityValid(source));
  const authoritativeDetectorSources = sources.filter((source) => source.detector_claim && isClaimAuthorityValid(source));
  const authoritativeDispositionSources = sources.filter((source) => source.disposition_claim && isClaimAuthorityValid(source));
  const claimGroups = [
    authoritativeDecisionSources.map((source) => source.decision),
    authoritativeFindingSources.map((source) => source.finding),
    authoritativeGateSources.map((source) => source.gate_claim),
    authoritativeDetectorSources.map((source) => source.detector_claim),
    authoritativeDispositionSources.map((source) => source.disposition_claim)
  ];
  const hasClaimConflict = claimGroups.some((claims) => (
    new Set(claims.map((claim) => digestCanonical(stripVolatile(claim)))).size > 1
  ));
  const conflicts = hasClaimConflict
    ? [{ code: 'claim_conflict', source_ref: sources.map((source) => source.source_ref).filter(Boolean).sort().join(',') || null }]
    : [];
  return {
    ...primary,
    source_kind: 'linked_sources',
    source_ref: sources.map((source) => source.source_ref).filter(Boolean).sort().join(',') || null,
    native_id: sources.map((source) => source.native_id).filter(Boolean).sort().join(',') || null,
    source_digest: digestCanonical(sources.map((source) => ({
      source_kind: source.source_kind,
      source_ref: source.source_ref,
      source_digest: source.source_digest
    })).sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)))),
    source_instance_digest: digestCanonical(sources.map(stripVolatile)),
    source_provenance: sources.map((source) => ({
      source_kind: source.source_kind,
      source_ref: source.source_ref ?? null,
      source_digest: source.source_digest ?? null,
      source_head_sha: source.source_head_sha ?? null,
      native_id: source.native_id ?? null
    })).sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b))),
    claim_provenance: {
      finding: sources.filter((source) => source.finding).map(provenanceFor),
      decision: [decisionSources.at(-1), ...decisionSources.slice(0, -1)].filter(Boolean).map(provenanceFor),
      gate: sources.filter((source) => source.gate_claim).map(provenanceFor),
      detector: sources.filter((source) => source.detector_claim).map(provenanceFor),
      disposition: sources.filter((source) => source.disposition_claim).reverse().map(provenanceFor)
    },
    finding: authoritativeFindingSources[0]?.finding ?? null,
    decision: authoritativeDecisionSources.at(-1)?.decision ?? null,
    gate_claim: authoritativeGateSources[0]?.gate_claim ?? null,
    detector_claim: authoritativeDetectorSources[0]?.detector_claim ?? null,
    disposition_claim: authoritativeDispositionSources.at(-1)?.disposition_claim ?? null,
    source_errors: [...sources.flatMap((source) => source.source_errors ?? []), ...conflicts],
    authority_valid: sources.every((source) => source.authority_valid !== false),
    explicit_link: true
  };
}

function provenanceFor(source) {
  if (!source) return null;
  return {
    source_kind: source.source_kind,
    source_ref: source.source_ref ?? null,
    source_digest: source.source_digest ?? null,
    source_head_sha: source.source_head_sha ?? null,
    native_id: source.native_id ?? null,
    authority_valid: source.authority_valid
  };
}

function isClaimAuthorityValid(source) {
  return source?.source_kind === 'review_source_error' || source?.authority_valid !== false;
}

function normalizeSubjectKey(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^(?:finding|gate):[^\s]+$/.test(normalized) ? normalized : null;
}

function buildTraceSourceRef(storyId, source) {
  return `tsr_${digestCanonical({
    story_id: storyId,
    normalized_subject_key: source.normalized_subject_key,
    source_kind: source.source_kind,
    source_ref: source.source_ref,
    native_id: source.native_id,
    role: source.role ?? null,
    stage: source.stage ?? null,
    source_instance_digest: source.source_instance_digest
  })}`;
}

// 0.1.0 ledgers originally included multiplicity in the public selector. Keep
// this deterministic alias so persisted observations survive the selector fix.
function buildLegacyMultiplicityTraceSourceRef(storyId, source) {
  return `tsr_${digestCanonical({
    story_id: storyId,
    normalized_subject_key: source.normalized_subject_key,
    source_kind: source.source_kind,
    source_ref: source.source_ref,
    native_id: source.native_id,
    role: source.role ?? null,
    stage: source.stage ?? null,
    source_instance_digest: source.source_instance_digest,
    source_multiplicity: source.source_multiplicity ?? 1
  })}`;
}

function buildBehaviorDelta({ storyId, subjectKey, verificationEvidence, currentHeadSha }) {
  const accepted = [];
  const excluded = [];
  const fallbackSourceDigest = digestCanonical({
    ...stripVolatile(verificationEvidence ?? {}),
    commands: (verificationEvidence?.commands ?? [])
      .map((command) => stripVolatile(command))
      .sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)))
  });
  for (const [index, command] of (verificationEvidence?.commands ?? []).entries()) {
    const commandSubjectKey = normalizeSubjectKey(command?.observation?.values?.decision_trace_key);
    if (subjectKey == null || commandSubjectKey == null || commandSubjectKey !== subjectKey) continue;
    const recordedHead = command?.git_context?.head_sha ?? command?.git?.head_sha ?? null;
    const bindingStatus = resolveCommandBindingStatus(command, currentHeadSha);
    if (bindingStatus === 'stale') {
      excluded.push({ index, command: command.command ?? null, reason: 'content_binding_stale' });
      continue;
    }
    const hasExplicitContentBinding = Boolean(command?.content_binding);
    const hasCurrentBinding = bindingStatus === 'current'
      || (!hasExplicitContentBinding && Boolean(currentHeadSha && recordedHead && currentHeadSha === recordedHead));
    if (currentHeadSha && !hasCurrentBinding) {
      excluded.push({
        index,
        command: command.command ?? null,
        reason: hasExplicitContentBinding
          ? 'content_binding_unverified'
          : (recordedHead ? 'strict_head_mismatch' : 'current_head_binding_missing')
      });
      continue;
    }
    const before = command?.observation?.values?.behavior_before;
    const after = command?.observation?.values?.behavior_after;
    if (before == null || after == null) {
      excluded.push({ index, command: command.command ?? null, reason: 'explicit_behavior_delta_missing' });
      continue;
    }
    accepted.push({
      before,
      after,
      change_refs: uniqueBy((command?.observation?.targets ?? []).filter((item) => typeof item === 'string'), (item) => item).sort(),
      verification_ref: command.command ?? `command:${digestCanonical(stripVolatile(command))}`,
      source_ref: verificationEvidence?.artifact ?? `.vibepro/pr/${storyId}/verification-evidence.json`,
      source_digest: verificationEvidence?.artifact_digest ?? fallbackSourceDigest
    });
  }
  accepted.sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)));
  const deltaGroups = groupBy(accepted.map((item) => ({
    ...item,
    delta_key: digestCanonical({ before: item.before, after: item.after })
  })), 'delta_key');
  const conflicting = deltaGroups.size > 1;
  const selectedGroup = conflicting ? [] : (deltaGroups.values().next().value ?? []);
  const selected = selectedGroup[0] ?? null;
  const verificationRefs = uniqueBy(accepted.map((item) => item.verification_ref), (item) => item).sort();
  const verificationSources = uniqueBy(accepted.map((item) => ({
    kind: 'verification_evidence',
    ref: item.source_ref,
    digest: item.source_digest
  })), (item) => `${item.kind}|${item.ref}|${item.digest}`)
    .sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)));
  return {
    status: conflicting ? 'conflicting' : (selected ? 'observed' : (excluded.length > 0 ? 'partial' : 'not_observed')),
    before: selected?.before ?? null,
    after: selected?.after ?? null,
    change_refs: uniqueBy(selectedGroup.flatMap((item) => item.change_refs), (item) => item).sort(),
    verification_refs: verificationRefs,
    verification_sources: verificationSources,
    missing_reason: conflicting ? 'behavior_delta_conflict' : (selected ? null : (excluded[0]?.reason ?? 'explicit_behavior_delta_missing')),
    ...(conflicting ? {
      conflicts: [...deltaGroups.values()].map((items) => ({
        before: items[0].before,
        after: items[0].after,
        verification_refs: uniqueBy(items.map((item) => item.verification_ref), (item) => item).sort()
      })).sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)))
    } : {}),
    excluded_sources: excluded
  };
}

function resolveCommandBindingStatus(command, currentHeadSha) {
  const contentBinding = command?.content_binding;
  const evaluatedContentBinding = command?.binding?.content_binding;
  if (contentBinding) {
    if (command?.binding?.status === 'stale') return 'stale';
    if (evaluatedContentBinding && command?.binding?.status === 'current') return 'current';
    if (contentBinding.status === 'stale') return 'stale';
    if (contentBinding.mode === 'strict_head') {
      return contentBinding.recorded_head_sha && contentBinding.recorded_head_sha === currentHeadSha ? 'current' : 'stale';
    }
    if (contentBinding.mode === 'content_surface') {
      // Raw production evidence records the surface but does not prove that it
      // is still current. Only the asynchronous PR preparation evaluation may
      // promote it to a current command binding.
      return null;
    }
    return null;
  }
  return command?.binding?.status ?? null;
}

function normalizeDelivery(delivery, storyId, expectedDelivery = null) {
  if (!delivery) {
    return {
      value: { status: 'not_delivered', pr: null, merge: null },
      source_errors: []
    };
  }
  if (delivery.story_id && delivery.story_id !== storyId) {
    return {
      value: { status: 'conflicting', pr: delivery.pr ?? null, merge: delivery.merge ?? null },
      source_errors: [{ code: 'delivery_binding_mismatch', source_ref: delivery.source_ref ?? null }]
    };
  }
  const expectedPrUrl = expectedDelivery?.pr?.url ?? null;
  const incomingPrUrl = delivery.pr?.url ?? null;
  const expectedExplicitPrNumber = expectedDelivery?.pr?.number ?? null;
  const incomingExplicitPrNumber = delivery.pr?.number ?? null;
  const expectedUrlPrNumber = parseDeliveryPrNumber(expectedPrUrl);
  const incomingUrlPrNumber = parseDeliveryPrNumber(incomingPrUrl);
  const expectedPrNumber = expectedExplicitPrNumber ?? expectedUrlPrNumber;
  const incomingPrNumber = incomingExplicitPrNumber ?? incomingUrlPrNumber;
  const expectedMergeSha = expectedDelivery?.merge?.sha ?? null;
  const incomingMergeSha = delivery.merge?.sha ?? null;
  if ((expectedExplicitPrNumber != null && expectedUrlPrNumber != null && expectedExplicitPrNumber !== expectedUrlPrNumber)
    || (incomingExplicitPrNumber != null && incomingUrlPrNumber != null && incomingExplicitPrNumber !== incomingUrlPrNumber)
    || (expectedPrUrl && incomingPrUrl && expectedPrUrl !== incomingPrUrl)
    || (expectedPrNumber != null && incomingPrNumber != null && expectedPrNumber !== incomingPrNumber)
    || (expectedMergeSha && incomingMergeSha && expectedMergeSha !== incomingMergeSha)) {
    return {
      value: { status: 'conflicting', pr: delivery.pr ?? null, merge: delivery.merge ?? null },
      source_errors: [{ code: 'delivery_binding_mismatch', source_ref: delivery.source_ref ?? null }]
    };
  }
  const resolvedPrNumber = incomingPrNumber ?? expectedPrNumber;
  const resolvedPrUrl = incomingPrUrl ?? expectedPrUrl;
  const resolvedMergeSha = incomingMergeSha ?? expectedMergeSha;
  const resolvedUrlPrNumber = parseDeliveryPrNumber(resolvedPrUrl);
  if (resolvedPrNumber != null && resolvedUrlPrNumber != null && resolvedPrNumber !== resolvedUrlPrNumber) {
    return {
      value: { status: 'conflicting', pr: delivery.pr ?? null, merge: delivery.merge ?? null },
      source_errors: [{ code: 'delivery_binding_mismatch', source_ref: delivery.source_ref ?? null }]
    };
  }
  const incomingStatus = delivery.status ?? (delivery.merge?.sha ? 'merged' : delivery.pr ? 'pr_created' : 'not_delivered');
  return {
    value: {
      status: incomingStatus,
      pr: delivery.pr ? {
        ...delivery.pr,
        ...(resolvedPrNumber == null ? {} : { number: resolvedPrNumber }),
        ...(resolvedPrUrl == null ? {} : { url: resolvedPrUrl }),
        state: delivery.pr.state ?? null
      } : null,
      merge: delivery.merge ? {
        ...delivery.merge,
        ...(resolvedMergeSha == null ? {} : { sha: resolvedMergeSha }),
        status: delivery.merge.status ?? null,
        merged_at: delivery.merge.merged_at ?? null
      } : null
    },
    source_errors: []
  };
}

function parseDeliveryPrNumber(prUrl) {
  const match = String(prUrl ?? '').match(/\/pull\/(\d+)(?:\/|$)|\/pr\/(\d+)(?:\/|$)/);
  return match ? Number(match[1] ?? match[2]) : null;
}

function resolveObservation({
  observations,
  storyId,
  selector,
  parentRevision,
  selectorAliases = [],
  parentRevisionAliases = []
}) {
  if (!Array.isArray(observations) || observations.length === 0) {
    return { outcome: missingObservation(), identity: null, source_errors: [] };
  }
  const selectors = uniqueSelectors([selector, ...selectorAliases]);
  const selectedSelector = selectors.find((candidate) => observations.some((item) => selectorMatches(item?.trace_selector, candidate)));
  const selectorCandidates = selectedSelector
    ? observations.filter((item) => selectorMatches(item?.trace_selector, selectedSelector))
    : [];
  if (selectorCandidates.length === 0) {
    return { outcome: missingObservation(), identity: null, source_errors: [] };
  }
  const parentRevisions = [...new Set([parentRevision, ...parentRevisionAliases].filter(Boolean))];
  const selectedParentRevision = parentRevisions.find((revision) => selectorCandidates.some((item) => (
    item?.story_id === storyId && item?.parent_revision_fingerprint === revision
  )));
  const candidates = selectedParentRevision
    ? selectorCandidates.filter((item) => item?.story_id === storyId && item?.parent_revision_fingerprint === selectedParentRevision)
    : [];
  if (candidates.length !== 1) {
    return observationError('observation_binding_mismatch', candidates[0]?.source_ref ?? selectorCandidates[0]?.source_ref ?? null);
  }
  const observation = candidates[0];
  const validation = validateDecisionOutcomeObservation(observation, {
    storyId,
    selector: selectedSelector,
    parentRevision: selectedParentRevision
  });
  if (!validation.valid) return observationError(validation.code, observation.source_ref ?? null);
  if (observation.status === 'observed' && observation.value != null) {
    return {
      outcome: { status: 'observed', value: observation.value, reason: null, source_ref: observation.source_ref ?? null, missing_reason: null },
      identity: { observation_id: observation.observation_id ?? null, source_digest: observation.authority.source_digest },
      source_errors: []
    };
  }
  if (observation.status === 'not_applicable' && observation.reason) {
    return {
      outcome: { status: 'not_applicable', value: null, reason: observation.reason, source_ref: observation.source_ref ?? null, missing_reason: null },
      identity: { observation_id: observation.observation_id ?? null, source_digest: observation.authority.source_digest },
      source_errors: []
    };
  }
  return observationError('observation_malformed', observation.source_ref ?? null);
}

function uniqueSelectors(selectors) {
  const seen = new Set();
  return selectors.filter((selector) => {
    const key = selector?.decision_trace_id
      ? `decision:${selector.decision_trace_id}`
      : `collision:${selector?.collision_group ?? ''}:${selector?.trace_source_ref ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateDecisionOutcomeObservation(observation, expected = {}) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    return { valid: false, code: 'observation_malformed' };
  }
  const selector = observation.trace_selector;
  const selectorValid = selector && typeof selector === 'object' && !Array.isArray(selector)
    && ((safeString(selector.decision_trace_id, 128)
      && selector.collision_group == null
      && selector.trace_source_ref == null)
      || (selector.decision_trace_id == null
        && safeString(selector.collision_group, 128)
        && safeString(selector.trace_source_ref, 128)));
  const structural = observation.schema_version === '0.1.0'
    && /^obs_[a-f0-9]{64}$/.test(String(observation.observation_id ?? ''))
    && safeString(observation.story_id, 256)
    && selectorValid
    && safeString(observation.parent_revision_fingerprint, 256)
    && ['observed', 'not_applicable'].includes(observation.status)
    && validObservedAt(observation.observed_at)
    && safeString(observation.producer, 256)
    && safeObservationSourceRef(observation.source_ref)
    && ((observation.status === 'observed' && observation.value != null && observation.reason == null)
      || (observation.status === 'not_applicable'
        && observation.value == null
        && safeString(observation.reason, 4096)));
  if (!structural || !isJsonSafeValue(observation)) return { valid: false, code: 'observation_malformed' };

  const { observation_id: ignored, ...core } = observation;
  if (observation.observation_id !== `obs_${digestCanonical(core)}`) {
    return { valid: false, code: 'observation_malformed' };
  }
  if (expected.storyId != null && observation.story_id !== expected.storyId) {
    return { valid: false, code: 'observation_binding_mismatch' };
  }
  if (expected.parentRevision != null && observation.parent_revision_fingerprint !== expected.parentRevision) {
    return { valid: false, code: 'observation_binding_mismatch' };
  }
  if (expected.selector != null && !selectorMatches(selector, expected.selector)) {
    return { valid: false, code: 'observation_binding_mismatch' };
  }
  const authority = observation.authority;
  if (!authority || !['verification_evidence', 'decision_record'].includes(authority.kind)
    || authority.recorded_by !== 'vibepro'
    || !/^[a-f0-9]{64}$/.test(String(authority.source_digest ?? ''))) {
    return { valid: false, code: 'observation_untrusted' };
  }
  return { valid: true, code: null };
}

function safeString(value, maxLength) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeObservationSourceRef(value) {
  if (!safeString(value, 2048)
    || value !== value.trim()
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || /^[a-z]:/i.test(value)
    || value.includes('\\')
    || value.includes('%')) return false;
  return !value.split('/').some((segment) => segment === '.' || segment === '..' || segment === '');
}

function validObservedAt(value) {
  if (typeof value !== 'string' || !value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function observationError(code, sourceRef) {
  return {
    outcome: { ...missingObservation(), missing_reason: code, source_ref: sourceRef },
    identity: null,
    source_errors: [{ code, source_ref: sourceRef }]
  };
}

function missingObservation() {
  return { status: 'not_observed', value: null, reason: null, source_ref: null, missing_reason: 'observation_missing' };
}

function buildEligibleOutcomeSources(behaviorDelta, source) {
  const candidates = [];
  if (behaviorDelta.status === 'observed') {
    candidates.push(...(behaviorDelta.verification_sources ?? []));
  }
  const decisionProvenanceEntries = source.source_kind === 'decision_record'
    ? [provenanceFor(source)]
    : (Array.isArray(source.claim_provenance?.decision)
        ? source.claim_provenance.decision
        : [source.claim_provenance?.decision].filter(Boolean));
  const decisionProvenance = decisionProvenanceEntries.find((entry) => (
    entry?.source_kind === 'decision_record'
      && entry.authority_valid === true
      && entry.source_ref
      && entry.source_digest
  ));
  if (source.decision?.type === 'waiver'
    && source.decision?.status === 'accepted'
    && decisionProvenance) {
    candidates.push({
      kind: 'decision_record',
      ref: decisionProvenance.source_ref,
      digest: decisionProvenance.source_digest
    });
  }
  return uniqueBy(candidates, (item) => `${item.kind}|${item.ref}|${item.digest}`)
    .sort((a, b) => `${a.kind}|${a.ref}|${a.digest}`.localeCompare(`${b.kind}|${b.ref}|${b.digest}`));
}

function boundEligibleSources(sources) {
  const entries = sources.slice(0, 5);
  return {
    total_count: sources.length,
    returned_count: entries.length,
    omitted_count: Math.max(0, sources.length - entries.length),
    truncated: entries.length < sources.length,
    entries
  };
}

function classifyTraceStatus({ collisionReason, sourceErrors, behaviorDelta, delivery, observation }) {
  if (sourceErrors.length > 0 || delivery.status === 'conflicting' || behaviorDelta.status === 'conflicting') return 'conflicting';
  if (collisionReason) return 'incomplete';
  if (behaviorDelta.status !== 'observed' || delivery.status === 'not_delivered' || observation.status === 'not_observed') return 'partial';
  return 'complete';
}

function normalizeClaim(value, source, claimKind) {
  if (!value) return { status: 'not_observed', value: null, provenance: [] };
  const provenance = source.claim_provenance?.[claimKind] ?? source;
  const provenanceEntries = Array.isArray(provenance) ? provenance : [provenance];
  const authoritativeProvenance = provenanceEntries.filter(isClaimAuthorityValid);
  if (authoritativeProvenance.length === 0) {
    return { status: 'not_observed', value: null, provenance: [] };
  }
  return {
    status: 'observed',
    value,
    provenance: authoritativeProvenance.map((entry) => ({
      source_kind: entry.source_kind,
      source_ref: entry.source_ref,
      source_head_sha: entry.source_head_sha ?? null,
      source_digest: entry.source_digest,
      native_id: entry.native_id ?? null
    }))
  };
}

function projectTrace(trace) {
  return {
    decision_trace_id: trace.decision_trace_id,
    collision_group: trace.collision_group,
    trace_source_ref: trace.trace_source_ref,
    parent_revision_fingerprint: trace.parent_revision_fingerprint,
    revision_fingerprint: trace.revision_fingerprint,
    trace_status: trace.trace_status,
    missing_reason: trace.missing_reason,
    finding_status: trace.finding?.status ?? 'not_observed',
    gate_status: trace.gate?.status ?? 'not_observed',
    detector_status: trace.detector?.status ?? 'not_observed',
    disposition_status: trace.disposition?.status ?? 'not_observed',
    decision_status: trace.decision?.status ?? 'not_observed',
    behavior_delta_status: trace.behavior_delta?.status ?? 'not_observed',
    delivery_status: trace.delivery?.status ?? 'not_delivered',
    downstream_outcome_status: trace.downstream_outcome?.status ?? 'not_observed',
    finding: projectClaim(trace.finding, ['id', 'summary', 'status', 'severity']),
    gate: projectClaim(trace.gate, ['gate_id', 'status', 'outcome', 'reason']),
    detector: projectClaim(trace.detector, ['detected_by', 'stage', 'detected_head_sha']),
    disposition: projectClaim(trace.disposition, ['finding_id', 'disposition', 'status', 'reason', 'rationale']),
    decision: projectClaim(trace.decision, ['decision_id', 'type', 'status', 'source', 'reason', 'rationale']),
    behavior_delta: {
      status: trace.behavior_delta?.status ?? 'not_observed',
      before: projectBoundedValue(trace.behavior_delta?.before),
      after: projectBoundedValue(trace.behavior_delta?.after),
      change_refs: projectBoundedValue(trace.behavior_delta?.change_refs ?? []),
      verification_refs: projectBoundedValue(trace.behavior_delta?.verification_refs ?? []),
      missing_reason: trace.behavior_delta?.missing_reason ?? null
    },
    delivery: {
      status: trace.delivery?.status ?? 'not_delivered',
      pr: projectBoundedValue(trace.delivery?.pr, ['number', 'url', 'state']),
      merge: projectBoundedValue(trace.delivery?.merge, ['sha', 'status', 'merged_at'])
    },
    downstream_outcome: {
      status: trace.downstream_outcome?.status ?? 'not_observed',
      value: projectBoundedValue(trace.downstream_outcome?.value),
      reason: redactBoundedString(trace.downstream_outcome?.reason),
      source_ref: redactBoundedString(trace.downstream_outcome?.source_ref),
      missing_reason: trace.downstream_outcome?.missing_reason ?? null
    },
    eligible_outcome_sources: trace.eligible_outcome_sources
  };
}

function projectClaim(claim, allowedKeys) {
  return {
    status: claim?.status ?? 'not_observed',
    value: claim?.status === 'observed' ? projectBoundedValue(claim.value, allowedKeys) : null
  };
}

function projectBoundedValue(value, allowedKeys = null, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value ?? null;
  if (typeof value === 'string') return redactBoundedString(value);
  if (depth >= 2) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, SUMMARY_ARRAY_ITEMS).map((item) => projectBoundedValue(item, null, depth + 1));
  if (typeof value !== 'object') return '[UNSUPPORTED]';
  const keys = (allowedKeys ?? Object.keys(value).sort()).filter((key) => Object.hasOwn(value, key)).slice(0, SUMMARY_VALUE_KEYS);
  return Object.fromEntries(keys.map((key) => [
    key,
    SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : projectBoundedValue(value[key], null, depth + 1)
  ]));
}

function redactBoundedString(value) {
  if (typeof value !== 'string') return value ?? null;
  const redacted = value
    .replace(/gh[pousr]_[A-Za-z0-9_=-]+/g, '[REDACTED]')
    .replace(/(bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/((?:authorization|api[_-]?key|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  return redacted.length <= SUMMARY_TEXT_LENGTH ? redacted : `${redacted.slice(0, SUMMARY_TEXT_LENGTH - 1)}…`;
}

function isJsonSafeValue(value, ancestors = new WeakSet(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 64 || ancestors.has(value)) return false;
  ancestors.add(value);
  let valid;
  if (Array.isArray(value)) valid = value.every((item) => isJsonSafeValue(item, ancestors, depth + 1));
  else if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) valid = false;
  else valid = Object.entries(value).every(([key, item]) => safeJsonKey(key) && isJsonSafeValue(item, ancestors, depth + 1));
  ancestors.delete(value);
  return valid;
}

function safeJsonKey(key) {
  return typeof key === 'string' && !/[\u0000-\u001f\u007f]/.test(key);
}

function selectorMatches(candidate, expected) {
  if (!candidate || !expected) return false;
  if (expected.decision_trace_id) {
    return candidate.decision_trace_id === expected.decision_trace_id
      && candidate.collision_group == null
      && candidate.trace_source_ref == null;
  }
  return candidate.decision_trace_id == null
    && candidate.collision_group === expected.collision_group
    && candidate.trace_source_ref === expected.trace_source_ref;
}

function compareTraceSelectors(a, b) {
  return traceSelectorKey(a).localeCompare(traceSelectorKey(b));
}

function traceSelectorKey(trace) {
  return trace.decision_trace_id ?? `${trace.collision_group ?? ''}|${trace.trace_source_ref ?? ''}`;
}

function groupBy(items, field) {
  const groups = new Map();
  for (const item of items) {
    const key = item[field];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !VOLATILE_KEYS.has(key))
    .map(([key, nested]) => [key, stripVolatile(nested)]));
}

function digestCanonical(value) {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}
