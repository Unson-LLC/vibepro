import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { RECOVERABLE_RUNTIME_STOP_CODES } from './guarded-stop-codes.js';
import { startExecution as defaultStartExecution } from './execution-state.js';
import { resolveGitIdentity as defaultResolveGitIdentity } from './git-identity.js';
import { createHumanDecision, HumanDecisionError, resolveHumanDecision } from './human-decision-checkpoint.js';
import {
  evaluateGateReadiness as defaultReadGateReadiness,
  preparePullRequest as defaultPreparePullRequest,
  safeAutopilotPullRequest as defaultSafeAutopilotPullRequest
} from './pr-manager.js';
import { buildSafeActionPlan, runSafeActionPlan, selectSafeActionCandidate } from './safe-action-orchestrator.js';
import { assertProviderIdentityUniqueness } from './run-lineage.js';
import { refreshContextCapsuleForRun as defaultRefreshContextCapsule } from './run-context-capsule.js';
import { getWorkspaceDir } from './workspace.js';

export const GUARDED_RUN_SCHEMA_VERSION = '0.2.0';
export const GUARDED_RUN_TARGET = 'pr_ready';
export const GUARDED_AUTONOMY_MODE = 'guarded';

const STORY_ID_PATTERN = /^story-[a-z0-9][a-z0-9._-]*$/;
const RUN_ID_PATTERN = /^run-\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const STATUS_VALUES = new Set([
  'running',
  'waiting_for_human',
  'waiting_for_runtime',
  'blocked',
  'failed',
  'cancelled',
  'pr_ready'
]);
const RECOVERABLE_STATUSES = new Set([
  'waiting_for_human',
  'waiting_for_runtime',
  'blocked',
  'failed'
]);
const AUTHORITY_KINDS = new Set(['managed', 'repository', 'source_fallback']);
const DEPENDENCY_KEYS = new Set([
  'now',
  'randomBytes',
  'startExecution',
  'readGateReadiness',
  'refreshContextCapsule',
  'artifactIo',
  'resolveGitIdentity',
  'preparePullRequest',
  'safeAutopilotPullRequest',
  'actionRunners',
  'agentRuntimeCoordinator',
  'recordAgentReview'
]);
const ARTIFACT_IO_KEYS = new Set(['readFile', 'writeFile', 'rename', 'mkdir', 'readdir', 'rm']);
const ACTION_RUNNER_KEYS = new Set(['diagnose', 'prepare_artifacts', 'implement', 'verify', 'review', 'repair', 'final_prepare']);

const defaultArtifactIo = { readFile, writeFile, rename, mkdir, readdir, rm };

export class GuardedRunError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GuardedRunError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      status: 'error',
      stop_reason: {
        code: this.code,
        message: this.message,
        details: this.details
      }
    };
  }
}

export function createGuardedRunSession(dependencies = {}) {
  assertClosedKeys(dependencies, DEPENDENCY_KEYS, 'guarded Run dependency');
  assertClosedKeys(dependencies.artifactIo ?? {}, ARTIFACT_IO_KEYS, 'guarded Run artifact I/O dependency');
  assertClosedKeys(dependencies.actionRunners ?? {}, ACTION_RUNNER_KEYS, 'guarded Run action runner');
  const deps = {
    now: dependencies.now ?? (() => new Date()),
    randomBytes: dependencies.randomBytes ?? nodeRandomBytes,
    startExecution: dependencies.startExecution ?? defaultStartExecution,
    readGateReadiness: dependencies.readGateReadiness ?? defaultReadGateReadiness,
    refreshContextCapsule: dependencies.refreshContextCapsule ?? defaultRefreshContextCapsule,
    resolveGitIdentity: dependencies.resolveGitIdentity ?? defaultResolveGitIdentity,
    preparePullRequest: dependencies.preparePullRequest ?? defaultPreparePullRequest,
    safeAutopilotPullRequest: dependencies.safeAutopilotPullRequest ?? defaultSafeAutopilotPullRequest,
    actionRunners: { ...(dependencies.actionRunners ?? {}) },
    agentRuntimeCoordinator: dependencies.agentRuntimeCoordinator ?? null,
    recordAgentReview: dependencies.recordAgentReview ?? null,
    artifactIo: { ...defaultArtifactIo, ...(dependencies.artifactIo ?? {}) }
  };

  return {
    run: (repoRoot, options = {}) => createRun(deps, repoRoot, options),
    status: (repoRoot, options = {}) => readRun(deps, repoRoot, options),
    watch: (repoRoot, options = {}) => watchRun(deps, repoRoot, options),
    resume: (repoRoot, options = {}) => resumeRun(deps, repoRoot, options),
    cancel: (repoRoot, options = {}) => cancelRun(deps, repoRoot, options),
    transition: (repoRoot, options = {}) => transitionRun(deps, repoRoot, options),
    orchestrate: (repoRoot, options = {}) => orchestrateRun(deps, repoRoot, options),
    dispatchRuntime: (repoRoot, options = {}) => mutateRuntimeDispatch(deps, repoRoot, options, 'dispatch'),
    pollRuntime: (repoRoot, options = {}) => mutateRuntimeDispatch(deps, repoRoot, options, 'poll'),
    cancelRuntime: (repoRoot, options = {}) => mutateRuntimeDispatch(deps, repoRoot, options, 'cancel'),
    recordRuntimeReview: (repoRoot, options = {}) => recordRuntimeReview(deps, repoRoot, options)
  };
}

async function mutateRuntimeDispatch(deps, repoRoot, options, operation) {
  if (!deps.agentRuntimeCoordinator) {
    throw new GuardedRunError('runtime_unavailable', 'Guarded Run has no provider-neutral agent runtime coordinator');
  }
  const loaded = await loadSelectedRun(deps, repoRoot, options, { requireCurrentHead: operation === 'dispatch' });
  const dispatchAuthority = runtimeDispatchAuthority(loaded.state);
  if (operation === 'dispatch' && dispatchAuthority.error) {
    throw contractError('worktree_mismatch', dispatchAuthority.error, {
      run_id: loaded.state.run_id,
      expected_authority_kind: loaded.state.execution_context?.authority_kind ?? null
    });
  }
  const authorityRoot = dispatchAuthority.root_realpath;
  if (operation === 'dispatch' && options.request?.requirements?.managed_worktree !== authorityRoot) {
    throw new GuardedRunError('worktree_mismatch', 'runtime dispatch must target the Guarded Run managed worktree', {
      expected: authorityRoot,
      actual: options.request?.requirements?.managed_worktree ?? null
    });
  }
  const currentDispatch = operation === 'dispatch'
    ? null
    : (loaded.state.runtime_dispatches ?? []).find((item) => item.dispatch_id === options.dispatchId);
  if (operation !== 'dispatch' && !currentDispatch) {
    throw new GuardedRunError('runtime_dispatch_not_found', `runtime dispatch not found: ${options.dispatchId}`);
  }
  const identityBefore = await resolveIdentity(deps, authorityRoot, 'worktree_mismatch');
  if (currentDispatch?.role === 'review' && identityBefore.head_sha !== loaded.state.current_head_sha) {
    throw new GuardedRunError('stale_head', 'Review runtime cannot continue after the authoritative worktree HEAD changes', {
      expected_head_sha: loaded.state.current_head_sha,
      actual_head_sha: identityBefore.head_sha
    });
  }
  const providerIdentityRecords = await readPersistedProviderIdentityRecords(deps, loaded.authorityIdentity.root_realpath);
  let result = operation === 'dispatch'
    ? await dispatchRuntimeWithFallbacks(deps.agentRuntimeCoordinator, loaded.state, options.request, { providerIdentityRecords })
    : await deps.agentRuntimeCoordinator[operation](loaded.state, options.dispatchId, { providerIdentityRecords });
  if (result.state.status !== loaded.state.status) {
    const nextStatus = result.state.status;
    result = {
      ...result,
      state: applyTransition(
        { ...result.state, status: loaded.state.status, transitions: loaded.state.transitions },
        nextStatus,
        `agent_runtime_${operation}`,
        toIso(deps.now()),
        { stop_reason: result.state.stop_reason ?? null }
      )
    };
  }
  if (operation === 'poll' && result.dispatch?.role === 'implementation' && result.dispatch.status === 'completed') {
    const actualIdentity = await resolveIdentity(deps, authorityRoot, 'worktree_mismatch');
    if (result.dispatch.result?.head_sha !== actualIdentity.head_sha) {
      throw new GuardedRunError('runtime_head_mismatch', 'Implementation result HEAD must match the authoritative managed worktree HEAD', {
        reported_head_sha: result.dispatch.result?.head_sha ?? null,
        actual_head_sha: actualIdentity.head_sha
      });
    }
    const reboundLineage = result.dispatch.lineage
      ? { ...result.dispatch.lineage, head_sha: actualIdentity.head_sha }
      : null;
    const reboundDispatch = reboundLineage
      ? { ...result.dispatch, lineage: reboundLineage }
      : result.dispatch;
    result = {
      ...result,
      dispatch: reboundDispatch,
      state: {
        ...result.state,
        current_head_sha: actualIdentity.head_sha,
        runtime_dispatches: (result.state.runtime_dispatches ?? []).map((dispatch) =>
          dispatch.dispatch_id === reboundDispatch.dispatch_id ? reboundDispatch : dispatch)
      }
    };
  }
  if (operation === 'poll' && !result.reused && result.dispatch?.status === 'completed' && result.dispatch.result?.usage_accounting) {
    result = {
      ...result,
      state: {
        ...result.state,
        usage_accounting: mergeUsageAccounting(
          loaded.state.usage_accounting,
          result.dispatch.result.usage_accounting,
          toIso(deps.now())
        )
      }
    };
  }
  await persistAuthorityThenMirror(
    deps,
    result.state,
    loaded.authorityFile,
    loaded.mirrorFile,
    `agent_runtime_${operation}`
  );
  return result;
}

function runtimeDispatchAuthority(state) {
  const kind = state?.execution_context?.authority_kind;
  const managed = state?.managed_worktree;
  if (kind === 'managed') {
    if (!managed?.path || !managed?.branch) {
      return { root_realpath: null, error: 'Guarded Run managed worktree authority is incomplete' };
    }
    return { root_realpath: managed.path, branch: managed.branch, error: null };
  }
  if (kind === 'repository' || kind === 'source_fallback') {
    if (!state?.execution_context?.root_realpath) {
      return { root_realpath: null, error: 'Guarded Run repository authority is incomplete' };
    }
    return { root_realpath: state.execution_context.root_realpath, branch: null, error: null };
  }
  return { root_realpath: null, error: 'Guarded Run authority kind is incomplete' };
}

const FALLBACK_RUNTIME_STOP_CODES = new Set([
  'runtime_unavailable',
  'quota_exceeded',
  'auth_denied',
  'runtime_probe_timeout',
  'review_readonly_unavailable'
]);

async function dispatchRuntimeWithFallbacks(coordinator, state, request, options = {}) {
  const adapterIds = [...new Set([request?.adapter_id, ...(state.provider_fallbacks ?? [])])]
    .filter((adapterId) => typeof adapterId === 'string' && adapterId.length > 0);
  let currentState = state;
  let result = null;
  for (const adapterId of adapterIds) {
    result = await coordinator.dispatch(currentState, { ...request, adapter_id: adapterId }, options);
    currentState = result.state;
    const fallbackAllowed = result.dispatch?.provider_run_id === null
      && FALLBACK_RUNTIME_STOP_CODES.has(result.dispatch?.stop_reason?.code);
    if (!fallbackAllowed) return result;
  }
  return result;
}

async function recordRuntimeReview(deps, repoRoot, options) {
  if (!deps.recordAgentReview) {
    throw new GuardedRunError('review_runtime_unavailable', 'Guarded Run has no Agent Review recording boundary');
  }
  const loaded = await loadSelectedRun(deps, repoRoot, options, { requireCurrentHead: true });
  const dispatch = (loaded.state.runtime_dispatches ?? []).find((item) => item.dispatch_id === options.dispatchId);
  const provenance = validateRuntimeReviewDispatch(dispatch, loaded.state.current_head_sha);
  const review = await deps.recordAgentReview(loaded.state.execution_context.root_realpath, {
    ...(options.review ?? {}),
    storyId: loaded.state.story_id,
    agentSystem: options.review?.agentSystem ?? 'codex',
    executionMode: 'parallel_subagent',
    agentId: provenance.agent_identity,
    agentThreadId: provenance.thread_id,
    agentSessionId: provenance.session_id,
    agentClosed: true,
    reviewerIdentity: 'separate_session',
    implementationSessionId: dispatch.implementation_session_id
  });
  return { dispatch, review };
}

function validateRuntimeReviewDispatch(dispatch, currentHeadSha) {
  const result = dispatch?.result;
  const provenance = result?.review_provenance;
  const expectedDispatchId = dispatch && `dispatch-${createHash('sha256').update(`${dispatch.run_id}:${dispatch.adapter_id}:${dispatch.task_id}:${dispatch.role}:${dispatch.input_head_sha}:${dispatch.reviewer_identity ?? ''}:${dispatch.implementation_session_id ?? ''}`).digest('hex').slice(0, 16)}`;
  const correlatedRuntime = Boolean(dispatch?.session_id || dispatch?.thread_id)
    && provenance?.session_id === dispatch?.session_id
    && provenance?.thread_id === dispatch?.thread_id;
  const separateRuntime = correlatedRuntime
    && ![provenance?.session_id, provenance?.thread_id].includes(dispatch?.implementation_session_id);
  const valid = dispatch?.role === 'review'
    && dispatch.dispatch_id === expectedDispatchId
    && dispatch.status === 'completed'
    && dispatch.sandbox === 'read-only'
    && Array.isArray(dispatch.requirements?.capabilities)
    && dispatch.requirements.capabilities.includes('review')
    && !dispatch.requirements.capabilities.includes('workspace_write')
    && Array.isArray(result?.changed_files)
    && result.changed_files.length === 0
    && dispatch.input_head_sha === currentHeadSha
    && result.head_sha === currentHeadSha
    && provenance?.execution_mode === 'parallel_subagent'
    && provenance.agent_identity === dispatch.reviewer_identity
    && provenance.agent_identity === dispatch.agent_identity
    && provenance.agent_identity !== dispatch.implementation_identity
    && provenance.lifecycle === 'closed'
    && separateRuntime;
  if (!valid) {
    throw new GuardedRunError('invalid_runtime_review', 'only a current-HEAD, read-only, separately identified closed review dispatch can enter the Agent Review Gate');
  }
  return provenance;
}

async function orchestrateRun(deps, repoRoot, options) {
  if (options.dryRun) {
    const identity = await resolveIdentity(deps, repoRoot, 'worktree_mismatch');
    const preview = {
      run_id: 'dry-run',
      story_id: requireStoryId(options.storyId),
      current_head_sha: identity.head_sha,
      status: 'running',
      attempt: 1,
      action_profile: requireActionProfile(options.actionProfile ?? 'legacy'),
      action_journal: [],
      next_best_action_decisions: []
    };
    const decision = selectControllerCheckpoint(preview, options);
    return { ...(await runSafeActionPlan(preview, { dryRun: true })), decision };
  }
  const loaded = await loadSelectedRun(deps, repoRoot, options, { requireCurrentHead: true });
  if (loaded.state.status === 'cancelled' || loaded.state.status === 'pr_ready' || loaded.state.status === 'waiting_for_human') {
    return { plan: [], state: loaded.state };
  }
  const policyStop = evaluatePolicyStop(loaded.state, deps.now());
  if (policyStop) {
    const stopped = applyPolicyStop(loaded.state, policyStop, toIso(deps.now()));
    await persistAuthorityThenMirror(deps, stopped, loaded.authorityFile, loaded.mirrorFile, 'guarded_policy_stop');
    return { plan: [], state: stopped };
  }
  const previousDecision = loaded.state.next_best_action_decisions?.at(-1) ?? null;
  const decision = selectControllerCheckpoint(loaded.state, options, previousDecision);
  const resumePlan = buildResumeSafeActionPlan(loaded.state);
  const decisionState = {
    ...loaded.state,
    iteration: loaded.state.iteration + 1,
    next_best_action_decisions: [...(loaded.state.next_best_action_decisions ?? []), decision]
  };
  const controllerEnabled = process.env.VIBEPRO_NEXT_BEST_ACTION !== 'off';
  if (!resumePlan && controllerEnabled && isEscapeDecision(decision)) {
    const escaped = await applyControllerEscape(deps, loaded.state.execution_context.root_realpath, decisionState, decision, toIso(deps.now()));
    await persistAuthorityThenMirror(deps, escaped, loaded.authorityFile, loaded.mirrorFile, 'next_best_action_escape');
    return { plan: [decision.selected_action_id], decision, state: escaped };
  }
  await persistAuthorityThenMirror(
    deps,
    decisionState,
    loaded.authorityFile,
    loaded.mirrorFile,
    'next_best_action_checkpoint'
  );
  const selectedPlan = resumePlan ?? (!controllerEnabled
    ? undefined
    : buildSelectedSafeActionPlan(decisionState, decision.selected_action_id));
  const result = await runSafeActionPlan(decisionState, {
    profile: decisionState.action_profile ?? 'legacy',
    policyDeniedActionIds: options.policyDeniedActionIds,
    plan: selectedPlan,
    onProgress: async (progress) => {
      const checkpoint = {
        ...decisionState,
        action_journal: progress.action_journal,
        ...resumeCursorPatch(progress, decisionState)
      };
      await persistAuthorityThenMirror(
        deps,
        checkpoint,
        loaded.authorityFile,
        loaded.mirrorFile,
        'safe_action_checkpoint'
      );
    },
    runners: buildActionRunners(deps, loaded, options)
  });
  let next = {
    ...decisionState,
    action_journal: result.state.action_journal,
    ...resumeCursorPatch(result.state, decisionState)
  };
  let outcomeStatus = result.state.status;
  let outcomeStopReason = result.state.stop_reason;
  const currentIdentity = await resolveIdentity(deps, loaded.state.execution_context.root_realpath, 'worktree_mismatch');
  if (currentIdentity.head_sha !== loaded.state.current_head_sha) {
    const reboundAt = toIso(deps.now());
    next = {
      ...next,
      current_head_sha: currentIdentity.head_sha,
      action_journal: [
        ...next.action_journal,
        buildSystemActionEntry(next, 'rebind_head', loaded.state.current_head_sha, currentIdentity.head_sha, reboundAt)
      ]
    };
    await persistAuthorityThenMirror(
      deps,
      next,
      loaded.authorityFile,
      loaded.mirrorFile,
      'safe_action_head_rebind_checkpoint'
    );
    let currentPrepare = null;
    try {
      currentPrepare = await deps.preparePullRequest(loaded.state.execution_context.root_realpath, {
        storyId: loaded.state.story_id,
        baseRef: options.baseRef
      });
      next = {
        ...next,
        action_journal: [...next.action_journal, buildSystemActionEntry(
          next,
          'pr_prepare_current_head',
          currentIdentity.head_sha,
          currentIdentity.head_sha,
          toIso(deps.now())
        )]
      };
    } catch (error) {
      next = {
        ...next,
        action_journal: [...next.action_journal, buildSystemActionEntry(
          next,
          'pr_prepare_current_head',
          currentIdentity.head_sha,
          currentIdentity.head_sha,
          toIso(deps.now()),
          'failed',
          error.message
        )]
      };
      outcomeStatus = 'failed';
      outcomeStopReason = {
        code: 'gate_recheck_failed',
        message: 'Current HEAD Gate recheck failed before readiness could be established.',
        details: {
          recovery: {
            failure: error.message,
            next_command: `vibepro execute resume ${shellQuoteCommandArg(next.execution_context.root_realpath)} --story-id ${next.story_id} --run-id ${next.run_id} --until pr-ready`
          }
        }
      };
    }
    if (currentPrepare && currentPrepare.preparation?.gate_status?.ready_for_pr_create !== true) {
      outcomeStatus = 'blocked';
      outcomeStopReason = {
        code: 'gate_recheck_required',
        message: 'Current HEAD must satisfy the Gate DAG before pr_ready.',
        details: {
          current_head_sha: currentIdentity.head_sha,
          recovery: {
            required_actions: currentPrepare.preparation?.gate_status?.next_required_actions ?? [],
            next_command: `vibepro execute resume ${shellQuoteCommandArg(next.execution_context.root_realpath)} --story-id ${next.story_id} --run-id ${next.run_id} --until pr-ready`
          }
        }
      };
    }
  }
  if (outcomeStatus !== loaded.state.status) {
    next = applyTransition(next, outcomeStatus, 'safe_action_orchestrator', toIso(deps.now()), { stop_reason: outcomeStopReason });
  }
  await persistAuthorityThenMirror(deps, next, loaded.authorityFile, loaded.mirrorFile, 'safe_action_orchestrator');
  return { plan: result.plan, state: next };
}

function buildActionRunners(deps, loaded, options) {
  const repoRoot = loaded.state.execution_context.root_realpath;
  const storyId = loaded.state.story_id;
  const injected = deps.actionRunners;
  const unavailable = (actionId) => async () => ({
    status: 'waiting_for_runtime',
    stop_reason: 'runtime_required',
    summary: `${actionId} action owner is not connected`,
    recovery: { missing_action_runner: actionId }
  });
  const autonomous = Object.fromEntries([...ACTION_RUNNER_KEYS].map((id) => [id, injected[id] ?? unavailable(id)]));
  autonomous.verify = injected.verify ?? (async () => deps.safeAutopilotPullRequest(repoRoot, {
    storyId,
    baseRef: options.baseRef
  }));
  autonomous.final_prepare = injected.final_prepare ?? (async () => {
    const prepared = await deps.preparePullRequest(repoRoot, { storyId, baseRef: options.baseRef });
    if (prepared.preparation?.gate_status?.ready_for_pr_create === true) {
      return { status: 'pr_ready', artifact: prepared.artifacts?.json ?? null };
    }
    return {
      status: 'blocked',
      stop_reason: 'gate_recheck_required',
      artifact: prepared.artifacts?.json ?? null,
      recovery: { required_actions: prepared.preparation?.gate_status?.next_required_actions ?? [] }
    };
  });
  if ((loaded.state.action_profile ?? 'legacy') === 'autonomous') return autonomous;
  return {
    pr_prepare: async () => {
      const prepared = await deps.preparePullRequest(repoRoot, { storyId, baseRef: options.baseRef });
      return { status: 'continue', artifact: prepared.artifacts?.json ?? null };
    },
    pr_autopilot_safe: async () => deps.safeAutopilotPullRequest(repoRoot, { storyId, baseRef: options.baseRef })
  };
}

function hasCompletedResumeCheckpoint(state, resumeNodeId) {
  if (resumeNodeId == null) return false;
  return state.action_journal.some((entry) => entry.node_id === resumeNodeId
    && entry.input_head_sha === state.current_head_sha
    && entry.status === 'completed');
}

function resumeCursorPatch(progress, source) {
  if (!Object.hasOwn(source, 'resume_from_node_id')) return {};
  return {
    resume_from_node_id: hasCompletedResumeCheckpoint(progress, source.resume_from_node_id)
      ? null
      : source.resume_from_node_id
  };
}

function buildResumeSafeActionPlan(state) {
  if (state.resume_from_node_id == null) return null;
  const plan = buildSafeActionPlan(state);
  const start = plan.findIndex((action) => action.node_id === state.resume_from_node_id);
  if (start < 0) {
    throw contractError('invalid_resume_node', `Run cannot resume from unknown node: ${state.resume_from_node_id}.`, {
      run_id: state.run_id,
      resume_from_node_id: state.resume_from_node_id
    });
  }
  return plan.slice(start);
}

function isEscapeDecision(decision) {
  return ['ask', 'split', 'wait', 'stop', 'rediagnose'].includes(decision.selected_action_id);
}

function buildSelectedSafeActionPlan(state, actionId) {
  const plan = buildSafeActionPlan(state);
  const selectedIndex = plan.findIndex((action) => action.id === actionId);
  return selectedIndex >= 0 ? plan.slice(selectedIndex) : plan;
}

async function applyControllerEscape(deps, repoRoot, state, decision, timestamp) {
  const actionId = decision.selected_action_id;
  let humanDecision;
  try {
    humanDecision = await createHumanDecision(repoRoot, state, {
      type: actionId === 'split' ? 'scope_split' : 'clarification',
      question: `How should VibePro continue after the controller selected ${actionId}?`,
      material_reason: `The autonomous controller stopped after repeated no progress and selected ${actionId}.`,
      impact_scope: ['guarded_run', 'next_best_action'],
      source_refs: [`run:${state.run_id}`, `controller_action:${actionId}`]
    }, { now: deps.now });
  } catch (error) {
    if (!(error instanceof HumanDecisionError)) throw error;
    throw contractError(error.code, error.message, error.details);
  }
  const stopReason = {
    code: 'next_best_action_escape',
    message: `Controller selected ${actionId} after repeated no progress.`,
    details: {
      recovery: {
        required_actions: [`resolve controller escape action: ${actionId}`],
        next_command: `vibepro execute resume ${shellQuoteCommandArg(state.execution_context.root_realpath)} --story-id ${state.story_id} --run-id ${state.run_id} --decision ${humanDecision.decision_id} --answer <answer> --until pr-ready`
      }
    }
  };
  return applyTransition(state, 'waiting_for_human', 'next_best_action_escape', timestamp, {
    stop_reason: stopReason,
    pending_decision: {
      decision_id: humanDecision.decision_id,
      type: humanDecision.type,
      artifact: path.join('.vibepro', 'executions', state.story_id, 'runs', state.run_id, 'decisions', `${humanDecision.decision_id}.json`),
      stop_node_id: 'pr_prepare'
    }
  });
}

function selectControllerCheckpoint(state, options = {}, previousDecision = null) {
  const explicitNoProgress = Number.isInteger(options.noProgressCount);
  const base = {
    checkpointReason: options.checkpointReason ?? 'run_started',
    noProgressCount: explicitNoProgress ? options.noProgressCount : 0,
    stateDelta: options.stateDelta,
    metrics: options.actionMetrics,
    escapeActionIds: options.escapeActionIds ?? [],
    previousDecision
  };
  const probe = selectSafeActionCandidate(state, base);
  if (explicitNoProgress) {
    return selectSafeActionCandidate(state, {
      ...base,
      escapeActionIds: options.escapeActionIds
        ?? (options.noProgressCount >= 2 ? ['rediagnose', 'split', 'ask', 'stop'] : [])
    });
  }
  const unchangedCheckpoints = (state.next_best_action_decisions ?? [])
    .slice()
    .reverse()
    .findIndex((item) => item.state_fingerprint !== probe.state_fingerprint);
  const trailingMatches = unchangedCheckpoints === -1
    ? (state.next_best_action_decisions ?? []).length
    : unchangedCheckpoints;
  const noProgressCount = trailingMatches > 0 ? trailingMatches + 1 : 0;
  if (noProgressCount < 2) return probe;
  return selectSafeActionCandidate(state, {
    ...base,
    checkpointReason: 'no_progress',
    noProgressCount,
    escapeActionIds: options.escapeActionIds ?? ['rediagnose', 'split', 'ask', 'stop']
  });
}

function buildSystemActionEntry(state, actionId, inputHead, outputHead, timestamp, status = 'completed', summary = actionId) {
  return {
    action_id: actionId,
    node_id: actionId,
    input_head_sha: inputHead,
    output_head_sha: outputHead,
    idempotency_key: createHash('sha256').update(`${state.run_id}:${actionId}:${inputHead}`).digest('hex'),
    status,
    artifact: null,
    result_summary: summary,
    started_at: timestamp,
    completed_at: timestamp
  };
}

export function isGuardedRunError(error) {
  return error instanceof GuardedRunError;
}

export function renderGuardedRunSummary(value) {
  const state = value?.state ?? value;
  const plan = value?.state ? value.plan ?? [] : [];
  const stop = state.stop_reason
    ? `${state.stop_reason.code}: ${state.stop_reason.message}`
    : 'none';
  const binding = state.execution_context
    ? `${state.execution_context.authority_kind} ${state.execution_context.root_realpath} @ ${state.current_head_sha}`
    : 'unknown';
  const transitions = (state.transitions ?? [])
    .map((item) => `  ${item.sequence}. ${item.from ?? 'created'} -> ${item.to} (${item.reason}) at ${item.timestamp}`)
    .join('\n');
  const latestAction = state.action_journal?.at(-1);
  const latestActionSummary = latestAction
    ? `${latestAction.action_id} (${latestAction.status}): ${latestAction.result_summary ?? 'no summary'}`
    : 'none';
  const latestDecision = state.next_best_action_decisions?.at(-1);
  const latestDecisionSummary = latestDecision
    ? `${latestDecision.selected_action_id ?? 'none'} (${[
        latestDecision.outcome,
        latestDecision.selection_reason,
        `checkpoint=${latestDecision.checkpoint_reason}`,
        `no_progress=${latestDecision.no_progress_count}`
      ].filter(Boolean).join('; ')})`
    : 'none';
  const plannedActions = plan.length > 0
    ? plan.map((action) => `  - ${action.id} (${action.classification})`).join('\n')
    : '  none';
  const recovery = state.stop_reason?.details?.recovery;
  const pendingDecision = state.pending_decision;
  const now = Date.now();
  const elapsedMs = state.created_at ? Math.max(0, now - new Date(state.created_at).getTime()) : null;
  const automatedSteps = state.action_journal?.filter((entry) => entry.status === 'completed').length ?? 0;
  const humanInterruptions = state.human_decision_journal?.length ?? 0;
  const usage = state.usage_accounting ?? { total_tokens: null, cost_usd: null, status: 'unknown' };
  const efficiency = deriveRunEfficiencyMetrics(state);
  const fallbackNextCommand = state.execution_context?.root_realpath && state.story_id && state.run_id
    ? `vibepro execute status ${shellQuoteCommandArg(state.execution_context.root_realpath)} --story-id ${state.story_id} --run-id ${state.run_id}`
    : 'Inspect the persisted Guarded Run state before taking another action.';
  const recoveryDetailLines = recovery
    ? [
        ...(recovery.missing_kinds?.length ? [`- missing: ${recovery.missing_kinds.join(', ')}`] : []),
        ...(recovery.failed_kinds?.length ? [`- failed: ${recovery.failed_kinds.join(', ')}`] : []),
        ...(recovery.judgments?.length ? recovery.judgments.map((item) => `- judgment: ${item.kind ?? item.id ?? 'decision'} - ${item.reason ?? item.prompt ?? 'human decision required'}`) : []),
        ...(recovery.required_actions?.length ? recovery.required_actions.map((item) => `- required_action: ${item}`) : []),
        recovery.failure ? `- failure: ${recovery.failure}` : null,
        recovery.next_command ? `- next_command: ${recovery.next_command}` : null
      ].filter(Boolean)
    : [];
  const recoveryLines = recoveryDetailLines.length > 0
    ? recoveryDetailLines.join('\n')
    : ['waiting_for_human', 'waiting_for_runtime', 'blocked', 'failed'].includes(state.status)
      ? `- next_command: ${fallbackNextCommand}`
      : 'none';
  const pendingDecisionLines = pendingDecision
    ? [
        `- decision_id: ${pendingDecision.decision_id ?? pendingDecision.id ?? 'unknown'}`,
        `- question: ${pendingDecision.question ?? pendingDecision.prompt ?? 'human decision required'}`,
        `- material_reason: ${pendingDecision.material_reason ?? 'not provided'}`
      ].join('\n')
    : 'none';
  return `# VibePro Guarded Run\n\n- run_id: ${state.run_id}\n- story_id: ${state.story_id}\n- target: ${state.target}\n- autonomy: ${state.autonomy_mode}\n- status: ${state.status}\n- stop_reason: ${stop}\n- binding: ${binding}\n- attempt: ${state.attempt}/${state.budget?.max_attempts ?? 'unknown'}\n- iteration: ${state.iteration}/${state.budget?.max_iterations ?? 'unknown'}\n- elapsed_ms: ${elapsedMs ?? 'unknown'}\n- active_ms: ${efficiency.active_ms ?? 'unknown'}\n- wait_ms: ${efficiency.wait_ms ?? 'unknown'}\n- trusted_pr_ready_ms: ${efficiency.trusted_pr_ready_ms ?? 'unknown'}\n- automated_steps: ${automatedSteps}\n- human_interruptions: ${humanInterruptions}\n- full_suite_runs: ${efficiency.full_suite_count ?? 'unknown'}\n- evidence_reuse: ${efficiency.evidence_reuse_count ?? 'unknown'}\n- evidence_invalidations: ${efficiency.evidence_invalidation_count ?? 'unknown'}\n- accepted_defects: ${efficiency.accepted_defect_count ?? 'unknown'}\n- risk_reductions: ${efficiency.risk_reduction_count ?? 'unknown'}\n- tokens: ${usage.total_tokens ?? 'unknown'}\n- cost_usd: ${usage.cost_usd ?? 'unknown'}\n- usage_status: ${usage.status ?? 'unknown'}\n- efficiency_basis: trusted_pr_ready+accepted_defects+risk_reductions_vs_active_wait_token_cost\n- deadline: ${state.deadline ?? 'unknown'}\n- latest_action: ${latestActionSummary}\n- next_best_action: ${latestDecisionSummary}\n\n## Pending Decision\n\n${pendingDecisionLines}\n\n## Planned Actions\n\n${plannedActions}\n\n## Recovery\n\n${recoveryLines}\n\n## Transitions\n\n${transitions || '  none'}\n`;
}

export function deriveRunEfficiencyMetrics(state) {
  const transitions = state.transitions ?? [];
  let activeMs = 0;
  let waitMs = 0;
  let hasDuration = false;
  for (let index = 0; index < transitions.length; index += 1) {
    const current = transitions[index];
    const start = Date.parse(current.timestamp);
    const end = Date.parse(transitions[index + 1]?.timestamp ?? state.updated_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    hasDuration = true;
    const duration = end - start;
    if (current.to === 'running') activeMs += duration;
    else if (['waiting_for_human', 'waiting_for_runtime', 'blocked', 'failed'].includes(current.to)) waitMs += duration;
  }
  const actions = state.action_journal;
  const measuredCount = (metric) => {
    if (!Array.isArray(actions)) return null;
    const measurements = actions
      .filter((entry) => entry.status === 'completed' && isPlainRecord(entry.measurements))
      .map((entry) => entry.measurements[metric])
      .filter((value) => Number.isInteger(value) && value >= 0);
    return measurements.length > 0 ? measurements.reduce((total, value) => total + value, 0) : null;
  };
  const created = Date.parse(state.created_at);
  const updated = Date.parse(state.updated_at);
  return {
    story_id: state.story_id,
    run_id: state.run_id,
    trusted_pr_ready_ms: state.status === 'pr_ready' && Number.isFinite(created) && Number.isFinite(updated)
      ? Math.max(0, updated - created)
      : null,
    active_ms: hasDuration ? activeMs : null,
    wait_ms: hasDuration ? waitMs : null,
    total_tokens: state.usage_accounting?.total_tokens ?? null,
    cost_usd: state.usage_accounting?.cost_usd ?? null,
    full_suite_count: measuredCount('full_suite_count'),
    evidence_reuse_count: measuredCount('evidence_reuse_count'),
    evidence_invalidation_count: measuredCount('evidence_invalidation_count'),
    human_interruption_count: Array.isArray(state.human_decision_journal) ? state.human_decision_journal.length : null,
    accepted_defect_count: measuredCount('accepted_defect_count'),
    risk_reduction_count: measuredCount('risk_reduction_count')
  };
}

function shellQuoteCommandArg(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function renderGuardedRunError(error, options = {}) {
  const details = error.details ?? {};
  const repoRoot = options.repoRoot ?? '.';
  const lines = [
    '# VibePro Guarded Run Error',
    '',
    `- code: ${error.code}`,
    `- message: ${error.message}`
  ];
  for (const [label, key] of [
    ['run_id', 'run_id'],
    ['story_id', 'story_id'],
    ['artifact', 'artifact'],
    ['authority_artifact', 'authority_artifact'],
    ['mirror_artifact', 'mirror_artifact'],
    ['quarantine_artifact', 'quarantine_artifact'],
    ['lock_artifact', 'lock_artifact'],
    ['legacy_artifact', 'legacy_artifact'],
    ['cause', 'cause']
  ]) {
    if (details[key]) lines.push(`- ${label}: ${details[key]}`);
  }
  if (Array.isArray(details.rejected_candidates)) {
    for (const candidate of details.rejected_candidates) {
      lines.push(`- rejected_candidate: ${candidate.run_id} (${candidate.code}) ${candidate.artifact}`);
    }
  }
  if (['linked_copy_sync_failed', 'linked_copy_out_of_sync'].includes(error.code) && details.story_id && details.run_id) {
    lines.push(`- next_action: vibepro execute watch ${shellQuoteCommandArg(repoRoot)} --story-id ${shellQuoteCommandArg(details.story_id)} --run-id ${shellQuoteCommandArg(details.run_id)} --repair-linked-copy`);
  }
  if (error.code === 'run_selection_blocked') {
    lines.push('- next_action: rerun with --run-id <validated-run-id> after inspecting the rejected candidates');
  }
  return `${lines.join('\n')}\n`;
}

async function createRun(deps, repoRoot, options) {
  if (options.runId != null) {
    const suppliedRunId = requireRunId(options.runId);
    throw contractError('run_id_not_allowed', 'execute run generates its Run id; --run-id is not accepted.', {
      run_id: suppliedRunId,
      command: 'execute run'
    });
  }
  const storyId = requireStoryId(options.storyId);
  const creationRequestId = options.creationRequestId == null ? null : requireCreationRequestId(options.creationRequestId);
  const caller = await resolveIdentity(deps, repoRoot, 'worktree_mismatch');
  await assertRegisteredStory(deps, caller.root_realpath, storyId);
  const initialLegacy = await readLegacyState(deps, caller.root_realpath, storyId);
  const lockRoot = await resolveCreationLockRoot(deps, caller, initialLegacy);
  const lockPath = getCreationLockPath(lockRoot, storyId);
  await deps.artifactIo.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    await deps.artifactIo.mkdir(lockPath);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw contractError('run_creation_locked', 'Another guarded Run is being created for this Story.', {
        lock_artifact: lockPath
      });
    }
    throw error;
  }

  try {
    let legacy = await readLegacyState(deps, caller.root_realpath, storyId);
    let binding;
    if (legacy) {
      binding = await resolveCreationBinding(deps, caller, legacy);
    } else {
      try {
        const bootstrap = await deps.startExecution(caller.root_realpath, {
          storyId,
          target: options.legacyTarget ?? 'pr_create',
          baseRef: options.baseRef,
          branchName: options.branchName,
          worktreePath: options.worktreePath
        });
        legacy = bootstrap?.state ?? await readLegacyState(deps, caller.root_realpath, storyId);
      } catch (error) {
        const partial = await readLegacyState(deps, caller.root_realpath, storyId);
        if (!partial) throw error;
        throw contractError('legacy_bootstrap_partial', 'Legacy execution bootstrap committed partially and Run creation stopped.', {
          legacy_artifact: getLegacyStatePath(caller.root_realpath, storyId),
          cause: error.message
        });
      }
      if (!legacy) throw new Error('execute start returned without a legacy execution state');
      binding = await resolveCreationBinding(deps, caller, legacy, { newlyBootstrapped: true });
    }

    if (creationRequestId) {
      const existing = await findRunByCreationRequest(deps, binding, caller, storyId, creationRequestId);
      if (existing) return existing;
    }
    const createdAt = toIso(deps.now());
    const runId = generateRunId(createdAt, deps.randomBytes);
    const state = buildInitialState({
      storyId,
      runId,
      createdAt,
      binding,
      creationRequestId,
      policy: buildGuardedPolicy(options, createdAt),
      actionProfile: requireActionProfile(options.actionProfile ?? 'legacy')
    });
    const authorityFile = getRunStatePath(binding.authority.root_realpath, storyId, runId);
    const mirrorFile = binding.mirror
      ? getRunStatePath(binding.mirror.root_realpath, storyId, runId)
      : null;
    await persistAuthorityThenMirror(deps, state, authorityFile, mirrorFile, 'run_started');
    return state;
  } finally {
    await deps.artifactIo.rm(lockPath, { recursive: true, force: true });
  }
}

async function findRunByCreationRequest(deps, binding, caller, storyId, creationRequestId) {
  const runsRoot = getRunsRoot(binding.authority.root_realpath, storyId);
  let entries;
  try {
    entries = await deps.artifactIo.readdir(runsRoot);
  } catch (cause) {
    if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') return null;
    throw cause;
  }
  const matches = [];
  for (const runId of entries.filter((entry) => RUN_ID_PATTERN.test(entry))) {
    const file = getRunStatePath(binding.authority.root_realpath, storyId, runId);
    const raw = await readOptionalFile(deps, file);
    if (raw === null) {
      throw contractError('creation_request_scan_blocked', 'A guarded Run disappeared while resolving a creation request identity.', {
        story_id: storyId, creation_request_id: creationRequestId, run_id: runId, artifact: file, cause: 'run_state_missing'
      });
    }
    let state;
    try {
      state = migrateRunState(JSON.parse(raw)).state;
      await validateAuthorityBinding(deps, caller, state, binding.authority, {
        storyId, runId, expectedAuthorityKind: binding.authorityKind
      });
    } catch (cause) {
      if (cause instanceof SyntaxError || isGuardedRunError(cause)) {
        throw contractError('creation_request_scan_blocked', 'A guarded Run cannot be validated while resolving a creation request identity.', {
          story_id: storyId, creation_request_id: creationRequestId, run_id: runId, artifact: file,
          cause: cause.code ?? cause.message
        });
      }
      throw cause;
    }
    if (state.creation_request_id === creationRequestId) matches.push(state);
  }
  if (matches.length > 1) {
    throw contractError('creation_request_ambiguous', 'Multiple guarded Runs share one creation request identity.', {
      story_id: storyId, creation_request_id: creationRequestId, run_ids: matches.map((state) => state.run_id)
    });
  }
  return matches[0] ?? null;
}

async function resolveCreationLockRoot(deps, caller, legacy) {
  const managed = legacy?.managed_worktree;
  if (!managed
      || managed.mode === 'disabled'
      || managed.status === 'disabled'
      || isManagedUnavailable(managed)) {
    return resolveRepositorySharedLockRoot(caller);
  }
  if (!managed.path) return resolveRepositorySharedLockRoot(caller);
  const authority = await resolveIdentity(deps, managed.path, 'worktree_unavailable');
  const source = await resolveIdentity(deps, managed.source_repo ?? caller.root_realpath, 'worktree_mismatch');
  assertAllowedCaller(caller, authority, source);
  return resolveRepositorySharedLockRoot(source);
}

function resolveRepositorySharedLockRoot(identity) {
  if (!identity.git_common_dir_realpath) {
    throw contractError('worktree_mismatch', 'Git identity does not expose a repository-shared common directory.', {
      root_realpath: identity.root_realpath
    });
  }
  return identity.git_common_dir_realpath;
}

async function readRun(deps, repoRoot, options) {
  const loaded = await loadSelectedRun(deps, repoRoot, options);
  return loaded.state;
}

async function readPersistedProviderIdentityRecords(deps, repoRoot) {
  const executionsRoot = path.join(getWorkspaceDir(repoRoot), 'executions');
  let storyEntries;
  try {
    storyEntries = await deps.artifactIo.readdir(executionsRoot);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  const records = [];
  for (const storyId of [...storyEntries].filter((entry) => typeof entry === 'string').sort()) {
    const runsRoot = path.join(executionsRoot, storyId, 'runs');
    let runEntries;
    try {
      runEntries = await deps.artifactIo.readdir(runsRoot);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    for (const runId of [...runEntries].filter((entry) => RUN_ID_PATTERN.test(entry)).sort()) {
      const artifact = getRunStatePath(repoRoot, storyId, runId);
      const raw = await readOptionalFile(deps, artifact);
      if (raw === null) {
        throw contractError('provider_identity_scan_blocked', 'A persisted Run state disappeared during provider identity validation.', {
          artifact
        });
      }
      let state;
      try {
        state = migrateRunState(JSON.parse(raw)).state;
      } catch (error) {
        throw contractError('provider_identity_scan_blocked', 'A persisted Run state cannot be read during provider identity validation.', {
          artifact,
          cause: error.code ?? error.message
        });
      }
      for (const dispatch of state.runtime_dispatches ?? []) {
        records.push({ ...dispatch, source_artifact: artifact });
      }
    }
  }
  assertProviderIdentityUniqueness(records);
  return records;
}

async function watchRun(deps, repoRoot, options) {
  if (!options.repairLinkedCopy) return readRun(deps, repoRoot, options);
  const selected = await locateSelectedRun(deps, repoRoot, options);
  const raw = await readRequiredFile(deps, selected.authorityFile, 'run_not_found', 'Guarded Run was not found.', {
    run_id: selected.runId
  });
  const parsed = await parseAndMaybeQuarantine(deps, raw, selected.authorityFile);
  const canonical = migrateRunState(parsed).state;
  await validateAuthorityBinding(deps, selected.caller, canonical, selected.authorityIdentity, {
    storyId: selected.storyId,
    runId: selected.runId,
    expectedAuthorityKind: selected.expectedAuthorityKind
  });
  if (canonical.execution_context.authority_kind !== 'managed' || !selected.mirrorFile) {
    throw contractError('linked_copy_not_configured', 'This guarded Run has no linked mirror.', {
      run_id: canonical.run_id,
      authority_artifact: selected.authorityFile
    });
  }
  await writeRawAtomic(deps, selected.mirrorFile, raw);
  return readRun(deps, repoRoot, options);
}

async function resumeRun(deps, repoRoot, options) {
  const loaded = await loadSelectedRun(deps, repoRoot, options, { requireCurrentHead: true });
  if (loaded.state.status === 'cancelled' || loaded.state.status === 'pr_ready') {
    throw contractError('terminal_state', `Run is already terminal: ${loaded.state.status}.`, {
      run_id: loaded.state.run_id,
      status: loaded.state.status
    });
  }
  if (!RECOVERABLE_STATUSES.has(loaded.state.status)) {
    throw contractError('invalid_transition', `Run cannot resume from ${loaded.state.status}.`, {
      run_id: loaded.state.run_id,
      from: loaded.state.status,
      to: 'running'
    });
  }
  const policyStop = evaluatePolicyStop(loaded.state, deps.now(), { nextAttempt: true });
  if (policyStop) {
    const stopped = applyPolicyStop(loaded.state, policyStop, toIso(deps.now()));
    await persistAuthorityThenMirror(deps, stopped, loaded.authorityFile, loaded.mirrorFile, 'guarded_policy_stop');
    return stopped;
  }
  enforceRetryPolicy(loaded.state, deps.now());
  let resolvedDecision = null;
  if (loaded.state.status === 'waiting_for_human') {
    try {
      resolvedDecision = await resolveHumanDecision(loaded.state.execution_context.root_realpath, loaded.state, {
        decisionId: options.decisionId,
        answer: options.answer,
        answeredBy: options.answeredBy,
        reflectedIn: options.reflectedIn
      }, { now: deps.now, allowResolvedReplay: true });
    } catch (error) {
      if (!(error instanceof HumanDecisionError)) throw error;
      throw contractError(error.code, error.message, error.details);
    }
  }
  const resumedAt = toIso(deps.now());
  const retryJournal = appendRetryAudit(loaded.state, resumedAt);
  const next = applyTransition(loaded.state, 'running', 'operator_resume', resumedAt, {
    attempt: loaded.state.attempt + 1,
    stop_reason: null,
    pending_decision: null,
    resume_from_node_id: resolvedDecision
      ? loaded.state.pending_decision?.stop_node_id ?? null
      : loaded.state.resume_from_node_id ?? null,
    human_decision_journal: resolvedDecision
      ? [...(loaded.state.human_decision_journal ?? []), {
          decision_id: resolvedDecision.decision_id,
          answer: resolvedDecision.answer,
          answered_by: resolvedDecision.answered_by,
          answered_at: resolvedDecision.answered_at,
          reflected_in: resolvedDecision.reflected_in,
          stop_node_id: loaded.state.pending_decision?.stop_node_id ?? null
        }]
      : (loaded.state.human_decision_journal ?? []),
    retry_journal: retryJournal
  });
  await persistAuthorityThenMirror(deps, next, loaded.authorityFile, loaded.mirrorFile, 'run_resumed');
  return next;
}

async function cancelRun(deps, repoRoot, options) {
  const loaded = await loadSelectedRun(deps, repoRoot, options);
  if (loaded.state.status === 'cancelled') return loaded.state;
  if (loaded.state.status === 'pr_ready') {
    throw contractError('terminal_state', 'A pr_ready Run is terminal and cannot be cancelled.', {
      run_id: loaded.state.run_id,
      status: loaded.state.status
    });
  }
  const next = applyTransition(loaded.state, 'cancelled', 'operator_cancelled', toIso(deps.now()), {
    stop_reason: {
      code: 'cancelled_by_operator',
      message: 'The guarded Run was cancelled by the operator.',
      details: {}
    },
    pending_decision: null
  });
  await persistAuthorityThenMirror(deps, next, loaded.authorityFile, loaded.mirrorFile, 'terminal_transition');
  return next;
}

async function transitionRun(deps, repoRoot, options) {
  const to = options.to;
  if (!STATUS_VALUES.has(to)) throw contractError('unknown_status', `Unknown Run status: ${to}.`, { status: to });
  const loaded = await loadSelectedRun(deps, repoRoot, options, { requireCurrentHead: true });
  if (RECOVERABLE_STATUSES.has(loaded.state.status) && to === 'running') {
    throw contractError('invalid_transition', `A ${loaded.state.status} Run can return to running only through execute resume.`, {
      run_id: loaded.state.run_id,
      from: loaded.state.status,
      to
    });
  }
  if (RECOVERABLE_STATUSES.has(to)
      && isAllowedTransition(loaded.state.status, to, options.reason ?? 'run_transition')
      && !isTypedStopReason(options.stopReason)) {
    throw contractError('invalid_state', 'A recoverable Run transition requires a fresh typed stop reason.', {
      run_id: loaded.state.run_id,
      from: loaded.state.status,
      to
    });
  }
  if (to === 'pr_ready') {
    const gate = await deps.readGateReadiness(loaded.state.execution_context.root_realpath, {
      storyId: loaded.state.story_id
    });
    if (!gate?.ready_for_pr_create) {
      throw contractError('invalid_transition', 'Gate DAG is not ready for pr_ready.', {
        run_id: loaded.state.run_id,
        to,
        ready_for_pr_create: false
      });
    }
  }
  if (!isAllowedTransition(loaded.state.status, to, options.reason ?? 'run_transition')) {
    throw contractError('invalid_transition', `Run cannot transition from ${loaded.state.status} to ${to}.`, {
      run_id: loaded.state.run_id,
      from: loaded.state.status,
      to
    });
  }
  const timestamp = toIso(deps.now());
  let pendingDecision = options.pendingDecision ?? loaded.state.pending_decision;
  if (to === 'waiting_for_human') {
    try {
      const decision = await createHumanDecision(loaded.state.execution_context.root_realpath, loaded.state, pendingDecision, { now: deps.now });
      pendingDecision = {
        decision_id: decision.decision_id,
        type: decision.type,
        artifact: path.join('.vibepro', 'executions', loaded.state.story_id, 'runs', loaded.state.run_id, 'decisions', `${decision.decision_id}.json`),
        stop_node_id: pendingDecision.stop_node_id ?? null
      };
    } catch (error) {
      if (!(error instanceof HumanDecisionError)) throw error;
      throw contractError(error.code, error.message, error.details);
    }
  }
  const next = applyTransition(loaded.state, to, options.reason ?? 'run_transition', timestamp, {
    stop_reason: RECOVERABLE_STATUSES.has(to)
      ? options.stopReason
      : (to === 'running' || to === 'pr_ready'
          ? null
          : (options.stopReason ?? loaded.state.stop_reason)),
    pending_decision: pendingDecision
  });
  if (next === loaded.state) return next;
  await persistAuthorityThenMirror(deps, next, loaded.authorityFile, loaded.mirrorFile, classifyCapsuleReason(next, options.reason));
  return next;
}

async function loadSelectedRun(deps, repoRoot, options, requirements = {}) {
  const selected = await locateSelectedRun(deps, repoRoot, options);
  const authorityRaw = await readRequiredFile(
    deps,
    selected.authorityFile,
    selected.discoveredFromMirror ? 'worktree_unavailable' : 'run_not_found',
    selected.discoveredFromMirror ? 'The recorded Run authority is unavailable.' : 'Guarded Run was not found.',
    { run_id: selected.runId, authority_artifact: selected.authorityFile }
  );
  const authorityState = await parseAndMaybeQuarantine(deps, authorityRaw, selected.authorityFile);

  let mirrorRaw = null;
  if (selected.mirrorFile) {
    if (authorityState.execution_context?.authority_kind !== 'managed') {
      throw contractError('invalid_state', 'Run authority kind conflicts with its managed execution binding.', {
        run_id: selected.runId,
        authority_kind: authorityState.execution_context?.authority_kind ?? null
      });
    }
    mirrorRaw = await readOptionalFile(deps, selected.mirrorFile);
    if (mirrorRaw === null || mirrorRaw !== authorityRaw) {
      throw contractError('linked_copy_out_of_sync', 'Run authority and linked mirror are out of sync.', {
        run_id: selected.runId,
        story_id: selected.storyId,
        authority_artifact: selected.authorityFile,
        mirror_artifact: selected.mirrorFile
      });
    }
  }

  const migration = migrateRunState(authorityState);
  await validateAuthorityBinding(
    deps,
    selected.caller,
    migration.state,
    selected.authorityIdentity,
    {
      ...requirements,
      storyId: selected.storyId,
      runId: selected.runId,
      expectedAuthorityKind: selected.expectedAuthorityKind
    }
  );
  if (migration.changed) {
    await persistAuthorityThenMirror(deps, migration.state, selected.authorityFile, selected.mirrorFile, 'run_migrated');
  }
  return {
    ...selected,
    state: migration.state
  };
}

async function locateSelectedRun(deps, repoRoot, options) {
  const storyId = requireStoryId(options.storyId);
  const caller = await resolveIdentity(deps, repoRoot, 'worktree_mismatch');
  await assertRegisteredStory(deps, caller.root_realpath, storyId);
  const explicitRunId = options.runId == null ? null : requireRunId(options.runId);
  const legacy = await readLegacyState(deps, caller.root_realpath, storyId);
  const location = await resolveReadLocation(deps, caller, legacy);
  let runId = explicitRunId;
  if (!runId) {
    runId = await selectLatestRunId(deps, location, caller, storyId);
  }
  const authorityFile = getRunStatePath(location.authority.root_realpath, storyId, runId);
  const mirrorFile = location.mirror
    ? getRunStatePath(location.mirror.root_realpath, storyId, runId)
    : null;
  return {
    storyId,
    runId,
    caller,
    authorityIdentity: location.authority,
    expectedAuthorityKind: location.expectedAuthorityKind,
    authorityFile,
    mirrorFile,
    discoveredFromMirror: location.discoveredFromMirror
  };
}

async function resolveCreationBinding(deps, caller, legacy, options = {}) {
  const managed = legacy?.managed_worktree ?? {};
  const status = managed.status ?? null;
  const mode = managed.mode ?? (managed.required ? 'required' : 'preferred');
  if (mode === 'disabled' || status === 'disabled') {
    return {
      authority: caller,
      mirror: null,
      authorityKind: 'repository',
      managedWorktree: normalizeManagedBinding(managed, caller.root_realpath)
    };
  }
  if (isManagedUnavailable(managed)) {
    if (!options.newlyBootstrapped || mode === 'required') {
      throw contractError('worktree_unavailable', 'The recorded managed worktree is unavailable.', {
        path: managed.path ?? null,
        failure_reason: managed.failure_reason ?? null
      });
    }
    const normalized = normalizeManagedBinding(managed, caller.root_realpath);
    normalized.bootstrap_binding_fingerprint = buildBootstrapBindingFingerprint(normalized);
    return {
      authority: caller,
      mirror: null,
      authorityKind: 'source_fallback',
      managedWorktree: normalized
    };
  }
  if (!managed.path) {
    throw contractError('invalid_state', 'Legacy managed worktree binding has no path.', {});
  }
  const authority = await resolveIdentity(deps, managed.path, 'worktree_unavailable');
  const source = await resolveIdentity(deps, managed.source_repo ?? caller.root_realpath, 'worktree_mismatch');
  assertAllowedCaller(caller, authority, source);
  return {
    authority,
    mirror: source.root_realpath === authority.root_realpath ? null : source,
    authorityKind: 'managed',
    managedWorktree: normalizeManagedBinding(managed, source.root_realpath)
  };
}

async function resolveReadLocation(deps, caller, legacy) {
  const managed = legacy?.managed_worktree ?? null;
  if (!managed || managed.mode === 'disabled' || managed.status === 'disabled') {
    return {
      authority: caller,
      mirror: null,
      discoveredFromMirror: false,
      expectedAuthorityKind: 'repository'
    };
  }
  if (isManagedUnavailable(managed)) {
    const source = await resolveIdentity(deps, managed.source_repo ?? caller.root_realpath, 'worktree_mismatch');
    if (caller.root_realpath !== source.root_realpath) {
      throw contractError('worktree_mismatch', 'A source_fallback Run accepts only its recorded source root.', {
        caller_root: caller.root_realpath,
        source_root: source.root_realpath
      });
    }
    return {
      authority: source,
      mirror: null,
      discoveredFromMirror: false,
      expectedAuthorityKind: 'source_fallback'
    };
  }
  if (!managed.path) {
    throw contractError('invalid_state', 'Legacy managed worktree binding has no path.', {});
  }
  const authority = await resolveIdentity(deps, managed.path, 'worktree_unavailable');
  const source = await resolveIdentity(deps, managed.source_repo ?? caller.root_realpath, 'worktree_mismatch');
  assertAllowedCaller(caller, authority, source);
  return {
    authority,
    mirror: source.root_realpath === authority.root_realpath ? null : source,
    discoveredFromMirror: caller.root_realpath !== authority.root_realpath,
    expectedAuthorityKind: 'managed'
  };
}

async function validateAuthorityBinding(deps, caller, state, authorityIdentity, requirements = {}) {
  validateRunShape(state);
  const context = state.execution_context;
  if (requirements.storyId && state.story_id !== requirements.storyId) {
    throw contractError('invalid_state', 'Run Story identity does not match its artifact path.', {
      expected_story_id: requirements.storyId,
      story_id: state.story_id
    });
  }
  if (requirements.runId && state.run_id !== requirements.runId) {
    throw contractError('invalid_state', 'Run identity does not match its artifact path.', {
      expected_run_id: requirements.runId,
      run_id: state.run_id
    });
  }
  if (requirements.expectedAuthorityKind
      && context.authority_kind !== requirements.expectedAuthorityKind) {
    throw contractError('invalid_state', 'Run authority kind conflicts with the current execution binding.', {
      run_id: state.run_id,
      expected_authority_kind: requirements.expectedAuthorityKind,
      authority_kind: context.authority_kind
    });
  }
  if (!AUTHORITY_KINDS.has(context.authority_kind)) {
    throw contractError('invalid_state', `Unknown Run authority kind: ${context.authority_kind}.`, {
      run_id: state.run_id,
      authority_kind: context.authority_kind
    });
  }
  let actualAuthority;
  try {
    actualAuthority = await deps.resolveGitIdentity(context.root_realpath);
  } catch {
    throw contractError('worktree_unavailable', 'The recorded Run authority is unavailable.', {
      run_id: state.run_id,
      authority_root: context.root_realpath
    });
  }
  if (actualAuthority.root_realpath !== context.root_realpath
      || actualAuthority.git_dir_realpath !== context.git_dir_realpath
      || authorityIdentity.root_realpath !== context.root_realpath) {
    throw contractError('worktree_mismatch', 'The Run authority does not match its recorded worktree identity.', {
      run_id: state.run_id,
      expected_root: context.root_realpath,
      actual_root: actualAuthority.root_realpath
    });
  }
  const sourceRoot = state.managed_worktree?.source_repo ?? null;
  if (context.authority_kind === 'managed') {
    if (caller.root_realpath !== context.root_realpath && caller.root_realpath !== sourceRoot) {
      throw contractError('worktree_mismatch', 'This checkout is not an allowed control root for the managed Run.', {
        run_id: state.run_id,
        caller_root: caller.root_realpath
      });
    }
  } else if (caller.root_realpath !== context.root_realpath) {
    throw contractError('worktree_mismatch', 'This checkout is not the recorded Run authority.', {
      run_id: state.run_id,
      caller_root: caller.root_realpath
    });
  }
  if (context.authority_kind === 'source_fallback') {
    const fingerprint = state.managed_worktree?.bootstrap_binding_fingerprint;
    if (!fingerprint) {
      throw contractError('invalid_state', 'source_fallback Run is missing its bootstrap binding fingerprint.', {
        run_id: state.run_id
      });
    }
    const expected = buildBootstrapBindingFingerprint(state.managed_worktree);
    if (fingerprint !== expected) {
      throw contractError('worktree_mismatch', 'source_fallback binding fingerprint does not match.', {
        run_id: state.run_id
      });
    }
    const legacy = await readLegacyState(deps, context.root_realpath, state.story_id);
    if (!legacy?.managed_worktree || !isManagedUnavailable(legacy.managed_worktree)) {
      throw contractError('worktree_mismatch', 'source_fallback no longer matches an unavailable legacy binding.', {
        run_id: state.run_id
      });
    }
    if (buildBootstrapBindingFingerprint(normalizeManagedBinding(legacy.managed_worktree, context.root_realpath)) !== fingerprint) {
      throw contractError('worktree_mismatch', 'Current unavailable binding does not match the recorded source_fallback.', {
        run_id: state.run_id
      });
    }
  }
  if (requirements.requireCurrentHead && actualAuthority.head_sha !== state.current_head_sha) {
    throw contractError('stale_head', 'The authoritative worktree HEAD changed after this Run was recorded.', {
      run_id: state.run_id,
      expected_head_sha: state.current_head_sha,
      actual_head_sha: actualAuthority.head_sha
    });
  }
}

function buildInitialState({ storyId, runId, createdAt, binding, creationRequestId = null, policy, actionProfile = 'legacy' }) {
  return {
    schema_version: GUARDED_RUN_SCHEMA_VERSION,
    run_id: runId,
    story_id: storyId,
    ...(creationRequestId ? { creation_request_id: creationRequestId } : {}),
    target: GUARDED_RUN_TARGET,
    autonomy_mode: GUARDED_AUTONOMY_MODE,
    ...(actionProfile === 'legacy' ? {} : { action_profile: actionProfile }),
    created_at: createdAt,
    updated_at: createdAt,
    status: 'running',
    stop_reason: null,
    attempt: 1,
    iteration: 0,
    budget: policy.budget,
    deadline: policy.deadline,
    retry_policy: policy.retry_policy,
    provider_fallbacks: policy.provider_fallbacks,
    usage_accounting: {
      total_tokens: null,
      cost_usd: null,
      status: 'unknown',
      source: null,
      updated_at: null
    },
    last_progress_at: createdAt,
    pending_decision: null,
    current_head_sha: binding.authority.head_sha,
    execution_context: {
      authority_kind: binding.authorityKind,
      root_realpath: binding.authority.root_realpath,
      git_dir_realpath: binding.authority.git_dir_realpath
    },
    managed_worktree: binding.managedWorktree,
    action_journal: [],
    next_best_action_decisions: [],
    human_decision_journal: [],
    retry_journal: [],
    transitions: [{
      sequence: 1,
      from: null,
      to: 'running',
      reason: 'run_created',
      timestamp: createdAt
    }]
  };
}

function buildGuardedPolicy(options, createdAt) {
  const maxAttempts = positiveInteger(options.maxAttempts, 3, 'max_attempts');
  const maxIterations = nonNegativeInteger(options.maxIterations, 12, 'max_iterations');
  const maxDurationMs = positiveInteger(options.maxDurationMs, 3_600_000, 'max_duration_ms');
  const maxTokens = nullablePositiveNumber(options.maxTokens, 'max_tokens');
  const maxCostUsd = nullablePositiveNumber(options.maxCostUsd, 'max_cost_usd');
  const retryBackoffMs = nonNegativeInteger(options.retryBackoffMs, 0, 'retry_backoff_ms');
  const retryableStopCodes = options.retryableStopCodes ?? [
    ...RECOVERABLE_RUNTIME_STOP_CODES,
    'ci_pending', 'review_timeout', 'action_failed'
  ];
  const providerFallbacks = options.providerFallbacks ?? [];
  if (retryableStopCodes.some((value) => typeof value !== 'string' || value.length === 0)
      || providerFallbacks.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw contractError('invalid_policy', 'Retry codes and provider fallbacks must be non-empty strings.', {});
  }
  return {
    budget: { max_attempts: maxAttempts, max_iterations: maxIterations, max_duration_ms: maxDurationMs, max_tokens: maxTokens, max_cost_usd: maxCostUsd },
    deadline: new Date(new Date(createdAt).getTime() + maxDurationMs).toISOString(),
    retry_policy: { retryable_stop_codes: [...new Set(retryableStopCodes)], backoff_ms: retryBackoffMs },
    provider_fallbacks: [...new Set(providerFallbacks)]
  };
}

function evaluatePolicyStop(state, now, options = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const nextAttempt = state.attempt + (options.nextAttempt ? 1 : 0);
  if (nextAttempt > state.budget.max_attempts) return typedPolicyStop('max_attempts_exceeded', state, { observed: nextAttempt, limit: state.budget.max_attempts });
  if (state.iteration >= state.budget.max_iterations) return typedPolicyStop('max_iterations_exceeded', state, { observed: state.iteration, limit: state.budget.max_iterations });
  if (state.deadline && at.getTime() >= new Date(state.deadline).getTime()) return typedPolicyStop('deadline_exceeded', state, { observed_at: at.toISOString(), deadline: state.deadline });
  const usage = state.usage_accounting ?? {};
  if (state.budget.max_tokens != null && usage.total_tokens != null && usage.total_tokens >= state.budget.max_tokens) return typedPolicyStop('token_budget_exceeded', state, { observed: usage.total_tokens, limit: state.budget.max_tokens });
  if (state.budget.max_cost_usd != null && usage.cost_usd != null && usage.cost_usd >= state.budget.max_cost_usd) return typedPolicyStop('cost_budget_exceeded', state, { observed: usage.cost_usd, limit: state.budget.max_cost_usd });
  return null;
}

function typedPolicyStop(code, state, details) {
  return {
    code,
    message: `Guarded Run stopped by policy: ${code}.`,
    details: {
      ...details,
      retryable: false,
      recovery: { next_command: `vibepro execute status ${shellQuoteCommandArg(state.execution_context.root_realpath)} --story-id ${state.story_id} --run-id ${state.run_id}` }
    }
  };
}

function applyPolicyStop(state, stopReason, timestamp) {
  if (state.status === 'blocked') {
    return { ...state, stop_reason: stopReason, updated_at: timestamp };
  }
  return applyTransition(state, 'blocked', 'guarded_policy_stop', timestamp, { stop_reason: stopReason });
}

function appendRetryAudit(state, resumedAt) {
  const journal = state.retry_journal ?? [];
  if (state.status === 'waiting_for_human' || !state.stop_reason?.code) return journal;
  const stoppedAtMs = Date.parse(state.updated_at);
  const resumedAtMs = Date.parse(resumedAt);
  const elapsedMs = Number.isFinite(stoppedAtMs) && Number.isFinite(resumedAtMs)
    ? Math.max(0, resumedAtMs - stoppedAtMs)
    : null;
  const backoffMs = state.retry_policy?.backoff_ms ?? 0;
  return [...journal, {
    sequence: journal.length + 1,
    stop_code: state.stop_reason.code,
    retryable: state.retry_policy?.retryable_stop_codes?.includes(state.stop_reason.code) ?? false,
    backoff_ms: backoffMs,
    stopped_at: state.updated_at,
    resumed_at: resumedAt,
    elapsed_ms: elapsedMs,
    backoff_satisfied: elapsedMs == null ? null : elapsedMs >= backoffMs,
    resumed_by: 'operator'
  }];
}

function enforceRetryPolicy(state, resumedAt) {
  if (state.status === 'waiting_for_human' || !state.stop_reason?.code) return;
  if (state.migration_compatibility?.retry_policy_enforcement === 'legacy_advisory') return;
  const policyManaged = state.stop_reason.details?.retry_policy_scope === 'managed'
    || state.retry_policy?.retryable_stop_codes?.includes(state.stop_reason.code)
    || /^(runtime_|ci_|review_|action_)/.test(state.stop_reason.code);
  if (!policyManaged) return;
  const retryable = state.retry_policy?.retryable_stop_codes?.includes(state.stop_reason.code) ?? false;
  if (!retryable) {
    throw contractError('retry_not_allowed', `Stop ${state.stop_reason.code} is not retryable by the persisted policy.`, {
      run_id: state.run_id,
      stop_code: state.stop_reason.code,
      retryable_stop_codes: state.retry_policy?.retryable_stop_codes ?? []
    });
  }
  const stoppedAtMs = Date.parse(state.updated_at);
  const resumedAtMs = Date.parse(toIso(resumedAt));
  const backoffMs = state.retry_policy?.backoff_ms ?? 0;
  const elapsedMs = Number.isFinite(stoppedAtMs) && Number.isFinite(resumedAtMs)
    ? Math.max(0, resumedAtMs - stoppedAtMs)
    : null;
  if (elapsedMs == null || elapsedMs < backoffMs) {
    throw contractError('retry_backoff_pending', 'The persisted retry backoff has not elapsed.', {
      run_id: state.run_id,
      stop_code: state.stop_reason.code,
      backoff_ms: backoffMs,
      elapsed_ms: elapsedMs,
      retry_after_ms: elapsedMs == null ? backoffMs : backoffMs - elapsedMs
    });
  }
}

function positiveInteger(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) throw contractError('invalid_policy', `${name} must be a positive integer.`, { field: name, value });
  return resolved;
}

function nonNegativeInteger(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0) throw contractError('invalid_policy', `${name} must be a non-negative integer.`, { field: name, value });
  return resolved;
}

function nullablePositiveNumber(value, name) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value <= 0) throw contractError('invalid_policy', `${name} must be a positive number.`, { field: name, value });
  return value;
}

function applyTransition(state, to, reason, timestamp, patch = {}) {
  if (!STATUS_VALUES.has(state.status)) {
    throw contractError('unknown_status', `Unknown Run status: ${state.status}.`, {
      run_id: state.run_id,
      status: state.status
    });
  }
  if (!STATUS_VALUES.has(to)) {
    throw contractError('unknown_status', `Unknown Run status: ${to}.`, { run_id: state.run_id, status: to });
  }
  if (state.status === to && to === 'pr_ready') return state;
  if (!isAllowedTransition(state.status, to, reason)) {
    throw contractError('invalid_transition', `Run cannot transition from ${state.status} to ${to}.`, {
      run_id: state.run_id,
      from: state.status,
      to
    });
  }
  return {
    ...state,
    ...patch,
    status: to,
    updated_at: timestamp,
    last_progress_at: timestamp,
    transitions: [...state.transitions, {
      sequence: state.transitions.length + 1,
      from: state.status,
      to,
      reason,
      timestamp
    }]
  };
}

function isAllowedTransition(from, to, reason) {
  if (from === 'pr_ready') return to === 'pr_ready';
  if (from === 'cancelled') return false;
  if (from === 'failed' && to === 'running') return reason === 'operator_resume';
  if (from === 'running') return RECOVERABLE_STATUSES.has(to) || to === 'cancelled' || to === 'pr_ready';
  if (RECOVERABLE_STATUSES.has(from)) {
    return to === 'running'
      || (RECOVERABLE_STATUSES.has(to) && to !== from)
      || to === 'cancelled'
      || to === 'pr_ready';
  }
  return false;
}

async function persistAuthorityThenMirror(deps, state, authorityFile, mirrorFile, capsuleReason) {
  validateRunShape(state);
  const raw = serializeState(state);
  await writeRawAtomic(deps, authorityFile, raw);
  if (!mirrorFile) {
    await refreshCapsuleProjection(deps, state, authorityFile, null, capsuleReason);
    return;
  }
  try {
    await writeRawAtomic(deps, mirrorFile, raw);
  } catch (error) {
    throw contractError('linked_copy_sync_failed', 'Run authority committed but linked mirror synchronization failed.', {
      run_id: state.run_id,
      story_id: state.story_id,
      authority_artifact: authorityFile,
      mirror_artifact: mirrorFile,
      cause: error.message
    });
  }
  await refreshCapsuleProjection(deps, state, authorityFile, mirrorFile, capsuleReason);
}

async function refreshCapsuleProjection(deps, state, authorityFile, mirrorFile, reason) {
  try {
    await deps.refreshContextCapsule({ state, authorityFile, mirrorFile, reason });
  } catch {
    // The capsule is a rebuildable projection. Run authority has already committed.
  }
}

function classifyCapsuleReason(state, reason) {
  if (state.status === 'waiting_for_human') return 'human_decision';
  if (state.status === 'waiting_for_runtime') return 'runtime_wait';
  if (state.status === 'failed' || state.status === 'blocked') return 'failure_or_block';
  if (state.status === 'cancelled' || state.status === 'pr_ready') return 'terminal_transition';
  return reason ?? 'run_transition';
}

async function writeRawAtomic(deps, filePath, raw) {
  await deps.artifactIo.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await deps.artifactIo.writeFile(tempPath, raw);
    await deps.artifactIo.rename(tempPath, filePath);
  } catch (error) {
    await deps.artifactIo.rm(tempPath, { force: true }).catch(() => null);
    throw error;
  }
}

async function parseAndMaybeQuarantine(deps, raw, filePath) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const quarantine = `${filePath}.corrupt-${formatRunTimestamp(toIso(deps.now()))}`;
    await deps.artifactIo.rename(filePath, quarantine);
    throw contractError('corrupt_state', 'Guarded Run state is corrupt and was quarantined.', {
      artifact: filePath,
      quarantine_artifact: quarantine
    });
  }
}

function migrateRunState(state) {
  const legacyCurrentSchema = state.schema_version === GUARDED_RUN_SCHEMA_VERSION
    && (!Object.prototype.hasOwnProperty.call(state, 'retry_policy')
      || !Object.prototype.hasOwnProperty.call(state, 'provider_fallbacks')
      || !Object.prototype.hasOwnProperty.call(state, 'usage_accounting')
      || !Object.prototype.hasOwnProperty.call(state, 'retry_journal'));
  if (state.schema_version === GUARDED_RUN_SCHEMA_VERSION && !legacyCurrentSchema) {
    validateRunShape(state);
    return { changed: false, state };
  }
  if (!legacyCurrentSchema && state.schema_version !== undefined && state.schema_version !== '0.0.0' && state.schema_version !== '0.1.0') {
    throw contractError('unsupported_schema', `Unsupported guarded Run schema: ${state.schema_version}.`, {
      run_id: state.run_id ?? null,
      schema_version: state.schema_version ?? null
    });
  }
  const migrated = {
    ...state,
    schema_version: GUARDED_RUN_SCHEMA_VERSION,
    ...(state.action_profile && state.action_profile !== 'legacy' ? { action_profile: state.action_profile } : {}),
    action_journal: state.action_journal ?? [],
    next_best_action_decisions: state.next_best_action_decisions ?? [],
    human_decision_journal: state.human_decision_journal ?? [],
    retry_journal: state.retry_journal ?? [],
    resume_from_node_id: state.resume_from_node_id ?? null,
    budget: legacyCurrentSchema ? {
      max_attempts: 3,
      max_iterations: 12,
      max_duration_ms: 3_600_000,
      max_tokens: null,
      max_cost_usd: null
    } : state.budget,
    retry_policy: state.retry_policy ?? { retryable_stop_codes: ['action_failed'], backoff_ms: 0 },
    provider_fallbacks: state.provider_fallbacks ?? [],
    usage_accounting: state.usage_accounting ?? { total_tokens: null, cost_usd: null, status: 'unknown', source: null, updated_at: null },
    migration_compatibility: state.migration_compatibility ?? {
      retry_policy_enforcement: 'legacy_advisory'
    }
  };
  validateRunShape(migrated);
  return { changed: true, state: migrated };
}

function validateRunShape(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw contractError('invalid_state', 'Guarded Run state must be an object.', {});
  }
  const required = [
    'schema_version', 'run_id', 'story_id', 'target', 'autonomy_mode', 'created_at', 'updated_at',
    'status', 'stop_reason', 'attempt', 'iteration', 'budget', 'deadline', 'last_progress_at',
    'pending_decision', 'current_head_sha', 'execution_context', 'managed_worktree', 'action_journal', 'transitions'
  ];
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(state, key));
  if (missing.length > 0) {
    throw contractError('invalid_state', 'Guarded Run state is missing required fields.', {
      run_id: state.run_id ?? null,
      missing
    });
  }
  if (state.schema_version !== GUARDED_RUN_SCHEMA_VERSION) {
    throw contractError('unsupported_schema', `Unsupported guarded Run schema: ${state.schema_version}.`, {
      run_id: state.run_id ?? null,
      schema_version: state.schema_version
    });
  }
  requireRunId(state.run_id);
  requireStoryId(state.story_id);
  if (state.creation_request_id != null) requireCreationRequestId(state.creation_request_id);
  if (state.target !== GUARDED_RUN_TARGET || state.autonomy_mode !== GUARDED_AUTONOMY_MODE) {
    throw contractError('invalid_state', 'Guarded Run target or autonomy mode is invalid.', {
      run_id: state.run_id
    });
  }
  requireActionProfile(state.action_profile ?? 'legacy');
  if (!STATUS_VALUES.has(state.status)) {
    throw contractError('unknown_status', `Unknown Run status: ${state.status}.`, {
      run_id: state.run_id,
      status: state.status
    });
  }
  if (!Number.isInteger(state.attempt) || state.attempt < 1
      || !Number.isInteger(state.iteration) || state.iteration < 0
      || !Number.isInteger(state.budget?.max_attempts) || state.budget.max_attempts < 1
      || !Number.isInteger(state.budget?.max_iterations) || state.budget.max_iterations < 0) {
    throw contractError('invalid_state', 'Guarded Run counters or budget are invalid.', { run_id: state.run_id });
  }
  if (state.budget.max_duration_ms !== undefined && (!Number.isInteger(state.budget.max_duration_ms) || state.budget.max_duration_ms < 1)) {
    throw contractError('invalid_state', 'Guarded Run duration budget is invalid.', { run_id: state.run_id });
  }
  for (const key of ['max_tokens', 'max_cost_usd']) {
    if (state.budget[key] !== undefined && state.budget[key] !== null
        && (!Number.isFinite(state.budget[key]) || state.budget[key] <= 0)) {
      throw contractError('invalid_state', `Guarded Run ${key} is invalid.`, { run_id: state.run_id });
    }
  }
  if (state.retry_policy !== undefined
      && (!isPlainRecord(state.retry_policy)
        || !Array.isArray(state.retry_policy.retryable_stop_codes)
        || state.retry_policy.retryable_stop_codes.some((code) => typeof code !== 'string' || code.length === 0)
        || !Number.isInteger(state.retry_policy.backoff_ms)
        || state.retry_policy.backoff_ms < 0)) {
    throw contractError('invalid_state', 'Guarded Run retry policy is invalid.', { run_id: state.run_id });
  }
  if (state.migration_compatibility !== undefined
      && (!isPlainRecord(state.migration_compatibility)
        || state.migration_compatibility.retry_policy_enforcement !== 'legacy_advisory')) {
    throw contractError('invalid_state', 'Guarded Run migration compatibility marker is invalid.', { run_id: state.run_id });
  }
  if (state.retry_journal !== undefined && (!Array.isArray(state.retry_journal)
      || state.retry_journal.some((entry) => !isPlainRecord(entry)
        || !Number.isInteger(entry.sequence)
        || typeof entry.stop_code !== 'string'
        || typeof entry.retryable !== 'boolean'
        || !Number.isInteger(entry.backoff_ms)
        || (entry.elapsed_ms !== null && (!Number.isFinite(entry.elapsed_ms) || entry.elapsed_ms < 0))
        || (entry.backoff_satisfied !== null && typeof entry.backoff_satisfied !== 'boolean')))) {
    throw contractError('invalid_state', 'Guarded Run retry_journal is invalid.', { run_id: state.run_id });
  }
  if (state.provider_fallbacks !== undefined
      && (!Array.isArray(state.provider_fallbacks) || state.provider_fallbacks.some((provider) => typeof provider !== 'string' || provider.length === 0))) {
    throw contractError('invalid_state', 'Guarded Run provider fallbacks are invalid.', { run_id: state.run_id });
  }
  if (state.usage_accounting !== undefined && !validUsageAccounting(state.usage_accounting)) {
    throw contractError('invalid_state', 'Guarded Run usage accounting is invalid.', { run_id: state.run_id });
  }
  if (!isIsoTimestamp(state.created_at) || !isIsoTimestamp(state.updated_at) || !isIsoTimestamp(state.last_progress_at)) {
    throw contractError('invalid_state', 'Guarded Run timestamps are invalid.', { run_id: state.run_id });
  }
  if (!state.current_head_sha || typeof state.current_head_sha !== 'string') {
    throw contractError('invalid_state', 'Guarded Run current_head_sha is invalid.', { run_id: state.run_id });
  }
  if (!state.execution_context || typeof state.execution_context !== 'object'
      || !state.execution_context.authority_kind
      || !state.execution_context.root_realpath
      || !state.execution_context.git_dir_realpath) {
    throw contractError('invalid_state', 'Guarded Run execution context is invalid.', { run_id: state.run_id });
  }
  if (!AUTHORITY_KINDS.has(state.execution_context.authority_kind)) {
    throw contractError('invalid_state', `Unknown Run authority kind: ${state.execution_context.authority_kind}.`, {
      run_id: state.run_id
    });
  }
  if (!state.managed_worktree || typeof state.managed_worktree !== 'object' || Array.isArray(state.managed_worktree)) {
    throw contractError('invalid_state', 'Guarded Run managed worktree snapshot is invalid.', { run_id: state.run_id });
  }
  if (state.execution_context.authority_kind === 'source_fallback'
      && typeof state.managed_worktree.bootstrap_binding_fingerprint !== 'string') {
    throw contractError('invalid_state', 'source_fallback Run is missing its bootstrap binding fingerprint.', {
      run_id: state.run_id
    });
  }
  if (!Array.isArray(state.transitions) || state.transitions.length === 0) {
    throw contractError('invalid_state', 'Guarded Run transition history is invalid.', { run_id: state.run_id });
  }
  if (!Array.isArray(state.action_journal)) {
    throw contractError('invalid_state', 'Guarded Run action journal is invalid.', { run_id: state.run_id });
  }
  if (state.next_best_action_decisions !== undefined) {
    if (!Array.isArray(state.next_best_action_decisions)
        || state.next_best_action_decisions.some((decision) => !isBoundedDecisionRecord(decision))) {
      throw contractError('invalid_state', 'Guarded Run next-best-action decision history is invalid.', {
        run_id: state.run_id
      });
    }
  }
  if (state.human_decision_journal !== undefined
      && (!Array.isArray(state.human_decision_journal)
        || state.human_decision_journal.some((item) => !isPlainRecord(item)
          || typeof item.decision_id !== 'string'
          || typeof item.answer !== 'string'
          || typeof item.answered_by !== 'string'
          || !isIsoTimestamp(item.answered_at)
          || !Array.isArray(item.reflected_in)))) {
    throw contractError('invalid_state', 'Guarded Run human decision journal is invalid.', { run_id: state.run_id });
  }
  for (const entry of state.action_journal) {
    if (!entry || typeof entry !== 'object'
        || typeof entry.action_id !== 'string'
        || typeof entry.node_id !== 'string'
        || typeof entry.input_head_sha !== 'string'
        || typeof entry.output_head_sha !== 'string'
        || typeof entry.idempotency_key !== 'string'
        || !['completed', 'failed', 'forbidden'].includes(entry.status)
        || !isIsoTimestamp(entry.started_at)
        || !isIsoTimestamp(entry.completed_at)) {
      throw contractError('invalid_state', 'Guarded Run action journal contains an invalid entry.', {
        run_id: state.run_id
      });
    }
    if (entry.measurements !== undefined
        && (!isPlainRecord(entry.measurements)
          || Object.entries(entry.measurements).some(([key, value]) => ![
            'full_suite_count', 'evidence_reuse_count', 'evidence_invalidation_count',
            'accepted_defect_count', 'risk_reduction_count'
          ].includes(key) || !Number.isInteger(value) || value < 0))) {
      throw contractError('invalid_state', 'Guarded Run action journal measurements are invalid.', { run_id: state.run_id });
    }
  }
  for (let index = 0; index < state.transitions.length; index += 1) {
    const transition = state.transitions[index];
    const previous = index === 0 ? null : state.transitions[index - 1];
    if (transition?.sequence !== index + 1
        || (index === 0 ? transition.from !== null : transition.from !== previous.to)
        || !STATUS_VALUES.has(transition.to)
        || typeof transition.reason !== 'string'
        || !isIsoTimestamp(transition.timestamp)) {
      throw contractError('invalid_state', 'Guarded Run transition history is inconsistent.', {
        run_id: state.run_id,
        sequence: index + 1
      });
    }
    if ((index === 0 && (transition.to !== 'running' || transition.reason !== 'run_created'))
        || (index > 0 && !isAllowedTransition(previous.to, transition.to, transition.reason))) {
      throw contractError('invalid_state', 'Guarded Run transition history contains a forbidden transition.', {
        run_id: state.run_id,
        sequence: index + 1,
        from: transition.from,
        to: transition.to
      });
    }
  }
  if (state.transitions.at(-1).to !== state.status) {
    throw contractError('invalid_state', 'Guarded Run status does not match its last transition.', {
      run_id: state.run_id
    });
  }
  if (state.stop_reason !== null && !isTypedStopReason(state.stop_reason)) {
    throw contractError('invalid_state', 'Guarded Run stop_reason is invalid.', { run_id: state.run_id });
  }
  if (state.deadline !== null && !isIsoTimestamp(state.deadline)) {
    throw contractError('invalid_state', 'Guarded Run deadline is invalid.', { run_id: state.run_id });
  }
  if (state.pending_decision !== null && !isPlainRecord(state.pending_decision)) {
    throw contractError('invalid_state', 'Guarded Run pending_decision is invalid.', { run_id: state.run_id });
  }
  if (state.resume_from_node_id !== undefined
      && state.resume_from_node_id !== null
      && typeof state.resume_from_node_id !== 'string') {
    throw contractError('invalid_state', 'Guarded Run resume_from_node_id is invalid.', { run_id: state.run_id });
  }
}

function validUsageAccounting(value) {
  if (!isPlainRecord(value) || !['known', 'partial', 'unknown'].includes(value.status)) return false;
  for (const key of ['total_tokens', 'cost_usd']) {
    if (value[key] !== null && (!Number.isFinite(value[key]) || value[key] < 0)) return false;
  }
  return (value.source === null || typeof value.source === 'string')
    && (value.updated_at === null || isIsoTimestamp(value.updated_at));
}

function mergeUsageAccounting(current, observed, timestamp) {
  const currentTokens = current?.total_tokens;
  const currentCost = current?.cost_usd;
  const observedTokens = observed?.total_tokens;
  const observedCost = observed?.cost_usd;
  const totalTokens = observedTokens == null
    ? (currentTokens ?? null)
    : (currentTokens ?? 0) + observedTokens;
  const costUsd = observedCost == null
    ? (currentCost ?? null)
    : Number(((currentCost ?? 0) + observedCost).toFixed(6));
  const knownCount = Number(totalTokens !== null) + Number(costUsd !== null);
  return {
    total_tokens: totalTokens,
    cost_usd: costUsd,
    status: knownCount === 2 ? 'known' : knownCount === 1 ? 'partial' : 'unknown',
    source: observed?.source ?? current?.source ?? null,
    updated_at: knownCount > 0 ? timestamp : (current?.updated_at ?? null)
  };
}

function requireCreationRequestId(value) {
  if (typeof value !== 'string' || !/^portfolio-[0-9a-f]{24}$/.test(value)) {
    throw contractError('invalid_creation_request_id', 'A valid Portfolio creation request identity is required.', { creation_request_id: value ?? null });
  }
  return value;
}

function isBoundedDecisionRecord(decision) {
  const allowedKeys = new Set([
    'schema_version', 'policy_version', 'checkpoint_reason', 'state_delta', 'state_fingerprint',
    'no_progress_count', 'outcome', 'selected_action_id', 'selection_reason', 'selected_score',
    'candidates', 'rejected', 'reused'
  ]);
  return Boolean(decision && typeof decision === 'object' && !Array.isArray(decision))
    && Object.keys(decision).every((key) => allowedKeys.has(key))
    && decision.schema_version === '0.1.0'
    && typeof decision.policy_version === 'string'
    && typeof decision.checkpoint_reason === 'string'
    && typeof decision.state_fingerprint === 'string'
    && Number.isInteger(decision.no_progress_count)
    && typeof decision.outcome === 'string'
    && (decision.selected_action_id === null || typeof decision.selected_action_id === 'string')
    && typeof decision.selection_reason === 'string'
    && (decision.selected_score === null || (typeof decision.selected_score === 'number' && Number.isFinite(decision.selected_score)))
    && (!Object.hasOwn(decision, 'state_delta') || isBoundedJson(decision.state_delta))
    && Array.isArray(decision.candidates)
    && decision.candidates.every(isBoundedCandidate)
    && Array.isArray(decision.rejected)
    && decision.rejected.every(isBoundedRejection)
    && (!Object.hasOwn(decision, 'reused') || typeof decision.reused === 'boolean')
    && Buffer.byteLength(JSON.stringify(decision)) <= 16384;
}

function isBoundedCandidate(candidate) {
  const keys = new Set(['action_id', 'classification', 'metrics', 'score']);
  const metricKeys = new Set([
    'expected_progress', 'uncertainty_reduction', 'risk_reduction', 'evidence_reuse', 'estimated_time',
    'estimated_tokens_or_cost', 'invalidation_risk', 'rework_risk', 'confidence'
  ]);
  return isPlainRecord(candidate)
    && Object.keys(candidate).every((key) => keys.has(key))
    && typeof candidate.action_id === 'string'
    && typeof candidate.classification === 'string'
    && typeof candidate.score === 'number' && Number.isFinite(candidate.score)
    && isPlainRecord(candidate.metrics)
    && Object.keys(candidate.metrics).length === metricKeys.size
    && Object.keys(candidate.metrics).every((key) => metricKeys.has(key))
    && Object.values(candidate.metrics).every((value) => value === 'unknown' || (typeof value === 'number' && Number.isFinite(value)));
}

function isBoundedRejection(rejection) {
  return isPlainRecord(rejection)
    && Object.keys(rejection).every((key) => ['action_id', 'score', 'reason_code'].includes(key))
    && Object.keys(rejection).length === 3
    && typeof rejection.action_id === 'string'
    && typeof rejection.score === 'number' && Number.isFinite(rejection.score)
    && rejection.reason_code === 'lower_rank';
}

function isBoundedJson(value, depth = 0) {
  if (depth > 8) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => isBoundedJson(item, depth + 1));
  if (!isPlainRecord(value)) return false;
  const forbidden = /(transcript|chain[_-]?of[_-]?thought|hidden[_-]?reasoning|raw[_-]?(prompt|response|message))/i;
  return Object.keys(value).length <= 100
    && Object.entries(value).every(([key, item]) => !forbidden.test(key) && isBoundedJson(item, depth + 1));
}

async function selectLatestRunId(deps, location, caller, storyId) {
  const authorityRoot = location.authority.root_realpath;
  const runsRoot = getRunsRoot(authorityRoot, storyId);
  let entries;
  try {
    entries = await deps.artifactIo.readdir(runsRoot);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw contractError('run_not_found', 'No guarded Runs exist for this Story.', { story_id: storyId });
    }
    throw error;
  }
  const candidates = [];
  const rejectedCandidates = [];
  for (const runId of entries.filter((entry) => RUN_ID_PATTERN.test(entry))) {
    const filePath = getRunStatePath(authorityRoot, storyId, runId);
    const raw = await readOptionalFile(deps, filePath);
    if (raw === null) {
      rejectedCandidates.push({
        run_id: runId,
        code: 'invalid_state',
        message: 'Guarded Run directory has no state artifact.',
        artifact: filePath
      });
      continue;
    }
    let state;
    try {
      try {
        state = JSON.parse(raw);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw contractError('corrupt_state', 'Guarded Run state is corrupt.', { artifact: filePath });
      }
      state = migrateRunState(state).state;
      await validateAuthorityBinding(deps, caller, state, location.authority, {
        storyId,
        runId,
        expectedAuthorityKind: location.expectedAuthorityKind
      });
    } catch (error) {
      if (!isGuardedRunError(error)) throw error;
      rejectedCandidates.push({
        run_id: runId,
        code: error.code,
        message: error.message,
        artifact: error.details?.artifact ?? filePath
      });
      continue;
    }
    candidates.push({ runId, createdAt: state.created_at });
  }
  if (rejectedCandidates.length > 0) {
    throw contractError(
      'run_selection_blocked',
      'Implicit Run selection found rejected candidates; inspect them and select a validated Run explicitly.',
      { story_id: storyId, rejected_candidates: rejectedCandidates }
    );
  }
  candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.runId.localeCompare(left.runId));
  if (candidates.length === 0) {
    throw contractError('run_not_found', 'No guarded Runs exist for this Story.', { story_id: storyId });
  }
  return candidates[0].runId;
}

async function assertRegisteredStory(deps, repoRoot, storyId) {
  const configPath = path.join(getWorkspaceDir(repoRoot), 'config.json');
  const raw = await readRequiredFile(deps, configPath, 'invalid_story_id', 'VibePro Story catalog is unavailable.', {
    story_id: storyId
  });
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw contractError('invalid_story_id', 'VibePro Story catalog is invalid.', { story_id: storyId });
  }
  const registered = Array.isArray(config?.brainbase?.stories)
    && config.brainbase.stories.some((story) => story?.story_id === storyId);
  if (!registered) {
    throw contractError('invalid_story_id', 'Story is not registered in the VibePro catalog.', { story_id: storyId });
  }
}

async function readLegacyState(deps, repoRoot, storyId) {
  const raw = await readOptionalFile(deps, getLegacyStatePath(repoRoot, storyId));
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw contractError('invalid_state', 'Legacy execution state is invalid JSON.', {
      story_id: storyId,
      cause: error.message
    });
  }
}

async function readOptionalFile(deps, filePath) {
  try {
    return await deps.artifactIo.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function readRequiredFile(deps, filePath, code, message, details) {
  const raw = await readOptionalFile(deps, filePath);
  if (raw === null) throw contractError(code, message, details);
  return raw;
}

function normalizeManagedBinding(managed = {}, sourceRoot) {
  return {
    status: managed.status ?? null,
    required: managed.required ?? managed.mode === 'required',
    mode: managed.mode ?? (managed.required ? 'required' : 'preferred'),
    source_repo: path.resolve(sourceRoot ?? managed.source_repo),
    source_relative_path: managed.source_relative_path ?? null,
    path: managed.path ? path.resolve(managed.path) : null,
    relative_path: managed.relative_path ?? null,
    branch: managed.branch ?? null,
    actual_branch: managed.actual_branch ?? null,
    branch_match: managed.branch_match ?? null,
    base_ref: managed.base_ref ?? null,
    created_from_sha: managed.created_from_sha ?? null,
    current_head_sha: managed.current_head_sha ?? null,
    dirty: managed.dirty ?? null,
    dirty_paths: managed.dirty_paths ?? [],
    dirty_check_error: managed.dirty_check_error ?? null,
    failure_reason: managed.failure_reason ?? null,
    ...(managed.bootstrap_binding_fingerprint
      ? { bootstrap_binding_fingerprint: managed.bootstrap_binding_fingerprint }
      : {})
  };
}

export function buildBootstrapBindingFingerprint(managed) {
  const tuple = {
    status: managed?.status ?? null,
    mode: managed?.mode ?? null,
    source_repo: managed?.source_repo ? path.resolve(managed.source_repo) : null,
    relative_path: managed?.relative_path ?? null,
    branch: managed?.branch ?? null,
    actual_branch: managed?.actual_branch ?? null,
    base_ref: managed?.base_ref ?? null,
    created_from_sha: managed?.created_from_sha ?? null,
    current_head_sha: managed?.current_head_sha ?? null,
    failure_reason: managed?.failure_reason ?? null
  };
  return createHash('sha256').update(JSON.stringify(tuple)).digest('hex');
}

function isManagedUnavailable(managed) {
  return managed?.status === 'unavailable'
    || managed?.status === 'failed'
    || Boolean(managed?.failure_reason)
    || (!managed?.path && managed?.mode !== 'disabled' && managed?.status !== 'disabled');
}

function assertAllowedCaller(caller, authority, source) {
  if (caller.root_realpath !== authority.root_realpath && caller.root_realpath !== source.root_realpath) {
    throw contractError('worktree_mismatch', 'This checkout is not an allowed managed Run control root.', {
      caller_root: caller.root_realpath,
      authority_root: authority.root_realpath,
      source_root: source.root_realpath
    });
  }
}

async function resolveIdentity(deps, repoRoot, errorCode) {
  try {
    return await deps.resolveGitIdentity(path.resolve(repoRoot));
  } catch (error) {
    throw contractError(errorCode, 'Unable to resolve the Git worktree identity.', {
      path: path.resolve(repoRoot),
      cause: error.message
    });
  }
}

function requireStoryId(value) {
  const storyId = String(value ?? '').trim();
  if (!STORY_ID_PATTERN.test(storyId)
      || storyId.includes('..')
      || /[\\/%]/.test(storyId)
      || decodeSafely(storyId) !== storyId) {
    throw contractError('invalid_story_id', 'A valid registered Story id is required.', {
      story_id: value ?? null
    });
  }
  return storyId;
}

function requireActionProfile(value) {
  if (value !== 'legacy' && value !== 'autonomous') {
    throw contractError('invalid_action_profile', 'Action profile must be legacy or autonomous.', {
      action_profile: value ?? null
    });
  }
  return value;
}

function requireRunId(value) {
  const runId = String(value ?? '').trim();
  if (!RUN_ID_PATTERN.test(runId)
      || /[\\/%]/.test(runId)
      || decodeSafely(runId) !== runId) {
    throw contractError('invalid_run_id', 'A valid guarded Run id is required.', {
      run_id: value ?? null
    });
  }
  return runId;
}

function decodeSafely(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function generateRunId(createdAt, randomBytes) {
  const suffix = Buffer.from(randomBytes(4)).toString('hex');
  if (!/^[0-9a-f]{8}$/.test(suffix)) throw new Error('randomBytes must provide exactly four bytes');
  return `run-${formatRunTimestamp(createdAt)}-${suffix}`;
}

function formatRunTimestamp(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('now dependency returned an invalid date');
  return date.toISOString();
}

function isIsoTimestamp(value) {
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isTypedStopReason(value) {
  if (!isPlainRecord(value)
      || typeof value.code !== 'string' || value.code.length === 0
      || typeof value.message !== 'string' || value.message.length === 0) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'details')) return true;
  if (!isPlainRecord(value.details)) return false;
  return value.details.retry_policy_scope === undefined
    || ['managed', 'manual'].includes(value.details.retry_policy_scope);
}

function serializeState(state) {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function getRunsRoot(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'executions', storyId, 'runs');
}

function getRunStatePath(repoRoot, storyId, runId) {
  return path.join(getRunsRoot(repoRoot, storyId), runId, 'state.json');
}

function getLegacyStatePath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'executions', storyId, 'state.json');
}

function getCreationLockPath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'executions', storyId, '.run-creation.lock');
}

function contractError(code, message, details = {}) {
  return new GuardedRunError(code, message, details);
}

function assertClosedKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} set must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`Unknown ${label} key(s): ${unknown.join(', ')}`);
  }
}
