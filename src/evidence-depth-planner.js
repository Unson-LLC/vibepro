import { normalizeEvidenceDepth } from './evidence-cost-budget.js';

export const EVIDENCE_DEPTH_PLANNER_VERSION = '0.1.0';
export const EVIDENCE_DRILLDOWN_LOG_VERSION = '0.1.0';

const HIGH_RISK_PROFILES = new Set([
  'workflow_heavy',
  'api_contract',
  'security',
  'production_path',
  'release',
  'network',
  'migration',
  'high'
]);

const HIGH_RISK_ROUTES = new Set([
  'security_trust',
  'release_engineering',
  'data_pipeline',
  'business_system',
  'api_platform',
  'infra_ops',
  'agent_workflow'
]);

const RISK_BEARING_GATE_IDS = new Set([
  'gate:e2e',
  'gate:visual_qa',
  'gate:network_contract',
  'gate:agent_review',
  'gate:review_inspection_required',
  'gate:failure_mode_coverage',
  'gate:path_surface_matrix',
  'gate:artifact_consistency',
  'gate:pr_freshness',
  'gate:safety_secret_surface',
  'gate:deploy_verification',
  'gate:requirement',
  'gate:story_source_integrity',
  'gate:judgment_security_trust_security_regression',
  'gate:judgment_agent_workflow_evidence_lifecycle'
]);

const RESOLVED_GATE_STATUSES = new Set([
  'passed',
  'waived',
  'not_applicable',
  'not_required',
  'skipped',
  'implicit_pass'
]);

const SUMMARY_SKIPPED_ARTIFACTS = [
  'pr-prepare.html',
  'review-cockpit.html',
  'gate-dag.html',
  'gate-dag.json',
  'split-plan.html'
];

const SUMMARY_GENERATED_ARTIFACTS = [
  'evidence-reuse.json',
  'evidence-plan.json',
  'decision-index.json',
  'senior-gap-judgment.json',
  'pr-prepare.json',
  'pr-body.md',
  'split-plan.json',
  'traceability.json',
  'human-review.json',
  'architecture-review.json',
  'decision-records.json',
  'ref-topology.json'
];

const KNOWN_EVIDENCE_ARTIFACTS = new Set([
  ...SUMMARY_GENERATED_ARTIFACTS,
  ...SUMMARY_SKIPPED_ARTIFACTS
]);

export function buildEvidencePlan({
  story = null,
  git = null,
  fileGroups = {},
  scope = null,
  prContext = {},
  gateStatus = null,
  requestedDepth = null,
  requestedDepthReason = null,
  requestedDepthConsumer = null,
  requestedDepthTargets = [],
  createdAt = new Date().toISOString()
} = {}) {
  const changeClassification = prContext?.change_classification ?? {};
  const prRoute = prContext?.pr_route ?? {};
  const engineeringJudgment = prContext?.engineering_judgment ?? {};
  const riskSignals = collectRiskSignals({ changeClassification, prRoute, engineeringJudgment });
  const targetedFullSurfaces = collectTargetedFullSurfaces({
    prContext,
    gateStatus,
    changeClassification,
    engineeringJudgment
  });
  const defaultDepth = 'summary';
  const overrideDepth = normalizeEvidenceDepth(requestedDepth);
  const evidenceDepth = overrideDepth ?? defaultDepth;
  const drilldownTargets = normalizeDrilldownTargets(requestedDepthTargets);
  if (overrideDepth && overrideDepth !== 'summary') {
    assertDrilldownRequest({
      depth: overrideDepth,
      reason: requestedDepthReason,
      consumer: requestedDepthConsumer,
      targets: drilldownTargets,
      prContext,
      gateStatus
    });
  }
  const manualOverride = overrideDepth
    ? {
        status: 'requested',
        depth: overrideDepth,
        reason: nonEmptyString(requestedDepthReason) ?? 'summary view requested',
        consumer: nonEmptyString(requestedDepthConsumer) ?? 'summary_first_default',
        targets: drilldownTargets
      }
    : {
        status: 'none',
        depth: null,
        reason: null,
        consumer: null,
        targets: []
      };
  const artifactPolicy = buildArtifactPolicy(evidenceDepth, drilldownTargets);

  return {
    schema_version: '0.1.0',
    planner_version: EVIDENCE_DEPTH_PLANNER_VERSION,
    story_id: story?.story_id ?? null,
    created_at: createdAt,
    evidence_depth: evidenceDepth,
    default_depth: defaultDepth,
    manual_override: manualOverride,
    planner_inputs: {
      base_ref: git?.base_ref ?? null,
      head_ref: git?.head_ref ?? null,
      head_sha: git?.head_sha ?? null,
      changed_file_count: git?.changed_files?.length ?? null,
      scope_status: scope?.status ?? null,
      risk_profile: changeClassification?.profile ?? null,
      risk_surfaces: changeClassification?.risk_surfaces ?? [],
      pr_route: prRoute?.route_type ?? null,
      engineering_route: engineeringJudgment?.route_type ?? null
    },
    risk_signals: riskSignals,
    targeted_full_surfaces: targetedFullSurfaces,
    escalation_reasons: targetedFullSurfaces.map((surface) => ({
      surface: surface.surface,
      reason: surface.reason,
      source: surface.source
    })),
    artifact_policy: artifactPolicy,
    generated_artifacts: artifactPolicy.generated_artifacts,
    skipped_artifacts: artifactPolicy.skipped_artifacts,
    consumers: artifactPolicy.generated_artifacts
  };
}

export function buildEvidenceDrilldownEntry({ evidencePlan, git, createdAt = new Date().toISOString() } = {}) {
  if (evidencePlan?.manual_override?.status !== 'requested' || evidencePlan.evidence_depth === 'summary') return null;
  return {
    schema_version: EVIDENCE_DRILLDOWN_LOG_VERSION,
    recorded_at: createdAt,
    head_sha: git?.head_sha ?? null,
    base_ref: git?.base_ref ?? null,
    head_ref: git?.head_ref ?? null,
    depth: evidencePlan.evidence_depth,
    consumer: evidencePlan.manual_override.consumer,
    reason: evidencePlan.manual_override.reason,
    targets: evidencePlan.manual_override.targets,
    risk_surfaces: evidencePlan.targeted_full_surfaces.map((surface) => surface.surface)
  };
}

export function appendEvidenceDrilldownEntry(previousLog, entry, storyId) {
  const entries = Array.isArray(previousLog?.entries) ? previousLog.entries : [];
  return {
    schema_version: EVIDENCE_DRILLDOWN_LOG_VERSION,
    story_id: storyId ?? previousLog?.story_id ?? null,
    entries: entry ? [...entries, entry] : entries
  };
}

export function buildEvidenceDecisionIndex({
  story = null,
  git = null,
  fileGroups = {},
  scope = null,
  prContext = {},
  gateStatus = null,
  splitPlan = null,
  evidencePlan = null,
  createdAt = new Date().toISOString()
} = {}) {
  const gateDag = prContext?.gate_dag ?? null;
  const engineeringJudgment = prContext?.engineering_judgment ?? {};
  return {
    schema_version: '0.1.0',
    model: 'vibepro-evidence-decision-index-v1',
    planner_version: evidencePlan?.planner_version ?? EVIDENCE_DEPTH_PLANNER_VERSION,
    story_id: story?.story_id ?? null,
    created_at: createdAt,
    evidence_depth: evidencePlan?.evidence_depth ?? null,
    targeted_full_surfaces: evidencePlan?.targeted_full_surfaces ?? [],
    git: {
      base_ref: git?.base_ref ?? null,
      head_ref: git?.head_ref ?? null,
      head_sha: git?.head_sha ?? null,
      changed_file_count: git?.changed_files?.length ?? null
    },
    file_groups: Object.fromEntries(
      Object.entries(fileGroups ?? {}).map(([name, group]) => [name, group?.count ?? 0])
    ),
    scope: {
      status: scope?.status ?? null,
      recommended_strategy: scope?.recommended_strategy ?? null,
      reasons: scope?.reasons ?? []
    },
    gate_summary: {
      overall_status: gateStatus?.overall_status ?? gateDag?.overall_status ?? null,
      ready_for_pr_create: gateStatus?.ready_for_pr_create ?? null,
      unresolved_gate_count: gateStatus?.unresolved_gate_count ?? null,
      critical_unresolved_gate_count: gateStatus?.critical_unresolved_gate_count ?? null,
      unresolved_gates: (gateStatus?.unresolved_gates ?? []).map(summarizeGate),
      critical_unresolved_gates: (gateStatus?.critical_unresolved_gates ?? []).map(summarizeGate)
    },
    engineering_judgment: {
      route_type: engineeringJudgment?.route_type ?? null,
      route_dag: engineeringJudgment?.route_dag ?? null,
      confidence: engineeringJudgment?.confidence ?? null,
      signals: engineeringJudgment?.signals ?? [],
      active_axis_count: engineeringJudgment?.active_axis_count ?? 0,
      active_axes: engineeringJudgment?.active_axes ?? [],
      judgment_axes: (engineeringJudgment?.judgment_axes ?? []).map((axis) => ({
        axis: axis.axis,
        status: axis.status,
        reason: axis.reason ?? null
      }))
    },
    risk_signals: evidencePlan?.risk_signals ?? [],
    pr_route: {
      route_type: prContext?.pr_route?.route_type ?? null,
      required_gates: prContext?.pr_route?.required_gates ?? [],
      signals: prContext?.pr_route?.signals ?? []
    },
    traceability_clause_coverage: prContext?.traceability_clause_coverage ?? null,
    split_plan: splitPlan ? {
      status: splitPlan.status ?? null,
      recommended_strategy: splitPlan.recommended_strategy ?? null,
      reasons: splitPlan.reasons ?? []
    } : null
  };
}

function buildArtifactPolicy(evidenceDepth, drilldownTargets = []) {
  const summary = evidenceDepth === 'summary';
  const requestedArtifacts = summary
    ? new Set()
    : resolveRequestedArtifacts(drilldownTargets);
  const generatedArtifacts = [...SUMMARY_GENERATED_ARTIFACTS];
  generatedArtifacts.push(...requestedArtifacts);
  const writesPrPrepareHtml = requestedArtifacts.has('pr-prepare.html');
  const writesReviewCockpitHtml = requestedArtifacts.has('review-cockpit.html');
  const writesGateDagHtml = requestedArtifacts.has('gate-dag.html');
  const writesSplitPlanHtml = requestedArtifacts.has('split-plan.html');
  const writesAnyHtml = writesPrPrepareHtml
    || writesReviewCockpitHtml
    || writesGateDagHtml
    || writesSplitPlanHtml;
  return {
    write_html_reports: writesAnyHtml,
    write_pr_prepare_html: writesPrPrepareHtml,
    write_review_cockpit_html: writesReviewCockpitHtml,
    write_gate_dag_html: writesGateDagHtml,
    write_split_plan_html: writesSplitPlanHtml,
    write_full_gate_dag_dump: requestedArtifacts.has('gate-dag.json'),
    write_full_review_lifecycle_dump: false,
    write_raw_logs: false,
    pr_body_token_policy: {
      status: 'bounded_by_artifact_links',
      duplicates_canonical_artifacts: false,
      reason: 'PR body stays concise and links canonical VibePro artifacts instead of embedding full diagnostics'
    },
    generated_artifacts: generatedArtifacts,
    skipped_artifacts: SUMMARY_SKIPPED_ARTIFACTS.filter((artifact) => !requestedArtifacts.has(artifact))
  };
}

function resolveRequestedArtifacts(targets) {
  const requested = new Set();
  for (const target of targets) {
    const normalized = String(target ?? '').trim().replaceAll('\\', '/');
    const filename = normalized.split('/').at(-1);
    if (SUMMARY_SKIPPED_ARTIFACTS.includes(filename)) {
      requested.add(filename);
    } else if (normalized.startsWith('gate:')) {
      requested.add('gate-dag.json');
    }
  }
  return requested;
}

function collectRiskSignals({ changeClassification, prRoute, engineeringJudgment }) {
  const signals = [];
  const profile = changeClassification?.profile ?? null;
  if (profile && HIGH_RISK_PROFILES.has(profile)) {
    signals.push({ kind: 'risk_profile', value: profile, source: 'change_classification' });
  }
  for (const surface of changeClassification?.risk_surfaces ?? []) {
    signals.push({ kind: 'risk_surface', value: surface, source: 'change_classification' });
  }
  const routeType = engineeringJudgment?.route_type ?? prRoute?.route_type ?? null;
  if (routeType && HIGH_RISK_ROUTES.has(routeType)) {
    signals.push({ kind: 'engineering_route', value: routeType, source: 'engineering_judgment' });
  }
  return dedupeObjects(signals, (signal) => `${signal.kind}:${signal.value}:${signal.source}`);
}

function collectTargetedFullSurfaces({ prContext, gateStatus, changeClassification, engineeringJudgment }) {
  const surfaces = [];
  const addSurface = (surface, reason, source, gate = null) => {
    if (!surface) return;
    surfaces.push({
      surface,
      reason,
      source,
      gate: gate ? summarizeGate(gate) : null
    });
  };

  for (const surface of changeClassification?.risk_surfaces ?? []) {
    addSurface(surface, 'risk surface detected', 'change_classification');
  }
  const profile = changeClassification?.profile ?? null;
  if (profile && HIGH_RISK_PROFILES.has(profile)) {
    addSurface(profile, 'high-risk profile detected', 'change_classification');
  }
  const routeType = engineeringJudgment?.route_type ?? null;
  if (routeType && HIGH_RISK_ROUTES.has(routeType)) {
    addSurface(routeType, 'high-risk engineering judgment route detected', 'engineering_judgment');
  }

  const gates = [
    ...(gateStatus?.unresolved_gates ?? []),
    ...(prContext?.gate_dag?.nodes ?? [])
  ];
  for (const gate of gates) {
    if (!gate?.id || !RISK_BEARING_GATE_IDS.has(gate.id)) continue;
    if (RESOLVED_GATE_STATUSES.has(gate.status)) continue;
    if (gate.required === false && !['failed', 'blocking', 'needs_changes'].includes(String(gate.status ?? '').toLowerCase())) continue;
    addSurface(gate.id, `risk-bearing gate status is ${gate.status ?? 'unknown'}`, 'gate_dag', gate);
  }

  for (const decision of prContext?.decision_records?.decisions ?? []) {
    const type = String(decision?.type ?? '').toLowerCase();
    if (decision?.status === 'accepted' && type.includes('waiver')) {
      addSurface(decision.source ?? decision.id ?? 'accepted_waiver', 'accepted waiver requires targeted full evidence', 'decision_record');
    }
  }

  if (hasBlockingReviewFinding(prContext?.agent_reviews)) {
    addSurface('agent_review_findings', 'blocking or needs_changes review finding detected', 'agent_reviews');
  }

  const traceability = prContext?.traceability_clause_coverage ?? null;
  if (traceability && ((traceability.unmapped_count ?? 0) > 0 || (traceability.uncovered_count ?? 0) > 0)) {
    addSurface('traceability_gap', 'traceability has unmapped clauses', 'traceability');
  }

  return dedupeObjects(surfaces, (surface) => `${surface.surface}:${surface.source}`);
}

function hasBlockingReviewFinding(value) {
  if (!value || typeof value !== 'object') return false;
  const stack = [value];
  const statuses = new Set(['blocking', 'needs_changes', 'failed']);
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (statuses.has(String(current.status ?? '').toLowerCase())) return true;
    if (statuses.has(String(current.effective_status ?? '').toLowerCase())) return true;
    for (const child of Object.values(current)) {
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return false;
}

function summarizeGate(gate) {
  return {
    id: gate?.id ?? null,
    type: gate?.type ?? null,
    label: gate?.label ?? null,
    status: gate?.status ?? null,
    required: gate?.required === true,
    reason: gate?.reason ?? null
  };
}

function dedupeObjects(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function nonEmptyString(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDrilldownTargets(values) {
  const targets = Array.isArray(values) ? values : [values];
  return [...new Set(targets.flatMap((value) => String(value ?? '').split(','))
    .map((value) => value.trim())
    .filter(Boolean))];
}

function assertDrilldownRequest({ depth, reason, consumer, targets, prContext, gateStatus }) {
  const missing = [];
  if (!nonEmptyString(reason)) missing.push('--evidence-depth-reason');
  if (!nonEmptyString(consumer)) missing.push('--evidence-depth-consumer');
  if (targets.length === 0) missing.push('--evidence-depth-target');
  if (missing.length > 0) {
    throw new Error(`--evidence-depth ${depth} requires ${missing.join(', ')} so every drill-down is attributable and bounded`);
  }

  const resolvedGateIds = new Set([
    ...(prContext?.gate_dag?.nodes ?? []).map((gate) => gate?.id),
    ...(gateStatus?.unresolved_gates ?? []).map((gate) => gate?.id),
    ...(gateStatus?.critical_unresolved_gates ?? []).map((gate) => gate?.id)
  ].filter(Boolean));
  const unresolvedTargets = targets.filter((target) => {
    const normalized = String(target).replaceAll('\\', '/');
    const filename = normalized.split('/').at(-1);
    if (normalized.startsWith('gate:')) return !resolvedGateIds.has(normalized);
    return !KNOWN_EVIDENCE_ARTIFACTS.has(filename);
  });
  if (unresolvedTargets.length > 0) {
    throw new Error(`--evidence-depth ${depth} has unresolved --evidence-depth-target value(s): ${unresolvedTargets.join(', ')}`);
  }
}
