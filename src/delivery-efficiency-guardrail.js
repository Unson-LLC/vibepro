import { createHash } from 'node:crypto';

const DUPLICATE_STATES = new Set(['running', 'result_uncollected', 'completed_pass']);
const FREEZE_KEYS = ['source', 'spec', 'test', 'review_surface'];

export function selectRiskAdaptiveReviewCoverage(input = {}) {
  const workflowHeavy = input.risk_profile === 'workflow_heavy';
  const enforcementEnabled = input.validation_sequence_checkpoint_ownership === true;
  const validationSequenceOwnsCheckpoints = enforcementEnabled
    && workflowHeavy
    && input.validation_sequence_required === true;
  return {
    risk_profile: input.risk_profile ?? null,
    enforcement_enabled: enforcementEnabled,
    final_roles: {
      release_risk: workflowHeavy,
      human_usability: input.has_ui_surface === true,
      network_runtime: input.has_network_surface === true
    },
    checkpoint_owner: validationSequenceOwnsCheckpoints
      ? 'validation_sequence'
      : workflowHeavy
        ? 'agent_review'
        : 'none',
    duplicate_checkpoint_roles_suppressed: validationSequenceOwnsCheckpoints
      ? [
          'architecture_spec:regression_risk',
          'test_plan:e2e_ux',
          'test_plan:gate_coverage',
          'implementation:runtime_contract',
          'implementation:ux_completion'
        ]
      : [],
    validation_sequence_review_roles: validationSequenceOwnsCheckpoints
      ? ['architecture_spec:architecture_boundary']
      : []
  };
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

function required(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); return value.trim(); }
function strings(value, label) { if (value === undefined || value === null) return []; if (!Array.isArray(value)) throw new Error(`${label} must be an array`); return value.map((item) => required(item, label)); }
function nonEmptyStrings(value, label) { const result = strings(value, label); if (result.length === 0) throw new Error(`${label} must not be empty`); return result; }
function uniqueSorted(value) { return [...new Set(value)].sort(); }
