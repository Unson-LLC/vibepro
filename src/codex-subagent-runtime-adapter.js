import { createAgentCompletionInbox } from './agent-completion-inbox.js';

const TERMINAL_KINDS = new Set(['completed', 'failed', 'cancelled']);

export function createCodexSubagentRuntimeAdapter({ repoRoot, host, inbox, now = () => new Date() } = {}) {
  assertHost(host);
  const persistentInbox = inbox ?? createAgentCompletionInbox({ repoRoot, now });
  const dispatches = new Map();
  const starting = new Map();
  const recovering = new Map();

  async function startDispatch(request) {
    const recoveryPlan = planJudgmentRecovery({
      previous: request.previous_judgments,
      requested: request.requested_judgments,
      previousSurfaceHash: request.previous_surface_hash,
      currentSurfaceHash: request.inspection_surface_hash,
      changedPaths: request.changed_paths
    });
    const effectiveRequest = {
      ...request,
      requested_judgments: recoveryPlan.remaining_judgments,
      recovery_plan: recoveryPlan,
      idempotency_key: request.dispatch_id,
      completion_delivery: {
        protocol: 'vibepro-runtime-inbox-v1',
        repo_root: repoRoot,
        story_id: request.story_id,
        run_id: request.run_id,
        dispatch_id: request.dispatch_id
      }
    };
    let started = null;
    const pendingBeforeStart = [];
    let deliveryChain = Promise.resolve();
    const persistAndWake = async (providerEvent) => {
      const event = toInboxEvent(request, started, providerEvent, now);
      await persistentInbox.append(event);
      try {
        await host.wake({ dispatch_id: request.dispatch_id, provider_run_id: started.provider_run_id, event_id: event.event_id });
      } catch {
        // Inbox persistence is authoritative; reconcile recovers a lost push.
      }
    };
    const onEvent = (providerEvent) => {
      if (!started) {
        pendingBeforeStart.push(providerEvent);
        return Promise.resolve();
      }
      deliveryChain = deliveryChain.then(() => persistAndWake(providerEvent));
      return deliveryChain;
    };
    let subscription;
    try {
      subscription = await host.subscribeCompletion({
        provider_run_id: null,
        dispatch_id: request.dispatch_id,
        onEvent
      });
      started = await host.spawn(effectiveRequest);
      const record = {
        request: effectiveRequest,
        started,
        subscription,
        logical_started_at: now().toISOString(),
        attempt_started_at: now().toISOString(),
        accumulated_cost_usd: 0,
        awaitDelivery: () => deliveryChain,
        setStarted(next) { started = next; this.started = next; }
      };
      dispatches.set(request.dispatch_id, record);
      for (const providerEvent of pendingBeforeStart.splice(0)) {
        deliveryChain = deliveryChain.then(() => persistAndWake(providerEvent));
      }
      await deliveryChain;
    } catch (error) {
      dispatches.delete(request.dispatch_id);
      if (started?.provider_run_id) {
        await host.shutdown({ provider_run_id: started.provider_run_id, force: true, reason: 'completion_delivery_unavailable' });
      }
      throw error;
    }
    return started;
  }

  return {
    id: 'codex-subagent',
    async probe(input) {
      const capability = await host.probe(input);
      return { ...capability, capabilities: [...new Set([...(capability.capabilities ?? []), 'completion_inbox', 'detached_resume'])] };
    },
    async start(request) {
      const existing = dispatches.get(request.dispatch_id);
      if (existing) return existing.started;
      const inFlight = starting.get(request.dispatch_id);
      if (inFlight) return inFlight;
      const pending = startDispatch(request);
      starting.set(request.dispatch_id, pending);
      try {
        return await pending;
      } finally {
        if (starting.get(request.dispatch_id) === pending) starting.delete(request.dispatch_id);
      }
    },
    async status({ provider_run_id }) {
      const record = findByProviderRun(dispatches, provider_run_id);
      if (record) {
        await record.awaitDelivery?.();
        const reconciled = await persistentInbox.reconcile(record.request.dispatch_id);
        if (reconciled.completion) return completionStatus(reconciled.completion);
      }
      return host.status({ provider_run_id });
    },
    async detach({ provider_run_id, dispatch_id, monitor_boundary_ms }) {
      if (typeof host.detach === 'function') await host.detach({ provider_run_id, dispatch_id, monitor_boundary_ms });
      return { status: 'running_detached', provider_run_id, dispatch_id };
    },
    async reconcile({ provider_run_id, dispatch_id, dispatch }) {
      const record = dispatches.get(dispatch_id) ?? findByProviderRun(dispatches, provider_run_id) ?? reconstructRecord(dispatch);
      await record?.awaitDelivery?.();
      const reconciled = await persistentInbox.reconcile(dispatch_id);
      if (reconciled.completion) return completionStatus(reconciled.completion);
      const providerStatus = await host.status({ provider_run_id });
      const partialResults = matchingPartialResults(reconciled, record?.request.inspection_surface_hash ?? dispatch?.inspection_surface_hash);
      if (!record) {
        return { ...providerStatus, partial_results: partialResults, latest_event: reconciled.latest };
      }
      const stalled = evaluateProgressBounds(record, reconciled, providerStatus, now());
      if (stalled) {
        const attempts = Math.max(providerStatus.attempts ?? 1, record.recovery_attempts ?? 1);
        if (stalled.stop_reason.code === 'no_progress_deadline_exceeded'
          && attempts < record.request.requirements.max_attempts) {
          const inFlight = recovering.get(dispatch_id);
          if (inFlight) return inFlight;
          const recovery = resumeIncomplete(record, reconciled, attempts);
          recovering.set(dispatch_id, recovery);
          try {
            return await recovery;
          } finally {
            if (recovering.get(dispatch_id) === recovery) recovering.delete(dispatch_id);
          }
        }
        await host.shutdown({ provider_run_id, force: true, reason: stalled.stop_reason.code });
        return stalled;
      }
      return { ...providerStatus, partial_results: partialResults, latest_event: reconciled.latest };
    },
    async cancel({ provider_run_id, force = false }) {
      return host.shutdown({ provider_run_id, force, reason: 'explicit_runtime_cancel' });
    },
    async collect_result({ provider_run_id, dispatch_id, dispatch }) {
      const record = findByProviderRun(dispatches, provider_run_id) ?? reconstructRecord(dispatch);
      await record?.awaitDelivery?.();
      const logicalDispatchId = record?.request.dispatch_id ?? dispatch_id;
      if (!logicalDispatchId) throw new Error(`unknown Codex provider run: ${provider_run_id}`);
      const reconciled = await persistentInbox.reconcile(logicalDispatchId);
      if (reconciled.completion?.kind !== 'completed') throw new Error('Codex completion result is not present in the persistent inbox');
      const partialResults = matchingPartialResults(reconciled, record?.request.inspection_surface_hash ?? dispatch?.inspection_surface_hash);
      await persistentInbox.acknowledge(logicalDispatchId, reconciled.completion.event_id);
      return {
        ...reconciled.completion.payload,
        completion_status: 'completed',
        partial_results: partialResults,
        judgments: mergeJudgments(
          record?.request.recovery_plan?.reusable_judgments ?? planJudgmentRecovery({
            previous: record?.request.previous_judgments,
            requested: record?.request.requested_judgments,
            previousSurfaceHash: record?.request.previous_surface_hash,
            currentSurfaceHash: record?.request.inspection_surface_hash,
            changedPaths: record?.request.changed_paths
          }).reusable_judgments,
          partialResults,
          reconciled.completion.payload?.judgments
        ),
        surface_hash: reconciled.completion.surface_hash
      };
    },
    async ingestCompletion({ dispatch, providerEvent }) {
      if (!dispatch?.provider_run_id) throw new TypeError('persisted dispatch with provider_run_id is required');
      const event = toInboxEvent(dispatch, { provider_run_id: dispatch.provider_run_id }, providerEvent, now);
      await persistentInbox.append(event);
      return event;
    }
  };

  async function resumeIncomplete(record, reconciled, attempts) {
    await host.shutdown({ provider_run_id: record.started.provider_run_id, force: true, reason: 'bounded_incomplete_recovery' });
    const partialJudgments = matchingPartialResults(reconciled, record.request.inspection_surface_hash);
    const recoveryPlan = planJudgmentRecovery({
      previous: mergeJudgments(record.request.recovery_plan?.reusable_judgments, partialJudgments),
      requested: record.request.requested_judgments,
      previousSurfaceHash: record.request.inspection_surface_hash,
      currentSurfaceHash: record.request.inspection_surface_hash,
      changedPaths: []
    });
    const attemptCost = reportedCost(await host.status({ provider_run_id: record.started.provider_run_id }));
    record.accumulated_cost_usd = (record.accumulated_cost_usd ?? 0) + attemptCost;
    const recoveryRequest = {
      ...record.request,
      previous_judgments: recoveryPlan.reusable_judgments,
      requested_judgments: recoveryPlan.remaining_judgments,
      recovery_plan: recoveryPlan,
      recovery_attempt: attempts + 1,
      idempotency_key: `${record.request.dispatch_id}:attempt:${attempts + 1}`
    };
    const restarted = await host.spawn(recoveryRequest);
    record.request = recoveryRequest;
    record.recovery_attempts = attempts + 1;
    record.attempt_started_at = now().toISOString();
    record.setStarted(restarted);
    return {
      status: 'running_detached',
      provider_run_id: restarted.provider_run_id,
      provider_session_id: restarted.provider_session_id ?? null,
      session_id: restarted.session_id ?? null,
      thread_id: restarted.thread_id ?? null,
      attempts: attempts + 1,
      usage_accounting: { cost_usd: record.accumulated_cost_usd, total_tokens: null },
      partial_results: partialJudgments,
      recovery_plan: recoveryPlan
    };
  }
}

export function planJudgmentRecovery({ previous = [], requested = [], previousSurfaceHash, currentSurfaceHash, changedPaths = [] } = {}) {
  const completed = new Map(previous.filter((item) => item?.judgment_id).map((item) => [item.judgment_id, item]));
  const sameSurface = previousSurfaceHash === currentSurfaceHash;
  const surfaceChangedWithoutDiff = !sameSurface && changedPaths.length === 0;
  const invalidated = [];
  const reusable = [];
  const remaining = [];
  for (const judgment of requested) {
    const prior = completed.get(judgment.judgment_id);
    if (!prior) {
      remaining.push(judgment);
      continue;
    }
    const affected = !sameSurface && (surfaceChangedWithoutDiff || intersects(judgment.surface_paths ?? [], changedPaths));
    if (affected) {
      invalidated.push(judgment.judgment_id);
      remaining.push(judgment);
    } else {
      reusable.push(prior);
    }
  }
  return { reusable_judgments: reusable, remaining_judgments: remaining, invalidated_judgments: invalidated };
}

function matchingPartialResults(reconciled, expectedSurfaceHash) {
  return reconciled.events
    .filter((event) => event.kind === 'partial_result' && event.surface_hash === expectedSurfaceHash)
    .map((event) => event.payload);
}

function assertHost(host) {
  const required = ['probe', 'spawn', 'status', 'shutdown', 'subscribeCompletion', 'wake'];
  if (!host || required.some((name) => typeof host[name] !== 'function')) {
    throw new TypeError(`Codex host requires ${required.join(', ')}`);
  }
}

function findByProviderRun(dispatches, providerRunId) {
  return [...dispatches.values()].find((record) => record.started.provider_run_id === providerRunId) ?? null;
}

function toInboxEvent(request, started, providerEvent, now) {
  if (providerEvent.provider_run_id && providerEvent.provider_run_id !== started.provider_run_id) {
    throw new Error(`Codex completion provider_run_id mismatch: ${providerEvent.provider_run_id}`);
  }
  if (providerEvent.dispatch_id && providerEvent.dispatch_id !== request.dispatch_id) {
    throw new Error(`Codex completion dispatch_id mismatch: ${providerEvent.dispatch_id}`);
  }
  const kind = providerEvent.kind ?? providerEvent.status;
  if (!['progress', 'partial_result', 'completed', 'failed', 'cancelled'].includes(kind)) throw new Error(`unsupported Codex completion event: ${kind}`);
  return {
    event_id: providerEvent.event_id,
    dispatch_id: request.dispatch_id,
    provider_run_id: started.provider_run_id,
    kind,
    observed_at: providerEvent.observed_at ?? now().toISOString(),
    checkpoint_id: providerEvent.checkpoint_id,
    surface_hash: providerEvent.surface_hash ?? request.inspection_surface_hash,
    payload: providerEvent.result ?? providerEvent.payload ?? {}
  };
}

function completionStatus(event) {
  if (!TERMINAL_KINDS.has(event.kind)) throw new Error(`not a completion event: ${event.kind}`);
  return {
    status: event.kind === 'completed' ? 'completed' : event.kind,
    message: event.payload?.message ?? null,
    provider_run_id: event.provider_run_id,
    dispatch_id: event.dispatch_id,
    head_sha: event.payload?.head_sha ?? null
  };
}

function evaluateProgressBounds(record, reconciled, providerStatus, observedNow) {
  const requirements = record.request.requirements;
  const elapsed = observedNow.getTime() - Date.parse(record.logical_started_at);
  const lastProgressAt = lastUniqueProgressAt(reconciled.events, record.attempt_started_at);
  const noProgressElapsed = observedNow.getTime() - Date.parse(lastProgressAt);
  const attempts = Math.max(providerStatus.attempts ?? 1, record.recovery_attempts ?? 1);
  const cost = (record.accumulated_cost_usd ?? 0) + reportedCost(providerStatus);
  if (elapsed > requirements.max_wall_clock_ms) return stalled('max_wall_clock_exceeded');
  if (attempts > requirements.max_attempts) return stalled('max_attempts_exceeded');
  if (requirements.max_cost_usd > 0 && cost > requirements.max_cost_usd) return stalled('max_cost_exceeded');
  if (noProgressElapsed > requirements.no_progress_deadline_ms) return stalled('no_progress_deadline_exceeded');
  return null;
}

function lastUniqueProgressAt(events, fallback) {
  const checkpoints = new Set();
  const judgments = new Set();
  let latest = fallback;
  for (const event of events) {
    let advanced = false;
    if (event.checkpoint_id && !checkpoints.has(event.checkpoint_id)) {
      checkpoints.add(event.checkpoint_id);
      advanced = true;
    }
    if (event.kind === 'partial_result') {
      for (const judgment of judgmentItems(event.payload)) {
        if (!judgments.has(judgment.judgment_id)) {
          judgments.add(judgment.judgment_id);
          advanced = true;
        }
      }
    }
    if (advanced) latest = event.observed_at;
  }
  return latest;
}

function reconstructRecord(dispatch) {
  if (!dispatch?.provider_run_id || !dispatch?.started_at) return null;
  return {
    request: dispatch,
    started: { provider_run_id: dispatch.provider_run_id },
    logical_started_at: dispatch.started_at,
    attempt_started_at: dispatch.updated_at ?? dispatch.started_at,
    recovery_attempts: dispatch.attempts ?? 1,
    accumulated_cost_usd: dispatch.usage_accounting?.cost_usd ?? 0
  };
}

function reportedCost(providerStatus) {
  const cost = providerStatus?.usage_accounting?.cost_usd;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : 0;
}

function judgmentItems(value) {
  if (Array.isArray(value)) return value.filter((item) => item?.judgment_id);
  if (value?.judgment_id) return [value];
  if (Array.isArray(value?.judgments)) return value.judgments.filter((item) => item?.judgment_id);
  return [];
}

function mergeJudgments(...collections) {
  const merged = new Map();
  for (const collection of collections) {
    for (const judgment of judgmentItems(collection)) merged.set(judgment.judgment_id, judgment);
  }
  return [...merged.values()];
}

function stalled(reason) {
  return { status: 'stalled', message: reason, stop_reason: { code: reason, message: reason, details: {} } };
}

function intersects(surfacePaths, changedPaths) {
  if (surfacePaths.length === 0) return true;
  return changedPaths.some((changed) => surfacePaths.some((surface) => changed === surface || changed.startsWith(`${surface}/`) || surface.startsWith(`${changed}/`)));
}
