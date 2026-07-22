import { createHash } from 'node:crypto';
import {
  authorizeAgentReviewDispatch, closeAgentReviewLifecycle, prepareAgentReview,
  recordAgentReview, startAgentReviewLifecycle
} from './agent-review.js';

// Owns the runtime-neutral execution of the existing Agent Review DAG.
// It deliberately has no CLI, filesystem, or PR-manager dependency: the Guarded
// Run boundary supplies the canonical lifecycle/runtime adapters and persists
// the returned journal.

export function createDefaultAgentReviewOps(overrides = {}) {
  const defaults = { prepare: prepareAgentReview, authorize: authorizeAgentReviewDispatch,
    start: startAgentReviewLifecycle, close: closeAgentReviewLifecycle, record: recordAgentReview };
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, overrides[key] ?? fallback]));
}

const TERMINAL_STOP_CODES = new Set([
  'runtime_unavailable', 'auth_denied', 'permission_wait', 'runtime_probe_timeout',
  'runtime_start_timeout', 'runtime_status_timeout', 'runtime_result_timeout',
  'runtime_timeout', 'invalid_runtime_review', 'invalid_runtime_result',
  'runtime_required', 'implementation_provenance_unavailable',
  'review_identity_not_separate', 'review_session_not_separate', 'review_readonly_unavailable'
]);
const VERDICTS = new Set(['pass', 'needs_changes', 'block']);

export class IndependentReviewOrchestrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IndependentReviewOrchestrationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Executes only the next incomplete review stage. Roles within that stage are
 * dispatched/polled concurrently; later stages cannot start until the current
 * stage has terminally recorded every role. Callers persist `journal` into the
 * Guarded Run action_journal and pass it back unchanged after a restart.
 */
export async function orchestrateIndependentReview(input = {}) {
  const stages = normalizeStages(input.stages);
  const boundaries = requireBoundaries(input.boundaries);
  const journal = Array.isArray(input.journal) ? input.journal.slice() : [];
  const context = input.context ?? {};
  const persistCheckpoint = input.persistCheckpoint;
  let checkpointTail = Promise.resolve();
  const persistCheckpointInOrder = typeof persistCheckpoint === 'function'
    ? (snapshot) => {
        checkpointTail = checkpointTail.then(() => persistCheckpoint(snapshot));
        return checkpointTail;
      }
    : undefined;
  const invalidRecord = journal.find((entry) => entry?.kind === 'independent_review'
    && entry.operation === 'record'
    && !VERDICTS.has(entry.result?.verdict ?? entry.result?.status));
  if (invalidRecord) {
    return {
      status: 'blocked',
      verdict: 'block',
      journal,
      stage: invalidRecord.stage,
      stop_reason: {
        code: 'invalid_review_verdict',
        message: 'persisted review record must preserve pass, needs_changes, or block',
        details: { stage: invalidRecord.stage, role: invalidRecord.role }
      }
    };
  }
  const nextStage = stages.find((stage) => !stage.roles.every((role) => hasRecorded(journal, stage, role)));
  if (!nextStage) return { status: 'pass', verdict: 'pass', journal, completed: true };

  try {
    const prepared = await once(journal, nextStage, '*', 'prepare', (operation) => boundaries.prepare({ ...context, stage: nextStage.stage, operation }), persistCheckpointInOrder);
    if (isStop(prepared)) return stopResult(prepared, journal, nextStage.stage);

    const results = await Promise.all(nextStage.roles.map((role) => runRole({ boundaries, context, journal, stage: nextStage, role, persistCheckpoint: persistCheckpointInOrder })));
    const stopped = results.find((result) => result.status !== 'completed');
    if (stopped) return stopResult(stopped, journal, nextStage.stage);
    const verdict = aggregateVerdict(results.map((result) => result.verdict));
    return {
      status: verdict === 'block' ? 'blocked' : 'completed',
      verdict,
      journal,
      stage: nextStage.stage,
      completed: false,
      ...(verdict === 'block' ? {
        stop_reason: {
          code: 'review_blocked',
          message: 'independent review returned block',
          details: { stage: nextStage.stage }
        }
      } : {})
    };
  } catch (error) {
    if (error instanceof IndependentReviewOrchestrationError) return {
      status: terminalStatus(error.code),
      verdict: 'block',
      journal,
      stage: nextStage.stage,
      stop_reason: { code: error.code, message: error.message, details: error.details }
    };
    throw error;
  }
}

// Adapts the review DAG to the existing Guarded Run action contract. A
// needs_changes verdict deliberately completes the review action so the
// canonical next node remains `repair`; block and runtime stops remain typed
// stops. The checkpoint is persisted by Safe Action journal entries.
export function createIndependentReviewActionRunner({ resolveStages, boundaries }) {
  if (typeof resolveStages !== 'function') {
    throw new IndependentReviewOrchestrationError('review_boundary_unavailable', 'missing independent review stage resolver');
  }
  return async ({ state, action, persistCheckpoint }) => {
    const previous = state.action_journal.findLast((entry) => entry.action_id === action.id && Array.isArray(entry.checkpoint));
    let journal = previous?.checkpoint ?? [];
    let stages;
    try {
      stages = await resolveStages({ state, action });
    } catch (error) {
      if (!error?.code) throw error;
      return {
        status: terminalStatus(error.code),
        verdict: 'block',
        stop_reason: error.code,
        recovery: error.details?.recovery,
        checkpoint: journal,
        summary: error.message
      };
    }
    while (true) {
      const result = await orchestrateIndependentReview({
        stages,
        boundaries,
        journal,
        context: { state, action },
        persistCheckpoint
      });
      journal = result.journal;
      if (['blocked', 'waiting_for_runtime', 'waiting_for_human', 'failed'].includes(result.status)) {
        return {
          ...result,
          stop_reason: result.stop_reason?.code ?? 'review_orchestration_stopped',
          recovery: result.stop_reason?.details?.recovery,
          checkpoint: journal,
          summary: result.stop_reason?.message ?? result.stop_reason?.code
        };
      }
      if (result.verdict === 'needs_changes') {
        return { status: 'continue', verdict: result.verdict, checkpoint: journal, summary: 'independent review requested changes' };
      }
      if (result.completed) {
        return { status: 'continue', verdict: 'pass', checkpoint: journal, summary: 'all independent review stages passed' };
      }
    }
  };
}

export function createGuardedIndependentReviewRunner({
  repoRoot, baseRef, preparePullRequest, agentReviewOps, dispatchRuntime, pollRuntime,
  recordRuntimeReview, createError
}) {
  let stagesByName = new Map();
  let implementationProvenance = null;
  const fail = (code, message) => createError(code, message);
  return createIndependentReviewActionRunner({
    resolveStages: async ({ state }) => {
      implementationProvenance = resolveImplementationProvenance(state, fail);
      const prepared = await preparePullRequest(repoRoot, { storyId: state.story_id, baseRef });
      const required = prepared?.preparation?.pr_context?.agent_reviews?.parallel_dispatch?.required_stages;
      if (!Array.isArray(required) || required.length === 0) throw fail('review_plan_unavailable', 'PR preparation did not provide required independent review stages');
      stagesByName = new Map(required.map((stage) => [stage.stage, stage]));
      return required.map((stage) => ({ stage: stage.stage, roles: stage.roles }));
    },
    boundaries: {
      prepare: async ({ state, stage }) => {
        const planned = stagesByName.get(stage);
        if (!planned) throw fail('review_plan_unavailable', `missing required review stage: ${stage}`);
        return agentReviewOps.prepare(repoRoot, { storyId: state.story_id, stage, roles: planned.roles });
      },
      authorize: async ({ state, stage, role }) => agentReviewOps.authorize(repoRoot, {
        storyId: state.story_id, stage, role, agentModel: 'codex', agentReasoningEffort: 'low', agentCostTier: 'low'
      }),
      start: async ({ state, stage, role, authorization }) => agentReviewOps.start(repoRoot, {
        storyId: state.story_id, stage, role, agentSystem: 'codex', agentId: reviewerIdentity(state, stage, role),
        agentModel: 'codex', agentReasoningEffort: 'low', agentCostTier: 'low',
        dispatchAuthorization: authorization.authorization?.authorization_id
      }),
      dispatch: async ({ state, stage, role, lifecycle }) => dispatchRuntime(state, {
        adapter_id: 'codex', task_id: `independent-review:${stage}:${role}`, role: 'review',
        reviewer_identity: reviewerIdentity(state, stage, role),
        implementation_identity: implementationProvenance.agent_identity,
        implementation_session_id: implementationProvenance.session_id,
        requirements: { capabilities: ['review'], timeout_ms: lifecycle.lifecycle?.timeout_ms ?? 600000, managed_worktree: repoRoot }
      }),
      poll: async ({ state, dispatch }) => normalizePoll(await pollRuntime(state, dispatch.dispatch?.dispatch_id)),
      close: async ({ state, stage, role, lifecycle, closeReason }) => agentReviewOps.close(repoRoot, {
        storyId: state.story_id, stage, role, lifecycleId: lifecycle.lifecycle?.lifecycle_id,
        closeReason: closeReason ?? 'completed', closeEvidence: closeReason ? 'guarded_run_runtime_stopped' : 'guarded_run_runtime_completed'
      }),
      record: async ({ state, stage, role, poll }) => {
        const dispatch = poll.dispatch;
        const review = dispatch?.result?.review;
        if (!review) throw fail('invalid_runtime_review', 'review runtime result did not include a valid review verdict');
        const recorded = await recordRuntimeReview(state, dispatch.dispatch_id, {
          stage, role, status: review.status, summary: review.summary,
          inspectionSummary: review.inspection_summary, inspectionEvidence: review.inspection_evidence,
          inspectionInputs: review.inspection_inputs, judgmentDeltas: review.judgment_delta,
          findings: review.findings.map((finding) => JSON.stringify(finding))
        });
        return { ...recorded.review, verdict: review.status };
      }
    }
  });
}

export async function recordGuardedRuntimeReview({ deps, repoRoot, options, loadRun, createError }) {
  const reviewRecorder = deps.recordAgentReview ?? deps.agentReviewOps?.record;
  if (!reviewRecorder) throw createError('review_runtime_unavailable', 'Guarded Run has no Agent Review recording boundary');
  const loaded = await loadRun(deps, repoRoot, options, { requireCurrentHead: true });
  const dispatch = (loaded.state.runtime_dispatches ?? []).find((item) => item.dispatch_id === options.dispatchId);
  const provenance = validateRuntimeReviewDispatch(dispatch, loaded.state.current_head_sha, createError);
  const review = await reviewRecorder(loaded.state.execution_context.root_realpath, {
    ...(options.review ?? {}), storyId: loaded.state.story_id,
    agentSystem: options.review?.agentSystem ?? 'codex', executionMode: 'parallel_subagent',
    agentId: provenance.agent_identity, agentThreadId: provenance.thread_id,
    agentSessionId: provenance.session_id, agentClosed: true, reviewerIdentity: 'separate_session',
    implementationSessionId: dispatch.implementation_session_id
  });
  return { dispatch, review };
}

function validateRuntimeReviewDispatch(dispatch, currentHeadSha, createError) {
  const result = dispatch?.result;
  const provenance = result?.review_provenance;
  const expected = dispatch && `dispatch-${createHash('sha256').update(`${dispatch.run_id}:${dispatch.adapter_id}:${dispatch.task_id}:${dispatch.role}:${dispatch.input_head_sha}:${dispatch.reviewer_identity ?? ''}:${dispatch.implementation_session_id ?? ''}`).digest('hex').slice(0, 16)}`;
  const correlated = Boolean(dispatch?.session_id || dispatch?.thread_id)
    && provenance?.session_id === dispatch?.session_id && provenance?.thread_id === dispatch?.thread_id;
  const separate = correlated && ![provenance?.session_id, provenance?.thread_id].includes(dispatch?.implementation_session_id);
  const valid = dispatch?.role === 'review' && dispatch.dispatch_id === expected && dispatch.status === 'completed'
    && dispatch.sandbox === 'read-only' && dispatch.requirements?.capabilities?.includes('review')
    && !dispatch.requirements?.capabilities?.includes('workspace_write') && Array.isArray(result?.changed_files)
    && result.changed_files.length === 0 && dispatch.input_head_sha === currentHeadSha && result.head_sha === currentHeadSha
    && provenance?.execution_mode === 'parallel_subagent' && provenance.agent_identity === dispatch.reviewer_identity
    && provenance.agent_identity === dispatch.agent_identity && provenance.agent_identity !== dispatch.implementation_identity
    && provenance.lifecycle === 'closed' && separate;
  if (!valid) throw createError('invalid_runtime_review', 'only a current-HEAD, read-only, separately identified closed review dispatch can enter the Agent Review Gate');
  return provenance;
}

export function createReviewCheckpointPersister({ loadRun, persist, now }) {
  return async ({ state, action, checkpoint }) => {
    const loaded = await loadRun(state);
    const timestamp = now();
    const entry = {
      action_id: action.id, node_id: action.node_id, input_head_sha: state.current_head_sha,
      output_head_sha: state.current_head_sha,
      idempotency_key: `${state.run_id}:${action.node_id}:${state.current_head_sha}:checkpoint`,
      status: 'checkpoint', artifact: null, result_summary: 'operation checkpoint', checkpoint,
      started_at: timestamp, completed_at: timestamp
    };
    const prior = loaded.state.action_journal.filter((item) => !(item.action_id === action.id && item.status === 'checkpoint'));
    await persist(loaded, { ...loaded.state, action_journal: [...prior, entry] });
  };
}

function resolveImplementationProvenance(state, fail) {
  const dispatch = (state.runtime_dispatches ?? []).findLast((item) => item.role === 'implementation'
    && item.status === 'completed' && item.result?.head_sha === state.current_head_sha
    && typeof item.agent_identity === 'string'
    && (typeof item.session_id === 'string' || typeof item.thread_id === 'string'));
  if (!dispatch) throw fail('implementation_provenance_unavailable', 'independent review requires a completed current-HEAD implementation runtime dispatch');
  return { agent_identity: dispatch.agent_identity, session_id: dispatch.session_id ?? dispatch.thread_id };
}

function reviewerIdentity(state, stage, role) { return `guarded-review:${state.run_id}:${stage}:${role}`; }

function normalizePoll(result) {
  if (result.dispatch?.status === 'completed') return result;
  const code = result.dispatch?.stop_reason?.code ?? result.state?.stop_reason?.code ?? 'runtime_required';
  return {
    status: result.state?.status === 'failed' ? 'failed' : 'waiting_for_runtime',
    stop_reason: {
      code,
      message: result.dispatch?.stop_reason?.message ?? 'review runtime has not reached a terminal completed state',
      details: { dispatch_id: result.dispatch?.dispatch_id ?? null }
    }
  };
}

async function runRole({ boundaries, context, journal, stage, role, persistCheckpoint }) {
  if (hasRecorded(journal, stage, role)) return recordedResult(journal, stage, role);
  const base = { ...context, stage: stage.stage, role: role.role };
  const authorization = await once(journal, stage, role, 'authorize', (operation) => boundaries.authorize({ ...base, operation }), persistCheckpoint);
  if (isStop(authorization)) return authorization;
  if (authorization.action && authorization.action !== 'dispatch') {
    return typedStop('review_dispatch_denied', authorization.stop_reason ?? 'review dispatch was not authorized');
  }
  const lifecycle = await once(journal, stage, role, 'start', (operation) => boundaries.start({ ...base, authorization, operation }), persistCheckpoint);
  if (isStop(lifecycle)) return lifecycle;
  const dispatched = await once(journal, stage, role, 'dispatch', (operation) => boundaries.dispatch({ ...base, authorization, lifecycle, operation }), persistCheckpoint);
  if (isStop(dispatched)) {
    const cleanup = await closeStoppedLifecycle({ boundaries, base, lifecycle, dispatch: dispatched, stop: dispatched, journal, stage, role, persistCheckpoint });
    if (isStop(cleanup)) return cleanup;
    return dispatched;
  }
  const polled = await once(journal, stage, role, 'poll', (operation) => boundaries.poll({ ...base, lifecycle, dispatch: dispatched, operation }), persistCheckpoint);
  if (isStop(polled)) {
    const cleanup = await closeStoppedLifecycle({ boundaries, base, lifecycle, dispatch: dispatched, stop: polled, journal, stage, role, persistCheckpoint });
    if (isStop(cleanup)) return cleanup;
    return polled;
  }
  const closed = await once(journal, stage, role, 'close', (operation) => boundaries.close({ ...base, lifecycle, dispatch: dispatched, poll: polled, operation }), persistCheckpoint);
  if (isStop(closed)) return closed;
  const recorded = await once(journal, stage, role, 'record', (operation) => boundaries.record({ ...base, lifecycle, dispatch: dispatched, poll: polled, close: closed, operation }), persistCheckpoint);
  if (isStop(recorded)) return recorded;
  const verdict = recorded.verdict ?? recorded.status;
  if (!VERDICTS.has(verdict)) throw new IndependentReviewOrchestrationError('invalid_review_verdict', 'review record must preserve pass, needs_changes, or block', { stage: stage.stage, role: role.role, verdict });
  return { status: 'completed', verdict, record: recorded };
}

async function closeStoppedLifecycle({ boundaries, base, lifecycle, dispatch, stop, journal, stage, role, persistCheckpoint }) {
  return once(journal, stage, role, 'close', (operation) => boundaries.close({
    ...base, lifecycle, dispatch, poll: stop, closeReason: stop.stop_reason?.code ?? 'runtime_stopped', operation
  }), persistCheckpoint);
}

async function once(journal, stage, role, operation, invoke, persistCheckpoint) {
  const existing = journal.find((entry) => entry.stage === stage.stage && entry.role === roleName(role) && entry.operation === operation);
  if (existing?.state === 'completed' || (existing && !existing.state)) return existing.result;
  const entry = existing ?? {
    kind: 'independent_review', stage: stage.stage, role: roleName(role), operation,
    idempotency_key: `${stage.stage}:${roleName(role)}:${operation}`, state: 'reserved', result: null
  };
  if (!existing) {
    journal.push(entry);
    // Reserve the deterministic operation key before crossing an external
    // boundary. On restart the same reservation is reconciled with the same
    // idempotency key instead of creating a second logical operation.
    await persistCheckpoint?.(journal.map((item) => ({ ...item })));
  }
  let result;
  try {
    result = await invoke({ idempotency_key: entry.idempotency_key, resumed: Boolean(existing) });
  } catch (error) {
    if (error?.code) result = typedStop(error.code, error.message, error.details);
    else throw error;
  }
  entry.state = 'completed';
  entry.result = result;
  // Successful and stopped attempts are both durable. This makes the journal
  // a complete exactly-once operation ledger and prevents a restart from
  // silently retrying a terminal poll or lifecycle transition.
  await persistCheckpoint?.(journal.map((entry) => ({ ...entry })));
  return result;
}

function normalizeStages(value) {
  if (!Array.isArray(value) || value.length === 0) throw new IndependentReviewOrchestrationError('invalid_review_dag', 'review stages are required');
  return value.map((stage, index) => {
    if (!stage || typeof stage.stage !== 'string' || !Array.isArray(stage.roles) || stage.roles.length === 0) {
      throw new IndependentReviewOrchestrationError('invalid_review_dag', 'each review stage needs a name and roles', { index });
    }
    return { stage: stage.stage, roles: stage.roles.map((role) => typeof role === 'string' ? { role } : role) };
  });
}

function requireBoundaries(value) {
  for (const name of ['prepare', 'authorize', 'start', 'dispatch', 'poll', 'close', 'record']) {
    if (typeof value?.[name] !== 'function') throw new IndependentReviewOrchestrationError('review_boundary_unavailable', `missing independent review boundary: ${name}`);
  }
  return value;
}

function hasRecorded(journal, stage, role) { return journal.some((entry) => entry.stage === stage.stage && entry.role === roleName(role) && entry.operation === 'record'); }
function recordedResult(journal, stage, role) { const entry = journal.find((item) => item.stage === stage.stage && item.role === roleName(role) && item.operation === 'record'); return { status: 'completed', verdict: entry.result.verdict ?? entry.result.status, record: entry.result }; }
function roleName(role) { return typeof role === 'string' ? role : role.role; }
function isStop(value) { return value?.status === 'waiting_for_runtime' || value?.status === 'blocked' || value?.status === 'failed' || value?.status === 'waiting_for_human'; }
function typedStop(code, message, details = {}) { return { status: terminalStatus(code), stop_reason: { code, message, details } }; }
function terminalStatus(code) { return TERMINAL_STOP_CODES.has(code) ? 'waiting_for_runtime' : 'blocked'; }
function stopResult(value, journal, stage) { return { status: value.status, verdict: 'block', journal, stage, stop_reason: value.stop_reason ?? { code: 'review_orchestration_stopped', message: 'review orchestration stopped' } }; }
function aggregateVerdict(verdicts) { return verdicts.includes('block') ? 'block' : verdicts.includes('needs_changes') ? 'needs_changes' : 'pass'; }
