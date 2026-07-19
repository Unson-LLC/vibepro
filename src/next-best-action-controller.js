import { createHash } from 'node:crypto';

const ALLOWED_CLASSIFICATIONS = new Set(['read_only', 'repo_local_safe']);
const ESCAPE_ACTIONS = new Set(['ask', 'split', 'wait', 'stop', 'rediagnose']);
const METRICS = Object.freeze([
  'expected_progress',
  'uncertainty_reduction',
  'risk_reduction',
  'evidence_reuse',
  'estimated_time',
  'estimated_tokens_or_cost',
  'invalidation_risk',
  'rework_risk',
  'confidence'
]);
const MAX_STATE_DELTA_BYTES = 4096;

export function selectNextBestAction(input = {}) {
  const checkpointReason = requireText(input.checkpoint_reason, 'checkpoint_reason');
  const stateFingerprint = fingerprint(input.state_delta ?? {});
  const previous = input.previous_decision ?? null;
  if (previous
    && previous.state_fingerprint === stateFingerprint
    && previous.policy_version === (input.policy_version ?? '1')
    && previous.checkpoint_reason === checkpointReason) {
    return { ...previous, reused: true };
  }

  const noProgressCount = Number.isInteger(input.no_progress_count) ? input.no_progress_count : 0;
  const eligible = (input.candidates ?? [])
    .filter(isEligible)
    .map(normalizeCandidate);
  const candidates = noProgressCount >= 2
    ? eligible.filter((candidate) => ESCAPE_ACTIONS.has(candidate.action_id))
    : eligible;

  if (candidates.length === 0) {
    return buildDecision({
      input,
      checkpointReason,
      stateFingerprint,
      noProgressCount,
      candidates: [],
      selected: null,
      outcome: noProgressCount >= 2 ? 'stop' : 'no_eligible_action'
    });
  }

  const scored = candidates
    .map((candidate) => ({ ...candidate, score: score(candidate) }))
  const nonDominated = scored.filter((candidate) => !scored.some((other) => dominatesUncertaintyCost(other, candidate)));
  const ranked = [...nonDominated.sort(compareRank), ...scored.filter((candidate) => !nonDominated.includes(candidate)).sort(compareRank)];
  return buildDecision({
    input,
    checkpointReason,
    stateFingerprint,
    noProgressCount,
    candidates: ranked,
    selected: ranked[0],
    outcome: 'selected'
  });
}

function isEligible(candidate) {
  if (!candidate || typeof candidate.action_id !== 'string') return false;
  if (candidate.policy_allowed !== true || candidate.dependency_ready !== true) return false;
  return ALLOWED_CLASSIFICATIONS.has(candidate.classification)
    || ESCAPE_ACTIONS.has(candidate.action_id);
}

function normalizeCandidate(candidate) {
  const metrics = {};
  for (const metric of METRICS) metrics[metric] = normalizeMetric(candidate.metrics?.[metric]);
  return {
    action_id: candidate.action_id,
    classification: candidate.classification,
    metrics
  };
}

function normalizeMetric(value) {
  if (value === undefined || value === null || value === 'unknown') return 'unknown';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return value;
}

function score(candidate) {
  const m = candidate.metrics;
  const benefit = known(m.expected_progress) * 4
    + known(m.uncertainty_reduction) * 3
    + known(m.risk_reduction) * 3
    + known(m.evidence_reuse) * 2
    + known(m.confidence);
  const cost = known(m.estimated_time)
    + known(m.estimated_tokens_or_cost)
    + known(m.invalidation_risk) * 2
    + known(m.rework_risk) * 2;
  const unknownCostPenalty = ['estimated_time', 'estimated_tokens_or_cost', 'invalidation_risk', 'rework_risk']
    .filter((key) => m[key] === 'unknown').length;
  return benefit - cost - unknownCostPenalty;
}

function known(value) {
  return typeof value === 'number' ? value : 0;
}

function compareRank(left, right) {
  if (right.score !== left.score) return right.score - left.score;
  const confidence = known(right.metrics.confidence) - known(left.metrics.confidence);
  if (confidence !== 0) return confidence;
  return left.action_id.localeCompare(right.action_id);
}

function dominatesUncertaintyCost(left, right) {
  const l = left.metrics;
  const r = right.metrics;
  if (![l.uncertainty_reduction, r.uncertainty_reduction, l.estimated_time, r.estimated_time,
    l.estimated_tokens_or_cost, r.estimated_tokens_or_cost].every((value) => typeof value === 'number')) return false;
  return l.uncertainty_reduction >= r.uncertainty_reduction
    && l.estimated_time <= r.estimated_time
    && l.estimated_tokens_or_cost <= r.estimated_tokens_or_cost
    && (l.uncertainty_reduction > r.uncertainty_reduction
      || l.estimated_time < r.estimated_time
      || l.estimated_tokens_or_cost < r.estimated_tokens_or_cost);
}

function buildDecision({ input, checkpointReason, stateFingerprint, noProgressCount, candidates, selected, outcome }) {
  const rejected = candidates.slice(1).map((candidate) => ({
    action_id: candidate.action_id,
    score: candidate.score,
    reason_code: 'lower_rank'
  }));
  return {
    schema_version: '0.1.0',
    policy_version: input.policy_version ?? '1',
    checkpoint_reason: checkpointReason,
    state_delta: boundedStateDelta(input.state_delta ?? {}),
    state_fingerprint: stateFingerprint,
    no_progress_count: noProgressCount,
    outcome,
    selected_action_id: selected?.action_id ?? null,
    selection_reason: selected
      ? (noProgressCount >= 2 ? 'no_progress_escape' : 'highest_expected_value')
      : outcome,
    selected_score: selected?.score ?? null,
    candidates,
    rejected,
    reused: false
  };
}

function boundedStateDelta(value) {
  assertSafeStateDelta(value);
  const raw = stableStringify(value);
  if (Buffer.byteLength(raw) > MAX_STATE_DELTA_BYTES) throw new Error('state_delta exceeds bounded decision record limit');
  return JSON.parse(raw);
}

function assertSafeStateDelta(value, depth = 0) {
  if (depth > 8) throw new Error('state_delta exceeds bounded decision record depth');
  if (Array.isArray(value)) {
    for (const item of value) assertSafeStateDelta(item, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const forbidden = /(transcript|chain[_-]?of[_-]?thought|hidden[_-]?reasoning|raw[_-]?(prompt|response|message))/i;
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.test(key)) throw new Error(`state_delta contains forbidden raw context key: ${key}`);
    assertSafeStateDelta(item, depth + 1);
  }
}

function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}
