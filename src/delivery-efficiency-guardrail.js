import { createHash } from 'node:crypto';

const LIMITS = {
  max_elapsed_ms: 'trusted_pr_ready_ms',
  max_observed_work_ms: 'observed_work_ms',
  max_tool_wait_ms: 'tool_wait_ms',
  max_total_tokens: 'total_tokens',
  max_fresh_input_tokens: 'fresh_input_tokens',
  max_cost_usd: 'cost_usd',
  max_subagent_count: 'subagent_count',
  max_agent_consumption_ms: 'agent_consumption_ms',
  max_repair_batches: 'repair_batch_count',
  max_expensive_verification_count: 'expensive_verification_count'
};

const DUPLICATE_STATES = new Set(['running', 'result_uncollected', 'completed_pass']);
const DEBT_STATES = new Set(['timed_out', 'obsolete', 'orphaned_agent']);
const FREEZE_KEYS = ['source', 'spec', 'test', 'review_surface'];

export function normalizeEfficiencyPolicy(input = {}) {
  const policy = {};
  for (const key of Object.keys(LIMITS)) policy[key] = nullableLimit(input[key], key);
  policy.max_review_dispatches_by_role = normalizeRoleLimits(input.max_review_dispatches_by_role);
  policy.require_known_attribution = input.require_known_attribution === true;
  return policy;
}

export function evaluateDeliveryBudget(policyInput = {}, metrics = {}) {
  const policy = normalizeEfficiencyPolicy(policyInput);
  const dimensions = {};
  const remaining = {};
  const exceeded = [];
  for (const [limitKey, metricKey] of Object.entries(LIMITS)) {
    const result = evaluateDimension(policy[limitKey], metrics[metricKey]);
    dimensions[metricKey] = result;
    remaining[metricKey] = result.remaining;
    if (result.status === 'exceeded') exceeded.push(metricKey);
  }
  const roleDimensions = {};
  const roleRemaining = {};
  for (const [role, limit] of Object.entries(policy.max_review_dispatches_by_role)) {
    const result = evaluateDimension(limit, metrics.review_dispatches_by_role?.[role]);
    roleDimensions[role] = result;
    roleRemaining[role] = result.remaining;
    if (result.status === 'exceeded') exceeded.push(`review_dispatches_by_role.${role}`);
  }
  dimensions.review_dispatches_by_role = roleDimensions;
  remaining.review_dispatches_by_role = roleRemaining;
  const attributionUnknown = policy.require_known_attribution && metrics.attribution_status !== 'known';
  dimensions.attribution_status = {
    status: attributionUnknown ? 'unknown' : 'known',
    measured: metrics.attribution_status ?? null,
    limit: policy.require_known_attribution ? 'known' : null,
    remaining: null
  };
  if (attributionUnknown) {
    return { status: 'stopped', policy, dimensions, remaining, exceeded,
      stop: { type: 'stop', reason: 'attribution_unknown', dimensions: ['attribution_status'] } };
  }
  if (exceeded.length > 0) {
    return { status: 'exceeded', policy, dimensions, remaining, exceeded,
      stop: { type: 'stop', reason: 'budget_exceeded', dimensions: exceeded } };
  }
  return { status: 'within_budget', policy, dimensions, remaining, exceeded: [], stop: null };
}

export function buildReviewDispatchDecision(input = {}) {
  const identity = normalizeBinding(input);
  const decisionEvidence = {
    closes_risks: nonEmptyStrings(input.closes_risks, 'closes_risks'),
    expected_judgment_delta: required(input.expected_judgment_delta, 'expected_judgment_delta'),
    reusable_evidence: strings(input.reusable_evidence, 'reusable_evidence'),
    budget: input.budget ?? null
  };
  const idempotencyKey = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  if (input.budget?.stop || ['exceeded', 'stopped'].includes(input.budget?.status)) {
    return decision('stop', identity, idempotencyKey, decisionEvidence, input.budget?.stop?.reason ?? 'budget_exceeded');
  }
  const reviewKind = input.review_kind ?? 'final';
  if (!['preflight', 'final'].includes(reviewKind)) throw new Error('review_kind must be preflight or final');
  if (reviewKind === 'final' && FREEZE_KEYS.some((key) => input.freeze?.[key] !== true)) {
    return decision('stop', identity, idempotencyKey, decisionEvidence, 'finalization_incomplete');
  }
  const matching = (input.lifecycles ?? []).find((entry) => sameBinding(entry, identity) && DUPLICATE_STATES.has(entry.status));
  if (matching) {
    const action = matching.status === 'completed_pass' ? 'reuse' : 'await_result';
    return { ...decision(action, identity, idempotencyKey, decisionEvidence, null), duplicate_status: matching.status };
  }
  return decision('dispatch', identity, idempotencyKey, decisionEvidence, null);
}

export function planLifecycleTerminalization(input = {}) {
  const currentHead = required(input.current_head_sha, 'current_head_sha');
  const actions = [];
  for (const entry of input.lifecycles ?? []) {
    if (entry.status !== 'running' || entry.head_sha === currentHead) continue;
    const confirmed = entry.cancel_confirmed === true
      && typeof entry.cancellation_evidence === 'string'
      && entry.cancellation_evidence.trim().length > 0;
    actions.push({
      lifecycle_id: required(entry.lifecycle_id, 'lifecycle_id'),
      from_head_sha: required(entry.head_sha, 'lifecycle.head_sha'),
      current_head_sha: currentHead,
      action: confirmed ? 'terminalize' : 'stop',
      terminal_status: confirmed ? 'obsolete' : 'orphaned_agent',
      cancel_confirmed: confirmed
    });
  }
  const orphaned = actions.filter((item) => item.terminal_status === 'orphaned_agent');
  return {
    actions,
    stop: orphaned.length > 0
      ? { type: 'stop', reason: 'orphaned_agent', lifecycle_ids: orphaned.map((item) => item.lifecycle_id) }
      : null
  };
}

export function planCompatibleFindingBatches(findings = []) {
  const batches = [];
  for (const finding of findings) {
    const normalized = normalizeFinding(finding);
    const compatible = normalized.disposition === 'repairable'
      ? batches.find((batch) => batch.disposition === 'repairable'
        && batch.role === normalized.role
        && batch.surface_digest === normalized.surface_digest
        && isConflictFree(batch.findings, normalized))
      : null;
    if (compatible) {
      compatible.findings.push(normalized);
      compatible.finding_ids.push(normalized.id);
      compatible.instruction = compatible.findings.map((item) => item.detail).join('\n');
      continue;
    }
    batches.push({
      batch_id: `repair-batch-${batches.length + 1}-${normalized.surface_digest.slice(0, 10)}`,
      role: normalized.role,
      disposition: normalized.disposition,
      surface_digest: normalized.surface_digest,
      finding_ids: [normalized.id],
      findings: [normalized],
      instruction: normalized.detail,
      code_scope: normalized.code_scope,
      test_scope: normalized.test_scope,
      verification_count: normalized.disposition === 'repairable' ? 1 : 0,
      rereview_count: normalized.disposition === 'repairable' ? 1 : 0
    });
  }
  return batches;
}

export function aggregateDeliveryMetrics(input = {}) {
  const reviews = input.reviews ?? [];
  const hasCompleteReviewTiming = reviews.length > 0
    && reviews.every((review) => review.started_at && review.finished_at);
  const intervals = hasCompleteReviewTiming
    ? reviews.map((review) => interval(review.started_at, review.finished_at))
    : [];
  const reviewDispatchesByRole = reviews.reduce((counts, review) => {
    if (typeof review.role === 'string' && review.role.trim()) counts[review.role] = (counts[review.role] ?? 0) + 1;
    return counts;
  }, {});
  const totalTokens = nullableMeasurement(input.total_tokens, 'total_tokens');
  const freshTokens = nullableMeasurement(input.fresh_input_tokens, 'fresh_input_tokens');
  const accepted = nullableMeasurement(input.accepted_finding_count, 'accepted_finding_count', true);
  return {
    trusted_pr_ready_ms: elapsed(input.run_started_at, input.trusted_pr_ready_at),
    observed_work_ms: nullableMeasurement(input.observed_work_ms, 'observed_work_ms'),
    tool_wait_ms: nullableMeasurement(input.tool_wait_ms, 'tool_wait_ms'),
    review_wait_ms: hasCompleteReviewTiming ? unionDuration(intervals) : null,
    subagent_wall_clock_ms: hasCompleteReviewTiming ? unionDuration(intervals) : null,
    agent_consumption_ms: hasCompleteReviewTiming ? intervals.reduce((sum, item) => sum + item[1] - item[0], 0) : null,
    subagent_count: nullableMeasurement(input.subagent_count ?? (input.reviews ? input.reviews.length : null), 'subagent_count', true),
    review_dispatch_count: nullableMeasurement(input.review_dispatch_count ?? (input.reviews ? input.reviews.length : null), 'review_dispatch_count', true),
    review_dispatches_by_role: input.review_dispatches_by_role ?? (input.reviews ? reviewDispatchesByRole : null),
    accepted_finding_count: accepted,
    repair_batch_count: nullableMeasurement(input.repair_batch_count, 'repair_batch_count', true),
    full_suite_count: nullableMeasurement(input.full_suite_count, 'full_suite_count', true),
    expensive_verification_count: nullableMeasurement(input.expensive_verification_count ?? input.full_suite_count, 'expensive_verification_count', true),
    evidence_reuse_count: nullableMeasurement(input.evidence_reuse_count, 'evidence_reuse_count', true),
    evidence_invalidation_count: nullableMeasurement(input.evidence_invalidation_count, 'evidence_invalidation_count', true),
    fresh_input_tokens: freshTokens,
    total_tokens: totalTokens,
    cost_usd: nullableMeasurement(input.cost_usd, 'cost_usd'),
    tokens_per_accepted_finding: {
      total: ratioOrNull(totalTokens, accepted),
      fresh_input: ratioOrNull(freshTokens, accepted)
    },
    attribution_status: input.attribution_status ?? null
  };
}

export function summarizeEfficiencyDebt(input = {}) {
  const debt = [];
  const counts = new Map();
  for (const lifecycle of input.lifecycles ?? []) {
    if (!DEBT_STATES.has(lifecycle.status)) continue;
    counts.set(lifecycle.status, (counts.get(lifecycle.status) ?? 0) + 1);
  }
  for (const kind of ['timed_out', 'obsolete', 'orphaned_agent']) {
    if (counts.has(kind)) debt.push({ kind, count: counts.get(kind) });
  }
  if ((input.duplicate_dispatch_count ?? 0) > 0) debt.push({ kind: 'duplicate_dispatch', count: input.duplicate_dispatch_count });
  if (input.budget?.status === 'exceeded' || input.budget?.stop?.reason === 'budget_exceeded') {
    debt.push({ kind: 'budget_exceeded', dimensions: input.budget.exceeded ?? input.budget.stop?.dimensions ?? [] });
  }
  return {
    correctness_ready: input.correctness_ready === true,
    ready_for_pr_create: input.correctness_ready === true,
    has_efficiency_debt: debt.length > 0,
    debt
  };
}

function decision(action, identity, idempotencyKey, evidence, stopReason) {
  return { action, dispatch_required: action === 'dispatch', stop_reason: stopReason,
    idempotency_key: idempotencyKey, binding: identity, decision_evidence: evidence };
}

function normalizeBinding(input) {
  return {
    story_id: required(input.story_id, 'story_id'),
    stage: required(input.stage, 'stage'),
    role: required(input.role, 'role'),
    head_sha: required(input.head_sha, 'head_sha'),
    surface_digest: required(input.surface_digest, 'surface_digest')
  };
}

function sameBinding(entry, binding) {
  return ['story_id', 'stage', 'role', 'head_sha', 'surface_digest'].every((key) => entry?.[key] === binding[key]);
}

function normalizeFinding(finding) {
  const codeScope = uniqueSorted(strings(finding.code_scope, 'code_scope'));
  const testScope = uniqueSorted(strings(finding.test_scope, 'test_scope'));
  const role = required(finding.role ?? 'implementation', 'finding.role');
  const disposition = required(finding.disposition, 'finding.disposition');
  const surfaceDigest = createHash('sha256').update(JSON.stringify({ role, code_scope: codeScope, test_scope: testScope })).digest('hex');
  return { ...finding, id: required(finding.id, 'finding.id'), detail: required(finding.detail, 'finding.detail'),
    role, disposition, code_scope: codeScope, test_scope: testScope, conflicts_with: strings(finding.conflicts_with, 'conflicts_with'), surface_digest: surfaceDigest };
}

function isConflictFree(existing, candidate) {
  return existing.every((item) => !candidate.conflicts_with.includes(item.id) && !item.conflicts_with.includes(candidate.id));
}

function evaluateDimension(limit, measured) {
  if (limit === null) return { status: measured === null || measured === undefined ? 'unknown' : 'unbounded', measured: measured ?? null, limit: null, remaining: null };
  if (measured === null || measured === undefined) return { status: 'unknown', measured: null, limit, remaining: null };
  const value = nonNegative(measured, 'measurement');
  return { status: value > limit ? 'exceeded' : 'within_budget', measured: value, limit, remaining: Math.max(0, limit - value) };
}

function normalizeRoleLimits(input) {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('max_review_dispatches_by_role must be an object');
  return Object.fromEntries(Object.entries(input).map(([role, value]) => [required(role, 'review role'), nullableLimit(value, `review role ${role}`)]));
}

function nullableLimit(value, label) { return value === undefined || value === null ? null : nonNegative(value, label); }
function nullableMeasurement(value, label, integer = false) {
  if (value === undefined || value === null) return null;
  const number = nonNegative(value, label);
  if (integer && !Number.isInteger(number)) throw new Error(`${label} must be an integer`);
  return number;
}
function nonNegative(value, label) { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number`); return number; }
function required(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); return value.trim(); }
function strings(value, label) { if (value === undefined || value === null) return []; if (!Array.isArray(value)) throw new Error(`${label} must be an array`); return value.map((item) => required(item, label)); }
function nonEmptyStrings(value, label) { const result = strings(value, label); if (result.length === 0) throw new Error(`${label} must not be empty`); return result; }
function uniqueSorted(value) { return [...new Set(value)].sort(); }
function interval(start, end) { const from = Date.parse(required(start, 'started_at')); const to = Date.parse(required(end, 'finished_at')); if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new Error('review interval is invalid'); return [from, to]; }
function elapsed(start, end) { if (!start || !end) return null; const [from, to] = interval(start, end); return to - from; }
function unionDuration(intervals) { const sorted = intervals.toSorted((a, b) => a[0] - b[0]); let total = 0; let [start, end] = sorted[0]; for (const [nextStart, nextEnd] of sorted.slice(1)) { if (nextStart <= end) end = Math.max(end, nextEnd); else { total += end - start; start = nextStart; end = nextEnd; } } return total + end - start; }
function ratioOrNull(value, denominator) { return value === null || denominator === null || denominator === 0 ? null : value / denominator; }
