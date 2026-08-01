import {
  buildMergeGateAuthorization,
  resolveCurrentMergeGateStatus
} from './merge-gate-authorization.js';
import { collectUnresolvedRequiredGates, isUnresolvedGateStatus } from './pr-manager.js';

// `buildMergeGateAuthorization` distinguishes twelve denial reasons, but
// `executeMerge` used to collapse every one of them into `gate_not_ready`.
// That is actively misleading: the most common denial in practice is a
// pr-create/pr-prepare artifact that is no longer bound to the current HEAD,
// which reports "gate not ready" while every gate is in fact resolved. This
// module classifies the denial so `stop_reason` names the real failure class,
// and `gate_not_ready` is reserved for unresolved or critical gate evidence.

const AUTHORIZED_AUTHORIZATION_REASONS = new Set([
  'gate_dag_ready_for_review',
  'auditable_noncritical_gate_override'
]);

const WAIVER_INCOMPLETE_AUTHORIZATION_REASONS = new Set([
  'gate_override_reason_missing',
  'gate_override_policy_missing',
  'gate_override_targets_missing',
  'gate_override_targets_invalid',
  'gate_override_critical_gates_unknown',
  'gate_override_critical_gates_invalid'
]);

const WAIVER_STALE_AUTHORIZATION_REASONS = new Set([
  'gate_override_targets_mismatch',
  'gate_override_critical_gates_mismatch'
]);

const STOP_REASON_BY_CAUSE = new Map([
  ['gates_unresolved', 'gate_not_ready'],
  ['critical_gates_unresolved', 'gate_not_ready'],
  ['gate_status_missing', 'gate_status_unresolved'],
  ['gate_status_unresolvable', 'gate_status_unresolved'],
  ['gate_status_malformed', 'gate_status_unresolved'],
  ['gate_dag_surface_mismatch', 'gate_status_unresolved'],
  ['pr_prepare_artifact_missing', 'pr_prepare_artifact_missing'],
  ['pr_prepare_artifact_stale', 'pr_prepare_artifact_stale'],
  ['pr_create_artifact_missing', 'pr_create_artifact_missing'],
  ['pr_create_artifact_stale', 'pr_create_artifact_stale'],
  ['gate_waiver_incomplete', 'gate_waiver_incomplete'],
  ['gate_waiver_stale', 'gate_waiver_stale'],
  ['gate_evidence_missing', 'gate_evidence_missing'],
  ['artifact_unreadable', 'artifact_unreadable'],
  ['gate_authorization_denied', 'gate_authorization_denied']
]);

export const MERGE_GATE_DIAGNOSIS_STOP_REASONS = new Set(STOP_REASON_BY_CAUSE.values());

export function isCurrentPrLifecycleArtifact(artifact, currentHeadSha) {
  if (!artifact || !currentHeadSha) return false;
  const artifactHeadSha = resolveArtifactHeadSha(artifact);
  if (artifact.artifact_freshness) {
    return artifact.artifact_freshness.status === 'current' && artifactHeadSha === currentHeadSha;
  }
  return artifactHeadSha === currentHeadSha;
}

export function resolveMergeGateAuthorizationContext({
  storyId = null,
  prPrepare = null,
  prCreate = null,
  gateDagArtifact = null,
  currentHeadSha = null,
  unreadableArtifacts = null
} = {}) {
  const currentPrPrepare = isCurrentPrLifecycleArtifact(prPrepare, currentHeadSha) ? prPrepare : null;
  const currentPrCreate = isCurrentPrLifecycleArtifact(prCreate, currentHeadSha) ? prCreate : null;
  const currentGateDagArtifact = isCurrentPrLifecycleArtifact(gateDagArtifact, currentHeadSha)
    ? gateDagArtifact
    : null;
  const gateDag = currentPrPrepare?.pr_context?.gate_dag
    ?? currentPrCreate?.gate_dag
    ?? currentGateDagArtifact
    ?? null;
  const currentGateStatus = resolveCurrentMergeGateStatus(
    currentPrPrepare,
    currentHeadSha,
    gateDagArtifact ?? gateDag
  );
  const gateAuthorization = buildMergeGateAuthorization(gateDag, currentPrCreate, currentGateStatus);
  const diagnosis = diagnoseMergeGateAuthorization({
    storyId,
    gateAuthorization,
    gateDag,
    currentGateStatus,
    prPrepare,
    currentPrPrepare,
    prCreate,
    currentPrCreate,
    gateDagArtifact,
    currentGateDagArtifact,
    currentHeadSha,
    unreadableArtifacts
  });
  return {
    currentPrPrepare,
    currentPrCreate,
    currentGateDagArtifact,
    gateDag,
    currentGateStatus,
    gateAuthorization,
    diagnosis
  };
}

export function diagnoseMergeGateAuthorization({
  storyId = null,
  gateAuthorization = null,
  gateDag = null,
  currentGateStatus = null,
  prPrepare = null,
  currentPrPrepare = null,
  prCreate = null,
  currentPrCreate = null,
  gateDagArtifact = null,
  currentGateDagArtifact = null,
  currentHeadSha = null,
  unreadableArtifacts = null
} = {}) {
  const authorizationReason = typeof gateAuthorization?.reason === 'string'
    ? gateAuthorization.reason
    : 'unknown';
  const artifactBindings = [
    buildArtifactBinding('pr_prepare', prPrepare, currentPrPrepare, currentHeadSha, unreadableArtifacts),
    buildArtifactBinding('pr_create', prCreate, currentPrCreate, currentHeadSha, unreadableArtifacts),
    buildArtifactBinding('gate_dag', gateDagArtifact, currentGateDagArtifact, currentHeadSha, unreadableArtifacts)
  ];
  const unreadableBindings = artifactBindings.filter((binding) => binding.status === 'unreadable');

  // Precedence must be checked before the authorized branch. An unparseable
  // artifact is treated as absent by the authority function, so a valid waiver
  // can make authorization "allowed" over input nobody could read -- while
  // `executeMerge` throws on that same state. Reporting authorized here would
  // make `--explain` contradict the command it explains.
  if (unreadableBindings.length > 0) {
    return buildBlockedDiagnosis({
      cause: 'artifact_unreadable',
      gateAuthorization,
      authorizationReason,
      gateDag,
      artifactBindings,
      unreadableBindings,
      blockingGates: [],
      currentHeadSha,
      storyId
    });
  }

  if (gateAuthorization?.allowed === true) {
    return {
      schema_version: '0.1.0',
      status: 'authorized',
      cause: AUTHORIZED_AUTHORIZATION_REASONS.has(authorizationReason)
        ? authorizationReason
        : 'gate_override_authorized',
      stop_reason: null,
      authorization_reason: authorizationReason,
      authorization_source: gateAuthorization?.source ?? 'none',
      gate_dag_overall_status: gateDag?.overall_status ?? null,
      artifact_bindings: artifactBindings,
      blocking_gates: [],
      explanation: gateAuthorization?.source === 'pr_create_gate_override'
        ? 'Merge is authorized by an auditable noncritical waiver recorded in pr-create.json.'
        : 'Merge is authorized because the current gate DAG is ready_for_review.',
      next_actions: []
    };
  }

  const gateOverride = resolveGateOverride(currentPrCreate) ?? resolveGateOverride(prCreate);
  const cause = resolveDenialCause({
    authorizationReason,
    gateDag,
    gateDagArtifact,
    currentGateStatus,
    prPrepare,
    currentPrPrepare,
    prCreate,
    currentPrCreate,
    gateOverride
  });
  const blockingGates = collectBlockingGates({ currentGateStatus, gateOverride, gateDag });
  return buildBlockedDiagnosis({
    cause,
    gateAuthorization,
    authorizationReason,
    gateDag,
    artifactBindings,
    unreadableBindings,
    blockingGates,
    currentHeadSha,
    storyId
  });
}

const GATE_EVIDENCE_CAUSES = new Set(['gates_unresolved', 'critical_gates_unresolved']);

function buildBlockedDiagnosis({
  cause: requestedCause,
  gateAuthorization,
  authorizationReason,
  gateDag,
  artifactBindings,
  unreadableBindings,
  blockingGates: requestedBlockingGates,
  currentHeadSha,
  storyId
}) {
  // The reservation is enforced here, structurally, rather than by each branch
  // remembering to check. A gate-evidence cause that cannot name a gate is not
  // a gate verdict, and a cause that says nothing could be named must not carry
  // gates borrowed from a waiver document.
  const namesGates = requestedBlockingGates.length > 0;
  const cause = GATE_EVIDENCE_CAUSES.has(requestedCause) && !namesGates
    ? 'gate_status_unresolvable'
    : requestedCause;
  const blockingGates = cause === 'gate_status_unresolvable' ? [] : requestedBlockingGates;
  return {
    schema_version: '0.1.0',
    status: 'blocked',
    cause,
    stop_reason: STOP_REASON_BY_CAUSE.get(cause) ?? 'gate_authorization_denied',
    authorization_reason: authorizationReason,
    authorization_source: gateAuthorization?.source ?? 'none',
    gate_dag_overall_status: gateDag?.overall_status ?? null,
    artifact_bindings: artifactBindings,
    blocking_gates: blockingGates,
    explanation: buildExplanation({
      cause,
      blockingGates,
      artifactBindings,
      unreadableBindings,
      currentHeadSha,
      gateDag
    }),
    next_actions: buildNextActions({ cause, storyId })
  };
}

function resolveDenialCause({
  authorizationReason,
  gateDag,
  gateDagArtifact,
  currentGateStatus,
  prPrepare,
  currentPrPrepare,
  prCreate,
  currentPrCreate,
  gateOverride
}) {
  if (
    authorizationReason === 'current_gate_status_contains_critical_gates'
    || hasCriticalUnresolvedGates(currentGateStatus)
  ) {
    return 'critical_gates_unresolved';
  }
  // The waiver document naming critical gates does not prove the gates are
  // still critical now: validateMergeGateOverride reads the document alone.
  // Claiming "critical gate evidence is unresolved" when the current status
  // lists none would be a false statement about current evidence.
  if (authorizationReason === 'gate_override_contains_critical_gates') {
    return hasCriticalUnresolvedGates(currentGateStatus)
      ? 'critical_gates_unresolved'
      : 'gate_waiver_stale';
  }
  if (authorizationReason === 'current_gate_status_not_ready') {
    return hasUnresolvedGates(currentGateStatus) || hasUnresolvedGateDagNodes(gateDag)
      ? 'gates_unresolved'
      : 'gate_status_unresolvable';
  }
  if (WAIVER_INCOMPLETE_AUTHORIZATION_REASONS.has(authorizationReason)) return 'gate_waiver_incomplete';
  if (WAIVER_STALE_AUTHORIZATION_REASONS.has(authorizationReason)) return 'gate_waiver_stale';
  if (authorizationReason === 'current_gate_status_unknown') {
    return resolveGateStatusUnknownCause({
      gateDag,
      gateDagArtifact,
      currentGateStatus,
      prPrepare,
      currentPrPrepare
    });
  }
  if (authorizationReason === 'gate_override_not_allowed') {
    return resolveOverrideNotAllowedCause({
      gateDag,
      gateDagArtifact,
      currentGateStatus,
      prPrepare,
      currentPrPrepare,
      prCreate,
      currentPrCreate,
      gateOverride
    });
  }
  return 'gate_authorization_denied';
}

// `resolveCurrentMergeGateStatus` returns null for four distinct situations.
// Recovering which one applies is the whole point of this module: the operator
// needs to know whether to re-run `pr prepare`, re-run `pr create`, or actually
// close a gate.
function resolveGateStatusUnknownCause({
  gateDag,
  gateDagArtifact,
  currentGateStatus,
  prPrepare,
  currentPrPrepare
}) {
  if (currentGateStatus) return 'gate_status_malformed';
  if (!prPrepare) return 'pr_prepare_artifact_missing';
  if (!currentPrPrepare) return 'pr_prepare_artifact_stale';
  if (!prPrepare.gate_status) return 'gate_status_missing';
  // Reaching here means `resolveCurrentMergeGateStatus` rejected a head-bound
  // pr-prepare that does carry gate_status, which it only does when a routed
  // gate DAG describes a different authorization surface.
  if (gateDagArtifact ?? gateDag) return 'gate_dag_surface_mismatch';
  return 'gate_status_malformed';
}

function resolveOverrideNotAllowedCause({
  gateDag,
  gateDagArtifact,
  currentGateStatus,
  prPrepare,
  currentPrPrepare,
  prCreate,
  currentPrCreate,
  gateOverride
}) {
  if (!prCreate && !prPrepare && !gateDagArtifact && !gateDag) return 'gate_evidence_missing';
  if (!currentPrCreate) {
    // Report the pr-prepare binding first when both artifacts have lapsed.
    // Without a head-bound pr-prepare the current gate status cannot be
    // resolved at all, so re-creating the PR alone would fail again on the
    // next attempt; `pr prepare` is the repair that has to run first.
    if (!prPrepare) return 'pr_prepare_artifact_missing';
    if (!currentPrPrepare) return 'pr_prepare_artifact_stale';
    // A lapsed pr-create only withholds merge authority if it ever carried a
    // waiver. With no waiver and a resolvable gate status that shows unresolved
    // gates, the gate evidence is what blocks: re-creating the PR cannot
    // authorize something nothing ever waived, so naming the artifact here
    // would send the operator at a repair that cannot succeed.
    if (!gateOverride && hasUnresolvedGates(currentGateStatus)) return 'gates_unresolved';
    return prCreate ? 'pr_create_artifact_stale' : 'pr_create_artifact_missing';
  }
  // A current pr-create with no waiver at all is not a waiver defect -- but it
  // is only a gate failure if the gates were actually evaluated. Without a
  // head-bound pr-prepare nothing evaluated them, and reporting gate_not_ready
  // with an empty blocking_gates list is the exact misdirection this module
  // exists to remove.
  if (!gateOverride) {
    if (!prPrepare) return 'pr_prepare_artifact_missing';
    if (!currentPrPrepare) return 'pr_prepare_artifact_stale';
    // No waiver means the gate status was never consulted by the authority
    // function, so it can still be unresolvable for the usual reasons. But a
    // head-bound prepared DAG that names unresolved required gates is current
    // blocked evidence even when a routed DAG disagrees with it: the gates can
    // be named, so naming them beats reporting the surface as unreadable.
    if (!currentGateStatus) {
      if (hasUnresolvedGateDagNodes(gateDag)) return 'gates_unresolved';
      return resolveGateStatusUnknownCause({
        gateDag,
        gateDagArtifact,
        currentGateStatus,
        prPrepare,
        currentPrPrepare
      });
    }
    if (!hasUnresolvedGates(currentGateStatus) && !hasUnresolvedGateDagNodes(gateDag)) {
      return 'gate_status_unresolvable';
    }
    return 'gates_unresolved';
  }
  return 'gate_waiver_incomplete';
}

function hasCriticalUnresolvedGates(currentGateStatus) {
  return normalizeBlockingGates(currentGateStatus?.critical_unresolved_gates, 'current_gate_status', null).length > 0;
}

// Must use VibePro's own definition of an unresolved required gate. A local
// predicate diverges: a real Gate DAG carries scaffolding nodes (code, pr,
// ac:N) whose statuses are "present"/"pending", and counting those as gate
// evidence reports non-gates as gate failures -- the exact defect this module
// exists to remove. `story` is NOT scaffolding: the canonical collector treats
// it as a gate, and isCriticalUnresolvedGate treats story=transient as
// critical, so it is correctly reportable as gate evidence.
//
// The canonical collector additionally requires `type` and `required`, which a
// DAG written by another tool (or an older artifact) may omit. A node whose id
// is namespaced `gate:`/`review:` is unambiguously a gate, so it is recognised
// even without those fields -- scaffolding ids never carry that namespace.
const NAMESPACED_GATE_ID = /^(?:gate|review):/;

function collectUnresolvedDagGates(gateDag) {
  const canonical = collectUnresolvedRequiredGates(gateDag);
  const canonicalIds = new Set(canonical.map((node) => node.id));
  const namespaced = (Array.isArray(gateDag?.nodes) ? gateDag.nodes : [])
    .filter((node) => typeof node?.id === 'string'
      && NAMESPACED_GATE_ID.test(node.id)
      && !canonicalIds.has(node.id)
      && node.required !== false
      && isUnresolvedGateStatus(node.status));
  return [...canonical, ...namespaced];
}

function hasUnresolvedGateDagNodes(gateDag) {
  return collectUnresolvedDagGates(gateDag).length > 0;
}

function hasUnresolvedGates(currentGateStatus) {
  if (!currentGateStatus) return false;
  return [currentGateStatus.critical_unresolved_gates, currentGateStatus.unresolved_gates]
    .some((gates) => normalizeBlockingGates(gates, 'current_gate_status', null).length > 0);
}

function resolveGateOverride(prCreate) {
  return prCreate?.gate_override ?? prCreate?.execution?.gate_override ?? null;
}

function buildArtifactBinding(kind, artifact, currentArtifact, currentHeadSha, unreadableArtifacts) {
  // A malformed artifact is neither present nor absent: reporting it as
  // "missing" would send the operator at the wrong repair, so it gets its own
  // status and never contributes authority.
  if (unreadableArtifacts?.[kind]) {
    return {
      artifact: kind,
      status: 'unreadable',
      artifact_head_sha: null,
      current_head_sha: currentHeadSha ?? null
    };
  }
  if (!artifact) {
    return {
      artifact: kind,
      status: 'missing',
      artifact_head_sha: null,
      current_head_sha: currentHeadSha ?? null
    };
  }
  return {
    artifact: kind,
    status: currentArtifact ? 'current' : currentHeadSha ? 'stale' : 'unknown',
    artifact_head_sha: resolveArtifactHeadSha(artifact),
    current_head_sha: currentHeadSha ?? null
  };
}

function resolveArtifactHeadSha(artifact) {
  return artifact?.artifact_freshness?.artifact_head_sha
    ?? artifact?.current_head_sha
    ?? artifact?.git?.head_sha
    ?? artifact?.toolchain?.source_git?.commit
    ?? artifact?.git_context?.head_sha
    ?? null;
}

function collectBlockingGates({ currentGateStatus, gateOverride, gateDag }) {
  const fromStatus = [
    ...normalizeBlockingGates(currentGateStatus?.critical_unresolved_gates, 'current_gate_status', 'critical'),
    ...normalizeBlockingGates(currentGateStatus?.unresolved_gates, 'current_gate_status', null)
  ];
  if (fromStatus.length > 0) return dedupeBlockingGates(fromStatus);
  const fromOverride = [
    // Not forced to 'critical': the waiver document records what was critical
    // when it was written, not what is critical now.
    ...normalizeBlockingGates(gateOverride?.critical_unresolved_gates, 'gate_override', null),
    ...normalizeBlockingGates(gateOverride?.unresolved_gates, 'gate_override', null)
  ];
  if (fromOverride.length > 0) return dedupeBlockingGates(fromOverride);
  return dedupeBlockingGates(collectUnresolvedDagGates(gateDag)
    .map((node) => ({
      id: typeof node?.id === 'string' ? node.id : 'unknown',
      severity: node?.critical === true ? 'critical' : (node?.severity ?? 'unknown'),
      status: node?.status ?? 'unknown',
      source: 'gate_dag'
    })));
}

function normalizeBlockingGates(gates, source, forcedSeverity) {
  if (!Array.isArray(gates)) return [];
  return gates
    .filter((gate) => gate
      && typeof gate === 'object'
      && typeof gate.id === 'string'
      && gate.id.trim().length > 0)
    .map((gate) => ({
      id: gate.id.trim(),
      severity: forcedSeverity ?? gate.severity ?? 'unknown',
      status: gate.status ?? 'unresolved',
      source
    }));
}

function dedupeBlockingGates(gates) {
  const seen = new Set();
  const deduped = [];
  for (const gate of gates) {
    if (seen.has(gate.id)) continue;
    seen.add(gate.id);
    deduped.push(gate);
  }
  return deduped;
}

function buildExplanation({
  cause,
  blockingGates,
  artifactBindings,
  unreadableBindings = [],
  currentHeadSha,
  gateDag
}) {
  const head = typeof currentHeadSha === 'string' ? currentHeadSha.slice(0, 12) : 'unknown';
  const binding = (kind) => artifactBindings.find((entry) => entry.artifact === kind) ?? null;
  // An explanation that asserts unresolved gates while naming none is exactly
  // the self-contradiction this module removes, so the caller must not reach a
  // gate-evidence cause with an empty list; assert that here rather than
  // printing "none recorded".
  const gateList = blockingGates.length > 0
    ? blockingGates.map((gate) => `${gate.id}=${gate.status}(${gate.severity})`).join(', ')
    : 'none enumerated by the current gate status';
  switch (cause) {
    case 'gates_unresolved':
      return `Gate evidence is unresolved at HEAD ${head}: ${gateList}.`;
    case 'critical_gates_unresolved':
      return `Critical gate evidence is unresolved at HEAD ${head}: ${gateList}. A waiver cannot authorize these.`;
    case 'pr_create_artifact_stale':
      return `pr-create.json is bound to ${binding('pr_create')?.artifact_head_sha ?? 'an unknown commit'} but HEAD is ${head}, so its merge authority (including any waiver) was discarded.`;
    case 'pr_create_artifact_missing':
      return `No pr-create.json exists for this story, so there is no merge authority to check.`;
    case 'pr_prepare_artifact_stale':
      return `pr-prepare.json is bound to ${binding('pr_prepare')?.artifact_head_sha ?? 'an unknown commit'} but HEAD is ${head}, so the current gate status could not be resolved.`;
    case 'pr_prepare_artifact_missing':
      return `No pr-prepare.json exists for this story, so the current gate status could not be resolved.`;
    case 'gate_status_missing':
      return `pr-prepare.json is bound to HEAD ${head} but carries no gate_status.`;
    case 'gate_status_unresolvable':
      return `Merge authority was denied at HEAD ${head} but no unresolved gate could be named from the current gate status or gate DAG, so the gate surface itself cannot be trusted to explain the denial.`;
    case 'gate_dag_surface_mismatch':
      return `The routed gate-dag.json describes a different gate surface than the one embedded in pr-prepare.json (overall_status=${gateDag?.overall_status ?? 'unknown'}), so merge authority failed closed.`;
    case 'gate_status_malformed':
      return `The current gate status carries malformed or duplicate gate ids, so merge authority failed closed.`;
    case 'gate_waiver_incomplete':
      return `The waiver in pr-create.json is incomplete or not marked allowed, so it cannot authorize the merge.`;
    case 'gate_waiver_stale':
      return `The waiver in pr-create.json targets a different gate set (${gateList}) than the current gate status, so it cannot authorize the merge.`;
    case 'gate_evidence_missing':
      return `No gate evidence exists for this story: pr-prepare.json, pr-create.json and gate-dag.json are all absent.`;
    case 'artifact_unreadable':
      return `Gates could not be evaluated at all: ${unreadableBindings.map((binding) => binding.artifact).join(', ')} could not be parsed as JSON, so merge authority failed closed on unreadable input rather than on a gate verdict.`;
    default:
      return `Merge gate authorization was denied at HEAD ${head}; see authorization_reason for the raw authority verdict.`;
  }
}

function buildNextActions({ cause, storyId }) {
  const id = storyId ?? '<story-id>';
  const prepare = `vibepro pr prepare . --story-id ${id}`;
  const create = `vibepro pr create . --story-id ${id}`;
  const explain = `vibepro execute merge . --story-id ${id} --explain`;
  switch (cause) {
    case 'gates_unresolved':
    case 'critical_gates_unresolved':
      return [`${prepare} --view blocking-gates`, explain];
    case 'pr_create_artifact_stale':
    case 'pr_create_artifact_missing':
      return [prepare, create, explain];
    case 'pr_prepare_artifact_stale':
    case 'pr_prepare_artifact_missing':
    case 'gate_status_missing':
    case 'gate_status_unresolvable':
    case 'gate_dag_surface_mismatch':
    case 'gate_status_malformed':
      return [prepare, create, explain];
    case 'gate_waiver_incomplete':
    case 'gate_waiver_stale':
      return [`${prepare} --view blocking-gates`, create, explain];
    case 'gate_evidence_missing':
      return [prepare, create, explain];
    case 'artifact_unreadable':
      return [explain, prepare, create];
    default:
      return [prepare, explain];
  }
}

export function renderMergeGateDiagnosisLines(diagnosis, { includeNextActions = true } = {}) {
  if (!diagnosis) return ['- gate_diagnosis: unavailable'];
  return [
    `- gate_diagnosis_status: ${diagnosis.status}`,
    `- gate_diagnosis_cause: ${diagnosis.cause}`,
    `- gate_diagnosis_stop_reason: ${diagnosis.stop_reason ?? 'none'}`,
    `- gate_diagnosis_explanation: ${diagnosis.explanation}`,
    `- gate_diagnosis_blocking_gates: ${(diagnosis.blocking_gates ?? [])
      .map((gate) => `${gate.id}=${gate.status}(${gate.severity}) via ${gate.source ?? 'unknown'}`)
      .join('|') || 'none'}`,
    `- gate_diagnosis_artifact_bindings: ${(diagnosis.artifact_bindings ?? [])
      .map((binding) => `${binding.artifact}=${binding.status}`)
      .join('|') || 'none'}`,
    `- gate_diagnosis_artifact_binding_heads: ${(diagnosis.artifact_bindings ?? [])
      .map((binding) => `${binding.artifact}=${binding.artifact_head_sha ?? '-'}`)
      .join('|') || 'none'}`,
    `- gate_diagnosis_current_head: ${(diagnosis.artifact_bindings ?? [])[0]?.current_head_sha ?? '-'}`,
    // The pr-merge text summary must expose exactly one authoritative recovery
    // action, so callers rendering that surface suppress these.
    ...(includeNextActions
      ? (diagnosis.next_actions ?? []).map((action, index) => `- gate_diagnosis_next_action_${index + 1}: ${action}`)
      : [])
  ];
}
