/**
 * Contracts and canonical repository resolution for VibePro-owned Run lineage.
 * Provider and Thread identifiers are observations; they never establish authority.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { toWorkspaceRelative } from './workspace.js';

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
  const authorityKind = authority.execution_context?.authority_kind;
  const managed = authority.managed_worktree;
  const currentManagedAuthority = authorityKind === 'managed';
  const legacyOrUnmanaged = !managed || authorityKind === 'repository' || authorityKind === 'source_fallback';
  return {
    story_id: authority.story_id,
    run_id: authority.run_id,
    worktree_root: currentManagedAuthority
      ? managed?.path
      : (legacyOrUnmanaged
          ? authority.worktree_root ?? authority.root_realpath ?? authority.execution_context?.root_realpath
          : undefined),
    branch: currentManagedAuthority
      ? managed?.branch
      : (legacyOrUnmanaged ? authority.branch ?? authority.current_branch : undefined),
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

function identityScope(value) {
  return value.provider ?? value.adapter_id ?? null;
}

function sameIdentityScope(left, right) {
  return identityScope(left) === identityScope(right);
}

function sameIdentity(left, right) {
  return sameIdentityScope(left, right)
    && OBSERVATION_FIELDS.some((field) => left[field] && right[field] && left[field] === right[field]);
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
    if (sameIdentityScope(current, nextObservation)
        && current.provider_run_id
        && nextObservation.provider_run_id
        && current.provider_run_id === nextObservation.provider_run_id) {
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

/**
 * Validate the provider identities persisted across dispatch records. Provider
 * identifiers are scoped to their adapter/provider, but cannot be rebound to a
 * different dispatch or Run. Repeated records for the same dispatch are
 * allowed so persisted retries remain idempotent.
 */
export function assertProviderIdentityUniqueness(records = []) {
  if (!Array.isArray(records)) {
    fail('invalid_run_lineage', 'persisted dispatch records must be an array', { field: 'runtime_dispatches' });
  }
  const bindings = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object') {
      fail('invalid_run_lineage', 'persisted dispatch record must be an object', { field: 'runtime_dispatch' });
    }
    const envelope = record.lineage;
    const validated = envelope ? validateRunLineageEnvelope(envelope) : null;
    const observations = validated?.provider_observations ?? [];
    const adapter = text(record.adapter_id);
    const lineageValues = Object.fromEntries(OBSERVATION_FIELDS
      .map((field) => [field, text(validated?.[field])])
      .filter(([, value]) => value));

    for (const field of OBSERVATION_FIELDS) {
      const recordValue = text(record[field]);
      const lineageValue = lineageValues[field];
      if (recordValue && lineageValue && recordValue !== lineageValue) {
        fail('provider_identity_conflict', 'record provider identity disagrees with lineage identity', {
          field, record_value: recordValue, lineage_value: lineageValue
        });
      }
    }

    if (observations.length > 0) {
      for (const observation of observations) {
        if (adapter && observation.provider && adapter !== observation.provider) {
          fail('provider_identity_conflict', 'adapter/provider scope disagrees with authoritative lineage observation', {
            field: 'provider', adapter_id: adapter, provider: observation.provider,
            run_id: validated?.run_id ?? text(record.run_id)
          });
        }
        for (const field of OBSERVATION_FIELDS) {
          const recordValue = text(record[field]);
          if (recordValue && observation[field] && recordValue !== observation[field]) {
            fail('provider_identity_conflict', 'record provider identity disagrees with authoritative lineage observation', {
              field, record_value: recordValue, observation_value: observation[field]
            });
          }
        }
      }
    }

    const authoritativeIdentities = observations.length > 0
      ? observations.flatMap((observation) => OBSERVATION_FIELDS
        .filter((field) => observation[field])
        .map((field) => ({ provider: observation.provider ?? adapter ?? 'unknown', field, value: observation[field] })))
      : OBSERVATION_FIELDS
        .map((field) => ({
          provider: adapter ?? 'unknown',
          field,
          value: text(record[field]) ?? lineageValues[field]
        }))
        .filter(({ value }) => value);

    for (const { provider, field, value } of authoritativeIdentities) {
      const key = `${provider}:${field}:${value}`;
      const current = bindings.get(key);
      if (!current) {
        bindings.set(key, {
          dispatch_id: validated?.dispatch_id ?? text(record.dispatch_id),
          run_id: validated?.run_id ?? text(record.run_id),
          story_id: validated?.story_id ?? text(record.story_id),
          provider,
          field,
          value
        });
        continue;
      }
      if (current.dispatch_id === (validated?.dispatch_id ?? text(record.dispatch_id))
          && current.run_id === (validated?.run_id ?? text(record.run_id))) continue;
      fail('provider_identity_conflict', 'provider identity is already bound to another dispatch or Run', {
        field, value, provider,
        existing: current,
        attempted: {
          dispatch_id: validated?.dispatch_id ?? text(record.dispatch_id),
          run_id: validated?.run_id ?? text(record.run_id),
          story_id: validated?.story_id ?? text(record.story_id)
        }
      });
    }
  }
  return true;
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

export async function resolveCanonicalRunLineage(repoRoot, observedRoot, {
  storyId,
  runId,
  sessionCwd = null,
  processCwd = null,
  sessionEvents = []
} = {}) {
  const candidateRoots = [...new Set([
    repoRoot,
    observedRoot,
    sessionCwd,
    processCwd
  ].filter(Boolean).map((candidate) => path.resolve(candidate)))];
  let firstUnavailable = null;
  for (const candidateRoot of candidateRoots) {
    const mirrorPath = path.join(candidateRoot, '.vibepro', 'executions', storyId, 'runs', runId, 'state.json');
    let state;
    try {
      state = JSON.parse(await readFile(mirrorPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      return {
        status: 'unavailable',
        reason: 'canonical Run state artifact is malformed or unreadable; authority resolution stopped',
        source_artifact: toWorkspaceRelative(candidateRoot, mirrorPath),
        requested: { story_id: storyId, run_id: runId },
        authority_failure: {
          status: 'degraded',
          code: 'canonical_run_artifact_corrupt',
          artifact: toWorkspaceRelative(candidateRoot, mirrorPath),
          cause: error.code ?? error.name ?? 'read_error',
          detail: error.message
        }
      };
    }
    if (state.story_id !== storyId || state.run_id !== runId) {
      return {
        status: 'unavailable',
        reason: 'canonical Run artifact identity did not match the requested Story/Run',
        source_artifact: toWorkspaceRelative(candidateRoot, mirrorPath),
        requested: { story_id: storyId, run_id: runId },
        observed: { story_id: state.story_id ?? null, run_id: state.run_id ?? null }
      };
    }
    const authorityRoot = path.resolve(state.execution_context?.root_realpath ?? candidateRoot);
    const authorityPath = path.join(authorityRoot, '.vibepro', 'executions', storyId, 'runs', runId, 'state.json');
    if (authorityPath !== mirrorPath) {
      try {
        state = JSON.parse(await readFile(authorityPath, 'utf8'));
      } catch (error) {
        return {
          status: 'unavailable',
          reason: 'canonical Run authority points to an unreadable state artifact',
          source_artifact: toWorkspaceRelative(candidateRoot, mirrorPath),
          authority_artifact: toWorkspaceRelative(authorityRoot, authorityPath),
          detail: error.message
        };
      }
    }
    if (state.story_id !== storyId || state.run_id !== runId) {
      return {
        status: 'unavailable',
        reason: 'canonical Run authority identity did not match the requested Story/Run',
        source_artifact: toWorkspaceRelative(authorityRoot, authorityPath),
        requested: { story_id: storyId, run_id: runId },
        observed: { story_id: state.story_id ?? null, run_id: state.run_id ?? null }
      };
    }
    return await buildCanonicalRunLineage(state, authorityRoot, authorityPath, {
      storyId,
      runId,
      sessionCwd,
      processCwd,
      sessionEvents
    });
  }
  return {
    status: 'unavailable',
    reason: firstUnavailable?.reason ?? 'canonical Guarded Run state artifact was not found for the requested Story/Run',
    source_artifact: firstUnavailable ? toWorkspaceRelative(repoRoot, firstUnavailable.path) : null,
    requested: { story_id: storyId, run_id: runId }
  };
}

async function buildCanonicalRunLineage(state, authorityRoot, authorityPath, {
  storyId,
  runId,
  sessionCwd = null,
  processCwd = null,
  sessionEvents = []
}) {
  const sourceArtifact = toWorkspaceRelative(authorityRoot, authorityPath);
  const authority = authorityOf({ ...state, story_id: state.story_id, run_id: state.run_id });
  const authorityError = validateCanonicalRunAuthority(authority, authorityRoot, {
    storyId,
    runId,
    sessionCwd,
    processCwd,
    sessionEvents
  });
  if (authorityError) {
    return {
      status: 'unavailable',
      reason: authorityError,
      source_artifact: sourceArtifact,
      requested: { story_id: storyId, run_id: runId }
    };
  }
  const events = [];
  const invalidDispatches = [];
  for (const dispatch of Array.isArray(state.runtime_dispatches) ? state.runtime_dispatches : []) {
    if (!dispatch?.lineage) {
      invalidDispatches.push({ dispatch_id: dispatch?.dispatch_id ?? null, reason: 'dispatch has no lineage envelope' });
      continue;
    }
    try {
      const lineage = validateRunLineageEnvelope(dispatch.lineage, authority);
      events.push({
        id: `run:${runId}:dispatch:${lineage.dispatch_id}`,
        event_kind: 'runtime_dispatch',
        story_id: storyId,
        run_id: runId,
        lineage,
        provider_observations: lineage.provider_observations ?? [],
        artifact_binding: { story_id: storyId, run_id: runId, source_artifact: sourceArtifact },
        source_artifact: sourceArtifact,
        tokens: 0,
        time_ms: 0
      });
    } catch (error) {
      invalidDispatches.push({ dispatch_id: dispatch.dispatch_id ?? null, reason: error.message, code: error.code ?? null });
    }
  }
  if (invalidDispatches.length > 0) {
    return {
      status: 'unavailable',
      reason: `canonical Run dispatch lineage validation failed: ${invalidDispatches.length} invalid dispatch(es)`,
      source_artifact: sourceArtifact,
      requested: { story_id: storyId, run_id: runId },
      dispatch_count: Array.isArray(state.runtime_dispatches) ? state.runtime_dispatches.length : 0,
      validated_dispatch_count: events.filter((event) => event.event_kind === 'runtime_dispatch').length,
      invalid_dispatches: invalidDispatches,
      provider_identity_validation: {
        status: 'degraded',
        code: 'invalid_dispatch_lineage',
        details: invalidDispatches
      }
    };
  }
  try {
    assertProviderIdentityUniqueness(await scanPersistedProviderIdentityRecords(authorityRoot));
  } catch (error) {
    return {
      status: 'unavailable',
      reason: `canonical Run provider identity uniqueness validation failed: ${error.message}`,
      source_artifact: sourceArtifact,
      requested: { story_id: storyId, run_id: runId },
      provider_identity_validation: {
        status: 'degraded',
        code: error.code ?? 'provider_identity_conflict',
        details: error.details ?? null
      }
    };
  }
  if (events.length === 0) {
    events.push({
      id: `run:${runId}:authority`,
      event_kind: 'run_authority',
      story_id: storyId,
      run_id: runId,
      artifact_binding: { story_id: storyId, run_id: runId, source_artifact: sourceArtifact },
      source_artifact: sourceArtifact,
      tokens: 0,
      time_ms: 0
    });
  }
  const providerObservationCount = events.reduce((total, event) => total + (event.provider_observations?.length ?? 0), 0);
  return {
    status: 'available',
    events,
    source_artifact: sourceArtifact,
    authority,
    dispatch_count: Array.isArray(state.runtime_dispatches) ? state.runtime_dispatches.length : 0,
    validated_dispatch_count: events.filter((event) => event.event_kind === 'runtime_dispatch').length,
    provider_observation_count: providerObservationCount,
    invalid_dispatches: invalidDispatches,
    reason: null
  };
}

async function scanPersistedProviderIdentityRecords(root) {
  const executionsRoot = path.join(root, '.vibepro', 'executions');
  let storyEntries;
  try {
    storyEntries = await readdir(executionsRoot);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw providerIdentityScanError(executionsRoot, error);
  }
  const records = [];
  for (const storyId of storyEntries.filter((entry) => typeof entry === 'string').sort()) {
    const runsRoot = path.join(executionsRoot, storyId, 'runs');
    let runEntries;
    try {
      runEntries = await readdir(runsRoot);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw providerIdentityScanError(runsRoot, error);
    }
    for (const runId of runEntries.filter((entry) => typeof entry === 'string').sort()) {
      const artifact = path.join(runsRoot, runId, 'state.json');
      let state;
      try {
        state = JSON.parse(await readFile(artifact, 'utf8'));
      } catch (error) {
        throw providerIdentityScanError(artifact, error);
      }
      if (state.runtime_dispatches !== undefined && !Array.isArray(state.runtime_dispatches)) {
        throw providerIdentityScanError(artifact, new Error('runtime_dispatches must be an array'));
      }
      const dispatches = Array.isArray(state.runtime_dispatches) ? state.runtime_dispatches : [];
      records.push(...dispatches.map((dispatch) => ({ ...dispatch, source_artifact: artifact })));
      const legacyIdentity = ['provider_run_id', 'provider_session_id', 'thread_id']
        .some((field) => state[field] !== undefined && state[field] !== null && state[field] !== '');
      if (legacyIdentity) {
        const matchingDispatch = dispatches.find((dispatch) =>
          ['provider_run_id', 'provider_session_id', 'thread_id']
            .some((field) => state[field] && dispatch?.[field] === state[field]));
        records.push({
          ...Object.fromEntries(['adapter_id', 'provider_run_id', 'provider_session_id', 'thread_id']
            .filter((field) => state[field] !== undefined)
            .map((field) => [field, state[field]])),
          story_id: state.story_id ?? storyId,
          run_id: state.run_id ?? runId,
          dispatch_id: state.dispatch_id ?? matchingDispatch?.dispatch_id ?? `legacy-${storyId}-${runId}`,
          source_artifact: artifact
        });
      }
    }
  }
  return records;
}

function providerIdentityScanError(artifact, error) {
  const wrapped = new Error(`provider identity scan blocked for ${artifact}: ${error.message}`);
  wrapped.code = 'provider_identity_scan_blocked';
  wrapped.details = { artifact, cause: error.code ?? error.message };
  return wrapped;
}

function validateCanonicalRunAuthority(authority, authorityRoot, {
  storyId,
  runId,
  sessionCwd = null,
  processCwd = null,
  sessionEvents = []
} = {}) {
  try {
    validateRunLineageEnvelope({
      schema_version: '0.1.0',
      ...authority,
      dispatch_id: `authority-${runId}`
    });
  } catch (error) {
    return `canonical Run authority is incomplete or invalid: ${error.message}`;
  }
  if (authority.story_id !== storyId || authority.run_id !== runId) {
    return 'canonical Run authority identity did not match the requested Story/Run';
  }

  const authorityWorktree = path.resolve(authority.worktree_root);
  if (authorityWorktree !== path.resolve(authorityRoot)) {
    return 'canonical Run authority worktree_root did not match its authority artifact root';
  }
  for (const [label, cwd] of [['session cwd', sessionCwd], ['process cwd', processCwd]]) {
    if (cwd && path.resolve(cwd) !== authorityWorktree) {
      return `canonical Run authority worktree_root did not match ${label}`;
    }
  }

  for (const event of Array.isArray(sessionEvents) ? sessionEvents : []) {
    const lineage = event?.lineage;
    if (!lineage || lineage.run_id !== runId) continue;
    try {
      validateRunLineageEnvelope(lineage, authority);
    } catch (error) {
      return `canonical Run authority conflicted with session observation: ${error.message}`;
    }
  }
  return null;
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
