import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgentRuntimeCoordinator } from '../src/agent-runtime-adapter.js';
import { appendProviderObservation, createRunLineageEnvelope } from '../src/run-lineage.js';

const state = {
  story_id: 'story-lineage',
  run_id: 'run-lineage-1',
  worktree_root: '/repo/worktree',
  branch: 'codex/story-lineage',
  current_head_sha: 'a'.repeat(40),
  runtime_dispatches: []
};

const request = {
  adapter_id: 'provider-a',
  task_id: 'implement-lineage',
  role: 'implementation',
  requirements: {
    capabilities: ['workspace_write'],
    timeout_ms: 1000,
    managed_worktree: '/repo/worktree'
  }
};

function adapter(overrides = {}) {
  let runtimeStatus = 'running';
  return {
    id: 'provider-a',
    async probe() {
      return { available: true, capabilities: ['workspace_write'], sandbox: 'workspace-write', approval_policy: 'managed' };
    },
    async start(input) {
      assert.equal(input.lineage.story_id, state.story_id);
      assert.equal(input.lineage.run_id, state.run_id);
      return {
        provider_run_id: 'provider-run-1',
        agent_identity: 'agent-1',
        session_id: 'session-1',
        thread_id: 'thread-1'
      };
    },
    async status() {
      return { status: runtimeStatus };
    },
    async cancel() {
      runtimeStatus = 'cancelled';
    },
    async collect_result() {
      return { completion_status: 'completed', changed_files: [], head_sha: state.current_head_sha, test_suggestions: [], summary: 'done' };
    },
    complete() {
      runtimeStatus = 'completed';
    },
    ...overrides
  };
}

test('persists Run authority and provider observations while preserving compatibility fields', async () => {
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter()] });
  const result = await coordinator.dispatch(state, request);

  assert.equal(result.dispatch.story_id, state.story_id);
  assert.equal(result.dispatch.run_id, state.run_id);
  assert.equal(result.dispatch.provider_run_id, 'provider-run-1');
  assert.equal(result.dispatch.session_id, 'session-1');
  assert.equal(result.dispatch.thread_id, 'thread-1');
  assert.deepEqual(result.dispatch.lineage, {
    schema_version: '0.1.0',
    story_id: state.story_id,
    run_id: state.run_id,
    dispatch_id: result.dispatch.dispatch_id,
    worktree_root: state.worktree_root,
    branch: state.branch,
    head_sha: state.current_head_sha,
    provider_run_id: 'provider-run-1',
    provider_session_id: 'session-1',
    thread_id: 'thread-1',
    provider_observations: [{
      provider: 'provider-a',
      provider_run_id: 'provider-run-1',
      provider_session_id: 'session-1',
      thread_id: 'thread-1'
    }]
  });
});

test('provider identity cannot replace authoritative Story or Run lineage', async () => {
  const coordinator = createAgentRuntimeCoordinator({
    adapters: [adapter({
      async start() {
        return {
          provider_run_id: 'provider-run-1',
          agent_identity: 'agent-1',
          session_id: 'session-1',
          story_id: 'story-provider-claim',
          run_id: 'run-provider-claim'
        };
      }
    })]
  });
  const result = await coordinator.dispatch(state, request);

  assert.equal(result.dispatch.lineage.story_id, state.story_id);
  assert.equal(result.dispatch.lineage.run_id, state.run_id);
  assert.equal(result.dispatch.lineage.provider_observations, undefined);
  assert.equal(result.state.status, 'failed');
  assert.notEqual(result.dispatch.stop_reason.code, 'provider_observation_conflict');
});

test('poll retains the same authoritative lineage and append-only observation', async () => {
  const runtime = adapter();
  const coordinator = createAgentRuntimeCoordinator({ adapters: [runtime] });
  const started = await coordinator.dispatch(state, request);
  runtime.complete();
  const completed = await coordinator.poll(started.state, started.dispatch.dispatch_id);

  assert.equal(completed.dispatch.lineage.story_id, state.story_id);
  assert.equal(completed.dispatch.lineage.run_id, state.run_id);
  assert.equal(completed.dispatch.lineage.provider_observations.length, 1);
  assert.equal(completed.dispatch.provider_run_id, 'provider-run-1');
});

test('fails closed on a provider identity rebound across persisted Run envelopes and reuses idempotent dispatches', async () => {
  let starts = 0;
  let cancelled = 0;
  const runtime = adapter({
    async start() { starts += 1; return { provider_run_id: 'provider-run-1', agent_identity: 'agent-1', session_id: 'session-2' }; },
    async cancel() { cancelled += 1; },
    async status() { return { status: cancelled ? 'cancelled' : 'running' }; }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [runtime] });
  const existing = await coordinator.dispatch(state, request);
  const foreignLineage = appendProviderObservation(createRunLineageEnvelope({
    story_id: 'story-foreign', run_id: 'run-foreign', dispatch_id: 'dispatch-foreign',
    worktree_root: '/repo/foreign', branch: 'codex/foreign', head_sha: state.current_head_sha
  }), { provider: 'provider-a', provider_run_id: 'provider-run-1', provider_session_id: 'foreign-session' });

  const persisted = {
    ...existing.state,
    runtime_dispatches: [...existing.state.runtime_dispatches, {
      adapter_id: 'provider-a', provider_run_id: 'provider-run-1',
      lineage: foreignLineage
    }]
  };
  await assert.rejects(coordinator.dispatch(persisted, request), { code: 'provider_identity_conflict' });
  assert.equal(starts, 1);

  const duplicate = await coordinator.dispatch(existing.state, request);
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.dispatch.dispatch_id, existing.dispatch.dispatch_id);

  const rebound = await coordinator.dispatch(existing.state, { ...request, task_id: 'implement-lineage-rebound' });
  assert.equal(rebound.state.status, 'failed');
  assert.equal(rebound.dispatch.stop_reason.code, 'provider_identity_conflict');
  assert.equal(starts, 2);
});
