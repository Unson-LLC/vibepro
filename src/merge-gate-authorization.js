export function buildMergeGateAuthorization(gateDag, currentPrCreate) {
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
  if (validation.allowed) {
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
    reason: validation.reason,
    gate_override: null
  };
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
  if (!Array.isArray(gateOverride.critical_unresolved_gates)) {
    return { allowed: false, reason: 'gate_override_critical_gates_unknown' };
  }
  if (gateOverride.critical_unresolved_gates.length > 0) {
    return { allowed: false, reason: 'gate_override_contains_critical_gates' };
  }
  return { allowed: true, reason: 'auditable_noncritical_gate_override' };
}
