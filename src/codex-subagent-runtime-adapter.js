import { createAgentCompletionInbox } from './agent-completion-inbox.js';

const TERMINAL_KINDS = new Set(['completed', 'failed', 'cancelled']);

export function createCodexSubagentRuntimeAdapter({ repoRoot, host, inbox, now = () => new Date() } = {}) {
  assertHost(host);
  const persistentInbox = inbox ?? createAgentCompletionInbox({ repoRoot, now });
  const dispatches = new Map();

  return {
    id: 'codex-subagent',
    async probe(input) {
      const capability = await host.probe(input);
      return { ...capability, capabilities: [...new Set([...(capability.capabilities ?? []), 'completion_inbox', 'detached_resume'])] };
    },
    async start(request) {
      const existing = dispatches.get(request.dispatch_id);
      if (existing) return existing.started;
      const started = await host.spawn({ ...request, idempotency_key: request.dispatch_id });
      const record = { request, started, subscription: null, started_at: now().toISOString() };
      dispatches.set(request.dispatch_id, record);
      try {
        record.subscription = await host.subscribeCompletion({
          provider_run_id: started.provider_run_id,
          dispatch_id: request.dispatch_id,
          onEvent: async (providerEvent) => {
            const event = toInboxEvent(request, started, providerEvent, now);
            await persistentInbox.append(event);
            await host.wake({ dispatch_id: request.dispatch_id, provider_run_id: started.provider_run_id, event_id: event.event_id });
          }
        });
      } catch (error) {
        dispatches.delete(request.dispatch_id);
        await host.shutdown({ provider_run_id: started.provider_run_id, force: true, reason: 'completion_delivery_unavailable' });
        throw error;
      }
      return started;
    },
    async status({ provider_run_id }) {
      const record = findByProviderRun(dispatches, provider_run_id);
      if (record) {
        const reconciled = await persistentInbox.reconcile(record.request.dispatch_id);
        if (reconciled.completion) return completionStatus(reconciled.completion);
      }
      return host.status({ provider_run_id });
    },
    async detach({ provider_run_id, dispatch_id, monitor_boundary_ms }) {
      if (typeof host.detach === 'function') await host.detach({ provider_run_id, dispatch_id, monitor_boundary_ms });
      return { status: 'running_detached', provider_run_id, dispatch_id };
    },
    async reconcile({ provider_run_id, dispatch_id }) {
      const record = dispatches.get(dispatch_id) ?? findByProviderRun(dispatches, provider_run_id);
      const reconciled = await persistentInbox.reconcile(dispatch_id);
      if (reconciled.completion) return completionStatus(reconciled.completion);
      const providerStatus = await host.status({ provider_run_id });
      if (!record) {
        return { ...providerStatus, partial_results: reconciled.partial_results, latest_event: reconciled.latest };
      }
      const stalled = evaluateProgressBounds(record, reconciled, providerStatus, now());
      if (stalled) {
        await host.shutdown({ provider_run_id, force: true, reason: stalled.stop_reason.code });
        return stalled;
      }
      return { ...providerStatus, partial_results: reconciled.partial_results, latest_event: reconciled.latest };
    },
    async cancel({ provider_run_id, force = false }) {
      return host.shutdown({ provider_run_id, force, reason: 'explicit_runtime_cancel' });
    },
    async collect_result({ provider_run_id, dispatch_id }) {
      const record = findByProviderRun(dispatches, provider_run_id);
      const logicalDispatchId = record?.request.dispatch_id ?? dispatch_id;
      if (!logicalDispatchId) throw new Error(`unknown Codex provider run: ${provider_run_id}`);
      const reconciled = await persistentInbox.reconcile(logicalDispatchId);
      if (reconciled.completion?.kind !== 'completed') throw new Error('Codex completion result is not present in the persistent inbox');
      await persistentInbox.acknowledge(logicalDispatchId, reconciled.completion.event_id);
      return {
        ...reconciled.completion.payload,
        completion_status: 'completed',
        partial_results: reconciled.partial_results,
        surface_hash: reconciled.completion.surface_hash
      };
    }
  };
}

export function planJudgmentRecovery({ previous = [], requested = [], previousSurfaceHash, currentSurfaceHash, changedPaths = [] } = {}) {
  const completed = new Map(previous.filter((item) => item?.judgment_id).map((item) => [item.judgment_id, item]));
  const sameSurface = previousSurfaceHash === currentSurfaceHash;
  const invalidated = [];
  const reusable = [];
  const remaining = [];
  for (const judgment of requested) {
    const prior = completed.get(judgment.judgment_id);
    if (!prior) {
      remaining.push(judgment);
      continue;
    }
    const affected = !sameSurface && intersects(judgment.surface_paths ?? [], changedPaths);
    if (affected) {
      invalidated.push(judgment.judgment_id);
      remaining.push(judgment);
    } else {
      reusable.push(prior);
    }
  }
  return { reusable_judgments: reusable, remaining_judgments: remaining, invalidated_judgments: invalidated };
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
  const elapsed = observedNow.getTime() - Date.parse(record.started_at);
  const progressEvents = reconciled.events.filter((event) => event.checkpoint_id || event.kind === 'partial_result');
  const lastProgressAt = progressEvents.at(-1)?.observed_at ?? record.started_at;
  const noProgressElapsed = observedNow.getTime() - Date.parse(lastProgressAt);
  const attempts = providerStatus.attempts ?? 1;
  const cost = providerStatus.usage_accounting?.cost_usd ?? 0;
  if (elapsed > requirements.max_wall_clock_ms) return stalled('max_wall_clock_exceeded');
  if (noProgressElapsed > requirements.no_progress_deadline_ms) return stalled('no_progress_deadline_exceeded');
  if (attempts > requirements.max_attempts) return stalled('max_attempts_exceeded');
  if (requirements.max_cost_usd > 0 && cost > requirements.max_cost_usd) return stalled('max_cost_exceeded');
  return null;
}

function stalled(reason) {
  return { status: 'stalled', message: reason, stop_reason: { code: reason, message: reason, details: {} } };
}

function intersects(surfacePaths, changedPaths) {
  if (surfacePaths.length === 0) return true;
  return changedPaths.some((changed) => surfacePaths.some((surface) => changed === surface || changed.startsWith(`${surface}/`) || surface.startsWith(`${changed}/`)));
}
