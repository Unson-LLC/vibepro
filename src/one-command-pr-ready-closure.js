import { setTimeout as wait } from 'node:timers/promises';

export const ONE_COMMAND_DEFAULT_PROVIDERS = Object.freeze(['codex', 'claude-code']);
export const ONE_COMMAND_MAX_REPAIR_ATTEMPTS = 3;

const RUNTIME_WAIT_CODES = new Set([
  'auth_denied',
  'permission_wait',
  'quota_exceeded',
  'runtime_probe_timeout',
  'runtime_required',
  'runtime_unavailable'
]);

/**
 * Production action owners for the autonomous safe-action DAG.
 *
 * This module deliberately owns policy only. Repository inspection, PR
 * preparation, and runtime transport are callback-injected by run-session so
 * this boundary never imports CLI, Gate, PR, or connector modules.
 */
export function createOneCommandPrReadyActionOwners(boundaries = {}) {
  assertKnownBoundaries(boundaries, [
    'readReadiness',
    'prepareCurrentHead',
    'dispatchRuntime',
    'pollRuntime',
    'cancelRuntime',
    'providerFallbacks',
    'runtimeTimeoutMs',
    'runtimePollIntervalMs',
    'waitForRuntimePoll',
    'maxRepairAttempts'
  ]);
  const readReadiness = requireBoundary(boundaries.readReadiness, 'readReadiness');
  const prepareCurrentHead = requireBoundary(boundaries.prepareCurrentHead, 'prepareCurrentHead');
  const dispatchRuntime = requireBoundary(boundaries.dispatchRuntime, 'dispatchRuntime');
  const pollRuntime = requireBoundary(boundaries.pollRuntime, 'pollRuntime');
  const cancelRuntime = requireBoundary(boundaries.cancelRuntime, 'cancelRuntime');
  const providerFallbacks = normalizeProviders(boundaries.providerFallbacks);
  const runtimeTimeoutMs = positiveInteger(boundaries.runtimeTimeoutMs ?? 30 * 60 * 1000, 'runtimeTimeoutMs');
  const runtimePollIntervalMs = positiveInteger(boundaries.runtimePollIntervalMs ?? 250, 'runtimePollIntervalMs');
  const waitForRuntimePoll = boundaries.waitForRuntimePoll ?? wait;
  requireBoundary(waitForRuntimePoll, 'waitForRuntimePoll');
  const maxRepairAttempts = positiveInteger(
    boundaries.maxRepairAttempts ?? ONE_COMMAND_MAX_REPAIR_ATTEMPTS,
    'maxRepairAttempts'
  );

  return Object.freeze({
    diagnose: async (context) => {
      const readiness = await readReadiness(context);
      const humanDecision = normalizeHumanDecision(readiness?.human_decision);
      const missing = collectMissingArtifacts(readiness);
      return {
        status: 'continue',
        artifact: readinessArtifact(readiness),
        diagnosis: {
          missing_artifacts: missing,
          material_decision_required: humanDecision !== null
        },
        summary: humanDecision
          ? 'diagnosis found a material decision that prepare_artifacts must persist'
          : missing.length > 0
          ? `diagnosed ${missing.length} missing prerequisite artifact(s)`
          : 'prerequisite diagnosis is complete'
      };
    },

    prepare_artifacts: async (context) => {
      const readiness = await readReadiness(context);
      const humanDecision = normalizeHumanDecision(readiness?.human_decision);
      if (humanDecision) {
        return {
          status: 'waiting_for_human',
          stop_reason: 'human_decision_required',
          human_decision: humanDecision,
          artifact: readinessArtifact(readiness),
          summary: humanDecision.material_reason
        };
      }
      const missing = collectMissingArtifacts(readiness);
      if (missing.length === 0) {
        return {
          status: 'continue',
          artifact: readinessArtifact(readiness),
          summary: 'required Story, Architecture, Spec, and Task artifacts already exist'
        };
      }
      return runImplementationRuntime({
        context,
        actionKind: 'prepare-artifacts',
        objective: buildArtifactObjective(context.state, missing),
        dispatchRuntime,
        pollRuntime,
        cancelRuntime,
        providerFallbacks,
        runtimeTimeoutMs,
        runtimePollIntervalMs,
        waitForRuntimePoll,
        requireHeadAdvance: true
      });
    },

    implement: async (context) => runImplementationRuntime({
      context,
      actionKind: 'implement',
      objective: buildImplementationObjective(context.state),
      dispatchRuntime,
      pollRuntime,
      cancelRuntime,
      providerFallbacks,
      runtimeTimeoutMs,
      runtimePollIntervalMs,
      waitForRuntimePoll,
      requireHeadAdvance: false
    }),

    verify: async (context) => {
      const prepared = await prepareCurrentHead(context);
      const gate = gateStatus(prepared);
      if (hasExplicitVerificationFailure(prepared, gate)) {
        return {
          status: 'blocked',
          stop_reason: 'verification_failed',
          artifact: readinessArtifact(prepared),
          recovery: { required_actions: requiredActions(gate) },
          summary: 'current-HEAD verification failed'
        };
      }
      return {
        status: 'continue',
        artifact: readinessArtifact(prepared),
        verification: {
          current_head_sha: context.state.current_head_sha,
          required_actions: requiredActions(gate)
        },
        summary: 'current-HEAD verification evidence was refreshed'
      };
    },

    repair: async (context) => {
      const review = latestReviewResult(context.state);
      if (!review || review.verdict === 'pass') {
        return { status: 'continue', summary: 'independent review has no outstanding changes' };
      }
      if (review.verdict !== 'needs_changes') {
        return {
          status: 'blocked',
          stop_reason: 'review_blocked',
          recovery: { review },
          summary: 'independent review did not authorize automated repair'
        };
      }
      const attempt = repairAttemptCount(context.state) + 1;
      if (attempt > maxRepairAttempts) {
        return {
          status: 'blocked',
          stop_reason: 'repair_convergence_exhausted',
          recovery: { attempts: attempt - 1, max_attempts: maxRepairAttempts, findings: review.findings },
          summary: `repair did not converge after ${maxRepairAttempts} attempts`
        };
      }
      const result = await runImplementationRuntime({
        context,
        actionKind: `repair-${attempt}`,
        objective: buildRepairObjective(context.state, review, attempt, maxRepairAttempts),
        dispatchRuntime,
        pollRuntime,
        cancelRuntime,
        providerFallbacks,
        runtimeTimeoutMs,
        runtimePollIntervalMs,
        waitForRuntimePoll,
        requireHeadAdvance: true
      });
      if (result.status !== 'continue') return result;
      return {
        ...result,
        replay_from_action_id: 'verify',
        repair_attempt: attempt,
        summary: `repair attempt ${attempt} completed; verification and review must replay`
      };
    },

    final_prepare: async (context) => {
      const prepared = await prepareCurrentHead(context);
      const gate = gateStatus(prepared);
      const artifact = readinessArtifact(prepared);
      const preparedHeadSha = preparationHeadSha(prepared);
      if (!preparedHeadSha || preparedHeadSha !== context.state.current_head_sha) {
        return {
          status: 'blocked',
          stop_reason: 'gate_recheck_required',
          artifact,
          recovery: {
            required_actions: ['Re-run PR preparation for the authoritative current HEAD.'],
            prepared_head_sha: preparedHeadSha,
            current_head_sha: context.state.current_head_sha
          },
          summary: 'PR readiness evidence is not bound to the authoritative current HEAD'
        };
      }
      if (gate.ready_for_pr_create === true) {
        return {
          status: 'pr_ready',
          artifact,
          gate_status: gate,
          output_head_sha: preparedHeadSha,
          summary: 'current HEAD is PR-ready'
        };
      }
      const actions = requiredActions(gate);
      const ciPending = gate.ci_pending === true
        || actions.some((item) => /\bci\b|check run|workflow/i.test(String(item)));
      return {
        status: 'blocked',
        stop_reason: ciPending ? 'ci_pending' : 'gate_recheck_required',
        artifact,
        recovery: { required_actions: actions },
        summary: ciPending
          ? 'CI evidence is still pending for the current HEAD'
          : 'the current-HEAD PR readiness gate requires more evidence'
      };
    }
  });
}

export function createOneCommandPrReadyRunSessionOwners(boundaries = {}) {
  assertKnownBoundaries(boundaries, [
    'repoRoot',
    'storyId',
    'baseRef',
    'providerFallbacks',
    'agentRuntimeCoordinator',
    'readGateReadiness',
    'preparePullRequest',
    'mutateRuntimeDispatch'
  ]);
  const {
    repoRoot,
    storyId,
    baseRef,
    providerFallbacks,
    agentRuntimeCoordinator,
    readGateReadiness,
    preparePullRequest,
    mutateRuntimeDispatch
  } = boundaries;
  return createOneCommandPrReadyActionOwners({
    readReadiness: async () => {
      const readiness = await readGateReadiness(repoRoot, { storyId });
      return {
        ...readiness,
        human_decision: readiness?.human_decision ?? deriveMaterialHumanDecision(readiness, storyId)
      };
    },
    prepareCurrentHead: async () => preparePullRequest(repoRoot, { storyId, baseRef }),
    dispatchRuntime: async ({ state, request }) => agentRuntimeCoordinator
      ? mutateRuntimeDispatch({
        storyId: state.story_id,
        runId: state.run_id,
        request
      }, 'dispatch')
      : {
        state,
        dispatch: {
          status: 'failed',
          stop_reason: { code: 'runtime_required', message: 'No guarded agent runtime is connected.' }
        }
      },
    pollRuntime: async ({ state, dispatch }) => mutateRuntimeDispatch({
      storyId: state.story_id,
      runId: state.run_id,
      dispatchId: dispatch.dispatch_id
    }, 'poll'),
    cancelRuntime: async ({ state, dispatch }) => mutateRuntimeDispatch({
      storyId: state.story_id,
      runId: state.run_id,
      dispatchId: dispatch.dispatch_id
    }, 'cancel'),
    providerFallbacks
  });
}

export function bindCurrentHeadFinalPrepare({
  owner,
  preparePullRequest,
  repoRoot,
  storyId,
  baseRef
}) {
  return async (context) => {
    const ownerResult = await owner(context);
    if (ownerResult.status !== 'pr_ready') return ownerResult;
    const prepared = await preparePullRequest(repoRoot, { storyId, baseRef });
    const preparedHeadSha = preparationHeadSha(prepared);
    if (!preparedHeadSha || preparedHeadSha !== context.state.current_head_sha) {
      return {
        status: 'blocked',
        stop_reason: 'gate_recheck_required',
        artifact: ownerResult.artifact ?? readinessArtifact(prepared),
        recovery: {
          required_actions: ['Re-run PR preparation for the authoritative current HEAD.'],
          prepared_head_sha: preparedHeadSha,
          current_head_sha: context.state.current_head_sha
        }
      };
    }
    if (gateStatus(prepared).ready_for_pr_create === true) {
      return {
        ...ownerResult,
        artifact: ownerResult.artifact ?? readinessArtifact(prepared),
        output_head_sha: preparedHeadSha
      };
    }
    return {
      status: 'blocked',
      stop_reason: 'gate_recheck_required',
      artifact: ownerResult.artifact ?? readinessArtifact(prepared),
      recovery: { required_actions: requiredActions(gateStatus(prepared)) }
    };
  };
}

export async function persistOneCommandHumanDecision({
  repoRoot,
  state,
  request,
  now,
  createDecision,
  isDecisionError
}) {
  if (!request) {
    return {
      state,
      status: 'failed',
      stopReason: {
        code: 'invalid_human_decision',
        message: 'The action owner requested a human decision without a validated descriptor.',
        details: {}
      }
    };
  }
  try {
    const { stop_node_id: stopNodeId, ...decisionInput } = request;
    const decision = await createDecision(repoRoot, state, decisionInput, { now });
    const artifact = `.vibepro/executions/${state.story_id}/runs/${state.run_id}/decisions/${decision.decision_id}.json`;
    const nextCommand = [
      'vibepro execute resume',
      shellQuote(repoRoot),
      '--story-id',
      shellQuote(state.story_id),
      '--run-id',
      shellQuote(state.run_id),
      '--decision',
      shellQuote(decision.decision_id),
      '--answer',
      '<answer>',
      '--until pr-ready'
    ].join(' ');
    return {
      state: {
        ...state,
        pending_decision: {
          decision_id: decision.decision_id,
          type: decision.type,
          question: decision.question,
          choices: decision.choices,
          material_reason: decision.material_reason,
          impact_scope: decision.impact_scope,
          source_refs: decision.source_refs,
          stop_node_id: stopNodeId,
          artifact,
          resume_command: nextCommand
        }
      },
      status: 'waiting_for_human',
      stopReason: {
        code: 'human_decision_required',
        message: decision.material_reason,
        details: {
          decision_id: decision.decision_id,
          question: decision.question,
          choices: decision.choices,
          recovery: {
            required_actions: [`Answer the persisted decision ${decision.decision_id}.`],
            next_command: nextCommand
          }
        }
      }
    };
  } catch (error) {
    if (!isDecisionError(error)) throw error;
    return {
      state,
      status: 'failed',
      stopReason: { code: error.code, message: error.message, details: error.details }
    };
  }
}

async function runImplementationRuntime({
  context,
  actionKind,
  objective,
  dispatchRuntime,
  pollRuntime,
  cancelRuntime,
  providerFallbacks,
  runtimeTimeoutMs,
  runtimePollIntervalMs,
  waitForRuntimePoll,
  requireHeadAdvance
}) {
  const request = {
    adapter_id: providerFallbacks[0],
    provider_fallbacks: providerFallbacks,
    task_id: `${context.state.story_id}:${actionKind}`,
    role: 'implementation',
    objective,
    requirements: {
      capabilities: ['workspace_write'],
      timeout_ms: runtimeTimeoutMs,
      managed_worktree: resolveManagedWorktree(context.state)
    }
  };
  let observed = await dispatchRuntime({ ...context, request, providerFallbacks });
  const deadline = Date.now() + runtimeTimeoutMs;
  if (observed?.reused && isRuntimePermissionWait(observed) && Date.now() < deadline) {
    observed = await pollRuntime({
      ...context,
      state: observed.state ?? context.state,
      dispatch: observed.dispatch,
      request,
      providerFallbacks
    });
  }
  while (isRuntimeActive(observed) && Date.now() < deadline) {
    await waitForRuntimePoll(runtimePollIntervalMs);
    observed = await pollRuntime({
      ...context,
      state: observed.state ?? context.state,
      dispatch: observed.dispatch,
      request,
      providerFallbacks
    });
  }
  if (isRuntimeActive(observed)) {
    const dispatch = observed?.dispatch ?? observed;
    let contained;
    try {
      contained = await cancelRuntime({
        ...context,
        state: observed.state ?? context.state,
        dispatch,
        request,
        providerFallbacks
      });
    } catch (error) {
      return orphanedRuntimeResult(dispatch, error);
    }
    if (isRuntimeActive(contained) || !isRuntimeTerminal(contained)) {
      return orphanedRuntimeResult(
        contained?.dispatch ?? dispatch,
        new Error('runtime cancellation did not confirm a terminal dispatch')
      );
    }
    const containedDispatch = contained?.dispatch ?? contained;
    if (containedDispatch?.status === 'failed' || containedDispatch?.status === 'completed') {
      return runtimeActionResult(contained, context.state.current_head_sha, requireHeadAdvance);
    }
    return {
      status: 'waiting_for_runtime',
      stop_reason: 'runtime_probe_timeout',
      runtime_dispatch: containedDispatch ?? dispatch ?? null,
      recovery: {
        dispatch_id: dispatch?.dispatch_id ?? null,
        containment_status: containedDispatch?.status ?? null
      },
      summary: `runtime dispatch exceeded ${runtimeTimeoutMs}ms and was contained before retry`
    };
  }
  return runtimeActionResult(observed, context.state.current_head_sha, requireHeadAdvance);
}

function runtimeActionResult(observed, inputHeadSha, requireHeadAdvance) {
  const dispatch = observed?.dispatch ?? observed;
  const runtimeState = observed?.state;
  const code = dispatch?.stop_reason?.code ?? runtimeState?.stop_reason?.code ?? null;
  if (isRuntimeActive(observed)) {
    return {
      status: 'waiting_for_runtime',
      stop_reason: code ?? 'runtime_required',
      runtime_dispatch: dispatch ?? null,
      recovery: { dispatch_id: dispatch?.dispatch_id ?? null },
      summary: dispatch?.stop_reason?.message ?? 'implementation runtime is still active'
    };
  }
  if (dispatch?.status !== 'completed') {
    return {
      status: RUNTIME_WAIT_CODES.has(code) ? 'waiting_for_runtime' : 'failed',
      stop_reason: code ?? 'runtime_failed',
      runtime_dispatch: dispatch ?? null,
      recovery: { dispatch_id: dispatch?.dispatch_id ?? null },
      summary: dispatch?.stop_reason?.message ?? `implementation runtime ended with ${dispatch?.status ?? 'an unknown status'}`
    };
  }
  const result = dispatch.result ?? {};
  const outputHeadSha = result.head_sha ?? dispatch.output_head_sha ?? inputHeadSha;
  if (requireHeadAdvance && outputHeadSha === inputHeadSha) {
    return {
      status: 'blocked',
      stop_reason: 'no_progress',
      output_head_sha: outputHeadSha,
      runtime_dispatch: dispatch,
      recovery: { dispatch_id: dispatch.dispatch_id, changed_files: result.changed_files ?? [] },
      summary: 'runtime completed without advancing the managed-worktree HEAD'
    };
  }
  return {
    status: 'continue',
    output_head_sha: outputHeadSha,
    runtime_dispatch: dispatch,
    changed_files: result.changed_files ?? [],
    test_suggestions: result.test_suggestions ?? [],
    summary: result.summary ?? 'implementation runtime completed'
  };
}

function isRuntimeActive(observed) {
  const status = observed?.dispatch?.status ?? observed?.status;
  return ['queued', 'running'].includes(status);
}

function isRuntimePermissionWait(observed) {
  return (observed?.dispatch?.status ?? observed?.status) === 'permission_wait';
}

function isRuntimeTerminal(observed) {
  const status = observed?.dispatch?.status ?? observed?.status;
  return ['completed', 'failed', 'cancelled', 'timed_out'].includes(status);
}

function orphanedRuntimeResult(dispatch, error) {
  return {
    status: 'failed',
    stop_reason: 'orphaned_agent',
    runtime_dispatch: dispatch ?? null,
    recovery: {
      dispatch_id: dispatch?.dispatch_id ?? null,
      containment_error: error?.message ?? String(error)
    },
    summary: 'runtime dispatch containment could not be confirmed after the owner deadline'
  };
}

function buildArtifactObjective(state, missing) {
  return [
    `Prepare only the missing VibePro planning artifacts for Story ${state.story_id}: ${missing.join(', ')}.`,
    'Use the canonical Story -> Architecture -> Spec -> Task flow and the managed worktree.',
    'Validate the created artifacts, commit one focused change, and report the actual current HEAD.',
    'Do not create or merge a PR, waive a gate, deploy, publish, or perform another external side effect.'
  ].join(' ');
}

function buildImplementationObjective(state) {
  return [
    `Implement the approved VibePro Task scope for Story ${state.story_id} in the managed worktree.`,
    'Follow the canonical Architecture and Spec, run focused verification, and commit one focused change.',
    'Do not create or merge a PR, waive a gate, deploy, publish, or perform another external side effect.',
    'Return the actual current HEAD, changed files, and suggested verification commands.'
  ].join(' ');
}

function buildRepairObjective(state, review, attempt, maxAttempts) {
  return [
    `Repair independent-review findings for Story ${state.story_id} (attempt ${attempt} of ${maxAttempts}).`,
    `Findings: ${JSON.stringify(review.findings ?? [])}.`,
    'Change only the approved Task scope, run focused verification, and commit one focused repair.',
    'Do not create or merge a PR, waive a gate, deploy, publish, or perform another external side effect.',
    'Return the actual current HEAD so VibePro can rebind verification and independent review.'
  ].join(' ');
}

function latestReviewResult(state) {
  const entry = (state.action_journal ?? [])
    .findLast((item) => item.action_id === 'review' && item.status === 'completed');
  if (!entry) return null;
  const records = Array.isArray(entry.checkpoint)
    ? entry.checkpoint.filter((item) => item?.operation === 'record' && item?.result)
    : [];
  const recordedVerdicts = records.map((item) => item.result.verdict).filter(Boolean);
  const checkpointVerdict = recordedVerdicts.includes('block')
    ? 'block'
    : recordedVerdicts.includes('needs_changes')
      ? 'needs_changes'
      : recordedVerdicts.length > 0
        ? 'pass'
        : null;
  const checkpointFindings = records.flatMap((item) =>
    Array.isArray(item.result.findings) ? item.result.findings : []);
  const legacyCheckpoint = Array.isArray(entry.checkpoint) ? entry.checkpoint.findLast(() => true) : null;
  const summary = entry.details?.summary ?? entry.summary ?? entry.result_summary ?? null;
  return {
    verdict: entry.details?.verdict
      ?? entry.verdict
      ?? checkpointVerdict
      ?? legacyCheckpoint?.verdict
      ?? (/requested changes|needs_changes/i.test(String(summary)) ? 'needs_changes' : 'pass'),
    findings: entry.details?.findings
      ?? entry.details?.review?.findings
      ?? entry.findings
      ?? (checkpointFindings.length > 0 ? checkpointFindings : null)
      ?? legacyCheckpoint?.findings
      ?? [],
    summary
  };
}

function deriveMaterialHumanDecision(readiness, storyId) {
  const unresolved = [
    ...(Array.isArray(readiness?.unresolved_gates) ? readiness.unresolved_gates : []),
    ...(Array.isArray(readiness?.critical_unresolved_gates) ? readiness.critical_unresolved_gates : [])
  ];
  const material = unresolved.find((gate) => {
    const id = String(gate?.id ?? '');
    const reason = String(gate?.reason ?? '');
    return /story_source_integrity|story_contract/.test(id)
      && /\b(?:needs[_ -]?clarification|ambiguous|clarif(?:y|ication)|scope split)\b/i.test(reason);
  });
  if (!material) return null;
  const gateId = requireText(material.id, 'material decision gate id');
  return {
    type: /split/i.test(String(material.reason)) ? 'scope_split' : 'clarification',
    question: `How should ${storyId} resolve the material Story contract ambiguity reported by ${gateId}?`,
    choices: ['Clarify the bounded Story contract', 'Split the ambiguous scope into a separate Story'],
    material_reason: String(material.reason ?? `${gateId} requires a material Story decision.`),
    impact_scope: ['Story contract', 'implementation authorization boundary'],
    source_refs: [`gate:${gateId}`, `story:${storyId}`],
    stop_node_id: 'prepare_artifacts'
  };
}

function repairAttemptCount(state) {
  return (state.action_journal ?? []).filter((entry) =>
    entry.action_id === 'repair'
    && entry.status === 'completed'
  ).length;
}

function collectMissingArtifacts(readiness) {
  const explicit = readiness?.missing_artifacts ?? readiness?.required_artifacts;
  if (Array.isArray(explicit)) return [...new Set(explicit.map(String).filter(Boolean))];
  const unresolved = Array.isArray(readiness?.unresolved_gates)
    ? readiness.unresolved_gates.flatMap((gate) => [gate?.id, gate?.reason]).filter(Boolean)
    : [];
  return [...new Set([
    ...requiredActions(gateStatus(readiness)),
    ...unresolved
  ].filter((item) => /story|architecture|spec|task|artifact/i.test(String(item))).map(String))];
}

function hasExplicitVerificationFailure(prepared, gate) {
  if (prepared?.verification_passed === false || prepared?.verification_status === 'failed') return true;
  if (gate.verification_passed === false || gate.verification_status === 'failed') return true;
  return requiredActions(gate).some((item) => /verification failed|test failed|record verification/i.test(String(item)));
}

function gateStatus(value) {
  return value?.preparation?.gate_status
    ?? value?.gate_status
    ?? (value && Object.hasOwn(value, 'ready_for_pr_create') ? value : {});
}

function requiredActions(gate) {
  return Array.isArray(gate?.next_required_actions) ? gate.next_required_actions : [];
}

function readinessArtifact(value) {
  return value?.artifacts?.json ?? value?.artifact ?? null;
}

function preparationHeadSha(value) {
  return value?.git?.head_sha
    ?? value?.preparation?.git?.head_sha
    ?? value?.preparation?.head_sha
    ?? null;
}

function normalizeHumanDecision(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object') throw new TypeError('human_decision must be an object');
  const decision = {
    type: requireText(value.type, 'human_decision.type'),
    question: requireText(value.question, 'human_decision.question'),
    choices: requireTextArray(value.choices, 'human_decision.choices'),
    material_reason: requireText(value.material_reason, 'human_decision.material_reason'),
    impact_scope: requireTextArray(value.impact_scope, 'human_decision.impact_scope'),
    source_refs: requireTextArray(value.source_refs, 'human_decision.source_refs'),
    stop_node_id: requireText(value.stop_node_id, 'human_decision.stop_node_id')
  };
  if (decision.choices.length < 2) throw new TypeError('human_decision.choices requires at least two choices');
  return decision;
}

function normalizeProviders(value) {
  const providers = Array.isArray(value) && value.length > 0 ? value : ONE_COMMAND_DEFAULT_PROVIDERS;
  const normalized = [...new Set(providers.map((item) => requireText(item, 'providerFallbacks')))];
  if (normalized.length === 0) throw new TypeError('providerFallbacks requires at least one provider');
  return normalized;
}

function resolveManagedWorktree(state) {
  return requireText(
    state.managed_worktree?.path ?? state.execution_context?.root_realpath,
    'managed worktree'
  );
}

function requireBoundary(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} boundary must be a function`);
  return value;
}

function assertKnownBoundaries(boundaries, allowed) {
  const unknown = Object.keys(boundaries).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new TypeError(`Unknown one-command authority boundary: ${unknown.join(', ')}`);
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function requireTextArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${name} must be a non-empty array`);
  return value.map((item) => requireText(item, name));
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(text)
    ? text
    : `'${text.replaceAll("'", "'\\''")}'`;
}
