import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const REVIEW_CAUSAL_MODEL = 'vibepro-review-causal-dag-v1';
export const REVIEW_CONVERGENCE_MODEL = 'vibepro-review-convergence-v1';
export const REVIEW_RUNTIME_FAILURE_KINDS = Object.freeze([
  'empty_result',
  'wrong_request',
  'timeout',
  'execution_error'
]);

const RUNTIME_FAILURE_KIND_SET = new Set(REVIEW_RUNTIME_FAILURE_KINDS);
const CONVERGENCE_THRESHOLD = 3;

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
  if (!filePath) return { path: null, domain: 'external' };
  const lower = filePath.toLowerCase();
  if (lower.startsWith('.vibepro/spec/') || lower.includes('/specs/') || /(^|\/)spec\.(json|ya?ml|md)$/.test(lower)) {
    return { path: filePath, domain: 'spec' };
  }
  if (lower.includes('/stories/') || lower.includes('/user_stories/') || lower.includes('/story/')) {
    return { path: filePath, domain: 'story' };
  }
  if (lower.includes('/architecture/') || lower.includes('/adr/') || /(^|\/)adr[-_.]/.test(lower)) {
    return { path: filePath, domain: 'architecture' };
  }
  if (lower.startsWith('test/') || lower.startsWith('tests/') || lower.includes('/test/') || lower.includes('/tests/') || lower.includes('/e2e/')) {
    return { path: filePath, domain: 'test' };
  }
  if (lower.startsWith('.github/workflows/') || lower.startsWith('.husky/') || lower.includes('/deploy') || lower.includes('/release') || lower.includes('/migration') || lower.includes('/migrations/')) {
    return { path: filePath, domain: 'release' };
  }
  if (lower === 'package.json' || lower === 'package-lock.json' || lower.endsWith('.config.js') || lower.endsWith('.config.mjs') || lower.endsWith('.config.ts') || lower.endsWith('.toml') || lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    return { path: filePath, domain: 'config' };
  }
  if (lower === 'readme.md' || lower === 'readme.ja.md' || lower.startsWith('docs/guide/') || lower.startsWith('docs/ja/guide/') || lower.startsWith('docs/reference/') || lower.startsWith('docs/ja/reference/')) {
    return { path: filePath, domain: 'docs' };
  }
  if (lower.includes('/policy') || lower.startsWith('policies/') || lower.includes('/authority') || lower.includes('/governance')) {
    return { path: filePath, domain: 'policy' };
  }
  if (lower.startsWith('src/') || lower.startsWith('lib/') || lower.startsWith('apps/') || lower.startsWith('packages/') || lower.startsWith('bin/') || lower.startsWith('scripts/')) {
    return { path: filePath, domain: 'implementation' };
  }
  if (lower.includes('api') || lower.includes('contract') || lower.includes('schema')) {
    return { path: filePath, domain: 'public_contract' };
  }
  return { path: filePath, domain: 'other' };
}

export function deriveReviewCausalSurface(options = {}) {
  const stage = String(options.stage ?? '').trim();
  const role = String(options.role ?? '').trim();
  const dependencyDomains = getReviewDependencyDomains(stage, role);
  const inspectedFiles = collectReviewFiles(options);
  const classified = inspectedFiles.map(classifyReviewPath).filter((item) => item.path);
  const decisionDependencies = classified.filter((item) => dependencyDomains.includes(item.domain));
  const previousDependencies = normalizePreviousDependencies(options.previousCausalReview);
  const mergedDependencies = dedupeClassified([...previousDependencies, ...decisionDependencies]);
  return {
    schema_version: '0.1.0',
    model: REVIEW_CAUSAL_MODEL,
    stage,
    role,
    dependency_domains: dependencyDomains,
    inspection_surface: classified,
    decision_dependencies: mergedDependencies,
    invalidation_surface: mergedDependencies,
    strict_head: options.strictHead === true,
    reason: mergedDependencies.length > 0
      ? 'Only files in the role-specific decision dependency domains invalidate this review.'
      : 'No role-specific dependency file was identified; unrelated implementation files do not automatically invalidate an upstream judgment.'
  };
}

export function evaluateReviewCausalInvalidation(options = {}) {
  const stage = String(options.stage ?? '').trim();
  const role = String(options.role ?? '').trim();
  const strictHead = options.strictHead === true;
  const changed = [...new Set((options.changedFiles ?? []).map(normalizeReviewPath).filter(Boolean))].sort();
  const dependencyDomains = getReviewDependencyDomains(stage, role);
  const classified = changed.map(classifyReviewPath).filter((item) => item.path);
  if (strictHead) {
    return {
      model: REVIEW_CAUSAL_MODEL,
      reusable: false,
      invalidated: changed.length > 0,
      reason: 'strict HEAD review cannot be reused across a changed candidate',
      dependency_domains: dependencyDomains,
      changed_files: classified,
      relevant_changed_files: classified
    };
  }
  const relevant = classified.filter((item) => dependencyDomains.includes(item.domain));
  return {
    model: REVIEW_CAUSAL_MODEL,
    reusable: relevant.length === 0,
    invalidated: relevant.length > 0,
    reason: relevant.length === 0
      ? `Changed files are outside ${stage}:${role} decision dependencies.`
      : `Changed files touch ${stage}:${role} decision dependencies: ${relevant.slice(0, 6).map((item) => item.path).join(', ')}`,
    dependency_domains: dependencyDomains,
    changed_files: classified,
    relevant_changed_files: relevant
  };
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
      unresolved_finding_ids: previousFindings
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
    closure_inputs: [...new Set((options.closureInputs ?? []).map(normalizeReviewPath).filter(Boolean))]
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
  const unresolved = [];
  const findings = [];
  const runtimeFailures = [];
  let latestEventAt = null;
  for (const stage of stageSummaries ?? []) {
    for (const role of stage.roles ?? []) {
      if (role.recorded_at && (!latestEventAt || role.recorded_at > latestEventAt)) latestEventAt = role.recorded_at;
      if (role.effective_status !== 'pass') {
        unresolved.push({
          stage: stage.stage,
          role: role.role,
          status: role.effective_status,
          binding_status: role.binding_status ?? null,
          dependency_domains: role.causal_review?.dependency_domains ?? getReviewDependencyDomains(stage.stage, role.role)
        });
      }
      for (const finding of role.findings ?? []) {
        if (finding?.id) findings.push(`${stage.stage}:${role.role}:${finding.id}`);
      }
      if (role.runtime_failure || role.effective_status === 'runtime_failed') {
        runtimeFailures.push({
          stage: stage.stage,
          role: role.role,
          kind: role.runtime_failure?.kind ?? 'execution_error'
        });
      }
    }
  }
  unresolved.sort(compareReviewItems);
  findings.sort();
  runtimeFailures.sort(compareReviewItems);
  const semanticPayload = { unresolved, findings, runtime_failures: runtimeFailures };
  const exactPayload = { head_sha: headSha, ...semanticPayload };
  return {
    model: REVIEW_CONVERGENCE_MODEL,
    head_sha: headSha,
    event_cursor: `${headSha ?? 'no-head'}:${latestEventAt ?? 'no-review-event'}`,
    exact_signature: hashJson(exactPayload),
    semantic_signature: hashJson(semanticPayload),
    unresolved_role_count: unresolved.length,
    unresolved_roles: unresolved,
    finding_ids: findings,
    runtime_failures: runtimeFailures,
    latest_review_event_at: latestEventAt
  };
}

export function advanceReviewConvergenceState(previous, snapshot, options = {}) {
  const threshold = Number.isInteger(options.threshold) && options.threshold > 1
    ? options.threshold
    : CONVERGENCE_THRESHOLD;
  if (snapshot.unresolved_role_count === 0) {
    return {
      schema_version: '0.1.0',
      model: REVIEW_CONVERGENCE_MODEL,
      status: 'converged',
      repeat_count: 0,
      head_churn_count: 0,
      threshold,
      snapshot,
      next_action: null,
      updated_at: new Date().toISOString()
    };
  }
  if (previous?.snapshot?.event_cursor === snapshot.event_cursor) return previous;
  const sameSemanticState = previous?.snapshot?.semantic_signature === snapshot.semantic_signature;
  const previousUnresolved = previous?.snapshot?.unresolved_role_count ?? Number.POSITIVE_INFINITY;
  const improved = snapshot.unresolved_role_count < previousUnresolved;
  const repeatCount = sameSemanticState && !improved ? (previous?.repeat_count ?? 0) + 1 : 1;
  const headChurnCount = sameSemanticState
    && previous?.snapshot?.head_sha
    && snapshot.head_sha
    && previous.snapshot.head_sha !== snapshot.head_sha
      ? (previous?.head_churn_count ?? 0) + 1
      : sameSemanticState ? previous?.head_churn_count ?? 0 : 0;
  const status = repeatCount >= threshold ? 'review_nonconvergent' : 'converging';
  return {
    schema_version: '0.1.0',
    model: REVIEW_CONVERGENCE_MODEL,
    status,
    repeat_count: repeatCount,
    head_churn_count: headChurnCount,
    threshold,
    snapshot,
    next_action: status === 'review_nonconvergent'
      ? 'Stop redispatching unchanged roles. Split the review-contract defect into a VibePro Story and return the current Story with explicit unresolved roles.'
      : 'Dispatch only unresolved causally-invalidated roles; do not recreate current reviews.',
    updated_at: new Date().toISOString()
  };
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

function collectReviewFiles(options) {
  const fromBinding = (options.contentBinding?.surface_files ?? []).map((item) => item?.path).filter(Boolean);
  const fromArtifacts = (options.artifacts ?? []).map((item) => item?.ref ?? item?.path ?? item).filter(Boolean);
  return [...new Set([
    ...(options.inspectionInputs ?? []),
    ...fromArtifacts,
    ...fromBinding
  ].map(normalizeReviewPath).filter(Boolean))].sort();
}

function normalizePreviousDependencies(previous) {
  return (previous?.decision_dependencies ?? previous?.invalidation_surface ?? [])
    .map((item) => {
      if (typeof item === 'string') return classifyReviewPath(item);
      const filePath = normalizeReviewPath(item?.path);
      return filePath ? { path: filePath, domain: item.domain ?? classifyReviewPath(filePath).domain } : null;
    })
    .filter(Boolean);
}

function dedupeClassified(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.path) continue;
    map.set(item.path, { path: item.path, domain: item.domain ?? classifyReviewPath(item.path).domain });
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function parseResolvedFindingRefs(values = []) {
  return (values ?? []).flatMap((value) => {
    const text = String(value ?? '').trim();
    if (!text) return [];
    const [findingId, ...rest] = text.split(':');
    return findingId ? [{ finding_id: findingId, evidence_ref: rest.join(':') || null }] : [];
  });
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

function compareReviewItems(a, b) {
  return `${a.stage}:${a.role}:${a.status ?? a.kind ?? ''}`.localeCompare(`${b.stage}:${b.role}:${b.status ?? b.kind ?? ''}`);
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
