export function buildMergeGateAuthorization(gateDag, currentPrCreate, currentGateStatus = null) {
  if (gateDag?.overall_status === 'ready_for_review') {
    return {
      allowed: true,
      source: 'gate_dag',
      reason: 'gate_dag_ready_for_review',
      gate_override: null
    };
  }

  const gateOverride = currentPrCreate?.gate_override ?? currentPrCreate?.execution?.gate_override ?? null;
  const validation = validateMergeGateOverride(gateOverride);
  const reconciliation = validation.allowed
    ? reconcileMergeGateOverride(gateOverride, currentGateStatus)
    : validation;
  if (reconciliation.allowed) {
    return {
      allowed: true,
      source: 'pr_create_gate_override',
      reason: gateOverride.reason.trim(),
      gate_override: gateOverride
    };
  }

  return {
    allowed: false,
    source: 'none',
    reason: reconciliation.reason,
    gate_override: null
  };
}

export function resolveCurrentMergeGateStatus(prPrepare, currentHeadSha, gateDag = null) {
  const preparedHeadSha = prPrepare?.git?.head_sha ?? prPrepare?.git?.head_ref ?? null;
  if (!currentHeadSha || preparedHeadSha !== currentHeadSha || !prPrepare?.gate_status) {
    return null;
  }
  const preparedGateDag = prPrepare?.pr_context?.gate_dag ?? null;
  if (gateDag && preparedGateDag && gateDag.overall_status !== preparedGateDag.overall_status) {
    return null;
  }
  return prPrepare.gate_status;
}

export function validateMergeGateOverride(gateOverride) {
  if (!gateOverride || gateOverride.allowed !== true) {
    return { allowed: false, reason: 'gate_override_not_allowed' };
  }
  if (typeof gateOverride.reason !== 'string' || gateOverride.reason.trim().length === 0) {
    return { allowed: false, reason: 'gate_override_reason_missing' };
  }
  if (typeof gateOverride.waiver_policy !== 'string' || gateOverride.waiver_policy.trim().length === 0) {
    return { allowed: false, reason: 'gate_override_policy_missing' };
  }
  const unresolvedGateIds = normalizeGateIds(gateOverride.unresolved_gates);
  if (unresolvedGateIds.reason) {
    return { allowed: false, reason: unresolvedGateIds.reason === 'missing' ? 'gate_override_targets_missing' : 'gate_override_targets_invalid' };
  }
  if (unresolvedGateIds.ids.length === 0) {
    return { allowed: false, reason: 'gate_override_targets_missing' };
  }
  if (!Array.isArray(gateOverride.critical_unresolved_gates)) {
    return { allowed: false, reason: 'gate_override_critical_gates_unknown' };
  }
  const criticalGateIds = normalizeGateIds(gateOverride.critical_unresolved_gates);
  if (criticalGateIds.reason) {
    return { allowed: false, reason: 'gate_override_critical_gates_invalid' };
  }
  if (gateOverride.critical_unresolved_gates.length > 0) {
    return { allowed: false, reason: 'gate_override_contains_critical_gates' };
  }
  return { allowed: true, reason: 'auditable_noncritical_gate_override' };
}

function reconcileMergeGateOverride(gateOverride, currentGateStatus) {
  const currentUnresolvedGateIds = normalizeGateIds(currentGateStatus?.unresolved_gates);
  const currentCriticalGateIds = normalizeGateIds(currentGateStatus?.critical_unresolved_gates);
  if (currentUnresolvedGateIds.reason || currentCriticalGateIds.reason) {
    return { allowed: false, reason: 'current_gate_status_unknown' };
  }
  if (currentCriticalGateIds.ids.length > 0) {
    return { allowed: false, reason: 'current_gate_status_contains_critical_gates' };
  }

  const overrideUnresolvedGateIds = normalizeGateIds(gateOverride.unresolved_gates);
  const overrideCriticalGateIds = normalizeGateIds(gateOverride.critical_unresolved_gates);
  if (!sameGateIds(overrideUnresolvedGateIds.ids, currentUnresolvedGateIds.ids)) {
    return { allowed: false, reason: 'gate_override_targets_mismatch' };
  }
  if (!sameGateIds(overrideCriticalGateIds.ids, currentCriticalGateIds.ids)) {
    return { allowed: false, reason: 'gate_override_critical_gates_mismatch' };
  }
  return { allowed: true, reason: 'auditable_noncritical_gate_override' };
}

function normalizeGateIds(gates) {
  if (!Array.isArray(gates)) return { ids: [], reason: 'missing' };
  const ids = gates.map((gate) => typeof gate?.id === 'string' ? gate.id.trim() : '');
  if (ids.some((id) => id.length === 0) || new Set(ids).size !== ids.length) {
    return { ids: [], reason: 'invalid' };
  }
  return { ids: ids.sort(), reason: null };
}

function sameGateIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
