import {
  buildMergeGateAuthorization,
  resolveCurrentMergeGateStatus
} from './merge-gate-authorization.js';

// `buildMergeGateAuthorization` distinguishes twelve denial reasons, but
// `executeMerge` used to collapse every one of them into `gate_not_ready`.
// That is actively misleading: the most common denial in practice is a
// pr-create/pr-prepare artifact that is no longer bound to the current HEAD,
// which reports "gate not ready" while every gate is in fact resolved. This
// module classifies the denial so `stop_reason` names the real failure class,
// and `gate_not_ready` is reserved for unresolved or critical gate evidence.

const GATE_STATUSES_TREATED_AS_RESOLVED = new Set([
  'passed',
  'ready_for_review',
  'not_applicable',
  'waived',
  'satisfied',
  'skipped'
]);

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
  // An unreadable lifecycle artifact outranks every other classification: no
  // downstream cause can be trusted while one of the inputs could not be parsed.
  const cause = unreadableBindings.length > 0 ? 'artifact_unreadable' : resolveDenialCause({
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
    || authorizationReason === 'gate_override_contains_critical_gates'
  ) {
    return 'critical_gates_unresolved';
  }
  if (authorizationReason === 'current_gate_status_not_ready') return 'gates_unresolved';
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
  // A current pr-create with no waiver at all is not a waiver defect: the gate
  // DAG simply is not ready and nothing was waived.
  if (!gateOverride) return 'gates_unresolved';
  return 'gate_waiver_incomplete';
}

function hasUnresolvedGates(currentGateStatus) {
  if (!currentGateStatus) return false;
  return [currentGateStatus.critical_unresolved_gates, currentGateStatus.unresolved_gates]
    .some((gates) => Array.isArray(gates) && gates.length > 0);
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
    ...normalizeBlockingGates(gateOverride?.critical_unresolved_gates, 'gate_override', 'critical'),
    ...normalizeBlockingGates(gateOverride?.unresolved_gates, 'gate_override', null)
  ];
  if (fromOverride.length > 0) return dedupeBlockingGates(fromOverride);
  const nodes = Array.isArray(gateDag?.nodes) ? gateDag.nodes : [];
  return dedupeBlockingGates(nodes
    .filter((node) => node?.required !== false
      && !GATE_STATUSES_TREATED_AS_RESOLVED.has(node?.status))
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
    .filter((gate) => gate && typeof gate === 'object')
    .map((gate) => ({
      id: typeof gate.id === 'string' && gate.id.trim().length > 0 ? gate.id.trim() : 'unknown',
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
  const gateList = blockingGates.length > 0
    ? blockingGates.map((gate) => `${gate.id}=${gate.status}(${gate.severity})`).join(', ')
    : 'none recorded';
  switch (cause) {
    case 'gates_unresolved':
      return `Gate evidence is unresolved at HEAD ${head}: ${gateList}.`;
    case 'critical_gates_unresolved':
      return `Critical gate evidence is unresolved at HEAD ${head}: ${gateList}. A waiver cannot authorize these.`;
    case 'pr_create_artifact_stale':
      return `Gates were not evaluated as blocked. pr-create.json is bound to ${binding('pr_create')?.artifact_head_sha ?? 'an unknown commit'} but HEAD is ${head}, so its merge authority (including any waiver) was discarded.`;
    case 'pr_create_artifact_missing':
      return `Gates were not evaluated as blocked. No pr-create.json exists for this story, so there is no merge authority to check.`;
    case 'pr_prepare_artifact_stale':
      return `Gates were not evaluated as blocked. pr-prepare.json is bound to ${binding('pr_prepare')?.artifact_head_sha ?? 'an unknown commit'} but HEAD is ${head}, so the current gate status could not be resolved.`;
    case 'pr_prepare_artifact_missing':
      return `Gates were not evaluated as blocked. No pr-prepare.json exists for this story, so the current gate status could not be resolved.`;
    case 'gate_status_missing':
      return `Gates were not evaluated as blocked. pr-prepare.json is bound to HEAD ${head} but carries no gate_status.`;
    case 'gate_dag_surface_mismatch':
      return `Gates were not evaluated as blocked. The routed gate-dag.json describes a different gate surface than the one embedded in pr-prepare.json (overall_status=${gateDag?.overall_status ?? 'unknown'}), so merge authority failed closed.`;
    case 'gate_status_malformed':
      return `Gates were not evaluated as blocked. The current gate status carries malformed or duplicate gate ids, so merge authority failed closed.`;
    case 'gate_waiver_incomplete':
      return `Gates were not evaluated as blocked. The waiver in pr-create.json is incomplete or not marked allowed, so it cannot authorize the merge.`;
    case 'gate_waiver_stale':
      return `Gates were not evaluated as blocked. The waiver in pr-create.json targets a different gate set (${gateList}) than the current gate status, so it cannot authorize the merge.`;
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

export function renderMergeGateDiagnosisLines(diagnosis) {
  if (!diagnosis) return ['- gate_diagnosis: unavailable'];
  return [
    `- gate_diagnosis_status: ${diagnosis.status}`,
    `- gate_diagnosis_cause: ${diagnosis.cause}`,
    `- gate_diagnosis_stop_reason: ${diagnosis.stop_reason ?? 'none'}`,
    `- gate_diagnosis_explanation: ${diagnosis.explanation}`,
    `- gate_diagnosis_blocking_gates: ${(diagnosis.blocking_gates ?? [])
      .map((gate) => `${gate.id}=${gate.status}(${gate.severity})`)
      .join('|') || 'none'}`,
    `- gate_diagnosis_artifact_bindings: ${(diagnosis.artifact_bindings ?? [])
      .map((binding) => `${binding.artifact}=${binding.status}`)
      .join('|') || 'none'}`,
    ...(diagnosis.next_actions ?? []).map((action, index) => `- gate_diagnosis_next_action_${index + 1}: ${action}`)
  ];
}
