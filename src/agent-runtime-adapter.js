import { createHash } from 'node:crypto';
import { appendProviderObservation, assertProviderIdentityUniqueness, createRunLineageEnvelope } from './run-lineage.js';
import { deriveDispatchIdentity } from './dispatch-identity.js';

export { RECOVERABLE_RUNTIME_STOP_CODES } from './guarded-stop-codes.js';

const REQUIRED_METHODS = Object.freeze(['probe', 'start', 'status', 'cancel', 'collect_result']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed_out']);
const RUNTIME_STATUSES = new Set(['queued', 'running', 'running_detached', 'permission_wait', 'stalled', ...TERMINAL_STATUSES]);
const RUNTIME_TRANSITIONS = new Map([
  ['queued', new Set(['queued', 'running', 'running_detached', 'permission_wait', 'stalled', ...TERMINAL_STATUSES])],
  ['running', new Set(['running', 'running_detached', 'permission_wait', 'stalled', ...TERMINAL_STATUSES])],
  ['running_detached', new Set(['running_detached', 'running', 'permission_wait', 'stalled', ...TERMINAL_STATUSES])],
  ['permission_wait', new Set(['permission_wait', 'running', 'running_detached', 'stalled', ...TERMINAL_STATUSES])],
  ['stalled', new Set(['stalled', 'running', 'running_detached', ...TERMINAL_STATUSES])]
]);
const WAIT_REASONS = new Set(['runtime_unavailable', 'quota_exceeded', 'permission_wait', 'auth_denied', 'runtime_probe_timeout']);
const ROLES = new Set(['implementation', 'review']);

export class AgentRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
    this.details = details;
  }
}

export function defineAgentRuntimeAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new AgentRuntimeError('invalid_adapter', 'runtime adapter must be an object');
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new AgentRuntimeError('invalid_adapter', `runtime adapter requires ${method}()`);
    }
  }
  const defined = {
    id: requireText(adapter.id, 'adapter.id'),
    probe: adapter.probe.bind(adapter),
    start: adapter.start.bind(adapter),
    status: adapter.status.bind(adapter),
    cancel: adapter.cancel.bind(adapter),
    collect_result: adapter.collect_result.bind(adapter)
  };
  if (typeof adapter.detach === 'function') defined.detach = adapter.detach.bind(adapter);
  if (typeof adapter.reconcile === 'function') defined.reconcile = adapter.reconcile.bind(adapter);
  return Object.freeze(defined);
}

export function createAgentRuntimeCoordinator({ adapters = [], now = () => new Date() } = {}) {
  const registry = new Map(adapters.map((adapter) => {
    const defined = defineAgentRuntimeAdapter(adapter);
    return [defined.id, defined];
  }));
  if (registry.size !== adapters.length) throw new AgentRuntimeError('duplicate_adapter', 'runtime adapter ids must be unique');

  return {
    dispatch: (runState, request, options = {}) => dispatch(registry, now, runState, request, options),
    poll: (runState, dispatchId, options = {}) => poll(registry, now, runState, dispatchId, options),
    detach: (runState, dispatchId) => detach(registry, now, runState, dispatchId),
    reconcile: (runState, dispatchId, options = {}) => reconcile(registry, now, runState, dispatchId, options),
    cancel: (runState, dispatchId) => cancel(registry, now, runState, dispatchId)
  };
}

async function dispatch(registry, now, runState, input = {}, options = {}) {
  const request = normalizeRequest(runState, input);
  const persistedDispatches = options.providerIdentityRecords ?? [];
  let startedRecord = null;
  try {
    assertProviderIdentityUniqueness([...persistedDispatches, ...(runState.runtime_dispatches ?? [])]);
  } catch (error) {
    if (error?.code) throw new AgentRuntimeError(error.code, error.message, error.details);
    throw error;
  }
  const existing = findDispatch(runState, request.dispatch_id);
  if (existing && existing.input_head_sha !== request.input_head_sha) {
    if (input.surface_unchanged_after_rebase !== true || existing.inspection_surface_hash !== request.inspection_surface_hash) {
      throw new AgentRuntimeError('stale_head', 'logical dispatch reuse across HEAD changes requires an explicit unchanged-surface assertion');
    }
    const rebound = {
      ...existing,
      input_head_sha: request.input_head_sha,
      surface_rebound_from_head_sha: existing.input_head_sha,
      updated_at: iso(now)
    };
    return { state: upsertDispatch(runState, rebound), dispatch: rebound, reused: true };
  }
  if (existing?.provider_run_id) {
    const state = TERMINAL_STATUSES.has(existing.status)
      ? runState
      : { ...runState, status: 'running', stop_reason: null };
    return { state, dispatch: existing, reused: true };
  }
  if (existing?.stop_reason?.code === 'orphaned_agent') return { state: runState, dispatch: existing, reused: true };

  const adapter = registry.get(request.adapter_id);
  if (!adapter) {
    return waiting(runState, request, 'runtime_unavailable',
      'requested runtime adapter is not registered', now,
      runtimeRecoveryDetails(runState, request));
  }
  let capability;
  try {
    capability = normalizeProbe(await withTimeout(
      adapter.probe({ requirements: request.requirements, role: request.role }),
      request.requirements.timeout_ms,
      'runtime_probe_timeout'
    ));
  } catch (error) {
    const reason = WAIT_REASONS.has(error.code) ? error.code : 'runtime_unavailable';
    return waiting(runState, request, reason, error.message, now,
      runtimeRecoveryDetails(runState, request));
  }
  const missing = request.requirements.capabilities.filter((item) => !capability.capabilities.includes(item));
  if (!capability.available || missing.length > 0) {
    return waiting(runState, request, capability.reason ?? 'runtime_unavailable', missing.length > 0
      ? `runtime lacks required capabilities: ${missing.join(', ')}`
      : 'runtime is unavailable', now, runtimeRecoveryDetails(runState, request, missing));
  }
  if (request.role === 'review' && capability.sandbox !== 'read-only') {
    return waiting(runState, request, 'review_readonly_unavailable',
      'review runtime requires a read-only sandbox before start', now,
      runtimeRecoveryDetails(runState, request, request.requirements.capabilities, {
        sandbox: capability.sandbox
      }));
  }

  try {
    const started = normalizeStarted(await withTimeout(
      adapter.start({ ...request, capability }),
      request.requirements.timeout_ms,
      'runtime_start_timeout'
    ));
    const startedAt = iso(now);
    const dispatchRecord = {
      ...request,
      provider_run_id: started.provider_run_id,
      agent_identity: started.agent_identity,
      session_id: started.session_id,
      thread_id: started.thread_id,
      sandbox: capability.sandbox,
      approval_policy: capability.approval_policy,
      status: 'running',
      started_at: startedAt,
      logical_started_at: startedAt,
      attempt_started_at: startedAt,
      updated_at: startedAt,
      result: null,
      stop_reason: null
    };
    startedRecord = dispatchRecord;
    dispatchRecord.lineage = appendRuntimeObservation(dispatchRecord.lineage, adapter.id, started, dispatchRecord);
    try {
      assertProviderIdentityUniqueness([
        ...persistedDispatches,
        ...(runState.runtime_dispatches ?? []),
        dispatchRecord
      ]);
    } catch (error) {
      if (error?.code) throw new AgentRuntimeError(error.code, error.message, error.details);
      throw error;
    }
    if (request.role === 'review' &&
        (started.agent_identity !== request.reviewer_identity || started.agent_identity === request.implementation_identity)) {
      return containUncertainRuntime(registry, now, upsertDispatch(runState, dispatchRecord), dispatchRecord,
        'review_identity_not_separate', 'review start identity must equal the requested reviewer and differ from implementation');
    }
    if (request.role === 'review' && !started.session_id && !started.thread_id) {
      return containUncertainRuntime(registry, now, upsertDispatch(runState, dispatchRecord), dispatchRecord,
        'review_session_not_separate', 'review start must expose a reviewer session or thread for result correlation');
    }
    return { state: { ...upsertDispatch(runState, dispatchRecord), status: 'running', stop_reason: null }, dispatch: dispatchRecord, reused: false };
  } catch (error) {
    if (startedRecord?.provider_run_id) {
      if (error.code === 'provider_identity_conflict'
          && error.details?.existing?.run_id
          && error.details.existing.run_id !== request.run_id) {
        await containUncertainRuntime(registry, now, runState, startedRecord, error.code, error.message);
        throw new AgentRuntimeError(error.code, error.message, error.details);
      }
      const failureCode = error.code === 'provider_identity_conflict' ? error.code : 'runtime_start_failed';
      return containUncertainRuntime(registry, now, upsertDispatch(runState, startedRecord), startedRecord,
        failureCode, error.message);
    }
    if (WAIT_REASONS.has(error.code) && error.code !== 'runtime_start_timeout') {
      return waiting(runState, request, error.code, error.message, now,
        runtimeRecoveryDetails(runState, request));
    }
    const failureCode = error.code === 'runtime_start_timeout' ? error.code : 'runtime_start_failed';
    try {
      const containment = normalizeStatus(await withTimeout(
        adapter.cancel({ dispatch_id: request.dispatch_id, force: true }),
        request.requirements.timeout_ms,
        'runtime_start_containment_timeout'
      ));
      if (!TERMINAL_STATUSES.has(containment.status)) {
        return failed(runState, request, 'orphaned_agent',
          `${failureCode}: ${error.message}; dispatch-scoped containment did not confirm a terminal runtime`, now);
      }
      return failed(runState, request, failureCode, error.message, now, containment.status);
    } catch (containmentError) {
      return failed(runState, request, 'orphaned_agent',
        `${failureCode}: ${error.message}; start containment failed: ${containmentError.message}`, now);
    }
  }
}

async function poll(registry, now, runState, dispatchId, options = {}) {
  const current = requireDispatch(runState, dispatchId);
  try {
    assertProviderIdentityUniqueness([...(options.providerIdentityRecords ?? []), ...(runState.runtime_dispatches ?? [])]);
  } catch (error) {
    if (error?.code) throw new AgentRuntimeError(error.code, error.message, error.details);
    throw error;
  }
  if (TERMINAL_STATUSES.has(current.status)) return { state: runState, dispatch: current, reused: true };
  if (!current.provider_run_id) throw new AgentRuntimeError('runtime_not_started', 'waiting runtime dispatch must be retried through dispatch()');
  const adapter = requireAdapter(registry, current.adapter_id);
  if (current.input_head_sha !== runState.current_head_sha) {
    return containUncertainRuntime(registry, now, runState, current,
      'stale_head', 'runtime dispatch input HEAD no longer matches the authoritative Run HEAD');
  }
  if (typeof adapter.detach === 'function' && typeof adapter.reconcile === 'function' &&
      current.status === 'running' && Date.parse(iso(now)) - Date.parse(current.started_at) >= current.requirements.monitor_boundary_ms) {
    return detach(registry, now, runState, dispatchId);
  }
  let observed;
  try {
    observed = normalizeStatus(await withTimeout(
      adapter.status({ provider_run_id: current.provider_run_id, dispatch: current }),
      current.requirements.timeout_ms,
      'runtime_status_timeout'
    ));
  } catch (error) {
    return containUncertainRuntime(registry, now, runState, current,
      error.code === 'runtime_status_timeout' || error.code === 'provider_identity_conflict' || error.code === 'provider_observation_conflict'
        ? error.code : 'runtime_status_failed', error.message);
  }
  return applyObservedStatus(registry, now, runState, current, observed, options);
}

async function detach(registry, now, runState, dispatchId) {
  const current = requireDispatch(runState, dispatchId);
  if (TERMINAL_STATUSES.has(current.status) || current.status === 'running_detached') {
    return { state: runState, dispatch: current, reused: true };
  }
  if (!current.provider_run_id) throw new AgentRuntimeError('runtime_not_started', 'waiting runtime dispatch has no provider run to detach');
  const adapter = requireAdapter(registry, current.adapter_id);
  if (typeof adapter.detach !== 'function' || typeof adapter.reconcile !== 'function') {
    throw new AgentRuntimeError('detached_runtime_unsupported', 'runtime adapter must implement detach() and reconcile() before monitor-boundary detachment');
  }
  await withTimeout(adapter.detach({
    provider_run_id: current.provider_run_id,
    dispatch_id: current.dispatch_id,
    monitor_boundary_ms: current.requirements.monitor_boundary_ms
  }), current.requirements.timeout_ms, 'runtime_detach_timeout');
  const next = {
    ...current,
    status: 'running_detached',
    detached_at: iso(now),
    updated_at: iso(now),
    stop_reason: null
  };
  return {
    state: { ...upsertDispatch(runState, next), status: 'running', stop_reason: null },
    dispatch: next,
    reused: false
  };
}

async function reconcile(registry, now, runState, dispatchId, options = {}) {
  const current = requireDispatch(runState, dispatchId);
  if (TERMINAL_STATUSES.has(current.status)) return { state: runState, dispatch: current, reused: true };
  const adapter = requireAdapter(registry, current.adapter_id);
  if (typeof adapter.reconcile !== 'function') return poll(registry, now, runState, dispatchId, options);
  let observed;
  try {
    observed = normalizeStatus(await withTimeout(adapter.reconcile({
      provider_run_id: current.provider_run_id,
      dispatch_id: current.dispatch_id,
      dispatch: current
    }), current.requirements.timeout_ms, 'runtime_reconcile_timeout'));
  } catch (error) {
    const next = {
      ...current,
      status: current.status === 'running_detached' ? 'running_detached' : current.status,
      updated_at: iso(now),
      stop_reason: {
        code: error.code ?? 'runtime_reconcile_failed',
        message: error.message,
        details: { recoverable_from_inbox: true }
      }
    };
    return { state: upsertDispatch(runState, next), dispatch: next, reused: false };
  }
  return applyObservedStatus(registry, now, runState, current, observed, options);
}

async function applyObservedStatus(registry, now, runState, current, observed, options = {}) {
  const adapter = requireAdapter(registry, current.adapter_id);
  if (!isAllowedRuntimeTransition(current.status, observed.status)) {
    return containUncertainRuntime(registry, now, runState, current,
      'invalid_runtime_transition', `runtime status cannot transition from ${current.status} to ${observed.status}`);
  }
  if (observed.status === 'permission_wait') {
    return waitingExisting(runState, current, 'permission_wait',
      observed.message ?? 'runtime requires permission', now,
      runtimeRecoveryDetails(runState, current, []));
  }
  if (observed.status === 'stalled') {
    return failed(runState, current, 'runtime_stalled', observed.message ?? 'runtime made no bounded progress', now);
  }
  if (!TERMINAL_STATUSES.has(observed.status)) {
    const preserveDetached = current.status === 'running_detached' && observed.status === 'running';
    const next = {
      ...current,
      status: preserveDetached ? 'running_detached' : observed.status,
      provider_run_id: observed.provider_run_id ?? current.provider_run_id,
      provider_session_id: observed.provider_session_id ?? current.provider_session_id ?? null,
      session_id: observed.session_id ?? current.session_id ?? null,
      thread_id: observed.thread_id ?? current.thread_id ?? null,
      updated_at: iso(now),
      stop_reason: observed.stop_reason ?? null,
      progress_checkpoint: observed.progress_checkpoint ?? current.progress_checkpoint ?? null,
      partial_results: observed.partial_results ?? current.partial_results ?? [],
      attempts: observed.attempts ?? current.attempts ?? 1,
      usage_accounting: observed.usage_accounting ?? current.usage_accounting ?? null,
      recovery_plan: observed.recovery_plan ?? current.recovery_plan ?? null,
      logical_started_at: observed.logical_started_at ?? current.logical_started_at ?? current.started_at,
      attempt_started_at: observed.attempt_started_at ?? current.attempt_started_at ?? current.started_at
    };
    next.lineage = appendRuntimeObservation(next.lineage, current.adapter_id, observed, next);
    assertProviderIdentityUniqueness([
      ...(options.providerIdentityRecords ?? []),
      ...(runState.runtime_dispatches ?? []).filter((item) => item.dispatch_id !== current.dispatch_id),
      next
    ]);
    return { state: { ...upsertDispatch(runState, next), status: 'running', stop_reason: null }, dispatch: next, reused: false };
  }
  if (observed.status !== 'completed') {
    return failed(runState, current, observed.stop_reason?.code
      ?? (observed.status === 'timed_out' ? 'runtime_timeout' : `runtime_${observed.status}`),
      observed.message ?? `runtime ended with ${observed.status}`, now, observed.status);
  }
  try {
    const result = normalizeResult(await withTimeout(
      adapter.collect_result({ provider_run_id: current.provider_run_id, dispatch_id: current.dispatch_id, dispatch: current }),
      current.requirements.timeout_ms,
      'runtime_result_timeout'
    ), current);
    const next = { ...current, status: result.completion_status, result, updated_at: iso(now), completed_at: iso(now), stop_reason: null };
    next.lineage = appendRuntimeObservation(next.lineage, current.adapter_id, result, next, {
      allowImplementationHeadAdvance: current.role === 'implementation'
    });
    assertProviderIdentityUniqueness([
      ...(options.providerIdentityRecords ?? []),
      ...(runState.runtime_dispatches ?? []).filter((item) => item.dispatch_id !== current.dispatch_id),
      next
    ]);
    return { state: upsertDispatch(runState, next), dispatch: next, reused: false };
  } catch (error) {
    const code = error.code === 'runtime_result_timeout' ? error.code : 'invalid_runtime_result';
    return containUncertainRuntime(registry, now, runState, current, code, error.message);
  }
}

function isAllowedRuntimeTransition(currentStatus, nextStatus) {
  return RUNTIME_TRANSITIONS.get(currentStatus)?.has(nextStatus) === true;
}

async function containUncertainRuntime(registry, now, runState, current, failureCode, failureMessage) {
  const adapter = requireAdapter(registry, current.adapter_id);
  let observed;
  try {
    await withTimeout(adapter.cancel({ provider_run_id: current.provider_run_id, dispatch: current }), current.requirements.timeout_ms, 'runtime_cancel_timeout');
    observed = normalizeStatus(await withTimeout(
      adapter.status({ provider_run_id: current.provider_run_id, dispatch: current }),
      current.requirements.timeout_ms,
      'runtime_cancel_status_timeout'
    ));
    if (!TERMINAL_STATUSES.has(observed.status)) {
      await withTimeout(adapter.cancel({ provider_run_id: current.provider_run_id, dispatch: current, force: true }), current.requirements.timeout_ms, 'runtime_force_cancel_timeout');
      observed = normalizeStatus(await withTimeout(
        adapter.status({ provider_run_id: current.provider_run_id, dispatch: current }),
        current.requirements.timeout_ms,
        'runtime_force_cancel_status_timeout'
      ));
    }
  } catch (containmentError) {
    return failed(runState, current, 'orphaned_agent',
      `${failureCode}: ${failureMessage}; containment failed: ${containmentError.message}`, now);
  }
  if (!TERMINAL_STATUSES.has(observed.status)) {
    return failed(runState, current, 'orphaned_agent',
      `${failureCode}: ${failureMessage}; runtime remained active after force cancellation`, now);
  }
  return failed(runState, current, failureCode, failureMessage, now, observed.status);
}

async function cancel(registry, now, runState, dispatchId) {
  const current = requireDispatch(runState, dispatchId);
  if (TERMINAL_STATUSES.has(current.status)) return { state: runState, dispatch: current, reused: true };
  if (!current.provider_run_id) throw new AgentRuntimeError('runtime_not_started', 'waiting runtime dispatch has no provider run to cancel');
  const adapter = requireAdapter(registry, current.adapter_id);
  let observed;
  try {
    await withTimeout(adapter.cancel({ provider_run_id: current.provider_run_id, dispatch: current }), current.requirements.timeout_ms, 'runtime_cancel_timeout');
    observed = normalizeStatus(await withTimeout(
      adapter.status({ provider_run_id: current.provider_run_id, dispatch: current }),
      current.requirements.timeout_ms,
      'runtime_cancel_status_timeout'
    ));
  } catch (error) {
    try {
      await withTimeout(adapter.cancel({ provider_run_id: current.provider_run_id, dispatch: current, force: true }), current.requirements.timeout_ms, 'runtime_force_cancel_timeout');
      observed = normalizeStatus(await withTimeout(
        adapter.status({ provider_run_id: current.provider_run_id, dispatch: current }),
        current.requirements.timeout_ms,
        'runtime_force_cancel_status_timeout'
      ));
    } catch (forceError) {
      return failed(runState, current, 'orphaned_agent', `runtime cancellation failed: ${error.message}; force containment failed: ${forceError.message}`, now);
    }
  }
  if (!TERMINAL_STATUSES.has(observed.status)) {
    try {
      await withTimeout(adapter.cancel({ provider_run_id: current.provider_run_id, dispatch: current, force: true }), current.requirements.timeout_ms, 'runtime_force_cancel_timeout');
      observed = normalizeStatus(await withTimeout(
        adapter.status({ provider_run_id: current.provider_run_id, dispatch: current }),
        current.requirements.timeout_ms,
        'runtime_force_cancel_status_timeout'
      ));
    } catch (error) {
      return failed(runState, current, 'orphaned_agent', `runtime force-cancel failed: ${error.message}`, now);
    }
    if (!TERMINAL_STATUSES.has(observed.status)) {
      return failed(runState, current, 'orphaned_agent', 'runtime remained active after normal and force cancellation', now);
    }
  }
  if (observed.status !== 'cancelled') {
    return failed(runState, current, 'runtime_terminal_race', `runtime ended with ${observed.status} while cancellation was requested`, now, observed.status);
  }
  const next = {
    ...current,
    status: 'cancelled',
    updated_at: iso(now),
    completed_at: iso(now),
    stop_reason: { code: 'runtime_cancelled', message: 'runtime dispatch was cancelled', details: {} }
  };
  return { state: upsertDispatch(runState, next), dispatch: next, reused: false };
}

function normalizeRequest(state, input) {
  const role = requireText(input.role, 'role');
  if (!ROLES.has(role)) throw new AgentRuntimeError('invalid_role', `unsupported runtime role: ${role}`);
  const adapterId = requireText(input.adapter_id, 'adapter_id');
  const taskId = requireText(input.task_id, 'task_id');
  const objective = requireText(
    input.objective ?? `${role === 'review' ? 'Review' : 'Implement'} VibePro task ${taskId}.`,
    'objective'
  );
  const headSha = requireText(state?.current_head_sha, 'runState.current_head_sha');
  const runId = requireText(state?.run_id, 'runState.run_id');
  const reviewerIdentity = input.reviewer_identity ?? null;
  if (role === 'review' && (!reviewerIdentity || reviewerIdentity === input.implementation_identity)) {
    throw new AgentRuntimeError('review_identity_not_separate', 'review runtime requires an identity separate from implementation');
  }
  if (role === 'review' && !input.implementation_session_id) {
    throw new AgentRuntimeError('review_session_not_separate', 'review runtime requires the implementation session id');
  }
  const capabilities = [...new Set(input.requirements?.capabilities ?? [])].map((item) => requireText(item, 'capability'));
  if (role === 'review' && capabilities.includes('workspace_write')) {
    throw new AgentRuntimeError('review_mutation_forbidden', 'review runtime cannot request workspace_write capability');
  }
  if (role === 'review' && !capabilities.includes('review')) {
    throw new AgentRuntimeError('review_capability_required', 'review runtime must request the review capability');
  }
  const inspectionSurfaceHash = requireText(input.inspection_surface_hash ?? headSha, 'inspection_surface_hash');
  const dispatchId = deriveDispatchIdentity({
    run_id: runId, adapter_id: adapterId, task_id: taskId, role,
    inspection_surface_hash: inspectionSurfaceHash, reviewer_identity: reviewerIdentity,
    implementation_session_id: input.implementation_session_id ?? null
  });
  return {
    dispatch_id: dispatchId,
    run_id: runId,
    story_id: requireText(state?.story_id, 'runState.story_id'),
    input_head_sha: headSha,
    adapter_id: adapterId,
    task_id: taskId,
    role,
    objective,
    reviewer_identity: reviewerIdentity,
    implementation_identity: input.implementation_identity ?? null,
    implementation_session_id: input.implementation_session_id ?? null,
    lineage: createDispatchLineage(state, input, dispatchId, runId, headSha),
    inspection_surface_hash: inspectionSurfaceHash,
    requested_judgments: Array.isArray(input.requested_judgments) ? input.requested_judgments : [],
    previous_judgments: Array.isArray(input.previous_judgments) ? input.previous_judgments : [],
    previous_surface_hash: input.previous_surface_hash ?? null,
    changed_paths: Array.isArray(input.changed_paths) ? input.changed_paths.map(String) : [],
    review_binding: normalizeReviewBinding(input.review_binding, role),
    requirements: {
      capabilities,
      timeout_ms: positiveInteger(input.requirements?.timeout_ms, 'timeout_ms'),
      monitor_boundary_ms: positiveInteger(input.requirements?.monitor_boundary_ms ?? 600000, 'monitor_boundary_ms'),
      no_progress_deadline_ms: positiveInteger(input.requirements?.no_progress_deadline_ms ?? 900000, 'no_progress_deadline_ms'),
      max_wall_clock_ms: positiveInteger(input.requirements?.max_wall_clock_ms ?? 3600000, 'max_wall_clock_ms'),
      max_attempts: positiveInteger(input.requirements?.max_attempts ?? 1, 'max_attempts'),
      max_cost_usd: nonNegativeNumber(input.requirements?.max_cost_usd ?? 0, 'max_cost_usd'),
      managed_worktree: requireText(input.requirements?.managed_worktree, 'managed_worktree')
    }
  };
}

function normalizeReviewBinding(value, role) {
  if (value === undefined || value === null) return null;
  if (role !== 'review' || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentRuntimeError('invalid_runtime_request', 'review_binding is supported only for review dispatches');
  }
  return {
    stage: requireText(value.stage, 'review_binding.stage'),
    role: requireText(value.role, 'review_binding.role'),
    inspection_inputs: requireStringArray(value.inspection_inputs, 'review_binding.inspection_inputs'),
    strict_head_binding: value.strict_head_binding === true,
    strict_head_reason: value.strict_head_binding === true
      ? requireText(value.strict_head_reason, 'review_binding.strict_head_reason')
      : null
  };
}

function normalizeProbe(value) {
  if (!value || typeof value !== 'object') throw new AgentRuntimeError('invalid_probe', 'probe result must be an object');
  return {
    available: value.available === true,
    capabilities: Array.isArray(value.capabilities) ? value.capabilities.map(String) : [],
    sandbox: value.sandbox ?? null,
    approval_policy: value.approval_policy ?? null,
    reason: value.reason ?? null
  };
}

function normalizeStarted(value) {
  if (!value || typeof value !== 'object') throw new AgentRuntimeError('invalid_start_result', 'start result must be an object');
  return {
    provider_run_id: requireText(value.provider_run_id, 'provider_run_id'),
    agent_identity: requireText(value.agent_identity, 'agent_identity'),
    provider: value.provider ?? null,
    session_id: value.session_id ?? null,
    thread_id: value.thread_id ?? null,
    provider_session_id: value.provider_session_id ?? null,
    story_id: value.story_id ?? null,
    run_id: value.run_id ?? null,
    dispatch_id: value.dispatch_id ?? null,
    head_sha: value.head_sha ?? null
    ,progress_checkpoint: value.progress_checkpoint ?? null
    ,partial_results: Array.isArray(value.partial_results) ? value.partial_results : null
  };
}

function normalizeStatus(value) {
  if (!value || typeof value !== 'object') throw new AgentRuntimeError('invalid_runtime_status', 'status result must be an object');
  const status = requireText(value.status, 'runtime status');
  if (!RUNTIME_STATUSES.has(status)) throw new AgentRuntimeError('invalid_runtime_status', `unsupported runtime status: ${status}`);
  return {
    status,
    message: value.message ?? null,
    stop_reason: value.stop_reason ?? null,
    provider: value.provider ?? null,
    provider_run_id: value.provider_run_id ?? null,
    provider_session_id: value.provider_session_id ?? null,
    session_id: value.session_id ?? null,
    thread_id: value.thread_id ?? null,
    story_id: value.story_id ?? null,
    run_id: value.run_id ?? null,
    dispatch_id: value.dispatch_id ?? null,
    head_sha: value.head_sha ?? null,
    attempts: Number.isInteger(value.attempts) ? value.attempts : null,
    usage_accounting: value.usage_accounting === undefined ? null : normalizeUsageAccounting(value.usage_accounting),
    partial_results: Array.isArray(value.partial_results) ? value.partial_results : null,
    recovery_plan: value.recovery_plan ?? null
  };
}

function normalizeResult(value, dispatchRecord) {
  if (!value || typeof value !== 'object') throw new AgentRuntimeError('invalid_runtime_result', 'collected result must be an object');
  const completionStatus = requireText(value.completion_status, 'completion_status');
  if (completionStatus !== 'completed') throw new AgentRuntimeError('invalid_runtime_result', 'successful collection requires completion_status=completed');
  const result = {
    completion_status: completionStatus,
    changed_files: requireStringArray(value.changed_files, 'changed_files'),
    head_sha: requireText(value.head_sha, 'head_sha'),
    test_suggestions: requireStringArray(value.test_suggestions, 'test_suggestions'),
    summary: requireText(value.summary, 'summary')
  };
  if (value.usage_accounting !== undefined) {
    result.usage_accounting = normalizeUsageAccounting(value.usage_accounting);
  }
  if (Array.isArray(value.partial_results)) result.partial_results = value.partial_results;
  if (Array.isArray(value.judgments)) result.judgments = value.judgments;
  if (value.surface_hash !== undefined) result.surface_hash = value.surface_hash;
  if (result.surface_hash !== undefined && result.surface_hash !== dispatchRecord.inspection_surface_hash) {
    throw new AgentRuntimeError('runtime_surface_mismatch', 'runtime result surface must match the dispatch inspection surface');
  }
  if (dispatchRecord.role === 'review') {
    if (result.changed_files.length > 0) {
      throw new AgentRuntimeError('review_mutation_forbidden', 'review runtime result must not contain changed files');
    }
    const acceptedResultHeads = new Set([
      dispatchRecord.input_head_sha,
      dispatchRecord.surface_rebound_from_head_sha
    ].filter(Boolean));
    if (!acceptedResultHeads.has(result.head_sha)) {
      throw new AgentRuntimeError('runtime_head_mismatch', 'review result HEAD must match the dispatch input HEAD or its explicitly unchanged-surface predecessor');
    }
    const actualIdentity = requireText(value.agent_identity ?? dispatchRecord.agent_identity, 'review agent_identity');
    if (actualIdentity === dispatchRecord.implementation_identity ||
        actualIdentity !== dispatchRecord.reviewer_identity ||
        actualIdentity !== dispatchRecord.agent_identity) {
      throw new AgentRuntimeError('review_identity_not_separate', 'review result identity must equal the requested reviewer and differ from implementation');
    }
    const resultSessionId = value.session_id ?? dispatchRecord.session_id;
    const resultThreadId = value.thread_id ?? dispatchRecord.thread_id;
    if (resultSessionId !== dispatchRecord.session_id || resultThreadId !== dispatchRecord.thread_id) {
      throw new AgentRuntimeError('review_session_not_separate', 'review result session and thread must correlate to the started reviewer runtime');
    }
    result.review_provenance = {
      execution_mode: 'parallel_subagent',
      agent_identity: actualIdentity,
      session_id: resultSessionId,
      thread_id: resultThreadId,
      lifecycle: requireText(value.lifecycle, 'review lifecycle')
    };
    if (!result.review_provenance.session_id && !result.review_provenance.thread_id) {
      throw new AgentRuntimeError('review_session_not_separate', 'review result requires reviewer session or thread provenance');
    }
    if (dispatchRecord.implementation_session_id &&
        [result.review_provenance.session_id, result.review_provenance.thread_id].includes(dispatchRecord.implementation_session_id)) {
      throw new AgentRuntimeError('review_identity_not_separate', 'review session must differ from the implementation session');
    }
    if (result.review_provenance.lifecycle !== 'closed') {
      throw new AgentRuntimeError('invalid_runtime_result', 'review result requires closed lifecycle');
    }
    result.review = normalizeReviewResult(value);
    if (dispatchRecord.review_binding) {
      result.review_record = normalizeRuntimeReviewRecord(value.review_record);
    }
  }
  return result;
}
function normalizeReviewResult(value) {
  const status = requireText(value.status, 'review status');
  if (!new Set(['pass', 'needs_changes', 'block']).has(status)) {
    throw new AgentRuntimeError('invalid_runtime_result', 'review status must be pass, needs_changes, or block');
  }
  return {
    status,
    summary: requireText(value.summary, 'review summary'),
    inspection_summary: requireText(value.inspection_summary, 'inspection_summary'),
    ...(value.inspection_evidence === undefined ? {} : { inspection_evidence: requireText(value.inspection_evidence, 'inspection_evidence') }),
    inspection_inputs: requireStringArray(value.inspection_inputs, 'inspection_inputs'),
    judgment_delta: requireStringArray(value.judgment_delta, 'judgment_delta'),
    findings: normalizeReviewFindings(value.findings)
  };
}

function normalizeReviewFindings(value) {
  if (!Array.isArray(value)) {
    throw new AgentRuntimeError('invalid_runtime_result', 'review findings must be an array');
  }
  return value.map((finding, index) => {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
      throw new AgentRuntimeError('invalid_runtime_result', `review findings[${index}] must be an object`);
    }
    const severity = requireText(finding.severity, `review findings[${index}].severity`);
    if (!new Set(['critical', 'high', 'medium', 'low']).has(severity)) {
      throw new AgentRuntimeError('invalid_runtime_result', `review findings[${index}].severity is unsupported`);
    }
    return {
      severity,
      id: requireText(finding.id, `review findings[${index}].id`),
      detail: requireText(finding.detail, `review findings[${index}].detail`)
    };
  });
}

function normalizeRuntimeReviewRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentRuntimeError('invalid_runtime_result', 'review result requires review_record for its persisted review binding');
  }
  const status = requireText(value.status, 'review_record.status');
  if (!['pass', 'needs_changes', 'block'].includes(status)) {
    throw new AgentRuntimeError('invalid_runtime_result', `unsupported review_record.status: ${status}`);
  }
  return {
    status,
    summary: requireText(value.summary, 'review_record.summary'),
    findings: normalizeRuntimeReviewFindings(value.findings ?? []),
    inspection_summary: requireText(value.inspection_summary, 'review_record.inspection_summary'),
    inspection_evidence: requireText(value.inspection_evidence, 'review_record.inspection_evidence'),
    judgment_deltas: requireStringArray(value.judgment_deltas, 'review_record.judgment_deltas')
  };
}

function normalizeRuntimeReviewFindings(value) {
  if (!Array.isArray(value)) {
    throw new AgentRuntimeError('invalid_runtime_result', 'review_record.findings must be an array');
  }
  return value.map((finding, index) => {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
      throw new AgentRuntimeError('invalid_runtime_result', `review_record.findings[${index}] must be an object`);
    }
    const unknown = Object.keys(finding).filter((key) => !['id', 'severity', 'detail'].includes(key));
    if (unknown.length > 0) {
      throw new AgentRuntimeError('invalid_runtime_result', `review_record.findings[${index}] contains unsupported fields: ${unknown.join(', ')}`);
    }
    return {
      id: requireText(finding.id, `review_record.findings[${index}].id`),
      severity: requireText(finding.severity, `review_record.findings[${index}].severity`),
      detail: requireText(finding.detail, `review_record.findings[${index}].detail`)
    };
  });
}
function normalizeUsageAccounting(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentRuntimeError('invalid_runtime_result', 'usage_accounting must be an object');
  }
  const totalTokens = value.total_tokens ?? null;
  const costUsd = value.cost_usd ?? null;
  if (totalTokens !== null && (!Number.isFinite(totalTokens) || totalTokens < 0)) {
    throw new AgentRuntimeError('invalid_runtime_result', 'usage_accounting.total_tokens must be a non-negative number or null');
  }
  if (costUsd !== null && (!Number.isFinite(costUsd) || costUsd < 0)) {
    throw new AgentRuntimeError('invalid_runtime_result', 'usage_accounting.cost_usd must be a non-negative number or null');
  }
  return {
    total_tokens: totalTokens,
    cost_usd: costUsd,
    source: typeof value.source === 'string' && value.source.length > 0 ? value.source : 'agent_runtime'
  };
}

function waiting(state, request, code, message, now, details = {}) {
  const record = { ...request, provider_run_id: null, status: 'waiting_for_runtime', started_at: null, updated_at: iso(now), result: null,
    stop_reason: { code, message, details } };
  return { state: { ...upsertDispatch(state, record), status: 'waiting_for_runtime', stop_reason: record.stop_reason }, dispatch: record, reused: false };
}

function runtimeRecoveryDetails(
  runState,
  request,
  missingCapabilities = request.requirements.capabilities,
  additionalDetails = {}
) {
  return {
    ...additionalDetails,
    provider: request.adapter_id,
    missing_capabilities: [...missingCapabilities],
    recovery: {
      action: 'resume_run',
      story_id: runState.story_id,
      run_id: runState.run_id,
      required_capabilities: [...request.requirements.capabilities]
    }
  };
}

function waitingExisting(state, current, code, message, now, details = {}) {
  const record = { ...current, status: 'permission_wait', updated_at: iso(now), stop_reason: { code, message, details } };
  return {
    state: { ...upsertDispatch(state, record), status: 'waiting_for_runtime', stop_reason: record.stop_reason },
    dispatch: record,
    reused: false
  };
}

function failed(state, current, code, message, now, providerTerminalStatus = null) {
  const record = { ...current, status: 'failed', provider_terminal_status: providerTerminalStatus, updated_at: iso(now), completed_at: iso(now), stop_reason: { code, message, details: {} } };
  return { state: { ...upsertDispatch(state, record), status: 'failed', stop_reason: record.stop_reason }, dispatch: record, reused: false };
}

function upsertDispatch(state, record) {
  const entries = Array.isArray(state.runtime_dispatches) ? state.runtime_dispatches : [];
  return { ...state, runtime_dispatches: [...entries.filter((item) => item.dispatch_id !== record.dispatch_id), record] };
}

function createDispatchLineage(state, input, dispatchId, runId, headSha) {
  const managedWorktree = state?.managed_worktree;
  const worktreeRoot = managedWorktree?.path;
  const branch = managedWorktree?.branch;
  if (!worktreeRoot || !branch || !/^[0-9a-f]{40}$/i.test(headSha)) return null;
  const authority = { story_id: state.story_id, run_id: runId, worktree_root: worktreeRoot, branch, head_sha: headSha };
  return createRunLineageEnvelope({ authority, ...(input.lineage ?? {}), dispatch_id: dispatchId });
}

function appendRuntimeObservation(lineage, provider, observation, record, options = {}) {
  if (!lineage) return null;
  try {
    return appendProviderObservation(lineage, {
      provider: observation.provider ?? provider,
      provider_run_id: observation.provider_run_id ?? record.provider_run_id,
      provider_session_id: observation.provider_session_id ?? observation.session_id ?? record.session_id,
      thread_id: observation.thread_id ?? record.thread_id,
      story_id: observation.story_id,
      run_id: observation.run_id,
      dispatch_id: observation.dispatch_id,
      // The provider may report the commit it produced. That is an observation,
      // not authority: Guarded Run rebinds the lineage only after checking the
      // managed worktree's actual HEAD.
      head_sha: options.allowImplementationHeadAdvance && observation.head_sha !== lineage.head_sha
        ? undefined
        : observation.head_sha
    });
  } catch (error) {
    if (error?.code) throw new AgentRuntimeError(error.code, error.message, error.details);
    throw error;
  }
}

function findDispatch(state, dispatchId) {
  return (state.runtime_dispatches ?? []).find((item) => item.dispatch_id === dispatchId) ?? null;
}

function requireDispatch(state, dispatchId) {
  const found = findDispatch(state, dispatchId);
  if (!found) throw new AgentRuntimeError('dispatch_not_found', `runtime dispatch not found: ${dispatchId}`);
  return found;
}

function requireAdapter(registry, id) {
  const adapter = registry.get(id);
  if (!adapter) throw new AgentRuntimeError('runtime_unavailable', `runtime adapter not registered: ${id}`);
  return adapter;
}

function requireStringArray(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new AgentRuntimeError('invalid_runtime_result', `${name} must be an array of strings`);
  return [...value];
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new AgentRuntimeError('invalid_request', `${name} must be a positive integer`);
  return value;
}

function nonNegativeNumber(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new AgentRuntimeError('invalid_request', `${name} must be a non-negative number`);
  return value;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new AgentRuntimeError('invalid_request', `${name} is required`);
  return value.trim();
}

function iso(now) {
  return now().toISOString();
}

async function withTimeout(promise, timeoutMs, code) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new AgentRuntimeError(code, `runtime operation exceeded ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
