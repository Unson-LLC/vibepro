import { createHash } from 'node:crypto';
import { selectNextBestAction } from './next-best-action-controller.js';

const REGISTRY = Object.freeze([
  Object.freeze({ id: 'pr_prepare', classification: 'repo_local_safe', depends_on: [] }),
  Object.freeze({ id: 'pr_autopilot_safe', classification: 'repo_local_safe', depends_on: ['pr_prepare'] })
]);
const ESCAPE_REGISTRY = Object.freeze([
  Object.freeze({ id: 'ask', classification: 'approval_required' }),
  Object.freeze({ id: 'split', classification: 'approval_required' }),
  Object.freeze({ id: 'wait', classification: 'approval_required' }),
  Object.freeze({ id: 'stop', classification: 'approval_required' }),
  Object.freeze({ id: 'rediagnose', classification: 'approval_required' })
]);

export function buildSafeActionPlan(state) {
  return REGISTRY.map((action) => ({
    ...action,
    node_id: action.id,
    input_head_sha: state.current_head_sha,
    idempotency_key: createHash('sha256')
      .update(`${state.run_id}:${action.id}:${state.current_head_sha}`)
      .digest('hex')
  }));
}

export function selectSafeActionCandidate(state, options = {}) {
  const candidates = buildSafeActionPlan(state)
    .filter((action) => !hasCompletedCheckpoint(state, action.id, state))
    .map((action) => ({
      action_id: action.id,
      classification: action.classification,
      policy_allowed: true,
      dependency_ready: dependenciesCompleted(state, action, state),
      metrics: options.metrics?.[action.id] ?? {}
    }));
  const escapeCandidates = buildEscapeCandidates(options.escapeActionIds, options.metrics);
  return selectNextBestAction({
    checkpoint_reason: options.checkpointReason ?? 'material_progress',
    state_delta: options.stateDelta ?? {
      current_head_sha: state.current_head_sha,
      status: state.status,
      completed_actions: state.action_journal
        .filter((entry) => entry.status === 'completed')
        .map((entry) => entry.action_id)
    },
    candidates: [...candidates, ...escapeCandidates],
    previous_decision: options.previousDecision,
    no_progress_count: options.noProgressCount,
    policy_version: options.policyVersion
  });
}

function buildEscapeCandidates(requestedIds = [], metrics = {}) {
  if (!Array.isArray(requestedIds) || requestedIds.some((id) => typeof id !== 'string')) {
    throw new TypeError('escapeActionIds must be an array of canonical action ids');
  }
  return requestedIds.map((id) => {
    const action = ESCAPE_REGISTRY.find((entry) => entry.id === id);
    if (!action) throw new Error(`Unknown canonical escape action: ${id}`);
    return {
      action_id: action.id,
      classification: action.classification,
      policy_allowed: true,
      dependency_ready: true,
      metrics: metrics[action.id] ?? {}
    };
  });
}

export async function runSafeActionPlan(state, options = {}) {
  const plan = options.plan ?? buildSafeActionPlan(state);
  const canonicalPlan = buildSafeActionPlan(state);
  if (!isAllowedCanonicalPlan(plan, canonicalPlan)) {
    const providedPlan = Array.isArray(plan) ? plan : [];
    const rejectedAction = providedPlan.find((action, index) => !isExactCanonicalAction(action, canonicalPlan[index]))
      ?? canonicalPlan[providedPlan.length]
      ?? canonicalPlan[0];
    const key = rejectedAction.idempotency_key ?? createHash('sha256')
      .update(`${state.run_id}:${rejectedAction.id}:${state.current_head_sha}`)
      .digest('hex');
    return {
      plan,
      state: stop(state, rejectedAction, key, 'blocked', 'action_forbidden', 'forbidden')
    };
  }
  if (options.dryRun) return { plan, state };
  let current = state;
  const seenActionIds = new Set();
  for (const action of plan) {
    const key = createHash('sha256')
      .update(`${state.run_id}:${action.id}:${state.current_head_sha}`)
      .digest('hex');
    if (!isCanonicalAction(action, state, key)
      || seenActionIds.has(action.id)
      || !dependenciesCompleted(current, action, state)
      || typeof options.runners?.[action.id] !== 'function') {
      current = stop(current, action, key, 'blocked', 'action_forbidden', 'forbidden');
      break;
    }
    seenActionIds.add(action.id);
    const completed = hasCompletedCheckpoint(current, action.id, state);
    if (completed) continue;
    try {
      const result = await options.runners[action.id]({ state: current, action });
      const journal = append(current, action, key, result?.status === 'failed' ? 'failed' : 'completed', result);
      if (result?.status === 'pr_ready') {
        current = transition(journal, 'pr_ready', null);
        break;
      }
      if (['blocked', 'waiting_for_human', 'waiting_for_runtime', 'failed'].includes(result?.status)) {
        const recovery = buildRecovery(current, result.recovery);
        current = transition(journal, result.status, result.stop_reason ?? 'action_failed', { recovery });
        break;
      }
      current = journal;
      await options.onProgress?.(current);
    } catch (error) {
      current = stop(current, action, key, 'failed', 'action_failed', 'failed', error.message, {
        recovery: buildRecovery(current, { failure: error.message })
      });
      break;
    }
  }
  return { plan, state: current };
}

function isAllowedCanonicalPlan(plan, canonicalPlan) {
  return isCompleteCanonicalPlan(plan, canonicalPlan)
    || (Array.isArray(plan) && plan.length > 0
      && canonicalPlan.some((_, start) => plan.length === canonicalPlan.length - start
        && plan.every((action, index) => isExactCanonicalAction(action, canonicalPlan[start + index]))));
}

function isCompleteCanonicalPlan(plan, canonicalPlan) {
  return Array.isArray(plan)
    && plan.length === canonicalPlan.length
    && plan.every((action, index) => isExactCanonicalAction(action, canonicalPlan[index]));
}

function isExactCanonicalAction(action, canonical) {
  return Boolean(action && canonical)
    && action.id === canonical.id
    && action.classification === canonical.classification
    && Array.isArray(action.depends_on)
    && action.depends_on.length === canonical.depends_on.length
    && action.depends_on.every((dependency, index) => dependency === canonical.depends_on[index])
    && action.node_id === canonical.node_id
    && action.input_head_sha === canonical.input_head_sha
    && action.idempotency_key === canonical.idempotency_key;
}

function dependenciesCompleted(current, action, state) {
  return action.depends_on.every((dependency) => hasCompletedCheckpoint(current, dependency, state));
}

function hasCompletedCheckpoint(current, actionId, state) {
  const key = createHash('sha256')
    .update(`${state.run_id}:${actionId}:${state.current_head_sha}`)
    .digest('hex');
  return current.action_journal.some((entry) => entry.idempotency_key === key
    && entry.status === 'completed'
    && entry.action_id === actionId
    && entry.node_id === actionId
    && entry.input_head_sha === state.current_head_sha);
}

function isCanonicalAction(action, state, expectedKey) {
  const canonical = REGISTRY.find((entry) => entry.id === action?.id);
  return Boolean(canonical)
    && action.classification === canonical.classification
    && Array.isArray(action.depends_on)
    && action.depends_on.length === canonical.depends_on.length
    && action.depends_on.every((dependency, index) => dependency === canonical.depends_on[index])
    && (action.node_id === undefined || action.node_id === canonical.id)
    && (action.input_head_sha === undefined || action.input_head_sha === state.current_head_sha)
    && (action.idempotency_key === undefined || action.idempotency_key === expectedKey);
}

function append(state, action, key, status, result = {}) {
  const now = new Date().toISOString();
  return {
    ...state,
    action_journal: [...state.action_journal, {
      action_id: action.id,
      node_id: action.node_id ?? action.id,
      input_head_sha: state.current_head_sha,
      output_head_sha: result.output_head_sha ?? state.current_head_sha,
      idempotency_key: key,
      status,
      artifact: result.artifact ?? null,
      result_summary: result.summary ?? result.stop_reason ?? result.status ?? null,
      started_at: now,
      completed_at: now
    }]
  };
}

function transition(state, status, code, details = {}) {
  return {
    ...state,
    status,
    stop_reason: code ? { code, message: code, details: details ?? {} } : null
  };
}

function stop(state, action, key, status, code, journalStatus, summary = code, details = {}) {
  return transition(append(state, action, key, journalStatus, { summary }), status, code, details);
}

function buildRecovery(state, details = {}) {
  const repoRoot = state.execution_context?.root_realpath ?? '.';
  return {
    ...(details ?? {}),
    next_command: `vibepro execute resume ${shellQuote(repoRoot)} --story-id ${state.story_id} --run-id ${state.run_id} --until pr-ready`
  };
}

function shellQuote(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}
