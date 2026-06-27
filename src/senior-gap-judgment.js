import {
  normalizeElapsedTimeAccounting,
  normalizeTokenAccounting
} from './evidence-cost-budget.js';

const BLOCKING_STATUSES = new Set(['block', 'failed', 'contradicted', 'active_blocked']);
const UNRESOLVED_STATUSES = new Set([
  'candidate',
  'missing',
  'transient',
  'implicit',
  'inferred_empty',
  'needs_evidence',
  'needs_story',
  'needs_setup',
  'needs_review',
  'needs_inspection',
  'needs_split',
  'needs_rebase',
  'needs_changes',
  'accepted_followup',
  'missing_coverage',
  'partial_surface',
  'stale',
  'stale_evidence',
  'story_source_mismatch',
  'block',
  'failed',
  'contradicted'
]);

export function buildSeniorGapJudgment({
  story = null,
  git = null,
  fileGroups = {},
  scope = null,
  prContext = {},
  gateStatus = null,
  evidencePlan = null,
  evidenceReuse = null,
  createdAt = new Date().toISOString()
} = {}) {
  const idealState = buildIdealState({ story, prContext });
  const currentState = buildCurrentState({ git, fileGroups, scope, prContext, gateStatus, evidencePlan, evidenceReuse });
  const costContext = buildCostContext({ prContext, evidencePlan, evidenceReuse });
  const gaps = buildGaps({ prContext, gateStatus, evidenceReuse, costContext });
  const residualRisks = gaps.filter((gap) => gap.safe_to_defer);
  const blockingGaps = gaps.filter((gap) => !gap.safe_to_defer);
  const criticalBlockingGaps = blockingGaps.filter((gap) => ['critical', 'block'].includes(gap.severity));
  const followups = buildFollowups({ prContext, gaps });
  const decision = buildDecision({ gaps, blockingGaps, criticalBlockingGaps, gateStatus });
  return {
    schema_version: '0.1.0',
    model: 'vibepro-senior-gap-judgment-v1',
    story_id: story?.story_id ?? prContext?.story_source?.story_id ?? null,
    generated_at: createdAt,
    ideal_state: idealState,
    current_state: currentState,
    gaps,
    decision,
    residual_risks: residualRisks,
    followups,
    cost_context: costContext
  };
}

export function buildSeniorGapJudgmentGate(judgment, options = {}) {
  const decision = judgment?.decision ?? {};
  const status = decision.status === 'block'
    ? 'block'
    : decision.status === 'needs_review'
      ? 'needs_review'
      : 'passed';
  return {
    id: 'gate:senior_gap_judgment',
    type: 'senior_gap_judgment_gate',
    label: 'Senior Gap Judgment Gate',
    status,
    required: true,
    artifact: options.artifact ?? null,
    decision_status: decision.status ?? 'unknown',
    gap_count: judgment?.gaps?.length ?? 0,
    blocking_gap_count: decision.blocking_gap_count ?? 0,
    residual_risk_count: judgment?.residual_risks?.length ?? 0,
    followup_count: judgment?.followups?.length ?? 0,
    reason: decision.reason ?? 'Senior gap judgment was not evaluated'
  };
}

export function renderSeniorGapJudgmentSummary(judgment) {
  const decision = judgment?.decision ?? {};
  const lines = [
    '# Senior Gap Judgment',
    '',
    `- status: ${decision.status ?? 'unknown'}`,
    `- gaps: ${judgment?.gaps?.length ?? 0}`,
    `- blocking_gaps: ${decision.blocking_gap_count ?? 0}`,
    `- residual_risks: ${judgment?.residual_risks?.length ?? 0}`,
    `- followups: ${judgment?.followups?.length ?? 0}`,
    `- reason: ${decision.reason ?? '-'}`
  ];
  for (const gap of (judgment?.gaps ?? []).slice(0, 10)) {
    lines.push(`- ${gap.severity}: ${gap.kind} ${gap.surface ?? '-'} - ${gap.summary}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildIdealState({ story, prContext }) {
  const axes = (prContext?.engineering_judgment?.judgment_axes ?? [])
    .filter((axis) => axis.status !== 'inactive')
    .map((axis) => ({
      axis: axis.axis,
      decision_question: axis.decision_question,
      required_evidence: axis.required_evidence ?? [],
      blocking_criteria: axis.blocking_criteria ?? [],
      acceptable_followup: axis.acceptable_followup ?? null
    }));
  const requiredGates = (prContext?.gate_dag?.nodes ?? [])
    .filter((node) => node.required)
    .map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label ?? node.id
    }));
  return {
    story_id: story?.story_id ?? prContext?.story_source?.story_id ?? null,
    title: story?.title ?? prContext?.story_source?.title ?? prContext?.story_source?.requirement_title ?? null,
    story_source: prContext?.story_source?.path ?? prContext?.story_source?.story_id ?? null,
    acceptance_criteria_count: prContext?.story_source?.acceptance_criteria?.length ?? 0,
    engineering_route: prContext?.engineering_judgment?.route_type ?? null,
    active_judgment_axes: axes,
    required_gates: requiredGates
  };
}

function buildCurrentState({ git, fileGroups, scope, prContext, gateStatus, evidencePlan, evidenceReuse }) {
  return {
    git: {
      base_ref: git?.base_ref ?? null,
      head_ref: git?.head_ref ?? null,
      head_sha: git?.head_sha ?? null,
      changed_file_count: git?.changed_files?.length ?? null
    },
    file_groups: Object.fromEntries(
      Object.entries(fileGroups ?? {}).map(([key, value]) => [key, value?.count ?? 0])
    ),
    scope: {
      status: scope?.status ?? null,
      recommended_strategy: scope?.recommended_strategy ?? null,
      reasons: scope?.reasons ?? []
    },
    gate_status: {
      overall_status: gateStatus?.overall_status ?? prContext?.gate_dag?.overall_status ?? null,
      ready_for_pr_create: gateStatus?.ready_for_pr_create ?? null,
      unresolved_gate_count: gateStatus?.unresolved_gate_count ?? null,
      critical_unresolved_gate_count: gateStatus?.critical_unresolved_gate_count ?? null
    },
    engineering_judgment: {
      route_type: prContext?.engineering_judgment?.route_type ?? null,
      active_axes: prContext?.engineering_judgment?.active_axes ?? []
    },
    design_ssot_reconciliation_status: prContext?.design_ssot_reconciliation?.status ?? null,
    responsibility_authority_status: prContext?.responsibility_authority?.status ?? null,
    requirement_status: prContext?.requirement_consistency?.status ?? null,
    traceability_clause_coverage: normalizeTraceabilityCoverage(prContext?.traceability_clause_coverage),
    evidence_depth: evidencePlan?.evidence_depth ?? null,
    evidence_reuse_status: evidenceReuse?.status ?? prContext?.evidence_reuse?.status ?? null
  };
}

function buildGaps({ prContext, gateStatus, evidenceReuse, costContext }) {
  return [
    ...gapsFromGateStatus(gateStatus),
    ...gapsFromDesignSsot(prContext?.design_ssot_reconciliation),
    ...gapsFromResponsibilityAuthority(prContext?.responsibility_authority),
    ...gapsFromTraceability(prContext?.traceability_clause_coverage),
    ...gapsFromJudgmentAxes(prContext?.engineering_judgment),
    ...gapsFromEvidenceReuse(evidenceReuse ?? prContext?.evidence_reuse),
    buildTelemetryUnknownGap(costContext)
  ].filter(Boolean);
}

function gapsFromGateStatus(gateStatus) {
  const gates = [
    ...(gateStatus?.critical_unresolved_gates ?? []),
    ...(gateStatus?.unresolved_gates ?? [])
  ];
  const seen = new Set();
  return gates
    .filter((gate) => gate?.id && !seen.has(gate.id) && seen.add(gate.id))
    .map((gate) => {
      const blocking = BLOCKING_STATUSES.has(gate.status);
      return {
        id: `gap:${gate.id}`,
        kind: 'unresolved_required_gate',
        surface: gate.type ?? gate.id,
        severity: blocking ? 'critical' : 'major',
        confidence: 'high',
        safe_to_defer: false,
        decision_effect: blocking ? 'blocks_pr' : 'requires_evidence_before_pr',
        evidence_refs: [gate.artifact].filter(Boolean),
        summary: `${gate.label ?? gate.id} is ${gate.status}`,
        details: {
          gate_id: gate.id,
          status: gate.status,
          reason: gate.reason ?? null,
          required_actions: gate.required_actions ?? []
        }
      };
    });
}

function gapsFromDesignSsot(reconciliation) {
  return (reconciliation?.action_items ?? []).map((item, index) => {
    const blocking = item.severity === 'block';
    return {
      id: `gap:design_ssot:${index + 1}`,
      kind: item.kind ?? 'design_ssot_action_item',
      surface: 'design_ssot',
      severity: blocking ? 'critical' : 'major',
      confidence: 'high',
      safe_to_defer: false,
      decision_effect: blocking ? 'blocks_pr' : 'requires_design_review',
      evidence_refs: [reconciliation.artifacts?.json, item.path, item.root_doc].filter(Boolean),
      summary: item.message ?? `${item.kind ?? 'design_ssot'} requires review`,
      details: item
    };
  });
}

function gapsFromResponsibilityAuthority(authority) {
  const summary = authority?.summary ?? {};
  const unknownCount = Number(summary.unregistered_count ?? summary.unknown_count ?? summary.no_registered_authority_count ?? 0);
  if (!Number.isFinite(unknownCount) || unknownCount <= 0) return [];
  return [{
    id: 'gap:responsibility_authority:unknown',
    kind: 'responsibility_authority_unknown',
    surface: 'responsibility_authority',
    severity: 'major',
    confidence: 'medium',
    safe_to_defer: false,
    decision_effect: 'requires_owner_or_no_registered_authority_decision',
    evidence_refs: [],
    summary: `${unknownCount} responsibility authority item(s) are unresolved`,
    details: summary
  }];
}

function gapsFromTraceability(traceability) {
  const summary = normalizeTraceabilityCoverage(traceability) ?? {};
  const unmapped = Number(summary.unmapped_count ?? 0);
  const weak = Number(summary.weakly_mapped_count ?? 0);
  const gaps = [];
  if (Number.isFinite(unmapped) && unmapped > 0) {
    gaps.push({
      id: 'gap:traceability:unmapped',
      kind: 'traceability_unmapped',
      surface: 'traceability',
      severity: 'major',
      confidence: 'high',
      safe_to_defer: false,
      decision_effect: 'requires_clause_binding',
      evidence_refs: ['.vibepro/pr/<story-id>/traceability.json'],
      summary: `${unmapped} acceptance or scenario clause(s) are unmapped`,
      details: summary
    });
  }
  if (Number.isFinite(weak) && weak > 0) {
    gaps.push({
      id: 'gap:traceability:weakly_mapped',
      kind: 'traceability_weakly_mapped',
      surface: 'traceability',
      severity: 'minor',
      confidence: 'medium',
      safe_to_defer: true,
      decision_effect: 'residual_risk',
      evidence_refs: ['.vibepro/pr/<story-id>/traceability.json'],
      summary: `${weak} acceptance or scenario clause(s) are weakly mapped`,
      details: summary
    });
  }
  return gaps;
}

function normalizeTraceabilityCoverage(traceability) {
  const summary = traceability?.coverage_summary ?? traceability ?? null;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  return summary;
}

function gapsFromJudgmentAxes(engineeringJudgment) {
  return (engineeringJudgment?.judgment_axes ?? [])
    .filter((axis) => axis.status !== 'inactive')
    .filter((axis) => UNRESOLVED_STATUSES.has(mapAxisStatus(axis.status)))
    .map((axis) => {
      const blocked = axis.status === 'active_blocked';
      const acceptedFollowup = axis.status === 'active_accepted_followup';
      return {
        id: `gap:judgment_axis:${axis.axis}`,
        kind: acceptedFollowup ? 'accepted_followup' : 'judgment_axis_gap',
        surface: axis.axis,
        severity: blocked ? 'critical' : acceptedFollowup ? 'minor' : 'major',
        confidence: axis.confidence ?? 'medium',
        safe_to_defer: acceptedFollowup,
        decision_effect: acceptedFollowup ? 'accepted_followup' : blocked ? 'blocks_pr' : 'requires_evidence_before_pr',
        evidence_refs: axis.matched_evidence?.map((item) => item.artifact ?? item.ref).filter(Boolean) ?? [],
        summary: acceptedFollowup
          ? `${axis.axis} missing evidence is explicitly accepted as bounded follow-up`
          : `${axis.axis} judgment axis is ${axis.status}`,
        details: {
          decision_question: axis.decision_question,
          missing_evidence: axis.missing_evidence ?? [],
          blocking_criteria: axis.blocking_criteria ?? [],
          acceptable_followup: axis.acceptable_followup ?? null,
          blocker_waiver: axis.blocker_waiver ?? null
        }
      };
    });
}

function gapsFromEvidenceReuse(evidenceReuse) {
  if (!evidenceReuse || !['stale', 'miss', 'missing'].includes(evidenceReuse.status)) return [];
  return [{
    id: 'gap:evidence_reuse:freshness',
    kind: 'evidence_reuse_not_fresh',
    surface: 'evidence_reuse',
    severity: 'minor',
    confidence: 'medium',
    safe_to_defer: true,
    decision_effect: 'residual_risk',
    evidence_refs: ['.vibepro/pr/<story-id>/evidence-reuse.json'],
    summary: `Evidence reuse status is ${evidenceReuse.status}; verification evidence must remain current elsewhere`,
    details: {
      status: evidenceReuse.status,
      evidence_key: evidenceReuse.evidence_key ?? null,
      stale_reasons: evidenceReuse.stale_reasons ?? []
    }
  }];
}

function buildTelemetryUnknownGap(costContext) {
  if (costContext?.telemetry_unavailability?.status === 'bounded_by_artifact_policy') return null;
  if (hasUsableAccounting(costContext?.token_accounting) && hasUsableAccounting(costContext?.elapsed_time_accounting)) return null;
  return {
    id: 'gap:cost_telemetry:pr_prepare_unavailable',
    kind: 'cost_telemetry_unavailable',
    surface: 'cost_context',
    severity: 'minor',
    confidence: 'high',
    safe_to_defer: true,
    decision_effect: 'residual_risk',
    evidence_refs: ['.vibepro/pr/<story-id>/senior-gap-judgment.json'],
    summary: 'PR prepare does not observe canonical token/time accounting; do not treat missing cost telemetry as zero cost.',
    details: {
      token_accounting_status: costContext?.token_accounting?.status ?? 'not_collected_in_pr_prepare',
      elapsed_time_accounting_status: costContext?.elapsed_time_accounting?.status ?? 'not_collected_in_pr_prepare',
      reason: costContext?.telemetry_unavailability?.reason ?? null
    }
  };
}

function buildDecision({ gaps, blockingGaps, criticalBlockingGaps, gateStatus }) {
  if (criticalBlockingGaps.length > 0) {
    return {
      status: 'block',
      ready_for_pr_create: false,
      blocking_gap_count: blockingGaps.length,
      critical_blocking_gap_count: criticalBlockingGaps.length,
      residual_risk_count: gaps.length - blockingGaps.length,
      reason: `${criticalBlockingGaps.length} critical gap(s) must be resolved before PR creation or merge.`
    };
  }
  if (blockingGaps.length > 0) {
    return {
      status: 'needs_review',
      ready_for_pr_create: false,
      blocking_gap_count: blockingGaps.length,
      critical_blocking_gap_count: 0,
      residual_risk_count: gaps.length - blockingGaps.length,
      reason: `${blockingGaps.length} non-deferrable senior judgment gap(s) require evidence or an explicit decision.`
    };
  }
  if (gaps.length > 0) {
    return {
      status: 'passed_with_residual_risk',
      ready_for_pr_create: gateStatus?.ready_for_pr_create ?? null,
      blocking_gap_count: 0,
      critical_blocking_gap_count: 0,
      residual_risk_count: gaps.length,
      reason: `${gaps.length} residual risk(s) remain explicit but are safe to defer for this PR.`
    };
  }
  return {
    status: 'passed',
    ready_for_pr_create: gateStatus?.ready_for_pr_create ?? null,
    blocking_gap_count: 0,
    critical_blocking_gap_count: 0,
    residual_risk_count: 0,
    reason: 'Ideal and current state have no unresolved senior judgment gaps.'
  };
}

function buildFollowups({ prContext, gaps }) {
  const axisFollowups = (prContext?.engineering_judgment?.judgment_axes ?? [])
    .filter((axis) => axis.status === 'active_accepted_followup')
    .map((axis) => ({
      source: `gate:judgment_axis_${axis.axis}`,
      status: 'accepted',
      summary: axis.acceptable_followup ?? `${axis.axis} follow-up accepted`,
      evidence_refs: axis.matched_evidence?.map((item) => item.artifact ?? item.ref).filter(Boolean) ?? []
    }));
  const residualFollowups = gaps
    .filter((gap) => gap.safe_to_defer && gap.decision_effect !== 'accepted_followup')
    .map((gap) => ({
      source: gap.id,
      status: 'residual_risk',
      summary: gap.summary,
      evidence_refs: gap.evidence_refs ?? []
    }));
  return [...axisFollowups, ...residualFollowups];
}

function buildCostContext({ prContext, evidencePlan, evidenceReuse }) {
  const explicitCostContext = resolveExplicitCostContext({ prContext, evidencePlan });
  const tokenAccounting = normalizePrPrepareTokenAccounting(explicitCostContext?.token_accounting);
  const elapsedTimeAccounting = normalizePrPrepareElapsedTimeAccounting(explicitCostContext?.elapsed_time_accounting);
  const telemetryUnavailable = buildTelemetryUnavailability({
    tokenAccounting,
    elapsedTimeAccounting,
    evidencePlan
  });
  return {
    evidence_depth: evidencePlan?.evidence_depth ?? null,
    artifact_policy: evidencePlan?.artifact_policy ?? null,
    evidence_reuse: evidenceReuse ? {
      status: evidenceReuse.status ?? null,
      evidence_key: evidenceReuse.evidence_key ?? null,
      full_evidence_generation_count: evidenceReuse.full_evidence?.generation_count
        ?? evidenceReuse.full_evidence_generation_count
        ?? null,
      full_evidence_cumulative_generation_count: evidenceReuse.full_evidence?.cumulative_generation_count
        ?? evidenceReuse.full_evidence_cumulative_generation_count
        ?? evidenceReuse.full_evidence_cumulative_count
        ?? null
    } : null,
    token_accounting: tokenAccounting,
    elapsed_time_accounting: elapsedTimeAccounting,
    telemetry_unavailability: telemetryUnavailable
  };
}

function resolveExplicitCostContext({ prContext, evidencePlan }) {
  return evidencePlan?.cost_context
    ?? evidencePlan?.cost_accounting
    ?? prContext?.cost_context
    ?? prContext?.cost_accounting
    ?? prContext?.canonical_audit_cost_context
    ?? null;
}

function normalizePrPrepareTokenAccounting(input) {
  if (!input) {
    return {
      status: 'not_collected_in_pr_prepare',
      total_tokens: null,
      input_tokens: null,
      output_tokens: null,
      cached_input_tokens: null,
      source: null,
      window: null,
      reason: 'PR prepare did not receive session token accounting'
    };
  }
  return normalizeTokenAccounting(input);
}

function normalizePrPrepareElapsedTimeAccounting(input) {
  if (!input) {
    return {
      status: 'not_collected_in_pr_prepare',
      elapsed_ms: null,
      started_at: null,
      finished_at: null,
      source: null,
      window: null,
      reason: 'PR prepare did not receive elapsed-time accounting'
    };
  }
  return normalizeElapsedTimeAccounting(input);
}

function buildTelemetryUnavailability({ tokenAccounting, elapsedTimeAccounting, evidencePlan }) {
  if (hasUsableAccounting(tokenAccounting) && hasUsableAccounting(elapsedTimeAccounting)) {
    return {
      status: 'not_applicable',
      reason: 'token and elapsed-time accounting are available'
    };
  }
  if (hasBoundedArtifactPolicy(evidencePlan)) {
    return {
      status: 'bounded_by_artifact_policy',
      reason: 'PR prepare keeps unavailable session telemetry explicit while the artifact policy limits PR-body token exposure to concise links'
    };
  }
  return {
    status: 'residual_risk',
    reason: 'PR prepare lacks both usable accounting and a bounded artifact policy'
  };
}

function hasUsableAccounting(accounting) {
  return ['available', 'partial'].includes(accounting?.status);
}

function hasBoundedArtifactPolicy(evidencePlan) {
  const artifactPolicy = evidencePlan?.artifact_policy;
  if (!artifactPolicy || typeof artifactPolicy !== 'object') return false;
  const policy = artifactPolicy.pr_body_token_policy;
  if (policy && typeof policy === 'object') {
    return policy.status === 'bounded_by_artifact_links'
      && policy.duplicates_canonical_artifacts === false;
  }
  return policy === 'bounded_by_artifact_links';
}

function mapAxisStatus(status) {
  if (status === 'active_needs_evidence') return 'needs_evidence';
  if (status === 'active_blocked') return 'block';
  if (status === 'active_accepted_followup') return 'accepted_followup';
  return status;
}
