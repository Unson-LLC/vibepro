import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createAgentRuntimeCoordinator } from '../src/agent-runtime-adapter.js';
import { createCliRuntimeConnector } from '../src/agent-runtime-connectors.js';
import {
  createOneCommandPrReadyActionOwners,
  createOneCommandPrReadyRunSessionOwners,
  ONE_COMMAND_DEFAULT_PROVIDERS,
  ONE_COMMAND_MAX_REPAIR_ATTEMPTS
} from '../src/one-command-pr-ready-closure.js';

const headA = 'a'.repeat(40);
const headB = 'b'.repeat(40);
const baseState = {
  story_id: 'story-one-command',
  run_id: 'run-one-command',
  current_head_sha: headA,
  action_journal: [],
  managed_worktree: { path: '/managed', branch: 'vibepro/story-one-command' },
  execution_context: { root_realpath: '/managed', branch: 'vibepro/story-one-command' }
};

function context(state = baseState, actionId = 'implement') {
  return { state, action: { id: actionId } };
}

function completedRuntime(request, headSha = headB) {
  return {
    state: { ...baseState, current_head_sha: headSha },
    dispatch: {
      dispatch_id: `dispatch-${request.task_id}`,
      status: 'completed',
      result: {
        completion_status: 'completed',
        changed_files: ['src/change.js'],
        head_sha: headSha,
        test_suggestions: ['node --test test/change.test.js'],
        summary: 'implemented'
      }
    }
  };
}

function boundaries(overrides = {}) {
  return {
    readReadiness: async () => ({ missing_artifacts: [] }),
    prepareCurrentHead: async () => ({
      artifacts: { json: '/managed/.vibepro/pr/story/pr-prepare.json' },
      git: { head_sha: headA },
      preparation: { gate_status: { ready_for_pr_create: true, next_required_actions: [] } }
    }),
    dispatchRuntime: async ({ request }) => completedRuntime(request),
    pollRuntime: async ({ dispatch, state }) => ({ dispatch, state }),
    cancelRuntime: async ({ dispatch, state }) => ({
      state,
      dispatch: {
        ...dispatch,
        status: 'cancelled',
        stop_reason: { code: 'runtime_cancelled', message: 'cancelled by owner deadline' }
      }
    }),
    runtimePollIntervalMs: 1,
    waitForRuntimePoll: async () => {},
    ...overrides
  };
}

test('OCR-T-1 production owners use ordered default providers and transmit a bounded implementation objective', async () => {
  let captured;
  const owners = createOneCommandPrReadyActionOwners(boundaries({
    dispatchRuntime: async (input) => {
      captured = input;
      return completedRuntime(input.request);
    }
  }));
  const result = await owners.implement(context());
  assert.deepEqual(ONE_COMMAND_DEFAULT_PROVIDERS, ['codex', 'claude-code']);
  assert.equal(captured.request.adapter_id, 'codex');
  assert.deepEqual(captured.request.provider_fallbacks, ['codex', 'claude-code']);
  assert.equal(captured.request.role, 'implementation');
  assert.deepEqual(captured.request.requirements.capabilities, ['workspace_write']);
  assert.equal(captured.request.requirements.managed_worktree, '/managed');
  assert.match(captured.request.objective, /Implement the approved VibePro Task scope/);
  assert.match(captured.request.objective, /Do not create or merge a PR/);
  assert.equal(result.status, 'continue');
  assert.equal(result.output_head_sha, headB);
});

test('OCR-T-3 production-shaped runtime keeps polling the same running dispatch through completion', async () => {
  const dispatch = {
    dispatch_id: 'dispatch-running-owner',
    status: 'running'
  };
  const polledDispatchIds = [];
  let polls = 0;
  const owners = createOneCommandPrReadyActionOwners(boundaries({
    dispatchRuntime: async () => ({ state: baseState, dispatch }),
    pollRuntime: async ({ dispatch: observed }) => {
      polledDispatchIds.push(observed.dispatch_id);
      polls += 1;
      if (polls < 3) return { state: baseState, dispatch: { ...observed, status: 'running' } };
      return {
        state: { ...baseState, current_head_sha: headB },
        dispatch: {
          ...observed,
          status: 'completed',
          result: {
            completion_status: 'completed',
            changed_files: ['src/change.js'],
            head_sha: headB,
            test_suggestions: ['node --test test/change.test.js'],
            summary: 'completed after poll'
          }
        }
      };
    }
  }));
  const result = await owners.implement(context());
  assert.deepEqual(polledDispatchIds, [
    dispatch.dispatch_id,
    dispatch.dispatch_id,
    dispatch.dispatch_id
  ]);
  assert.equal(result.status, 'continue');
  assert.equal(result.runtime_dispatch.dispatch_id, dispatch.dispatch_id);
  assert.equal(result.output_head_sha, headB);
});

test('OCR-T-3 runtime timeout and cancellation remain typed, contained stops', async () => {
  const dispatch = { dispatch_id: 'dispatch-contained', status: 'running' };
  const cancellations = [];
  const timedOut = createOneCommandPrReadyActionOwners(boundaries({
    runtimeTimeoutMs: 1,
    waitForRuntimePoll: async () => new Promise((resolve) => setTimeout(resolve, 2)),
    dispatchRuntime: async () => ({ state: baseState, dispatch }),
    pollRuntime: async () => ({ state: baseState, dispatch }),
    cancelRuntime: async ({ dispatch: active }) => {
      cancellations.push(active.dispatch_id);
      return { state: baseState, dispatch: { ...active, status: 'cancelled' } };
    }
  }));
  const timeout = await timedOut.implement(context());
  assert.equal(timeout.status, 'waiting_for_runtime');
  assert.equal(timeout.stop_reason, 'runtime_probe_timeout');
  assert.equal(timeout.recovery.dispatch_id, dispatch.dispatch_id);
  assert.equal(timeout.recovery.containment_status, 'cancelled');
  assert.deepEqual(cancellations, [dispatch.dispatch_id]);

  const cancelled = createOneCommandPrReadyActionOwners(boundaries({
    dispatchRuntime: async () => ({
      state: baseState,
      dispatch: {
        ...dispatch,
        status: 'cancelled',
        stop_reason: { code: 'runtime_cancelled', message: 'cancelled by runtime' }
      }
    })
  }));
  const cancellation = await cancelled.implement(context());
  assert.equal(cancellation.status, 'failed');
  assert.equal(cancellation.stop_reason, 'runtime_cancelled');
  assert.equal(cancellation.runtime_dispatch.dispatch_id, dispatch.dispatch_id);
});

test('OCR-T-4 owner deadline fails closed when dispatch containment is not terminal', async () => {
  const dispatch = { dispatch_id: 'dispatch-orphaned', status: 'running' };
  const owners = createOneCommandPrReadyActionOwners(boundaries({
    runtimeTimeoutMs: 1,
    waitForRuntimePoll: async () => new Promise((resolve) => setTimeout(resolve, 2)),
    dispatchRuntime: async () => ({ state: baseState, dispatch }),
    pollRuntime: async () => ({ state: baseState, dispatch }),
    cancelRuntime: async () => ({ state: baseState, dispatch })
  }));
  const result = await owners.implement(context());
  assert.equal(result.status, 'failed');
  assert.equal(result.stop_reason, 'orphaned_agent');
  assert.equal(result.recovery.dispatch_id, dispatch.dispatch_id);
  assert.match(result.recovery.containment_error, /did not confirm a terminal dispatch/);
});

test('OCR-T-4 owner deadline preserves a production-shaped orphaned containment failure', async () => {
  const dispatch = { dispatch_id: 'dispatch-production-orphan', status: 'running' };
  const owners = createOneCommandPrReadyActionOwners(boundaries({
    runtimeTimeoutMs: 1,
    waitForRuntimePoll: async () => new Promise((resolve) => setTimeout(resolve, 2)),
    dispatchRuntime: async () => ({ state: baseState, dispatch }),
    pollRuntime: async () => ({ state: baseState, dispatch }),
    cancelRuntime: async () => ({
      state: {
        ...baseState,
        stop_reason: {
          code: 'orphaned_agent',
          message: 'runtime remained active after normal and force cancellation'
        }
      },
      dispatch: {
        ...dispatch,
        status: 'failed',
        stop_reason: {
          code: 'orphaned_agent',
          message: 'runtime remained active after normal and force cancellation'
        }
      }
    })
  }));
  const result = await owners.implement(context());
  assert.equal(result.status, 'failed');
  assert.equal(result.stop_reason, 'orphaned_agent');
  assert.equal(result.runtime_dispatch.dispatch_id, dispatch.dispatch_id);
  assert.match(result.summary, /remained active/);
});

test('OCR-T-2 missing artifacts are delegated only when needed and no-progress fails closed', async () => {
  let dispatches = 0;
  const owners = createOneCommandPrReadyActionOwners(boundaries({
    readReadiness: async () => ({ missing_artifacts: ['Architecture', 'Spec'] }),
    dispatchRuntime: async ({ request }) => {
      dispatches += 1;
      assert.match(request.objective, /Architecture, Spec/);
      return completedRuntime(request, headA);
    }
  }));
  const result = await owners.prepare_artifacts(context(baseState, 'prepare_artifacts'));
  assert.equal(dispatches, 1);
  assert.equal(result.status, 'blocked');
  assert.equal(result.stop_reason, 'no_progress');

  const noMissing = createOneCommandPrReadyActionOwners(boundaries({
    dispatchRuntime: async () => {
      throw new Error('runtime must not be called');
    }
  }));
  assert.equal((await noMissing.prepare_artifacts(context(baseState, 'prepare_artifacts'))).status, 'continue');
});

test('OCR-T-3 implementation completion fails closed when the managed HEAD does not advance', async () => {
  const owners = createOneCommandPrReadyActionOwners(boundaries({
    dispatchRuntime: async ({ request }) => completedRuntime(request, headA)
  }));

  const result = await owners.implement(context());

  assert.equal(result.status, 'blocked');
  assert.equal(result.stop_reason, 'no_progress');
  assert.equal(result.output_head_sha, headA);
  assert.match(result.summary, /without advancing the managed-worktree HEAD/);
});

test('OCR-T-2 material ambiguity returns exactly the bounded seven-field Human Decision descriptor', async () => {
  const descriptor = {
    type: 'scope_split',
    question: 'Should this Story split the external deployment?',
    choices: ['Keep repository-local scope', 'Split the deployment'],
    material_reason: 'The choice changes the authorized side-effect boundary.',
    impact_scope: ['Story scope', 'deployment ownership'],
    source_refs: ['docs/architecture/story-one-command.md'],
    stop_node_id: 'prepare_artifacts'
  };
  const owners = createOneCommandPrReadyActionOwners(boundaries({
    readReadiness: async () => ({ human_decision: descriptor })
  }));
  const diagnosis = await owners.diagnose(context(baseState, 'diagnose'));
  assert.equal(diagnosis.status, 'continue');
  assert.equal(diagnosis.diagnosis.material_decision_required, true);
  const result = await owners.prepare_artifacts(context(baseState, 'prepare_artifacts'));
  assert.equal(result.status, 'waiting_for_human');
  assert.equal(result.stop_reason, 'human_decision_required');
  assert.deepEqual(Object.keys(result.human_decision).sort(), Object.keys(descriptor).sort());
  assert.deepEqual(result.human_decision, descriptor);
});

test('OCR-T-2 production readiness converts only explicit Story contract ambiguity into a Human Decision', async () => {
  const common = {
    repoRoot: '/managed',
    storyId: baseState.story_id,
    baseRef: 'origin/main',
    agentRuntimeCoordinator: {},
    preparePullRequest: async () => ({}),
    mutateRuntimeDispatch: async () => {
      throw new Error('runtime must not be called for a material decision');
    }
  };
  const material = createOneCommandPrReadyRunSessionOwners({
    ...common,
    readGateReadiness: async () => ({
      unresolved_gates: [{
        id: 'gate:story_source_integrity',
        reason: 'Story contract needs clarification before implementation'
      }]
    })
  });
  const result = await material.prepare_artifacts(context(baseState, 'prepare_artifacts'));
  assert.equal(result.status, 'waiting_for_human');
  assert.equal(result.human_decision.type, 'clarification');
  assert.deepEqual(Object.keys(result.human_decision).sort(), [
    'choices',
    'impact_scope',
    'material_reason',
    'question',
    'source_refs',
    'stop_node_id',
    'type'
  ]);

  const evidenceGap = createOneCommandPrReadyRunSessionOwners({
    ...common,
    readGateReadiness: async () => ({
      unresolved_gates: [{
        id: 'gate:verification',
        reason: 'Record verification evidence for the current HEAD'
      }]
    })
  });
  assert.equal((await evidenceGap.diagnose(context(baseState, 'diagnose')))
    .diagnosis.material_decision_required, false);
});

test('OCR-T-2 missing or malformed Human Decision descriptors fail closed before persistence', async () => {
  const valid = {
    type: 'scope_split',
    question: 'Choose the authorized boundary?',
    choices: ['preserve', 'split'],
    material_reason: 'The answer changes the authorized scope.',
    impact_scope: ['Story scope'],
    source_refs: ['story:OCR-T-2'],
    stop_node_id: 'prepare_artifacts'
  };
  for (const field of Object.keys(valid)) {
    const malformed = { ...valid };
    delete malformed[field];
    const owners = createOneCommandPrReadyActionOwners(boundaries({
      readReadiness: async () => ({ human_decision: malformed })
    }));
    await assert.rejects(
      owners.prepare_artifacts(context(baseState, 'prepare_artifacts')),
      new RegExp(`human_decision\\.${field}`)
    );
  }
  const invalidChoices = createOneCommandPrReadyActionOwners(boundaries({
    readReadiness: async () => ({ human_decision: { ...valid, choices: ['only-one'] } })
  }));
  await assert.rejects(
    invalidChoices.prepare_artifacts(context(baseState, 'prepare_artifacts')),
    /at least two choices/
  );
});

test('OCR-T-2 production owner boundary rejects every external authority seam without invoking it', () => {
  const forbidden = [
    'createPullRequest',
    'mergePullRequest',
    'grantWaiver',
    'deploy',
    'publish',
    'performMaterialExternalSideEffect'
  ];
  for (const name of forbidden) {
    let invoked = false;
    assert.throws(
      () => createOneCommandPrReadyActionOwners(boundaries({
        [name]: () => {
          invoked = true;
          throw new Error('forbidden authority invoked');
        }
      })),
      new RegExp(`Unknown one-command authority boundary: ${name}`)
    );
    assert.equal(invoked, false);
  }
});

test('OCR-T-3 verification and final prepare remain bound to typed current-HEAD Gate outcomes', async () => {
  const failedVerify = createOneCommandPrReadyActionOwners(boundaries({
    prepareCurrentHead: async () => ({
      verification_passed: false,
      git: { head_sha: headA },
      preparation: { gate_status: { next_required_actions: ['verification failed: focused tests'] } }
    })
  }));
  const verify = await failedVerify.verify(context(baseState, 'verify'));
  assert.equal(verify.status, 'blocked');
  assert.equal(verify.stop_reason, 'verification_failed');

  const ciPending = createOneCommandPrReadyActionOwners(boundaries({
    prepareCurrentHead: async () => ({
      artifact: '/managed/pr-prepare.json',
      git: { head_sha: headA },
      preparation: {
        gate_status: {
          ready_for_pr_create: false,
          ci_pending: true,
          next_required_actions: ['Import CI checks for current HEAD']
        }
      }
    })
  }));
  const pending = await ciPending.final_prepare(context(baseState, 'final_prepare'));
  assert.equal(pending.status, 'blocked');
  assert.equal(pending.stop_reason, 'ci_pending');

  const ready = createOneCommandPrReadyActionOwners(boundaries());
  const final = await ready.final_prepare(context(baseState, 'final_prepare'));
  assert.equal(final.status, 'pr_ready');
  assert.equal(final.gate_status.ready_for_pr_create, true);
  assert.equal(final.output_head_sha, headA);

  const stale = createOneCommandPrReadyActionOwners(boundaries({
    prepareCurrentHead: async () => ({
      git: { head_sha: headA },
      preparation: { gate_status: { ready_for_pr_create: true } }
    })
  }));
  const staleResult = await stale.final_prepare(context({ ...baseState, current_head_sha: headB }, 'final_prepare'));
  assert.equal(staleResult.status, 'blocked');
  assert.equal(staleResult.stop_reason, 'gate_recheck_required');
  assert.equal(staleResult.recovery.prepared_head_sha, headA);
});

test('OCR-T-3 needs_changes repair advances HEAD, requests verify replay, and stops at the convergence bound', async () => {
  const reviewEntry = {
    action_id: 'review',
    status: 'completed',
    result_summary: 'independent review requested changes',
    checkpoint: [{ verdict: 'needs_changes', findings: [{ id: 'finding-1', detail: 'repair this' }] }]
  };
  let objective;
  const owners = createOneCommandPrReadyActionOwners(boundaries({
    dispatchRuntime: async ({ request }) => {
      objective = request.objective;
      return completedRuntime(request);
    }
  }));
  const repaired = await owners.repair(context({
    ...baseState,
    action_journal: [reviewEntry]
  }, 'repair'));
  assert.equal(repaired.status, 'continue');
  assert.equal(repaired.replay_from_action_id, 'verify');
  assert.equal(repaired.repair_attempt, 1);
  assert.match(objective, /finding-1/);

  const exhausted = await owners.repair(context({
    ...baseState,
    action_journal: [
      reviewEntry,
      ...Array.from({ length: ONE_COMMAND_MAX_REPAIR_ATTEMPTS }, () => ({
        action_id: 'repair',
        status: 'completed'
      }))
    ]
  }, 'repair'));
  assert.equal(exhausted.status, 'blocked');
  assert.equal(exhausted.stop_reason, 'repair_convergence_exhausted');
  assert.equal(exhausted.recovery.attempts, ONE_COMMAND_MAX_REPAIR_ATTEMPTS);
});

test('OCR-T-3 repair objective aggregates production review record findings across roles', async () => {
  const checkpoint = [
    {
      operation: 'record',
      role: 'code_spec',
      result: { verdict: 'needs_changes', findings: [{ id: 'code-finding', detail: 'repair code' }] }
    },
    {
      operation: 'record',
      role: 'runtime',
      result: { verdict: 'pass', findings: [] }
    },
    {
      operation: 'record',
      role: 'ux',
      result: { verdict: 'needs_changes', findings: [{ id: 'ux-finding', detail: 'repair UX' }] }
    }
  ];
  let objective;
  const owners = createOneCommandPrReadyActionOwners(boundaries({
    dispatchRuntime: async ({ request }) => {
      objective = request.objective;
      return completedRuntime(request);
    }
  }));
  const repaired = await owners.repair(context({
    ...baseState,
    action_journal: [{
      action_id: 'review',
      status: 'completed',
      result_summary: 'independent review requested changes',
      checkpoint
    }]
  }, 'repair'));
  assert.equal(repaired.status, 'continue');
  assert.match(objective, /code-finding/);
  assert.match(objective, /ux-finding/);
});

test('OCR-T-4 runtime adapter preserves objective in the normalized provider request', async () => {
  let startedRequest;
  const adapter = {
    id: 'fake',
    async probe() {
      return {
        available: true,
        capabilities: ['workspace_write'],
        sandbox: 'workspace-write',
        approval_policy: 'managed'
      };
    },
    async start(request) {
      startedRequest = request;
      return { provider_run_id: 'provider-1', agent_identity: 'fake-implementation', session_id: 'session-1' };
    },
    async status() { return { status: 'running' }; },
    async cancel() { return { status: 'cancelled' }; },
    async collect_result() { throw new Error('not completed'); }
  };
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const objective = 'Implement the exact approved Story task and run focused tests.';
  const result = await coordinator.dispatch(baseState, {
    adapter_id: 'fake',
    task_id: 'implement',
    role: 'implementation',
    objective,
    requirements: { capabilities: ['workspace_write'], timeout_ms: 1000, managed_worktree: '/managed' }
  });
  assert.equal(startedRequest.objective, objective);
  assert.equal(result.dispatch.objective, objective);
  const legacyDispatchId = `dispatch-${createHash('sha256')
    .update(`${baseState.run_id}:fake:implement:implementation:${headA}::`)
    .digest('hex')
    .slice(0, 16)}`;
  assert.equal(result.dispatch.dispatch_id, legacyDispatchId);
});

test('OCR-T-4 production connector includes the runtime objective in the provider prompt', async () => {
  let invocation;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  const connector = createCliRuntimeConnector({
    id: 'codex',
    command: 'codex',
    enabled: true,
    probeCommand: async () => {},
    createId: () => 'objective',
    spawnProcess(command, args, options) {
      invocation = { command, args, options };
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }
  });
  await connector.start({
    dispatch_id: 'dispatch-objective',
    story_id: baseState.story_id,
    run_id: baseState.run_id,
    task_id: 'implement',
    role: 'implementation',
    objective: 'Implement only the approved task scope.',
    input_head_sha: headA,
    requirements: { managed_worktree: '/managed', capabilities: ['workspace_write'], timeout_ms: 1000 }
  });
  assert.match(invocation.args.at(-1), /Objective: Implement only the approved task scope\./);
});
