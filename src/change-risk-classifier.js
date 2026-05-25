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
  /auth/i,
  /認証/,
  /状態/,
  /再開/,
  /検出/,
  /キュー/
];

export function classifyChangeRisk({ fileGroups = {}, storySource = {}, networkContracts = null } = {}) {
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
  const riskSurfaces = detectRiskSurfaces({ sourceFiles, allFiles, storyText, networkContracts });
  const reasons = buildReasons({ riskSurfaces, sourceFiles, allFiles, storyText, networkContracts });
  const hasWorkflowSignal = WORKFLOW_KEYWORDS.some((pattern) => pattern.test(storyText) || allFiles.some((file) => pattern.test(file)));
  const crossSurface = riskSurfaces.filter((surface) => surface !== 'test_coverage').length >= 3;
  const coreWorkflowHeavy = riskSurfaces.includes('core_workflow_state') && hasWorkflowSignal;
  const profile = (crossSurface && hasWorkflowSignal) || coreWorkflowHeavy
    ? 'workflow_heavy'
    : riskSurfaces.includes('frontend_interaction')
      ? 'ui_interaction'
      : (riskSurfaces.includes('server_api') || riskSurfaces.includes('auth_boundary') || riskSurfaces.includes('legacy_v1_compatibility'))
        ? 'api_contract'
        : 'light';
  const changeType = profile === 'workflow_heavy'
    ? 'cross_surface_workflow_change'
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
    required_gate_profile: profile
  };
}

function detectRiskSurfaces({ sourceFiles, allFiles, storyText, networkContracts }) {
  const surfaces = new Set();
  if (sourceFiles.some(isUiPath)) surfaces.add('frontend_interaction');
  if (sourceFiles.some(isApiPath) || (networkContracts?.introduced_api_client_call_count ?? 0) > 0) surfaces.add('server_api');
  if (sourceFiles.some(isServicePath)) surfaces.add('service_orchestration');
  if (sourceFiles.some(isCoreWorkflowPath)) surfaces.add('core_workflow_state');
  if (sourceFiles.some(isGateOrchestrationPath)) surfaces.add('gate_orchestration');
  if (sourceFiles.some(isVerificationEvidencePath)) surfaces.add('verification_evidence');
  if (sourceFiles.some(isReviewLifecyclePath)) surfaces.add('review_lifecycle');
  if (sourceFiles.some(isDatabasePath)) surfaces.add('database_state');
  if (sourceFiles.some((file) => !isUiPath(file) && isQueueWorkerPath(file))) surfaces.add('queue_worker');
  if (sourceFiles.some((file) => !isUiPath(file) && /retry|poll|status|state/i.test(file))) {
    surfaces.add('polling_retry');
  }
  if (sourceFiles.some((file) => /auth|session|permission|middleware/i.test(file))) {
    surfaces.add('auth_boundary');
  }
  if (sourceFiles.some((file) => /\/v1\/|legacy/i.test(file))) surfaces.add('legacy_v1_compatibility');
  if (allFiles.some((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file))) surfaces.add('test_coverage');
  return [...surfaces].sort();
}

function buildReasons({ riskSurfaces, sourceFiles, allFiles, storyText, networkContracts }) {
  const reasons = [];
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
  if (/\/api\//.test(file) || file.startsWith('api/')) return false;
  return file.startsWith('src/app/')
    || file.startsWith('src/pages/')
    || file.startsWith('src/components/')
    || file.startsWith('components/')
    || /\.(tsx|jsx|css|scss|sass|less|vue|svelte)$/.test(file);
}

function isApiPath(file) {
  return /\/api\//.test(file) || file.startsWith('api/') || file.startsWith('server/');
}

function isServicePath(file) {
  return /\/services?\//.test(file) || /\/actions?\//.test(file) || /orchestr/i.test(file);
}

function isDatabasePath(file) {
  return /prisma|db|database|repository|model|schema/i.test(file);
}

function isQueueWorkerPath(file) {
  return /queue|worker|job|scheduled-task|background-task/i.test(file);
}

function isCoreWorkflowPath(file) {
  return /workflow|preflight|orchestrat|state-machine|statemachine|execution-state|transition|resume|replay/i.test(file);
}

function isGateOrchestrationPath(file) {
  return /(^|\/)(pr-manager|change-risk-classifier)\.[cm]?js$/.test(file);
}

function isVerificationEvidencePath(file) {
  return /(^|\/)(verification-evidence|flow-verifier)\.[cm]?js$/.test(file);
}

function isReviewLifecyclePath(file) {
  return /(^|\/)agent-review\.[cm]?js$/.test(file);
}
