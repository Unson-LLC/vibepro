import { createHash } from 'node:crypto';
import { selectNextBestAction } from './next-best-action-controller.js';
import { assertRunLineageBinding, createRunLineageEnvelope } from './run-lineage.js';

const LEGACY_REGISTRY = Object.freeze([
  Object.freeze({ id: 'pr_prepare', classification: 'repo_local_safe', depends_on: [] }),
  Object.freeze({ id: 'pr_autopilot_safe', classification: 'repo_local_safe', depends_on: ['pr_prepare'] })
]);
const AUTONOMOUS_REGISTRY = Object.freeze([
  Object.freeze({ id: 'diagnose', classification: 'repo_local_safe', depends_on: [] }),
  Object.freeze({ id: 'prepare_artifacts', classification: 'agent_runtime_guarded', depends_on: ['diagnose'] }),
  Object.freeze({ id: 'implement', classification: 'agent_runtime_guarded', depends_on: ['prepare_artifacts'] }),
  Object.freeze({ id: 'verify', classification: 'repo_local_safe', depends_on: ['implement'] }),
  Object.freeze({ id: 'review', classification: 'agent_runtime_read_only', depends_on: ['verify'] }),
  Object.freeze({ id: 'repair', classification: 'agent_runtime_guarded', depends_on: ['review'] }),
  Object.freeze({ id: 'final_prepare', classification: 'repo_local_safe', depends_on: ['repair'] })
]);
const ACTION_PROFILES = Object.freeze({ legacy: LEGACY_REGISTRY, autonomous: AUTONOMOUS_REGISTRY });
const HUMAN_DECISION_FIELDS = Object.freeze([
  'type',
  'question',
  'choices',
  'material_reason',
  'impact_scope',
  'source_refs',
  'stop_node_id'
]);
const HUMAN_DECISION_TYPES = new Set([
  'clarification',
  'scope_split',
  'waiver_request',
  'external_side_effect',
  'security_boundary'
]);
const ESCAPE_REGISTRY = Object.freeze([
  Object.freeze({ id: 'ask', classification: 'approval_required' }),
  Object.freeze({ id: 'split', classification: 'approval_required' }),
  Object.freeze({ id: 'wait', classification: 'approval_required' }),
  Object.freeze({ id: 'stop', classification: 'approval_required' }),
  Object.freeze({ id: 'rediagnose', classification: 'approval_required' })
]);

export function buildSafeActionPlan(state, options = {}) {
  const profile = resolveActionProfile(state, options.profile, options);
  return ACTION_PROFILES[profile].map((action) => {
    const lineage = resolveActionLineage(state, state.lineage ?? state.run_lineage, `action-${action.id}`);
    return {
      ...action,
      ...(lineage ? { lineage } : {}),
      ...(profile === 'legacy' ? {} : { action_profile: profile }),
      node_id: action.id,
      input_head_sha: state.current_head_sha,
      idempotency_key: actionKey(state, action.id, profile)
    };
  });
}

export function selectSafeActionCandidate(state, options = {}) {
  const profile = resolveActionProfile(state, options.profile, options);
  const candidates = buildSafeActionPlan(state, { ...options, profile })
    .filter((action) => !hasCompletedCheckpoint(state, action.id, state, profile))
    .map((action) => ({
      action_id: action.id,
      classification: action.classification,
      policy_allowed: !new Set(options.policyDeniedActionIds ?? []).has(action.id),
      dependency_ready: dependenciesCompleted(state, action, state, profile),
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
  const profile = resolveActionProfile(state, options.profile, options);
  const plan = options.plan ?? buildSafeActionPlan(state, { profile });
  const canonicalPlan = buildSafeActionPlan(state, { profile });
  if (!isAllowedCanonicalPlan(plan, canonicalPlan)) {
    const providedPlan = Array.isArray(plan) ? plan : [];
    const rejectedAction = providedPlan.find((action, index) => !isExactCanonicalAction(action, canonicalPlan[index]))
      ?? canonicalPlan[providedPlan.length]
      ?? canonicalPlan[0];
    const key = rejectedAction.idempotency_key ?? actionKey(state, rejectedAction.id, profile);
    return {
      plan,
      state: stop(state, rejectedAction, key, 'blocked', 'action_forbidden', 'forbidden')
    };
  }
  if (options.dryRun) return { plan, state };
  const executionState = profile === 'legacy' ? state : { ...state, action_profile: profile };
  let current = executionState;
  const seenActionIds = new Set();
  let activePlan = plan;
  let replayDependencyBypass = null;
  const replayRequiredActionIds = new Set();
  let replayCount = 0;
  for (let index = 0; index < activePlan.length; index += 1) {
    const action = activePlan[index];
    const key = actionKey(current, action.id, profile);
    const policyDenied = new Set(options.policyDeniedActionIds ?? []).has(action.id);
    if (!isCanonicalAction(action, current, key, profile)
      || seenActionIds.has(action.id)
      || (replayDependencyBypass !== action.id && !dependenciesCompleted(current, action, current, profile))
      || policyDenied
      || typeof options.runners?.[action.id] !== 'function') {
      current = stop(current, action, key, 'blocked', 'action_forbidden', 'forbidden');
      break;
    }
    seenActionIds.add(action.id);
    const replayRequired = replayRequiredActionIds.delete(action.id);
    const completed = !replayRequired && hasCompletedCheckpoint(current, action.id, current, profile);
    if (completed) continue;
    try {
      const persistCheckpoint = async (checkpoint) => {
        if (!Array.isArray(checkpoint)) throw new TypeError('Safe action checkpoint must be an array');
        await options.onCheckpoint?.({
          state: current,
          action,
          checkpoint: checkpoint.map((entry) => ({ ...entry }))
        });
      };
      const rawResult = await options.runners[action.id]({ state: current, action, persistCheckpoint });
      const result = profile === 'legacy' && rawResult?.status === undefined
        ? { ...(rawResult ?? {}), status: 'continue' }
        : rawResult;
      assertActionResult(result);
      const humanDecision = profile === 'autonomous'
        ? validateHumanDecisionResult(result, action)
        : null;
      const replayFrom = validateReplayRequest(result, action, profile);
      // Runner output is untrusted: always bind action evidence and any suffix
      // rebinding to the repository HEAD resolved after the runner completes.
      const resolvedHead = await options.resolveCurrentHead?.({ state: current, action, result })
        ?? current.current_head_sha;
      if (result.output_head_sha !== undefined && result.output_head_sha !== resolvedHead) {
        throw new Error(`Safe action output HEAD does not match the authoritative current HEAD: reported=${result.output_head_sha} actual=${resolvedHead}`);
      }
      const boundResult = { ...result, output_head_sha: resolvedHead };
      if (result.status === 'pr_ready' && profile === 'autonomous' && action.id !== 'final_prepare') {
        throw new Error(`Only autonomous final_prepare may return pr_ready: ${action.id}`);
      }
      if (profile === 'autonomous' && action.id === 'final_prepare' && result.status === 'continue') {
        throw new Error('Autonomous final_prepare must return pr_ready or a typed stop');
      }
      const journalStatus = profile === 'legacy'
        ? (result.status === 'failed' ? 'failed' : 'completed')
        : (['continue', 'pr_ready'].includes(result.status) ? 'completed' : 'failed');
      const lineage = resolveActionLineage(current, action.lineage, `action-${action.id}`);
      let journal = append(current, action, key, journalStatus, { ...boundResult, lineage });
      if (resolvedHead !== current.current_head_sha) {
        journal = { ...journal, current_head_sha: resolvedHead };
        const canonical = buildSafeActionPlan(journal, { profile });
        const actionPosition = canonical.findIndex((entry) => entry.id === action.id);
        activePlan = [...activePlan.slice(0, index + 1), ...canonical.slice(actionPosition + 1)];
      }
      if (replayFrom) {
        replayCount += 1;
        if (replayCount > (options.maxRepairReplays ?? 3)) {
          throw new Error('Autonomous repair replay limit exceeded');
        }
        const canonical = buildSafeActionPlan(journal, { profile });
        const replayPosition = canonical.findIndex((entry) => entry.id === replayFrom);
        const replaySuffix = canonical.slice(replayPosition);
        for (const entry of replaySuffix) {
          seenActionIds.delete(entry.id);
          replayRequiredActionIds.add(entry.id);
        }
        activePlan = [...activePlan.slice(0, index + 1), ...replaySuffix];
        replayDependencyBypass = replayFrom;
      } else if (replayDependencyBypass === action.id) {
        replayDependencyBypass = null;
      }
      if (result?.status === 'pr_ready') {
        current = transition(journal, 'pr_ready', null);
        break;
      }
      if (['blocked', 'waiting_for_human', 'waiting_for_runtime', 'failed'].includes(result?.status)) {
        const recovery = buildRecovery(current, result.recovery);
        current = transition(journal, result.status, result.stop_reason ?? 'action_failed', { recovery });
        if (humanDecision) current = { ...current, pending_decision_request: humanDecision };
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
    && action.action_profile === canonical.action_profile
    && Array.isArray(action.depends_on)
    && action.depends_on.length === canonical.depends_on.length
    && action.depends_on.every((dependency, index) => dependency === canonical.depends_on[index])
    && action.node_id === canonical.node_id
    && action.input_head_sha === canonical.input_head_sha
    && action.idempotency_key === canonical.idempotency_key;
}

function dependenciesCompleted(current, action, state, profile = state.action_profile ?? 'legacy') {
  return action.depends_on.every((dependency) => hasCompletedCheckpoint(current, dependency, state, profile));
}

function hasCompletedCheckpoint(current, actionId, state, profile = state.action_profile ?? 'legacy') {
  const key = actionKey(state, actionId, profile);
  return current.action_journal.some((entry) => (entry.idempotency_key === key
      || (entry.output_head_sha === state.current_head_sha
        && entry.idempotency_key === actionKey({ ...state, current_head_sha: entry.input_head_sha }, actionId, profile)))
    && entry.status === 'completed'
    && entry.action_id === actionId
    && entry.node_id === actionId
    && (profile === 'legacy' || entry.action_profile === profile)
    && (entry.input_head_sha === state.current_head_sha || entry.output_head_sha === state.current_head_sha));
}

function isCanonicalAction(action, state, expectedKey, profile) {
  const canonical = ACTION_PROFILES[profile].find((entry) => entry.id === action?.id);
  return Boolean(canonical)
    && action.classification === canonical.classification
    && (profile === 'legacy' ? action.action_profile === undefined : action.action_profile === profile)
    && Array.isArray(action.depends_on)
    && action.depends_on.length === canonical.depends_on.length
    && action.depends_on.every((dependency, index) => dependency === canonical.depends_on[index])
    && (action.node_id === undefined || action.node_id === canonical.id)
    && (action.input_head_sha === undefined || action.input_head_sha === state.current_head_sha)
    && (action.idempotency_key === undefined || action.idempotency_key === expectedKey);
}

function resolveActionProfile(state, requestedProfile, options = {}) {
  const profile = requestedProfile ?? state.action_profile ?? 'legacy';
  if (profile === 'autonomous' && options.autonomousEnabled === false) return 'legacy';
  if (!Object.hasOwn(ACTION_PROFILES, profile)) throw new Error(`Unknown safe action profile: ${profile}`);
  return profile;
}

function assertActionResult(result) {
  const statuses = new Set(['continue', 'pr_ready', 'waiting_for_human', 'waiting_for_runtime', 'blocked', 'failed']);
  if (!result || !statuses.has(result.status)) throw new Error(`Invalid safe action result status: ${result?.status ?? 'missing'}`);
}

function validateHumanDecisionResult(result, action) {
  if (result.status !== 'waiting_for_human') {
    if (result.human_decision !== undefined) {
      throw new Error('human_decision is allowed only with waiting_for_human');
    }
    return null;
  }
  const decision = result.human_decision;
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new Error('waiting_for_human requires a seven-field human_decision descriptor');
  }
  const keys = Object.keys(decision).sort();
  const expected = [...HUMAN_DECISION_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('human_decision must contain exactly the seven bounded fields');
  }
  if (!HUMAN_DECISION_TYPES.has(decision.type)
      || typeof decision.question !== 'string' || !decision.question.trim()
      || !Array.isArray(decision.choices)
      || decision.choices.length < 2
      || decision.choices.some((choice) => typeof choice !== 'string' || !choice.trim())
      || typeof decision.material_reason !== 'string' || !decision.material_reason.trim()
      || !Array.isArray(decision.impact_scope) || decision.impact_scope.length === 0
      || decision.impact_scope.some((scope) => typeof scope !== 'string' || !scope.trim())
      || !Array.isArray(decision.source_refs) || decision.source_refs.length === 0
      || decision.source_refs.some((ref) => typeof ref !== 'string' || !ref.trim())
      || decision.stop_node_id !== action.id) {
    throw new Error('human_decision contains invalid bounded field values');
  }
  return { ...decision };
}

function validateReplayRequest(result, action, profile) {
  if (result.replay_from_action_id === undefined) return null;
  if (profile !== 'autonomous'
      || action.id !== 'repair'
      || result.status !== 'continue'
      || result.replay_from_action_id !== 'verify') {
    throw new Error('Only a successful autonomous repair may replay from verify');
  }
  return result.replay_from_action_id;
}

function append(state, action, key, status, result = {}) {
  const now = new Date().toISOString();
  const lineage = result.lineage ?? resolveActionLineage(state, action.lineage, `action-${action.id}`);
  return {
    ...state,
    action_journal: [...state.action_journal, {
      action_id: action.id,
      ...((action.action_profile ?? state.action_profile ?? 'legacy') === 'legacy'
        ? {}
        : { action_profile: action.action_profile ?? state.action_profile }),
      node_id: action.node_id ?? action.id,
      input_head_sha: state.current_head_sha,
      output_head_sha: result.output_head_sha ?? state.current_head_sha,
      idempotency_key: key,
      status,
      artifact: result.artifact ?? null,
      result_summary: result.summary ?? result.stop_reason ?? result.status ?? null,
      ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
      ...(lineage ? { lineage } : {}),
      started_at: now,
      completed_at: now
    }]
  };
}

function resolveActionLineage(state, supplied, dispatchId) {
  const source = state.runAuthority ?? state.activeRun ?? state.run ?? state;
  const authority = {
    ...source,
    story_id: source.story_id ?? source.storyId,
    run_id: source.run_id ?? source.runId,
    worktree_root: source.worktree_root ?? source.root_realpath ?? source.execution_context?.root_realpath,
    branch: source.branch ?? source.current_branch ?? source.execution_context?.branch,
    head_sha: source.head_sha ?? source.current_head_sha
  };
  if (!supplied && !['story_id', 'run_id', 'worktree_root', 'branch', 'head_sha'].every((field) => authority[field])) return null;
  const lineage = supplied
    ? assertRunLineageBinding(supplied, authority)
    : createRunLineageEnvelope({ ...authority, dispatch_id: authority.dispatch_id ?? dispatchId });
  return assertRunLineageBinding(lineage, {
    story_id: state.story_id,
    run_id: state.run_id,
    worktree_root: state.execution_context?.root_realpath,
    branch: state.branch ?? state.current_branch ?? state.execution_context?.branch,
    head_sha: state.current_head_sha
  });
}

function actionKey(state, actionId, profile) {
  const profileSegment = profile === 'legacy' ? '' : `:${profile}`;
  return createHash('sha256')
    .update(`${state.run_id}${profileSegment}:${actionId}:${state.current_head_sha}`)
    .digest('hex');
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
