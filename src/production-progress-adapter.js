import path from 'node:path';

import { readAcceptedTaskAuthorityStrict } from './task-authority.js';

export const PRODUCTION_PROGRESS_PLAN_SCHEMA_VERSION = '0.2.0';
export const PRODUCTION_PROGRESS_MAPPING_UNCONFIRMED = 'mapping_unconfirmed';
export const PRODUCTION_PROGRESS_SOURCE_TYPES = Object.freeze([
  'development_task',
  'vibepro_task',
  'vibepro_development_task',
]);

const SOURCE_TYPE_SET = new Set(PRODUCTION_PROGRESS_SOURCE_TYPES);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u;
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 5_000;
const DEFAULT_CONFIRMATION_POLL_MS = 25;

/**
 * Build the thin coordinator seam for a Brainbase-accepted VibePro dispatch.
 *
 * The adapter deliberately owns no Task writer, HTTP transport, or sender. It
 * accepts the mapping already verified by the coordinator, reads the local
 * accepted 0.2.0 authority again, and passes the fixed mapping to the existing
 * Codex host. A missing or conflicting mapping never reaches spawn().
 */
export function createProductionProgressAdapter({
  host,
  integrationEnabled = true,
  readAcceptedAuthority = readAcceptedTaskAuthorityStrict,
  confirmationTimeoutMs = DEFAULT_CONFIRMATION_TIMEOUT_MS,
  confirmationPollMs = DEFAULT_CONFIRMATION_POLL_MS,
} = {}) {
  assertHost(host);
  const progressIntegrationEnabled = integrationEnabled !== false;
  const timeoutMs = positiveInteger(confirmationTimeoutMs, DEFAULT_CONFIRMATION_TIMEOUT_MS);
  const pollMs = positiveInteger(confirmationPollMs, DEFAULT_CONFIRMATION_POLL_MS);

  return {
    async dispatch(input) {
      if (!progressIntegrationEnabled) return host.spawn(input?.request ?? input);
      const prepared = await prepareDispatch(input, readAcceptedAuthority);
      if (prepared.status !== 'ready') return prepared;

      const events = [];
      const onEvent = async (event) => {
        events.push(event);
        if (typeof input?.onEvent === 'function') {
          try {
            await input.onEvent(event);
          } catch {
            // A consumer callback cannot make a durable host event disappear.
          }
        }
      };

      let subscription;
      try {
        // Register the durable completion consumer before claiming the run.
        subscription = await host.subscribeCompletion({
          dispatch_id: prepared.request.dispatch_id,
          repo_root: prepared.repoRoot,
          onEvent,
        });
      } catch {
        return { status: 'awaiting_integration', reason: 'completion_subscription_failed' };
      }

      let started;
      try {
        started = await host.spawn(prepared.request);
      } catch {
        return {
          status: 'awaiting_integration',
          reason: 'dispatch_spawn_failed',
          subscription,
        };
      }

      if (input?.require_confirmation === false) {
        return { status: 'started', started, subscription, events };
      }

      const confirmation = await waitForConfirmed(events, timeoutMs, pollMs);
      return {
        ...confirmation,
        started,
        subscription,
        events,
      };
    },

    /**
     * Reconnect after a coordinator restart. This path only drains durable
     * events; it never calls spawn and therefore reuses the original claim.
     */
    async drain(input) {
      if (!progressIntegrationEnabled) {
        return host.drainCompletion(input?.request ?? input);
      }
      const prepared = await prepareDispatch(input, readAcceptedAuthority);
      if (prepared.status !== 'ready') return prepared;

      let events;
      try {
        events = await host.drainCompletion({
          dispatch_id: prepared.request.dispatch_id,
          repo_root: prepared.repoRoot,
        });
      } catch {
        return { status: 'awaiting_integration', reason: 'completion_drain_failed' };
      }

      const normalizedEvents = Array.isArray(events) ? events : [];
      if (input?.require_confirmation === false) {
        return { status: 'drained', events: normalizedEvents };
      }

      const confirmation = await waitForConfirmed(normalizedEvents, timeoutMs, pollMs);
      return { ...confirmation, events: normalizedEvents };
    },
  };
}

async function prepareDispatch(input, readAcceptedAuthority) {
  const repoRoot = resolveRepoRoot(input);
  const storyId = identifier(input?.story_id ?? input?.storyId, 'story_id');
  const taskId = identifier(input?.task_id ?? input?.taskId, 'task_id');
  const mappingResult = validateMapping(input?.mapping);
  if (mappingResult.status !== 'ready') return mappingResult;

  let accepted;
  try {
    accepted = await readAcceptedAuthority(repoRoot, storyId);
  } catch {
    return { status: PRODUCTION_PROGRESS_MAPPING_UNCONFIRMED, reason: 'accepted_plan_unreadable' };
  }

  const authorityResult = validateAcceptedAuthority(accepted, storyId, taskId, mappingResult.mapping);
  if (authorityResult.status !== 'ready') return authorityResult;

  const requestResult = buildRequest(input?.request, repoRoot, mappingResult.mapping, authorityResult.plan);
  if (requestResult.status !== 'ready') return requestResult;

  return {
    status: 'ready',
    repoRoot,
    request: requestResult.request,
  };
}

function validateMapping(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return unconfirmed('mapping_missing');
  }
  const canonicalTaskId = identifier(value.canonical_task_id, 'canonical_task_id', true);
  if (!canonicalTaskId) return unconfirmed('canonical_task_id_missing');
  const taskVersion = value.task_version;
  if (!Number.isSafeInteger(taskVersion) || taskVersion < 1) {
    return unconfirmed('task_version_invalid');
  }
  const source = identifier(value.source, 'source', true);
  if (!source || !SOURCE_TYPE_SET.has(source)) return unconfirmed('source_unverified');
  const person = value.person;
  if (!person || Array.isArray(person) || typeof person !== 'object') return unconfirmed('owner_unverified');
  const personKeys = Object.keys(person);
  if (personKeys.some((key) => key !== 'id')) return unconfirmed('owner_unverified');
  const owner = identifier(person.id, 'person.id', true);
  if (!owner) return unconfirmed('owner_unverified');
  const taskRef = normalizeTaskRef(value.task_ref);
  if (!taskRef) return unconfirmed('task_ref_unverified');
  const sourceRefs = normalizeSourceRefs(value.source_refs);
  if (!sourceRefs) return unconfirmed('canonical_source_refs_unverified');
  const planVersion = identifier(value.plan_version, 'plan_version', true);
  if (!planVersion) return unconfirmed('plan_version_unverified');
  const dispatchId = identifier(value.dispatch_id, 'dispatch_id', true);
  const idempotencyKey = identifier(value.idempotency_key, 'idempotency_key', true);
  if (!dispatchId || !idempotencyKey) return unconfirmed('dispatch_identity_missing');

  const sourceRefResult = validateSourceRefs(sourceRefs, source, taskRef);
  if (sourceRefResult.status !== 'ready') return sourceRefResult;

  return {
    status: 'ready',
    mapping: {
      canonical_task_id: canonicalTaskId,
      task_version: taskVersion,
      source,
      person: { id: owner },
      task_ref: taskRef,
      source_refs: sourceRefs,
      plan_version: planVersion,
      dispatch_id: dispatchId,
      idempotency_key: idempotencyKey,
    },
  };
}

function validateAcceptedAuthority(authority, storyId, taskId, mapping) {
  if (!authority || authority.present !== true || authority.authority !== 'accepted') {
    return unconfirmed('accepted_plan_unavailable');
  }
  if (authority.schema_version !== PRODUCTION_PROGRESS_PLAN_SCHEMA_VERSION) {
    return unconfirmed('accepted_plan_schema_unsupported');
  }
  if (!sameIdentifier(authority.repository, mapping.task_ref.repository)
      || !sameIdentifier(authority.story_id, storyId)
      || !sameIdentifier(authority.story_id, mapping.task_ref.story_id)
      || !sameIdentifier(authority.plan_version, mapping.plan_version)) {
    return unconfirmed('accepted_plan_mapping_mismatch');
  }

  const task = (Array.isArray(authority.tasks) ? authority.tasks : [])
    .find((candidate) => (candidate?.id ?? candidate?.task_id) === taskId);
  if (!task || task.story_id !== storyId
      || (task.id ?? task.task_id) !== mapping.task_ref.task_id) {
    return unconfirmed('accepted_task_mapping_mismatch');
  }
  return {
    status: 'ready',
    plan: {
      repository: authority.repository,
      story_id: authority.story_id,
      plan_version: authority.plan_version,
    },
  };
}

function buildRequest(value, repoRoot, mapping, plan) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return unconfirmed('dispatch_request_missing');
  }
  if (!value.requirements || Array.isArray(value.requirements) || typeof value.requirements !== 'object') {
    return unconfirmed('managed_worktree_missing');
  }
  const managedWorktree = value.requirements.managed_worktree;
  if (typeof managedWorktree !== 'string' || path.resolve(managedWorktree) !== repoRoot) {
    return unconfirmed('managed_worktree_mismatch');
  }
  for (const [field, expected] of [
    ['dispatch_id', mapping.dispatch_id],
    ['idempotency_key', mapping.idempotency_key],
  ]) {
    if (value[field] != null && value[field] !== expected) return unconfirmed(`${field}_mismatch`);
  }
  for (const [field, expected] of [
    ['repository', mapping.task_ref.repository],
    ['story_id', mapping.task_ref.story_id],
    ['task_id', mapping.task_ref.task_id],
  ]) {
    if (value[field] != null && value[field] !== expected) return unconfirmed(`${field}_mismatch`);
  }
  if (value.task_ref != null && !sameTaskRef(value.task_ref, mapping.task_ref)) {
    return unconfirmed('task_ref_mismatch');
  }
  const suppliedProgress = value.development_progress;
  if (suppliedProgress != null && (Array.isArray(suppliedProgress) || typeof suppliedProgress !== 'object')) {
    return unconfirmed('development_progress_invalid');
  }
  if (suppliedProgress) {
    const optionalProgressFields = [
      ['canonical_task_id', mapping.canonical_task_id],
      ['source', mapping.source],
      ['plan_version', plan.plan_version],
      ['owner', mapping.person.id],
    ];
    for (const [field, expected] of optionalProgressFields) {
      if (suppliedProgress[field] != null && suppliedProgress[field] !== expected) {
        return unconfirmed(`development_progress_${field}_mismatch`);
      }
    }
    if (suppliedProgress.task_ref != null && !sameTaskRef(suppliedProgress.task_ref, mapping.task_ref)) {
      return unconfirmed('development_progress_task_ref_mismatch');
    }
  }

  const request = {
    ...structuredClone(value),
    dispatch_id: mapping.dispatch_id,
    idempotency_key: mapping.idempotency_key,
    repository: mapping.task_ref.repository,
    story_id: mapping.task_ref.story_id,
    task_id: mapping.task_ref.task_id,
    task_ref: { ...mapping.task_ref },
    requirements: { ...structuredClone(value.requirements), managed_worktree: repoRoot },
    development_progress: {
      ...(suppliedProgress ? structuredClone(suppliedProgress) : {}),
      canonical_task_id: mapping.canonical_task_id,
      source: mapping.source,
      owner: mapping.person.id,
      task_ref: { ...mapping.task_ref },
      plan_version: plan.plan_version,
      evidence: suppliedProgress?.evidence ?? { artifacts: [] },
    },
  };
  return { status: 'ready', request };
}

async function waitForConfirmed(events, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const confirmed = events.find((event) => event?.development_progress?.status === 'confirmed');
    if (confirmed) return { status: 'confirmed', event: confirmed };
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
  }
  const hasProgressReceipt = events.some((event) => event?.development_progress);
  return {
    status: 'awaiting_integration',
    reason: hasProgressReceipt ? 'development_progress_confirmation_timeout' : 'completion_event_timeout',
  };
}

function resolveRepoRoot(input) {
  const value = input?.repo_root ?? input?.repoRoot;
  if (typeof value !== 'string' || value.trim() === '') throw new Error('repo_root must be a non-empty path');
  return path.resolve(value);
}

function normalizeTaskRef(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !['repository', 'story_id', 'task_id'].includes(key))) return null;
  const repository = identifier(value.repository, 'task_ref.repository', true);
  const storyId = identifier(value.story_id, 'task_ref.story_id', true);
  const taskId = identifier(value.task_id, 'task_ref.task_id', true);
  if (!repository || !storyId || !taskId) return null;
  return { repository, story_id: storyId, task_id: taskId };
}

function normalizeSourceRefs(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const normalized = [];
  for (const sourceRef of value) {
    if (!sourceRef || Array.isArray(sourceRef) || typeof sourceRef !== 'object') return null;
    const type = identifier(sourceRef.type, 'source_refs.type', true);
    if (!type) return null;
    if (!SOURCE_TYPE_SET.has(type)) {
      normalized.push({ type });
      continue;
    }
    const repository = identifier(sourceRef.repository, 'source_refs.repository', true);
    const storyId = identifier(sourceRef.story_id, 'source_refs.story_id', true);
    const taskId = identifier(sourceRef.task_id, 'source_refs.task_id', true);
    if (!repository || !storyId || !taskId) return null;
    normalized.push({ type, repository, story_id: storyId, task_id: taskId });
  }
  return normalized;
}

function validateSourceRefs(sourceRefs, source, taskRef) {
  const candidates = sourceRefs.filter((sourceRef) => SOURCE_TYPE_SET.has(sourceRef.type));
  if (candidates.length === 0) return unconfirmed('canonical_source_ref_missing');
  if (candidates.length !== 1) return unconfirmed('canonical_source_ref_ambiguous');
  const [candidate] = candidates;
  if (candidate.type !== source
      || candidate.repository !== taskRef.repository
      || candidate.story_id !== taskRef.story_id
      || candidate.task_id !== taskRef.task_id) {
    return unconfirmed('canonical_source_ref_mapping_mismatch');
  }
  return { status: 'ready' };
}

function sameTaskRef(left, right) {
  const normalized = normalizeTaskRef(left);
  return normalized != null
    && normalized.repository === right.repository
    && normalized.story_id === right.story_id
    && normalized.task_id === right.task_id;
}

function identifier(value, _name, optional = false) {
  if (value == null && optional) return null;
  if (typeof value !== 'string' || value.trim() === '') return optional ? null : '';
  const normalized = value.trim();
  if (!IDENTIFIER_PATTERN.test(normalized)) return optional ? null : '';
  return normalized;
}

function sameIdentifier(left, right) {
  return typeof left === 'string' && left === right;
}

function unconfirmed(reason) {
  return { status: PRODUCTION_PROGRESS_MAPPING_UNCONFIRMED, reason };
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function assertHost(host) {
  if (!host || typeof host.subscribeCompletion !== 'function'
      || typeof host.spawn !== 'function' || typeof host.drainCompletion !== 'function') {
    throw new TypeError('production progress adapter requires a Codex host');
  }
}
