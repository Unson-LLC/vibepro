import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const REVIEW_CAUSAL_MODEL = 'vibepro-review-causal-dag-v1';
export const REVIEW_CONVERGENCE_MODEL = 'vibepro-review-convergence-v2';
export const REVIEW_RUNTIME_FAILURE_KINDS = Object.freeze([
  'empty_result',
  'wrong_request',
  'timeout',
  'execution_error'
]);

const RUNTIME_FAILURE_KIND_SET = new Set(REVIEW_RUNTIME_FAILURE_KINDS);
const DEFAULT_NO_PROGRESS_THRESHOLD = 3;
const UNKNOWN_DOMAINS = new Set(['other', 'external']);

const STAGE_DEFAULT_DOMAINS = Object.freeze({
  planning_spec: ['story', 'spec', 'architecture', 'policy', 'public_contract'],
  requirement: ['story', 'spec', 'architecture', 'policy', 'public_contract'],
  architecture_spec: ['story', 'spec', 'architecture', 'policy', 'public_contract'],
  test_plan: ['story', 'spec', 'architecture', 'implementation', 'test', 'config'],
  implementation: ['spec', 'architecture', 'implementation', 'test', 'config'],
  preview: ['story', 'spec', 'implementation', 'test', 'release', 'docs', 'config'],
  gate: ['story', 'spec', 'architecture', 'implementation', 'test', 'release', 'docs', 'config', 'policy']
});

const ROLE_DEPENDENCY_DOMAINS = Object.freeze({
  product_requirement: ['story', 'spec', 'policy', 'public_contract'],
  architecture_boundary: ['story', 'spec', 'architecture', 'policy', 'public_contract'],
  spec_consistency: ['story', 'spec', 'architecture', 'policy'],
  scope_risk: ['story', 'spec', 'architecture', 'implementation', 'config'],
  acceptance_e2e: ['story', 'spec', 'implementation', 'test'],
  regression_risk: ['architecture', 'implementation', 'test', 'config'],
  unit_integration: ['spec', 'implementation', 'test', 'config'],
  e2e_ux: ['story', 'spec', 'implementation', 'test', 'docs'],
  gate_coverage: ['spec', 'implementation', 'test', 'release', 'config'],
  code_spec_alignment: ['spec', 'architecture', 'implementation', 'config'],
  runtime_contract: ['architecture', 'implementation', 'test', 'release', 'config'],
  ux_completion: ['story', 'spec', 'implementation', 'test', 'docs'],
  preview_smoke: ['implementation', 'test', 'release', 'docs', 'config'],
  network_runtime: ['architecture', 'implementation', 'test', 'release', 'config'],
  human_usability: ['story', 'spec', 'implementation', 'test', 'docs'],
  gate_evidence: ['spec', 'architecture', 'implementation', 'test', 'release', 'config', 'docs'],
  pr_split_scope: ['story', 'spec', 'architecture', 'implementation', 'test', 'release', 'config', 'docs', 'policy'],
  release_risk: ['architecture', 'implementation', 'test', 'release', 'config', 'docs', 'policy']
});

export function getReviewDependencyDomains(stage, role) {
  const domains = ROLE_DEPENDENCY_DOMAINS[role] ?? STAGE_DEFAULT_DOMAINS[stage] ?? ['other'];
  return [...new Set(domains)];
}

export function classifyReviewPath(ref) {
  const filePath = normalizeReviewPath(ref);
  if (!filePath) return { path: null, domain: 'external', classified: false };
  const lower = filePath.toLowerCase();
  if (lower.startsWith('.vibepro/spec/') || lower.includes('/specs/') || /(^|\/)spec\.(json|ya?ml|md)$/.test(lower)) {
    return classifiedPath(filePath, 'spec');
  }
  if (lower.includes('/stories/') || lower.includes('/user_stories/') || lower.includes('/story/')) {
    return classifiedPath(filePath, 'story');
  }
  if (lower.includes('/architecture/') || lower.includes('/adr/') || /(^|\/)adr[-_.]/.test(lower)) {
    return classifiedPath(filePath, 'architecture');
  }
  if (lower.startsWith('test/') || lower.startsWith('tests/') || lower.includes('/test/') || lower.includes('/tests/') || lower.includes('/e2e/')) {
    return classifiedPath(filePath, 'test');
  }
  if (lower.startsWith('.github/workflows/') || lower.startsWith('.husky/') || lower.includes('/deploy') || lower.includes('/release') || lower.includes('/migration') || lower.includes('/migrations/')) {
    return classifiedPath(filePath, 'release');
  }
  if (
    lower === 'package.json'
    || lower === 'package-lock.json'
    || lower.endsWith('.config.js')
    || lower.endsWith('.config.mjs')
    || lower.endsWith('.config.ts')
    || lower.endsWith('.toml')
    || lower.endsWith('.yaml')
    || lower.endsWith('.yml')
  ) {
    return classifiedPath(filePath, 'config');
  }
  if (
    lower === 'readme.md'
    || lower === 'readme.ja.md'
    || lower.startsWith('docs/guide/')
    || lower.startsWith('docs/ja/guide/')
    || lower.startsWith('docs/reference/')
    || lower.startsWith('docs/ja/reference/')
  ) {
    return classifiedPath(filePath, 'docs');
  }
  if (lower.includes('/policy') || lower.startsWith('policies/') || lower.includes('/authority') || lower.includes('/governance')) {
    return classifiedPath(filePath, 'policy');
  }
  if (lower.startsWith('src/') || lower.startsWith('lib/') || lower.startsWith('apps/') || lower.startsWith('packages/') || lower.startsWith('bin/') || lower.startsWith('scripts/')) {
    return classifiedPath(filePath, 'implementation');
  }
  if (lower.includes('api') || lower.includes('contract') || lower.includes('schema')) {
    return classifiedPath(filePath, 'public_contract');
  }
  return { path: filePath, domain: 'other', classified: false };
}

export function deriveReviewCausalSurface(options = {}) {
  const stage = String(options.stage ?? '').trim();
  const role = String(options.role ?? '').trim();
  const dependencyDomains = getReviewDependencyDomains(stage, role);
  const inspectedFiles = collectReviewFiles(options);
  const inspectionSurface = inspectedFiles.map(classifyReviewPath).filter((item) => item.path);
  const unknownInspectionSurface = inspectionSurface.filter((item) => !item.classified);
  const decisionDependencies = inspectionSurface.filter((item) => (
    item.classified && dependencyDomains.includes(item.domain)
  ));
  const previousDependencies = normalizeRecordedSurface(
    options.previousCausalReview?.invalidation_surface
      ?? options.previousCausalReview?.decision_dependencies
      ?? []
  );
  const invalidationSurface = dedupeClassified([...previousDependencies, ...decisionDependencies]);
  const classificationStatus = unknownInspectionSurface.length > 0
    ? 'inconclusive_fail_closed'
    : 'classified';
  return {
    schema_version: '0.2.0',
    model: REVIEW_CAUSAL_MODEL,
    stage,
    role,
    dependency_domains: dependencyDomains,
    inspection_surface: inspectionSurface,
    decision_dependencies: invalidationSurface,
    invalidation_surface: invalidationSurface,
    unknown_inspection_surface: unknownInspectionSurface,
    classification_status: classificationStatus,
    strict_head: options.strictHead === true,
    reason: classificationStatus === 'inconclusive_fail_closed'
      ? `Inspection contains ${unknownInspectionSurface.length} unclassified path(s); causal reuse must fail closed until they are classified.`
      : invalidationSurface.length > 0
        ? 'Recorded invalidation surface contains only role-specific decision dependencies; inspection-only files remain auditable but do not automatically invalidate the judgment.'
        : 'No role-specific dependency file was identified; later reuse may rely on the conservative role-domain fallback, and unknown changes fail closed.'
  };
}

export function evaluateReviewCausalInvalidation(options = {}) {
  const stage = String(options.stage ?? '').trim();
  const role = String(options.role ?? '').trim();
  const strictHead = options.strictHead === true;
  const rawChanged = [...new Set((options.changedFiles ?? []).map((value) => String(value ?? '').trim()).filter(Boolean))].sort();
  const changedFiles = rawChanged.map(classifyReviewPath);
  const dependencyDomains = getReviewDependencyDomains(stage, role);
  const recordedSurface = normalizeRecordedSurface(
    options.invalidationSurface
      ?? options.causalReview?.invalidation_surface
      ?? options.causalReview?.decision_dependencies
      ?? []
  );
  const unparseableChangedFiles = changedFiles.filter((item) => !item.path);
  const unknownChangedFiles = changedFiles.filter((item) => item.path && !item.classified);
  const classificationIncomplete = options.causalReview?.classification_status === 'inconclusive_fail_closed'
    || (options.causalReview?.unknown_inspection_surface?.length ?? 0) > 0;

  if (strictHead) {
    return causalInvalidationResult({
      reusable: false,
      failClosed: true,
      reason: 'strict HEAD review cannot be reused across a changed candidate',
      dependencyDomains,
      changedFiles,
      relevantChangedFiles: changedFiles,
      recordedSurface,
      classificationStatus: 'strict_head'
    });
  }
  if (rawChanged.length === 0) {
    return causalInvalidationResult({
      reusable: false,
      failClosed: true,
      reason: 'content binding is stale but no changed-file delta was available; causal reuse fails closed',
      dependencyDomains,
      changedFiles,
      relevantChangedFiles: [],
      recordedSurface,
      classificationStatus: 'unresolved_delta'
    });
  }
  if (unparseableChangedFiles.length > 0 || unknownChangedFiles.length > 0 || classificationIncomplete) {
    const unknownPaths = [...unknownChangedFiles.map((item) => item.path), ...unparseableChangedFiles.map(() => '<unparseable>')];
    return causalInvalidationResult({
      reusable: false,
      failClosed: true,
      reason: `causal reuse fails closed because changed or recorded surfaces are not fully classified: ${unknownPaths.slice(0, 6).join(', ') || 'recorded inspection surface'}`,
      dependencyDomains,
      changedFiles,
      relevantChangedFiles: [...unknownChangedFiles, ...unparseableChangedFiles],
      recordedSurface,
      classificationStatus: 'inconclusive_fail_closed'
    });
  }

  const surfaceHits = changedFiles.filter((changed) => (
    recordedSurface.some((recorded) => pathsOverlap(recorded.path, changed.path))
  ));
  const domainHits = changedFiles.filter((changed) => dependencyDomains.includes(changed.domain));
  const relevantChangedFiles = dedupeClassified([...surfaceHits, ...domainHits]);
  const reusable = relevantChangedFiles.length === 0;
  return causalInvalidationResult({
    reusable,
    failClosed: false,
    reason: reusable
      ? `Changed files are outside the recorded invalidation surface and ${stage}:${role} dependency domains.`
      : `Changed files touch the recorded invalidation surface or ${stage}:${role} dependency domains: ${relevantChangedFiles.slice(0, 6).map((item) => item.path).join(', ')}`,
    dependencyDomains,
    changedFiles,
    relevantChangedFiles,
    recordedSurface,
    classificationStatus: 'classified'
  });
}

export function buildReviewDeltaClosure(options = {}) {
  const previous = options.previousReview;
  const resolved = parseResolvedFindingRefs(options.resolvedFindings);
  const previousFindings = Array.isArray(previous?.findings)
    ? previous.findings.map((finding) => finding?.id).filter(Boolean)
    : [];
  if (!previous || resolved.length === 0) {
    return {
      mode: 'full_review',
      source_recorded_at: previous?.recorded_at ?? null,
      source_status: previous?.status ?? null,
      resolved_findings: [],
      unresolved_finding_ids: previousFindings,
      closure_inputs: []
    };
  }
  const resolvedIds = new Set(resolved.map((item) => item.finding_id));
  return {
    mode: 'delta_closure',
    source_recorded_at: previous.recorded_at ?? null,
    source_status: previous.status ?? null,
    source_head_sha: previous.git_context?.head_sha ?? null,
    fix_head_sha: options.currentHeadSha ?? null,
    resolved_findings: resolved,
    unresolved_finding_ids: previousFindings.filter((id) => !resolvedIds.has(id)),
    closure_inputs: [...new Set((options.closureInputs ?? []).map(normalizeReviewPath).filter(Boolean))].sort()
  };
}

export function normalizeReviewRuntimeFailure(kind, detail = null) {
  const normalized = String(kind ?? '').trim().toLowerCase().replaceAll('-', '_');
  if (!RUNTIME_FAILURE_KIND_SET.has(normalized)) {
    throw new Error(`runtime failure kind must be one of: ${REVIEW_RUNTIME_FAILURE_KINDS.join(', ')}`);
  }
  return {
    kind: normalized,
    detail: String(detail ?? '').trim() || null,
    product_finding: false
  };
}

export function buildReviewConvergenceSnapshot({ headSha = null, stageSummaries = [] } = {}) {
  const unresolvedRoles = [];
  const findings = [];
  const runtimeFailures = [];
  const completedEvents = [];
  const evidenceState = [];
  const dependencyState = [];
  const repairState = [];

  for (const stage of stageSummaries ?? []) {
    for (const role of stage.roles ?? []) {
      const stageName = stage.stage;
      const roleName = role.role;
      const event = normalizeCompletedReviewEvent(stageName, roleName, role);
      if (event) completedEvents.push(event);
      if (role.effective_status !== 'pass') {
        unresolvedRoles.push({
          stage: stageName,
          role: roleName,
          status: role.effective_status,
          binding_status: role.binding_status ?? null,
          stale_reason: role.stale_reason ?? null,
          dependency_domains: role.causal_review?.dependency_domains ?? getReviewDependencyDomains(stageName, roleName)
        });
      }
      for (const finding of role.findings ?? []) {
        if (!finding?.id) continue;
        findings.push({
          stage: stageName,
          role: roleName,
          id: finding.id,
          severity: finding.severity ?? null,
          detail: finding.detail ?? null
        });
      }
      for (const disposition of role.finding_dispositions ?? []) {
        if (!disposition?.finding_id && !disposition?.id) continue;
        findings.push({
          stage: stageName,
          role: roleName,
          id: disposition.finding_id ?? disposition.id,
          disposition: disposition.disposition ?? disposition.status ?? null,
          reason: disposition.reason ?? null
        });
      }
      if (role.runtime_failure || role.effective_status === 'runtime_failed') {
        runtimeFailures.push({
          stage: stageName,
          role: roleName,
          kind: role.runtime_failure?.kind ?? 'execution_error',
          detail: role.runtime_failure?.detail ?? null
        });
      }
      evidenceState.push({
        stage: stageName,
        role: roleName,
        inspection_summary: role.inspection?.summary ?? null,
        inspection_evidence: role.inspection?.evidence ?? null,
        inspection_inputs: normalizeTextList(role.inspection?.inputs),
        judgment_delta: normalizeTextList(role.judgment_delta),
        summary: role.summary ?? null
      });
      dependencyState.push({
        stage: stageName,
        role: roleName,
        dependency_domains: normalizeTextList(role.causal_review?.dependency_domains),
        invalidation_surface: normalizeRecordedSurface(role.causal_review?.invalidation_surface),
        classification_status: role.causal_review?.classification_status ?? null
      });
      repairState.push({
        stage: stageName,
        role: roleName,
        delta_closure: normalizeDeltaClosure(role.delta_closure)
      });
    }
  }

  unresolvedRoles.sort(compareReviewItems);
  findings.sort(compareFindingItems);
  runtimeFailures.sort(compareReviewItems);
  completedEvents.sort(compareEventItems);
  evidenceState.sort(compareReviewItems);
  dependencyState.sort(compareReviewItems);
  repairState.sort(compareReviewItems);

  const componentHashes = {
    unresolved_roles: hashJson(unresolvedRoles),
    findings: hashJson(findings),
    runtime_failures: hashJson(runtimeFailures),
    evidence: hashJson(evidenceState),
    dependencies: hashJson(dependencyState),
    repairs: hashJson(repairState)
  };
  const semanticPayload = {
    unresolved_roles: unresolvedRoles.map(({ stage, role, status, binding_status }) => ({ stage, role, status, binding_status })),
    finding_ids: findings.map((finding) => `${finding.stage}:${finding.role}:${finding.id}:${finding.disposition ?? ''}`),
    runtime_failures: runtimeFailures.map(({ stage, role, kind }) => ({ stage, role, kind }))
  };
  const progressPayload = {
    unresolved_roles: unresolvedRoles,
    findings,
    runtime_failures: runtimeFailures,
    evidence: evidenceState,
    dependencies: dependencyState,
    repairs: repairState
  };
  const eventCursor = completedEvents.length > 0
    ? hashJson(completedEvents)
    : 'no-review-event';
  return {
    model: REVIEW_CONVERGENCE_MODEL,
    head_sha: headSha,
    event_cursor: eventCursor,
    event_count: completedEvents.length,
    exact_signature: hashJson({ head_sha: headSha, event_cursor: eventCursor, progress: progressPayload }),
    semantic_signature: hashJson(semanticPayload),
    progress_signature: hashJson(progressPayload),
    component_hashes: componentHashes,
    unresolved_role_count: unresolvedRoles.length,
    unresolved_roles: unresolvedRoles,
    findings,
    finding_ids: findings.map((finding) => `${finding.stage}:${finding.role}:${finding.id}`),
    runtime_failures: runtimeFailures,
    completed_review_events: completedEvents
  };
}

export function advanceReviewConvergenceState(previous, snapshot, options = {}) {
  const threshold = Number.isInteger(options.threshold) && options.threshold > 0
    ? options.threshold
    : DEFAULT_NO_PROGRESS_THRESHOLD;
  const now = new Date().toISOString();
  if (snapshot.unresolved_role_count === 0) {
    return {
      schema_version: '0.2.0',
      model: REVIEW_CONVERGENCE_MODEL,
      status: 'converged',
      wave_count: previous?.wave_count ?? 0,
      no_progress_count: 0,
      repeat_count: 0,
      head_churn_count: countHeadChurn(previous, snapshot),
      threshold,
      event_advanced: previous?.snapshot?.event_cursor !== snapshot.event_cursor,
      progress_detected: true,
      progress_reasons: ['all_required_roles_resolved'],
      snapshot,
      next_action: null,
      updated_at: now
    };
  }

  if (!previous) {
    return {
      schema_version: '0.2.0',
      model: REVIEW_CONVERGENCE_MODEL,
      status: 'converging',
      wave_count: snapshot.event_cursor === 'no-review-event' ? 0 : 1,
      no_progress_count: 0,
      repeat_count: 0,
      head_churn_count: 0,
      threshold,
      event_advanced: snapshot.event_cursor !== 'no-review-event',
      progress_detected: true,
      progress_reasons: ['initial_review_state'],
      snapshot,
      next_action: 'Dispatch only unresolved causally-invalidated roles; do not recreate current reviews.',
      updated_at: now
    };
  }

  const sameEventCursor = previous.snapshot?.event_cursor === snapshot.event_cursor;
  if (sameEventCursor) {
    if (previous.snapshot?.exact_signature === snapshot.exact_signature) return previous;
    const headChanged = Boolean(
      previous.snapshot?.head_sha
      && snapshot.head_sha
      && previous.snapshot.head_sha !== snapshot.head_sha
    );
    return {
      ...previous,
      snapshot,
      head_churn_count: (previous.head_churn_count ?? 0) + (headChanged ? 1 : 0),
      event_advanced: false,
      progress_detected: false,
      progress_reasons: headChanged ? ['head_only_observation'] : ['derived_status_observation'],
      updated_at: now
    };
  }

  const progressDetected = previous.snapshot?.progress_signature !== snapshot.progress_signature;
  const progressReasons = progressDetected
    ? resolveProgressReasons(previous.snapshot, snapshot)
    : [];
  const noProgressCount = progressDetected ? 0 : (previous.no_progress_count ?? previous.repeat_count ?? 0) + 1;
  const waveCount = (previous.wave_count ?? 0) + 1;
  const status = noProgressCount >= threshold ? 'review_nonconvergent' : 'converging';
  return {
    schema_version: '0.2.0',
    model: REVIEW_CONVERGENCE_MODEL,
    status,
    wave_count: waveCount,
    no_progress_count: noProgressCount,
    repeat_count: noProgressCount,
    head_churn_count: countHeadChurn(previous, snapshot),
    threshold,
    event_advanced: true,
    progress_detected: progressDetected,
    progress_reasons: progressReasons,
    snapshot,
    next_action: status === 'review_nonconvergent'
      ? 'Stop automatic redispatch. Preserve the unresolved roles, split the review-contract or runtime defect into its own Story, and require an explicit human-directed retry.'
      : 'Dispatch only unresolved causally-invalidated roles; do not recreate current reviews.',
    updated_at: now
  };
}

export async function readReviewConvergenceState(reviewRoot) {
  return readJsonIfExists(path.join(reviewRoot, 'convergence', 'current.json'));
}

export async function updateReviewConvergenceState(reviewRoot, snapshot, options = {}) {
  const convergenceRoot = path.join(reviewRoot, 'convergence');
  const currentPath = path.join(convergenceRoot, 'current.json');
  const previous = await readJsonIfExists(currentPath);
  const next = advanceReviewConvergenceState(previous, snapshot, options);
  if (next === previous) return previous;
  await mkdir(path.join(convergenceRoot, 'history'), { recursive: true });
  await writeFile(currentPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  const historyName = `${safeTimestamp(next.updated_at)}-${next.snapshot.exact_signature.slice(0, 12)}.json`;
  await writeFile(path.join(convergenceRoot, 'history', historyName), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

function causalInvalidationResult({
  reusable,
  failClosed,
  reason,
  dependencyDomains,
  changedFiles,
  relevantChangedFiles,
  recordedSurface,
  classificationStatus
}) {
  return {
    model: REVIEW_CAUSAL_MODEL,
    reusable,
    invalidated: !reusable,
    fail_closed: failClosed,
    reason,
    classification_status: classificationStatus,
    dependency_domains: dependencyDomains,
    changed_files: changedFiles,
    relevant_changed_files: relevantChangedFiles,
    invalidation_surface_used: recordedSurface.length > 0,
    recorded_invalidation_surface: recordedSurface
  };
}

function collectReviewFiles(options) {
  const fromBinding = (options.contentBinding?.surface_files ?? []).map((item) => item?.path).filter(Boolean);
  const fromArtifacts = (options.artifacts ?? []).map((item) => item?.ref ?? item?.path ?? item).filter(Boolean);
  return [...new Set([
    ...(options.inspectionInputs ?? []),
    ...fromArtifacts,
    ...fromBinding
  ].map(normalizeReviewPath).filter(Boolean))].sort();
}

function normalizeRecordedSurface(values) {
  return dedupeClassified((values ?? []).map((item) => {
    if (typeof item === 'string') return classifyReviewPath(item);
    const filePath = normalizeReviewPath(item?.path);
    if (!filePath) return null;
    const classified = classifyReviewPath(filePath);
    return {
      path: filePath,
      domain: item.domain ?? classified.domain,
      classified: item.classified ?? classified.classified
    };
  }).filter(Boolean));
}

function dedupeClassified(items) {
  const byPath = new Map();
  for (const item of items ?? []) {
    if (!item?.path) continue;
    const classified = classifyReviewPath(item.path);
    byPath.set(item.path, {
      path: item.path,
      domain: item.domain ?? classified.domain,
      classified: item.classified ?? classified.classified
    });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function parseResolvedFindingRefs(values = []) {
  return (values ?? []).flatMap((value) => {
    const text = String(value ?? '').trim();
    if (!text) return [];
    const [findingId, ...rest] = text.split(':');
    return findingId ? [{ finding_id: findingId, evidence_ref: rest.join(':') || null }] : [];
  });
}

function normalizeCompletedReviewEvent(stage, role, value) {
  if (!value?.recorded_at) return null;
  return {
    stage,
    role,
    recorded_at: value.recorded_at,
    recorded_status: value.status ?? null,
    runtime_failure_kind: value.runtime_failure?.kind ?? null,
    fix_head_sha: value.delta_closure?.fix_head_sha ?? null,
    artifact: value.artifact ?? null
  };
}

function normalizeDeltaClosure(value) {
  if (!value) return null;
  return {
    mode: value.mode ?? null,
    source_status: value.source_status ?? null,
    source_head_sha: value.source_head_sha ?? null,
    fix_head_sha: value.fix_head_sha ?? null,
    resolved_findings: (value.resolved_findings ?? []).map((item) => ({
      finding_id: item.finding_id ?? null,
      evidence_ref: item.evidence_ref ?? null
    })),
    unresolved_finding_ids: normalizeTextList(value.unresolved_finding_ids),
    closure_inputs: normalizeTextList(value.closure_inputs)
  };
}

function resolveProgressReasons(previous, current) {
  const reasons = [];
  const labels = {
    unresolved_roles: 'unresolved_roles_changed',
    findings: 'finding_state_changed',
    runtime_failures: 'runtime_state_changed',
    evidence: 'review_evidence_changed',
    dependencies: 'dependency_surface_changed',
    repairs: 'repair_delta_changed'
  };
  for (const [key, label] of Object.entries(labels)) {
    if (previous?.component_hashes?.[key] !== current?.component_hashes?.[key]) reasons.push(label);
  }
  return reasons.length > 0 ? reasons : ['progress_signature_changed'];
}

function countHeadChurn(previous, snapshot) {
  const changed = Boolean(
    previous?.snapshot?.head_sha
    && snapshot.head_sha
    && previous.snapshot.head_sha !== snapshot.head_sha
  );
  return (previous?.head_churn_count ?? 0) + (changed ? 1 : 0);
}

function pathsOverlap(left, right) {
  if (!left || !right) return false;
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function classifiedPath(filePath, domain) {
  return { path: filePath, domain, classified: true };
}

function normalizeReviewPath(ref) {
  const text = String(ref ?? '').trim();
  if (!text || /^https?:\/\//i.test(text)) return null;
  const first = text.split(/\s+/)[0].replace(/^['"`]|['"`]$/g, '');
  const normalized = first.replaceAll('\\', '/').replace(/^\.\//, '').replace(/:\d+(?::\d+)?$/, '');
  if (!normalized || normalized.includes('*') || normalized.includes('...') || path.posix.isAbsolute(normalized)) return null;
  const safe = path.posix.normalize(normalized);
  if (safe === '..' || safe.startsWith('../')) return null;
  return safe;
}

function normalizeTextList(value) {
  if (!Array.isArray(value)) return value ? [String(value)] : [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))].sort();
}

function compareReviewItems(a, b) {
  return `${a.stage}:${a.role}:${a.status ?? a.kind ?? ''}`.localeCompare(`${b.stage}:${b.role}:${b.status ?? b.kind ?? ''}`);
}

function compareFindingItems(a, b) {
  return `${a.stage}:${a.role}:${a.id}:${a.disposition ?? ''}:${a.detail ?? ''}`.localeCompare(`${b.stage}:${b.role}:${b.id}:${b.disposition ?? ''}:${b.detail ?? ''}`);
}

function compareEventItems(a, b) {
  return `${a.stage}:${a.role}:${a.recorded_at}:${a.recorded_status ?? ''}`.localeCompare(`${b.stage}:${b.role}:${b.recorded_at}:${b.recorded_status ?? ''}`);
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeTimestamp(value) {
  return String(value).replace(/[:.]/g, '-');
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
