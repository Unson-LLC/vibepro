import { createHash } from 'node:crypto';

const REQUIRED_METHODS = Object.freeze(['probe', 'start', 'status', 'cancel', 'collect_result']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed_out']);
const RUNTIME_STATUSES = new Set(['queued', 'running', 'permission_wait', ...TERMINAL_STATUSES]);
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
  return Object.freeze({
    id: requireText(adapter.id, 'adapter.id'),
    probe: adapter.probe.bind(adapter),
    start: adapter.start.bind(adapter),
    status: adapter.status.bind(adapter),
    cancel: adapter.cancel.bind(adapter),
    collect_result: adapter.collect_result.bind(adapter)
  });
}

export function createAgentRuntimeCoordinator({ adapters = [], now = () => new Date() } = {}) {
  const registry = new Map(adapters.map((adapter) => {
    const defined = defineAgentRuntimeAdapter(adapter);
    return [defined.id, defined];
  }));
  if (registry.size !== adapters.length) throw new AgentRuntimeError('duplicate_adapter', 'runtime adapter ids must be unique');

  return {
    dispatch: (runState, request) => dispatch(registry, now, runState, request),
    poll: (runState, dispatchId) => poll(registry, now, runState, dispatchId),
    cancel: (runState, dispatchId) => cancel(registry, now, runState, dispatchId)
  };
}

async function dispatch(registry, now, runState, input = {}) {
  const request = normalizeRequest(runState, input);
  const existing = findDispatch(runState, request.dispatch_id);
  if (existing && existing.provider_run_id && !TERMINAL_STATUSES.has(existing.status)) {
    return { state: { ...runState, status: 'running', stop_reason: null }, dispatch: existing, reused: true };
  }
  if (existing?.status === 'completed') return { state: runState, dispatch: existing, reused: true };
  if (existing?.stop_reason?.code === 'orphaned_agent') return { state: runState, dispatch: existing, reused: true };

  const adapter = registry.get(request.adapter_id);
  if (!adapter) return waiting(runState, request, 'runtime_unavailable', 'requested runtime adapter is not registered', now);
  let capability;
  try {
    capability = normalizeProbe(await withTimeout(
      adapter.probe({ requirements: request.requirements, role: request.role }),
      request.requirements.timeout_ms,
      'runtime_probe_timeout'
    ));
  } catch (error) {
    const reason = WAIT_REASONS.has(error.code) ? error.code : 'runtime_unavailable';
    return waiting(runState, request, reason, error.message, now);
  }
  const missing = request.requirements.capabilities.filter((item) => !capability.capabilities.includes(item));
  if (!capability.available || missing.length > 0) {
    return waiting(runState, request, capability.reason ?? 'runtime_unavailable', missing.length > 0
      ? `runtime lacks required capabilities: ${missing.join(', ')}`
      : 'runtime is unavailable', now, { missing_capabilities: missing });
  }
  if (request.role === 'review' && capability.sandbox !== 'read-only') {
    return waiting(runState, request, 'review_readonly_unavailable',
      'review runtime requires a read-only sandbox before start', now, { sandbox: capability.sandbox });
  }

  try {
    const started = normalizeStarted(await withTimeout(
      adapter.start({ ...request, capability }),
      request.requirements.timeout_ms,
      'runtime_start_timeout'
    ));
    const dispatchRecord = {
      ...request,
      provider_run_id: started.provider_run_id,
      agent_identity: started.agent_identity,
      session_id: started.session_id,
      thread_id: started.thread_id,
      sandbox: capability.sandbox,
      approval_policy: capability.approval_policy,
      status: 'running',
      started_at: iso(now),
      updated_at: iso(now),
      result: null,
      stop_reason: null
    };
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
    if (WAIT_REASONS.has(error.code) && error.code !== 'runtime_start_timeout') {
      return waiting(runState, request, error.code, error.message, now);
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

async function poll(registry, now, runState, dispatchId) {
  const current = requireDispatch(runState, dispatchId);
  if (TERMINAL_STATUSES.has(current.status)) return { state: runState, dispatch: current, reused: true };
  if (!current.provider_run_id) throw new AgentRuntimeError('runtime_not_started', 'waiting runtime dispatch must be retried through dispatch()');
  const adapter = requireAdapter(registry, current.adapter_id);
  let observed;
  try {
    observed = normalizeStatus(await withTimeout(
      adapter.status({ provider_run_id: current.provider_run_id }),
      current.requirements.timeout_ms,
      'runtime_status_timeout'
    ));
  } catch (error) {
    return containUncertainRuntime(registry, now, runState, current,
      error.code === 'runtime_status_timeout' ? error.code : 'runtime_status_failed', error.message);
  }
  if (observed.status === 'permission_wait') {
    return waitingExisting(runState, current, 'permission_wait', observed.message ?? 'runtime requires permission', now);
  }
  if (!TERMINAL_STATUSES.has(observed.status)) {
    const next = { ...current, status: observed.status, updated_at: iso(now), stop_reason: observed.stop_reason ?? null };
    return { state: { ...upsertDispatch(runState, next), status: 'running', stop_reason: null }, dispatch: next, reused: false };
  }
  if (observed.status !== 'completed') {
    return failed(runState, current, observed.status === 'timed_out' ? 'runtime_timeout' : `runtime_${observed.status}`,
      observed.message ?? `runtime ended with ${observed.status}`, now, observed.status);
  }
  try {
    const result = normalizeResult(await withTimeout(
      adapter.collect_result({ provider_run_id: current.provider_run_id }),
      current.requirements.timeout_ms,
      'runtime_result_timeout'
    ), current);
    const next = { ...current, status: result.completion_status, result, updated_at: iso(now), completed_at: iso(now), stop_reason: null };
    return { state: upsertDispatch(runState, next), dispatch: next, reused: false };
  } catch (error) {
    const code = error.code === 'runtime_result_timeout' ? error.code : 'invalid_runtime_result';
    return containUncertainRuntime(registry, now, runState, current, code, error.message);
  }
}

async function containUncertainRuntime(registry, now, runState, current, failureCode, failureMessage) {
  const adapter = requireAdapter(registry, current.adapter_id);
  let observed;
  try {
    await withTimeout(adapter.cancel({ provider_run_id: current.provider_run_id }), current.requirements.timeout_ms, 'runtime_cancel_timeout');
    observed = normalizeStatus(await withTimeout(
      adapter.status({ provider_run_id: current.provider_run_id }),
      current.requirements.timeout_ms,
      'runtime_cancel_status_timeout'
    ));
    if (!TERMINAL_STATUSES.has(observed.status)) {
      await withTimeout(adapter.cancel({ provider_run_id: current.provider_run_id, force: true }), current.requirements.timeout_ms, 'runtime_force_cancel_timeout');
      observed = normalizeStatus(await withTimeout(
        adapter.status({ provider_run_id: current.provider_run_id }),
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
    await withTimeout(adapter.cancel({ provider_run_id: current.provider_run_id }), current.requirements.timeout_ms, 'runtime_cancel_timeout');
    observed = normalizeStatus(await withTimeout(
      adapter.status({ provider_run_id: current.provider_run_id }),
      current.requirements.timeout_ms,
      'runtime_cancel_status_timeout'
    ));
  } catch (error) {
    try {
      await withTimeout(adapter.cancel({ provider_run_id: current.provider_run_id, force: true }), current.requirements.timeout_ms, 'runtime_force_cancel_timeout');
      observed = normalizeStatus(await withTimeout(
        adapter.status({ provider_run_id: current.provider_run_id }),
        current.requirements.timeout_ms,
        'runtime_force_cancel_status_timeout'
      ));
    } catch (forceError) {
      return failed(runState, current, 'orphaned_agent', `runtime cancellation failed: ${error.message}; force containment failed: ${forceError.message}`, now);
    }
  }
  if (!TERMINAL_STATUSES.has(observed.status)) {
    try {
      await withTimeout(adapter.cancel({ provider_run_id: current.provider_run_id, force: true }), current.requirements.timeout_ms, 'runtime_force_cancel_timeout');
      observed = normalizeStatus(await withTimeout(
        adapter.status({ provider_run_id: current.provider_run_id }),
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
  return {
    dispatch_id: `dispatch-${createHash('sha256').update(`${runId}:${adapterId}:${taskId}:${role}:${headSha}:${reviewerIdentity ?? ''}:${input.implementation_session_id ?? ''}`).digest('hex').slice(0, 16)}`,
    run_id: runId,
    story_id: requireText(state?.story_id, 'runState.story_id'),
    input_head_sha: headSha,
    adapter_id: adapterId,
    task_id: taskId,
    role,
    reviewer_identity: reviewerIdentity,
    implementation_identity: input.implementation_identity ?? null,
    implementation_session_id: input.implementation_session_id ?? null,
    requirements: {
      capabilities,
      timeout_ms: positiveInteger(input.requirements?.timeout_ms, 'timeout_ms'),
      managed_worktree: requireText(input.requirements?.managed_worktree, 'managed_worktree')
    }
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
    session_id: value.session_id ?? null,
    thread_id: value.thread_id ?? null
  };
}

function normalizeStatus(value) {
  if (!value || typeof value !== 'object') throw new AgentRuntimeError('invalid_runtime_status', 'status result must be an object');
  const status = requireText(value.status, 'runtime status');
  if (!RUNTIME_STATUSES.has(status)) throw new AgentRuntimeError('invalid_runtime_status', `unsupported runtime status: ${status}`);
  return { status, message: value.message ?? null, stop_reason: value.stop_reason ?? null };
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
  if (dispatchRecord.role === 'review') {
    if (result.changed_files.length > 0) {
      throw new AgentRuntimeError('review_mutation_forbidden', 'review runtime result must not contain changed files');
    }
    if (result.head_sha !== dispatchRecord.input_head_sha) {
      throw new AgentRuntimeError('runtime_head_mismatch', 'review result HEAD must match the dispatch input HEAD');
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
  }
  return result;
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
