import { createHash } from 'node:crypto';

const REGISTRY = Object.freeze([
  Object.freeze({ id: 'pr_prepare', classification: 'repo_local_safe', depends_on: [] }),
  Object.freeze({ id: 'pr_autopilot_safe', classification: 'repo_local_safe', depends_on: ['pr_prepare'] })
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

export async function runSafeActionPlan(state, options = {}) {
  const plan = options.plan ?? buildSafeActionPlan(state);
  if (options.dryRun) return { plan, state };
  let current = state;
  for (const action of plan) {
    const key = action.idempotency_key ?? createHash('sha256')
      .update(`${state.run_id}:${action.id}:${state.current_head_sha}`)
      .digest('hex');
    const completed = current.action_journal.some((entry) => entry.idempotency_key === key && entry.status === 'completed');
    if (completed) continue;
    if (action.classification !== 'repo_local_safe' || typeof options.runners?.[action.id] !== 'function') {
      current = stop(current, action, key, 'blocked', 'action_forbidden', 'forbidden');
      break;
    }
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
