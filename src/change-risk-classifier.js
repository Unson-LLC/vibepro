const WORKFLOW_KEYWORDS = [
  /workflow/i,
  /preflight/i,
  /poll(?:ing)?/i,
  /retry/i,
  /queue/i,
  /worker/i,
  /\bstate\b/i,
  /\bstatus\b/i,
  /resume/i,
  /legacy/i,
  /\bv1\b/i,
  /\b(?:auth|authn|authz|authentication|authorization)\b/i,
  /認証/,
  /状態/,
  /再開/,
  /検出/,
  /キュー/
];

const MAX_LOW_RISK_SOURCE_FILES = 2;
const MAX_LOW_RISK_SOURCE_LINES = 30;

export function classifyChangeRisk({ fileGroups = {}, storySource = {}, networkContracts = null, regressionRisk = null, diffStats = null } = {}) {
  const sourceFiles = fileGroups.source?.files ?? [];
  const testFiles = fileGroups.tests?.files ?? [];
  const allFiles = [
    ...sourceFiles,
    ...testFiles,
    ...(fileGroups.repo_control?.files ?? []),
    ...(fileGroups.story_docs?.files ?? []),
    ...(fileGroups.specifications?.files ?? [])
  ];
  const storyText = [
    storySource?.title,
    storySource?.requirement_title,
    storySource?.background,
    storySource?.policy,
    ...(storySource?.acceptance_criteria ?? [])
  ].filter(Boolean).join(' ');
  // Regression-risk hotspots that the diff actually touches. A changed module
  // with a large call-graph blast radius (and, when coverage is known, a thin
  // safety net) warrants heavier gates than its file paths alone would suggest.
  const regressionHits = resolveRegressionHits({ sourceFiles, regressionRisk });
  const criticalRegressionHits = regressionHits.filter((hit) => hit.priority === 'critical');
  const highRegressionHits = regressionHits.filter((hit) => hit.risk_tier === 'high' || hit.priority === 'critical');
  const riskSurfaces = detectRiskSurfaces({
    sourceFiles,
    allFiles,
    storyText,
    networkContracts,
    hasRegressionBlastRadius: highRegressionHits.length > 0
  });
  const reasons = buildReasons({ riskSurfaces, sourceFiles, allFiles, storyText, networkContracts });
  appendRegressionReasons(reasons, { criticalRegressionHits, highRegressionHits });
  const hasWorkflowSignal = WORKFLOW_KEYWORDS.some((pattern) => pattern.test(storyText) || allFiles.some((file) => pattern.test(file)));
  const lowRiskEvidenceChange = isLowRiskEvidenceChange({ fileGroups, allFiles, sourceFiles });
  const smallSourceLowRisk = !lowRiskEvidenceChange && isSmallSourceLowRiskChange({
    fileGroups,
    allFiles,
    sourceFiles,
    riskSurfaces,
    regressionHits,
    diffStats
  });
  if (smallSourceLowRisk) {
    reasons.push(`small source diff (<=${MAX_LOW_RISK_SOURCE_FILES} files, <=${MAX_LOW_RISK_SOURCE_LINES} changed lines) with no detected risk surfaces`);
  }
  const reuseEligible = lowRiskEvidenceChange || smallSourceLowRisk;
  const crossSurface = riskSurfaces.filter((surface) => surface !== 'test_coverage').length >= 3;
  const coreWorkflowHeavy = riskSurfaces.includes('core_workflow_state') && hasWorkflowSignal;
  const baseProfile = (crossSurface && hasWorkflowSignal) || coreWorkflowHeavy
    ? 'workflow_heavy'
    : riskSurfaces.includes('frontend_interaction')
      ? 'ui_interaction'
      : (riskSurfaces.includes('server_api') || riskSurfaces.includes('auth_boundary') || riskSurfaces.includes('legacy_v1_compatibility'))
        ? 'api_contract'
        : 'light';
  // A changed critical hotspot (large blast radius + low coverage) is the
  // genuine regression trap, so it forces the heaviest gate profile outright.
  const profile = criticalRegressionHits.length > 0 ? 'workflow_heavy' : baseProfile;
  const changeType = profile === 'workflow_heavy'
    ? 'cross_surface_workflow_change'
    : reuseEligible
      ? 'low_risk_evidence_change'
    : profile === 'ui_interaction'
      ? 'ui_interaction_change'
      : profile === 'api_contract'
        ? 'api_contract_change'
        : 'simple_code_change';
  return {
    schema_version: '0.1.0',
    profile,
    change_type: changeType,
    risk_surfaces: riskSurfaces,
    reasons,
    required_gate_profile: profile,
    evidence_reuse_policy: buildEvidenceReusePolicy({ lowRiskEvidenceChange, smallSourceLowRisk, fileGroups, sourceFiles, diffStats }),
    regression_hotspots: regressionHits,
    regression_escalated: criticalRegressionHits.length > 0
  };
}

function isLowRiskEvidenceChange({ fileGroups, allFiles, sourceFiles }) {
  if (sourceFiles.length > 0) return false;
  if (allFiles.length === 0) return false;
  const allowedBuckets = [
    fileGroups.story_docs?.files ?? [],
    fileGroups.specifications?.files ?? [],
    fileGroups.tests?.files ?? []
  ].flat();
  if (allowedBuckets.length !== allFiles.length) return false;
  return allFiles.every((file) => isLowRiskEvidencePath(file));
}

function isLowRiskEvidencePath(file) {
  return file.startsWith('docs/management/stories/')
    || file.startsWith('docs/specs/')
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

function isSmallSourceLowRiskChange({ fileGroups, allFiles, sourceFiles, riskSurfaces, regressionHits, diffStats }) {
  if (!diffStats || typeof diffStats !== 'object') return false;
  if (sourceFiles.length === 0 || sourceFiles.length > MAX_LOW_RISK_SOURCE_FILES) return false;
  if (riskSurfaces.some((surface) => surface !== 'test_coverage')) return false;
  if (regressionHits.length > 0) return false;
  const allowedCompanions = [
    fileGroups.story_docs?.files ?? [],
    fileGroups.specifications?.files ?? [],
    fileGroups.tests?.files ?? []
  ].flat();
  if (sourceFiles.length + allowedCompanions.length !== allFiles.length) return false;
  let totalChangedLines = 0;
  for (const file of sourceFiles) {
    const stats = diffStats[file];
    if (!Number.isFinite(stats?.additions) || !Number.isFinite(stats?.deletions)) return false;
    totalChangedLines += stats.additions + stats.deletions;
  }
  return totalChangedLines <= MAX_LOW_RISK_SOURCE_LINES;
}

function buildEvidenceReusePolicy({ lowRiskEvidenceChange, smallSourceLowRisk = false, fileGroups, sourceFiles = [], diffStats = null }) {
  const testFiles = fileGroups.tests?.files ?? [];
  if (lowRiskEvidenceChange) {
    const docsFiles = [
      ...(fileGroups.story_docs?.files ?? []),
      ...(fileGroups.specifications?.files ?? [])
    ];
    return {
      allowed: true,
      mode: 'path_scoped_low_risk_reuse',
      reason: 'low-risk Story/Spec/test evidence changes may reuse already passing current-head runtime evidence without rerunning unrelated live verification',
      rerun_required_for: testFiles,
      docs_only: docsFiles.length > 0 && testFiles.length === 0
    };
  }
  if (smallSourceLowRisk) {
    const totalChangedLines = sourceFiles.reduce((sum, file) => {
      const stats = diffStats?.[file];
      return sum + (stats?.additions ?? 0) + (stats?.deletions ?? 0);
    }, 0);
    return {
      allowed: true,
      mode: 'small_source_low_risk_reuse',
      reason: 'small source diff with no detected risk surfaces or regression hotspots may reuse already passing evidence; CI re-verifies unit/typecheck/build downstream',
      rerun_required_for: testFiles,
      source_line_budget: {
        max_files: MAX_LOW_RISK_SOURCE_FILES,
        max_total_lines: MAX_LOW_RISK_SOURCE_LINES,
        total_changed_lines: totalChangedLines
      },
      docs_only: false
    };
  }
  return {
    allowed: false,
    mode: 'strict_current_git_binding'
  };
}

function resolveRegressionHits({ sourceFiles, regressionRisk }) {
  const hotspots = regressionRisk?.hotspots ?? [];
  if (!Array.isArray(hotspots) || hotspots.length === 0) return [];
  const changedSource = new Set(sourceFiles);
  return hotspots
    .filter((hotspot) => hotspot && changedSource.has(hotspot.file))
    .map((hotspot) => ({
      file: hotspot.file,
      fan_in: hotspot.fan_in,
      coverage_pct: hotspot.coverage_pct ?? null,
      risk_tier: hotspot.risk_tier,
      priority: hotspot.priority ?? hotspot.risk_tier
    }));
}

function appendRegressionReasons(reasons, { criticalRegressionHits, highRegressionHits }) {
  if (criticalRegressionHits.length > 0) {
    const files = criticalRegressionHits.map((hit) => hit.file).join(', ');
    reasons.push(`critical regression hotspot changed (large blast radius + low coverage): ${files}`);
  } else if (highRegressionHits.length > 0) {
    const files = highRegressionHits.map((hit) => hit.file).join(', ');
    reasons.push(`high blast-radius module changed (many call-graph dependents): ${files}`);
  }
}

function detectRiskSurfaces({ sourceFiles, allFiles, storyText, networkContracts, hasRegressionBlastRadius = false }) {
  const surfaces = new Set();
  if (hasRegressionBlastRadius) surfaces.add('regression_blast_radius');
  if (sourceFiles.some(isUiPath)) surfaces.add('frontend_interaction');
  if (sourceFiles.some(isApiPath) || (networkContracts?.introduced_api_client_call_count ?? 0) > 0) surfaces.add('server_api');
  if (sourceFiles.some(isServicePath)) surfaces.add('service_orchestration');
  if (sourceFiles.some(isCoreWorkflowPath)) surfaces.add('core_workflow_state');
  if (sourceFiles.some(isGateOrchestrationPath)) surfaces.add('gate_orchestration');
  if (sourceFiles.some(isVerificationEvidencePath)) surfaces.add('verification_evidence');
  if (sourceFiles.some(isReviewLifecyclePath)) surfaces.add('review_lifecycle');
  if (sourceFiles.some(isDatabasePath)) surfaces.add('database_state');
  if (sourceFiles.some((file) => !isUiPath(file) && isQueueWorkerPath(file))) surfaces.add('queue_worker');
  if (sourceFiles.some((file) => !isUiPath(file) && /retry|poll|status|state/i.test(stripMonorepoPackagePrefix(file)))) {
    surfaces.add('polling_retry');
  }
  if (sourceFiles.some(isAuthBoundaryPath)) {
    surfaces.add('auth_boundary');
  }
  if (sourceFiles.some((file) => /\/v1\/|legacy/i.test(stripMonorepoPackagePrefix(file)))) surfaces.add('legacy_v1_compatibility');
  if (allFiles.some((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file))) surfaces.add('test_coverage');
  return [...surfaces].sort();
}

function buildReasons({ riskSurfaces, sourceFiles, allFiles, storyText, networkContracts }) {
  const reasons = [];
  if (riskSurfaces.includes('regression_blast_radius')) reasons.push('changed module has a large call-graph blast radius');
  if (riskSurfaces.includes('frontend_interaction')) reasons.push('UI-facing source files changed');
  if (riskSurfaces.includes('server_api')) reasons.push('API/server boundary changed');
  if (riskSurfaces.includes('service_orchestration')) reasons.push('service/orchestration layer changed');
  if (riskSurfaces.includes('core_workflow_state')) reasons.push('core workflow/state orchestration source changed');
  if (riskSurfaces.includes('gate_orchestration')) reasons.push('PR/gate orchestration source changed');
  if (riskSurfaces.includes('verification_evidence')) reasons.push('verification evidence binding source changed');
  if (riskSurfaces.includes('review_lifecycle')) reasons.push('agent review lifecycle source changed');
  if (riskSurfaces.includes('database_state')) reasons.push('database/state persistence surface detected');
  if (riskSurfaces.includes('queue_worker')) reasons.push('queue/worker/job surface detected');
  if (riskSurfaces.includes('polling_retry')) reasons.push('polling/retry/status workflow signal detected');
  if (riskSurfaces.includes('auth_boundary')) reasons.push('auth/permission boundary signal detected');
  if (riskSurfaces.includes('legacy_v1_compatibility')) reasons.push('legacy/v1 compatibility surface detected');
  if ((networkContracts?.introduced_api_client_call_count ?? 0) > 0) reasons.push('new API client calls detected by network contract scanner');
  if (WORKFLOW_KEYWORDS.some((pattern) => pattern.test(storyText) || allFiles.some((file) => pattern.test(file)))) {
    reasons.push('Story or diff contains workflow/state transition keywords');
  }
  if (sourceFiles.length === 0) reasons.push('no runtime source files changed');
  return reasons;
}

function isUiPath(file) {
  const runtimePath = stripMonorepoPackagePrefix(file);
  if (/\/api\//.test(runtimePath) || runtimePath.startsWith('api/') || runtimePath.startsWith('src/routes/')) return false;
  return runtimePath.startsWith('src/app/')
    || runtimePath.startsWith('src/pages/')
    || runtimePath.startsWith('src/components/')
    || runtimePath.startsWith('components/')
    || /\.(tsx|jsx|css|scss|sass|less|vue|svelte)$/.test(runtimePath);
}

function isApiPath(file) {
  const runtimePath = stripMonorepoPackagePrefix(file);
  return /\/api\//.test(runtimePath)
    || runtimePath.startsWith('api/')
    || runtimePath.startsWith('server/')
    || runtimePath.startsWith('src/routes/');
}

function isServicePath(file) {
  const runtimePath = stripMonorepoPackagePrefix(file);
  return /\/services?\//.test(runtimePath) || /\/actions?\//.test(runtimePath) || /orchestr/i.test(runtimePath);
}

function isDatabasePath(file) {
  return /prisma|db|database|repository|model|schema/i.test(stripMonorepoPackagePrefix(file));
}

function isQueueWorkerPath(file) {
  return /queue|worker|job|scheduled-task|background-task/i.test(stripMonorepoPackagePrefix(file));
}

function isAuthBoundaryPath(file) {
  return /(^|[/_.-])(?:auth|authn|authz|authentication|authorization|session|permission|permissions|middleware)(?=$|[/_.-])/i
    .test(stripMonorepoPackagePrefix(file));
}

function isCoreWorkflowPath(file) {
  return /workflow|preflight|orchestrat|state-machine|statemachine|execution-state|transition|resume|replay/i.test(stripMonorepoPackagePrefix(file));
}

function isGateOrchestrationPath(file) {
  return /(^|\/)(pr-manager|change-risk-classifier)\.[cm]?js$/.test(stripMonorepoPackagePrefix(file));
}

function isVerificationEvidencePath(file) {
  return /(^|\/)(verification-evidence|flow-verifier)\.[cm]?js$/.test(stripMonorepoPackagePrefix(file));
}

function isReviewLifecyclePath(file) {
  return /(^|\/)agent-review\.[cm]?js$/.test(stripMonorepoPackagePrefix(file));
}

function stripMonorepoPackagePrefix(filePath) {
  if (typeof filePath !== 'string') return '';
  return filePath.replace(/^(?:apps|packages|services)\/[^/]+\//, '');
}
