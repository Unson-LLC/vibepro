/**
 * Pure contracts for VibePro-owned Run lineage.
 * Provider and Thread identifiers are observations; they never establish authority.
 */

export const LINEAGE_SCHEMA_VERSION = '0.1.0';
export const RUN_LINEAGE_SCHEMA_VERSION = LINEAGE_SCHEMA_VERSION;
export const ATTRIBUTION_BUCKETS = [
  'story_attributed',
  'shared_parent',
  'other_story',
  'unattributed',
  'replayed_context'
];

const REQUIRED_FIELDS = ['story_id', 'run_id', 'dispatch_id', 'worktree_root', 'branch', 'head_sha'];
const OBSERVATION_FIELDS = ['provider_run_id', 'provider_session_id', 'thread_id'];
const REPLAY_TYPES = new Set(['compacted', 'compaction', 'context_compacted', 'replacement_history']);

export class RunLineageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RunLineageError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new RunLineageError(code, message, details);
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function authorityOf(value = {}) {
  const authority = value.authority ?? value.run ?? value;
  return {
    story_id: authority.story_id,
    run_id: authority.run_id,
    worktree_root: authority.worktree_root ?? authority.root_realpath ?? authority.execution_context?.root_realpath,
    branch: authority.branch ?? authority.current_branch,
    head_sha: authority.head_sha ?? authority.current_head_sha
  };
}

function compareBinding(envelope, authority, { staleHead = false } = {}) {
  const expected = authorityOf(authority);
  for (const field of ['story_id', 'run_id', 'worktree_root', 'branch']) {
    if (expected[field] !== undefined && expected[field] !== null && envelope[field] !== expected[field]) {
      fail('run_lineage_mismatch', `${field} does not match Run authority`, {
        field, expected: expected[field], actual: envelope[field]
      });
    }
  }
  if (expected.head_sha !== undefined && expected.head_sha !== null && envelope.head_sha !== expected.head_sha) {
    fail(staleHead ? 'stale_run_lineage_head' : 'run_lineage_mismatch', 'lineage HEAD does not match Run authority', {
      field: 'head_sha', expected: expected.head_sha, actual: envelope.head_sha
    });
  }
}

function normalizeObservation(observation) {
  if (!observation || typeof observation !== 'object') {
    fail('invalid_run_lineage', 'provider observation must be an object', { field: 'observation' });
  }
  const normalized = {};
  for (const field of ['provider', ...OBSERVATION_FIELDS, 'story_id', 'run_id', 'dispatch_id', 'head_sha']) {
    const value = text(observation[field]);
    if (value !== null) normalized[field] = value;
  }
  if (!OBSERVATION_FIELDS.some((field) => normalized[field])) {
    fail('invalid_run_lineage', 'provider observation needs a provider identity', { field: 'provider_observation' });
  }
  return normalized;
}

export function validateRunLineageEnvelope(input, authority = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('invalid_run_lineage', 'lineage envelope must be an object');
  }
  if (input.schema_version !== LINEAGE_SCHEMA_VERSION) {
    fail('invalid_run_lineage', `unsupported lineage schema: ${input.schema_version ?? 'missing'}`, {
      field: 'schema_version', expected: LINEAGE_SCHEMA_VERSION, actual: input.schema_version ?? null
    });
  }
  const normalized = { schema_version: LINEAGE_SCHEMA_VERSION };
  for (const field of REQUIRED_FIELDS) {
    const value = text(input[field]);
    if (!value) fail('invalid_run_lineage', `missing lineage field: ${field}`, { field });
    normalized[field] = value;
  }
  if (!/^[0-9a-f]{40}$/i.test(normalized.head_sha)) {
    fail('invalid_run_lineage', 'head_sha must be a 40-character hexadecimal SHA', { field: 'head_sha' });
  }
  for (const field of OBSERVATION_FIELDS) normalized[field] = text(input[field]);
  if (input.provider_observations !== undefined) {
    if (!Array.isArray(input.provider_observations)) {
      fail('invalid_run_lineage', 'provider_observations must be an array', { field: 'provider_observations' });
    }
    normalized.provider_observations = input.provider_observations.map(normalizeObservation);
    for (const observation of normalized.provider_observations) {
      for (const field of OBSERVATION_FIELDS) {
        if (normalized[field] && observation[field] && normalized[field] !== observation[field]) {
          fail('provider_observation_conflict', `provider observation conflicts with ${field}`, {
            field, expected: normalized[field], actual: observation[field]
          });
        }
      }
    }
  }
  if (authority) compareBinding(normalized, authority, { staleHead: true });
  return normalized;
}

export function createRunLineageEnvelope(input = {}, maybeDispatchId = null) {
  const source = input.authority ? { ...input.authority, ...input } : { ...input };
  if (maybeDispatchId && !source.dispatch_id) {
    Object.assign(source, typeof maybeDispatchId === 'object' ? maybeDispatchId : { dispatch_id: maybeDispatchId });
  }
  source.schema_version ??= LINEAGE_SCHEMA_VERSION;
  return validateRunLineageEnvelope(source, input.authority ?? null);
}

export function assertRunLineageBinding(envelope, authority) {
  return validateRunLineageEnvelope(envelope, authority);
}

function sameIdentity(left, right) {
  return OBSERVATION_FIELDS.some((field) => left[field] && right[field] && left[field] === right[field]);
}

export function appendProviderObservation(input, observation) {
  const envelope = validateRunLineageEnvelope(input);
  const nextObservation = normalizeObservation(observation);
  for (const field of ['story_id', 'run_id', 'dispatch_id', 'head_sha']) {
    if (nextObservation[field] !== undefined && nextObservation[field] !== envelope[field]) {
      fail('provider_observation_conflict', `provider observation conflicts with ${field}`, {
        field, expected: envelope[field], actual: nextObservation[field]
      });
    }
  }
  const observations = (envelope.provider_observations ?? []).map((item) => ({ ...item }));
  for (const current of observations) {
    if (sameIdentity(current, nextObservation)) {
      const allSame = [...new Set([...Object.keys(current), ...Object.keys(nextObservation)])]
        .every((field) => current[field] === undefined || nextObservation[field] === undefined || current[field] === nextObservation[field]);
      if (!allSame) fail('provider_observation_conflict', 'provider identity is already bound to different observation data', {
        field: OBSERVATION_FIELDS.find((field) => current[field] && current[field] === nextObservation[field])
      });
      return envelope;
    }
  }
  for (const current of observations) {
    if (sameIdentity(current, nextObservation) || (current.provider_run_id && nextObservation.provider_run_id && current.provider_run_id === nextObservation.provider_run_id)) {
      fail('provider_observation_conflict', 'provider identity cannot be rebound', { field: 'provider_observation' });
    }
  }
  const next = {
    ...envelope,
    provider_observations: [...observations, nextObservation]
  };
  for (const field of OBSERVATION_FIELDS) next[field] ??= nextObservation[field] ?? null;
  return next;
}

export const mergeProviderObservation = appendProviderObservation;

function eventAmount(event, fieldNames) {
  for (const field of fieldNames) {
    const value = Number(event[field]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function eventRunIds(event) {
  const ids = [];
  for (const value of [
    event.run_id,
    ...(event.run_ids ?? []),
    ...(event.parent_run_ids ?? []),
    ...(event.lineage?.run_id ? [event.lineage.run_id] : []),
    ...(event.lineage?.run_ids ?? [])
  ]) {
    if (text(value) && !ids.includes(value)) ids.push(value);
  }
  return ids;
}

function eventStoryId(event) {
  return text(event.story_id ?? event.lineage?.story_id ?? event.artifact_binding?.story_id);
}

function sourceArtifact(event) {
  return event.source_artifact ?? event.artifact ?? event.artifact_binding?.source_artifact ?? null;
}

function classify(event, options) {
  const targetStory = options.story_id ?? options.storyId;
  const targetRun = options.run_id ?? options.runId;
  const runIds = eventRunIds(event);
  const stories = new Set([...(event.story_ids ?? []), ...(event.run_story_ids ?? [])].filter(Boolean));
  const story = eventStoryId(event);
  if (REPLAY_TYPES.has(event.type) || REPLAY_TYPES.has(event.payload?.type)
    || event.provenance_bucket === 'replayed_context' || event.replayed_context === true) {
    return ['replayed_context', 'validated_artifact_binding', 'high', null];
  }
  if (event.shared_parent === true || runIds.length > 1 || event.lineage?.shared_parent === true) {
    return ['shared_parent', 'explicit_run_lineage', 'authoritative', null];
  }
  if (runIds.length === 1 && runIds[0] === targetRun && (!story || story === targetStory)) {
    return ['story_attributed', 'explicit_run_lineage', 'authoritative', runIds[0]];
  }
  if ((story && story !== targetStory) || (runIds.length === 1 && runIds[0] !== targetRun)) {
    return ['other_story', runIds.length ? 'validated_artifact_binding' : 'textual_heuristic', runIds.length ? 'high' : 'low', runIds[0] ?? null];
  }
  if (event.artifact_binding?.run_id && event.artifact_binding.run_id === targetRun && event.artifact_binding.story_id === targetStory) {
    return ['story_attributed', 'validated_artifact_binding', 'high', targetRun];
  }
  if (event.worktree_root && options.worktree_root && event.worktree_root === options.worktree_root && event.branch && event.branch === options.branch) {
    return ['story_attributed', 'worktree_inference', 'medium', targetRun ?? null];
  }
  if (event.text && targetStory && String(event.text).includes(targetStory)) {
    return ['story_attributed', 'textual_heuristic', 'low', null];
  }
  return ['unattributed', 'unavailable', 'unavailable', null];
}

export function resolveRunAttribution(input, maybeOptions = {}) {
  const options = Array.isArray(input) ? maybeOptions : { ...input, ...maybeOptions };
  const events = Array.isArray(input) ? input : (options.events ?? options.exposures ?? []);
  const buckets = Object.fromEntries(ATTRIBUTION_BUCKETS.map((bucket) => [bucket, {
    bucket, event_count: 0, tokens: 0, time_ms: 0, value: 0
  }]));
  const resolved = events.map((event, index) => {
    const [bucket, method, confidence, runId] = classify(event, options);
    const result = {
      ...event,
      index,
      bucket,
      method,
      source_artifact: sourceArtifact(event),
      confidence,
      run_id: runId
    };
    const target = buckets[bucket];
    target.event_count += 1;
    target.tokens += eventAmount(event, ['tokens', 'estimated_tokens', 'token_count']);
    target.time_ms += eventAmount(event, ['time_ms', 'duration_ms', 'elapsed_ms']);
    target.value += eventAmount(event, ['value', 'amount']);
    return result;
  });
  const totals = {
    event_count: events.length,
    tokens: resolved.reduce((sum, event) => sum + eventAmount(event, ['tokens', 'estimated_tokens', 'token_count']), 0),
    time_ms: resolved.reduce((sum, event) => sum + eventAmount(event, ['time_ms', 'duration_ms', 'elapsed_ms']), 0),
    value: resolved.reduce((sum, event) => sum + eventAmount(event, ['value', 'amount']), 0)
  };
  return {
    events: resolved,
    classifications: resolved,
    buckets,
    totals,
    total_event_count: totals.event_count,
    total_tokens: totals.tokens,
    total_time_ms: totals.time_ms,
    total_value: totals.value
  };
}

export const resolveAttribution = resolveRunAttribution;
export const createLineageEnvelope = createRunLineageEnvelope;
export const validateLineageEnvelope = validateRunLineageEnvelope;
