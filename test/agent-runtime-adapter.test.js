import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentRuntimeError, createAgentRuntimeCoordinator, defineAgentRuntimeAdapter } from '../src/agent-runtime-adapter.js';

const state = {
  story_id: 'story-runtime',
  run_id: 'run-20260719T010203Z-01020304',
  current_head_sha: 'abc123',
  status: 'running',
  runtime_dispatches: []
};

function fakeAdapter(overrides = {}) {
  let status = 'running';
  let starts = 0;
  return {
    id: 'fake',
    starts: () => starts,
    async probe({ role } = {}) { return { available: true, capabilities: ['workspace_write', 'review'], sandbox: role === 'review' ? 'read-only' : 'workspace-write', approval_policy: 'managed' }; },
    async start() { starts += 1; return { provider_run_id: 'provider-1', agent_identity: 'implementer-1', session_id: 'session-1' }; },
    async status() { return { status }; },
    async cancel() { status = 'cancelled'; },
    async collect_result() { return { completion_status: 'completed', changed_files: ['src/a.js'], head_sha: 'def456', test_suggestions: ['node --test'], summary: 'done' }; },
    complete() { status = 'completed'; },
    timeout() { status = 'timed_out'; },
    ...overrides
  };
}

const request = {
  adapter_id: 'fake',
  task_id: 'implement-runtime',
  role: 'implementation',
  requirements: { capabilities: ['workspace_write'], timeout_ms: 1000, managed_worktree: '/repo' }
};

test('ARA-S-1 ARA-S-2 provider-neutral contract reports quota wait before start', async () => {
  const adapter = fakeAdapter({ async probe() { return { available: true, capabilities: [], reason: 'quota_exceeded' }; } });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const result = await coordinator.dispatch(state, request);
  assert.equal(result.state.status, 'waiting_for_runtime');
  assert.equal(result.dispatch.stop_reason.code, 'quota_exceeded');
  assert.equal(adapter.starts(), 0);
});

test('ARA-S-2 waiting runtime dispatch re-probes after capability recovery', async () => {
  let available = false;
  const adapter = fakeAdapter({ async probe() { return { available, capabilities: available ? ['workspace_write'] : [], reason: 'runtime_unavailable' }; } });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const waiting = await coordinator.dispatch(state, request);
  available = true;
  const resumed = await coordinator.dispatch(waiting.state, request);
  assert.equal(resumed.reused, false);
  assert.equal(resumed.dispatch.status, 'running');
  assert.equal(resumed.state.status, 'running');
  assert.equal(resumed.state.stop_reason, null);
  assert.equal(adapter.starts(), 1);
});

test('ARA-S-2 auth denial remains a typed resumable stop', async () => {
  const adapter = fakeAdapter({ async start() { throw new AgentRuntimeError('auth_denied', 'login required'); } });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const result = await coordinator.dispatch(state, request);
  assert.equal(result.state.status, 'waiting_for_runtime');
  assert.equal(result.dispatch.stop_reason.code, 'auth_denied');
});

test('PRC-S-3 typed provider failure survives status normalization', async () => {
  const adapter = fakeAdapter({ async status() { return { status: 'failed', message: 'quota', stop_reason: { code: 'quota_exceeded', message: 'quota' } }; } });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, request);
  const result = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(result.dispatch.stop_reason.code, 'quota_exceeded');
});

test('ARA-S-3 successful implementation result is structured and HEAD-bearing', async () => {
  const adapter = fakeAdapter();
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, request);
  adapter.complete();
  const result = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(result.dispatch.status, 'completed');
  assert.equal(result.dispatch.result.head_sha, 'def456');
  assert.deepEqual(result.dispatch.result.changed_files, ['src/a.js']);
  assert.deepEqual(result.dispatch.result.test_suggestions, ['node --test']);
});

test('ARA-S-4 review requires separate identity and closed parallel provenance', async () => {
  const adapter = fakeAdapter({
    async start() { return { provider_run_id: 'review-1', agent_identity: 'reviewer-2', thread_id: 'thread-2' }; },
    async status() { return { status: 'completed' }; },
    async collect_result() { return {
      completion_status: 'completed', changed_files: [], head_sha: 'abc123', test_suggestions: [], summary: 'pass', agent_identity: 'reviewer-2', lifecycle: 'closed',
      status: 'needs_changes', inspection_summary: 'inspected runtime boundary', inspection_evidence: 'test/agent-runtime-adapter.test.js',
      inspection_inputs: ['src/agent-runtime-adapter.js'], judgment_delta: ['transport concern -> review payload retained'],
      findings: [{ severity: 'medium', id: 'runtime-contract', detail: 'follow-up needed' }]
    }; }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  await assert.rejects(coordinator.dispatch(state, { ...request, role: 'review', implementation_identity: 'same', reviewer_identity: 'same' }), { code: 'review_identity_not_separate' });
  const started = await coordinator.dispatch(state, { ...request, role: 'review', requirements: { ...request.requirements, capabilities: ['review'] }, implementation_identity: 'implementer-1', implementation_session_id: 'implementation-session', reviewer_identity: 'reviewer-2' });
  const result = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(result.dispatch.result.review_provenance.execution_mode, 'parallel_subagent');
  assert.equal(result.dispatch.result.review_provenance.lifecycle, 'closed');
  assert.deepEqual(result.dispatch.result.review, {
    status: 'needs_changes',
    summary: 'pass',
    inspection_summary: 'inspected runtime boundary',
    inspection_evidence: 'test/agent-runtime-adapter.test.js',
    inspection_inputs: ['src/agent-runtime-adapter.js'],
    judgment_delta: ['transport concern -> review payload retained'],
    findings: [{ severity: 'medium', id: 'runtime-contract', detail: 'follow-up needed' }]
  });
});

test('ARA-S-4 review requires review capability before provider start', async () => {
  let starts = 0;
  const adapter = fakeAdapter({
    async probe() { return { available: true, capabilities: [], sandbox: 'read-only', approval_policy: 'managed' }; },
    async start() { starts += 1; return { provider_run_id: 'unqualified-review' }; }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  await assert.rejects(coordinator.dispatch(state, {
    ...request,
    role: 'review',
    requirements: { ...request.requirements, capabilities: [] },
    implementation_identity: 'implementer-1',
    implementation_session_id: 'implementation-session',
    reviewer_identity: 'reviewer-2'
  }), { code: 'review_capability_required' });
  assert.equal(starts, 0);
});

test('ARA-S-4 review rejects a provider result that impersonates the implementer', async () => {
  const adapter = fakeAdapter({
    async start() { return { provider_run_id: 'review-identity', agent_identity: 'reviewer-2', session_id: 'review-identity-session' }; },
    async status() { return { status: 'completed' }; },
    async collect_result() {
      return { completion_status: 'completed', changed_files: [], head_sha: 'abc123', test_suggestions: [], summary: 'pass', agent_identity: 'implementer-1', lifecycle: 'closed' };
    }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, { ...request, role: 'review', requirements: { ...request.requirements, capabilities: ['review'] }, implementation_identity: 'implementer-1', implementation_session_id: 'implementation-session', reviewer_identity: 'reviewer-2' });
  const result = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(result.state.status, 'failed');
  assert.equal(result.dispatch.stop_reason.code, 'invalid_runtime_result');
});

test('ARA-S-4 review rejects stale HEAD and same implementation session', async () => {
  const stale = fakeAdapter({
    async start() { return { provider_run_id: 'review-stale', agent_identity: 'reviewer-2', session_id: 'implementation-session' }; },
    async status() { return { status: 'completed' }; },
    async collect_result() { return { completion_status: 'completed', changed_files: [], head_sha: 'stale-head', test_suggestions: [], summary: 'pass', agent_identity: 'reviewer-2', lifecycle: 'closed', session_id: 'implementation-session' }; }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [stale] });
  const started = await coordinator.dispatch(state, { ...request, role: 'review', requirements: { ...request.requirements, capabilities: ['review'] }, implementation_identity: 'implementer-1', implementation_session_id: 'implementation-session', reviewer_identity: 'reviewer-2' });
  const result = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(result.state.status, 'failed');
  assert.equal(result.dispatch.stop_reason.code, 'invalid_runtime_result');
});

test('ARA-S-4 review result must correlate to the reviewer runtime returned by start', async () => {
  const adapter = fakeAdapter({
    async start() { return { provider_run_id: 'review-correlated', agent_identity: 'reviewer-2', session_id: 'started-review-session', thread_id: 'started-review-thread' }; },
    async status() { return { status: 'completed' }; },
    async collect_result() { return { completion_status: 'completed', changed_files: [], head_sha: 'abc123', test_suggestions: [], summary: 'pass', agent_identity: 'reviewer-2', lifecycle: 'closed', session_id: 'substituted-session', thread_id: 'started-review-thread' }; }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, { ...request, role: 'review', requirements: { ...request.requirements, capabilities: ['review'] }, implementation_identity: 'implementer-1', implementation_session_id: 'implementation-session', reviewer_identity: 'reviewer-2' });
  const result = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(result.state.status, 'failed');
  assert.equal(result.dispatch.stop_reason.code, 'invalid_runtime_result');
});

test('ARA-S-4 review start without session or thread provenance is contained', async () => {
  let cancelled = false;
  const adapter = fakeAdapter({
    async start() { return { provider_run_id: 'review-no-session', agent_identity: 'reviewer-2' }; },
    async cancel() { cancelled = true; },
    async status() { return { status: cancelled ? 'cancelled' : 'running' }; }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const result = await coordinator.dispatch(state, { ...request, role: 'review', requirements: { ...request.requirements, capabilities: ['review'] }, implementation_identity: 'implementer-1', implementation_session_id: 'implementation-session', reviewer_identity: 'reviewer-2' });
  assert.equal(cancelled, true);
  assert.equal(result.state.status, 'failed');
  assert.equal(result.dispatch.stop_reason.code, 'review_session_not_separate');
});

test('ARA-S-4 review dispatch identity changes with the implementation session', async () => {
  const adapter = fakeAdapter({ async start() { return { provider_run_id: 'review-session', agent_identity: 'reviewer-2', thread_id: 'review-thread' }; } });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const reviewRequest = { ...request, role: 'review', requirements: { ...request.requirements, capabilities: ['review'] }, implementation_identity: 'implementer-1', reviewer_identity: 'reviewer-2' };
  const first = await coordinator.dispatch(state, { ...reviewRequest, implementation_session_id: 'implementation-a' });
  const second = await coordinator.dispatch(first.state, { ...reviewRequest, implementation_session_id: 'implementation-b' });
  assert.notEqual(first.dispatch.dispatch_id, second.dispatch.dispatch_id);
  assert.equal(second.reused, false);
});

test('ARA-S-4 review runtime is read-only at request and result boundaries', async () => {
  const coordinator = createAgentRuntimeCoordinator({ adapters: [fakeAdapter()] });
  await assert.rejects(coordinator.dispatch(state, { ...request, role: 'review', implementation_identity: 'implementer-1', implementation_session_id: 'implementation-session', reviewer_identity: 'reviewer-2' }), { code: 'review_mutation_forbidden' });
  const mutating = fakeAdapter({
    async start() { return { provider_run_id: 'review-mutating', agent_identity: 'reviewer-2', thread_id: 'review-thread' }; },
    async status() { return { status: 'completed' }; },
    async collect_result() { return { completion_status: 'completed', changed_files: ['src/mutated.js'], head_sha: 'abc123', test_suggestions: [], summary: 'changed', agent_identity: 'reviewer-2', lifecycle: 'closed' }; }
  });
  const readonlyCoordinator = createAgentRuntimeCoordinator({ adapters: [mutating] });
  const started = await readonlyCoordinator.dispatch(state, { ...request, role: 'review', requirements: { ...request.requirements, capabilities: ['review'] }, implementation_identity: 'implementer-1', implementation_session_id: 'implementation-session', reviewer_identity: 'reviewer-2' });
  const result = await readonlyCoordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(result.state.status, 'failed');
  assert.equal(result.dispatch.stop_reason.code, 'invalid_runtime_result');
});

test('ARA-S-4 review rejects a mutable provider sandbox before start', async () => {
  const adapter = fakeAdapter({ async probe() { return { available: true, capabilities: ['review'], sandbox: 'workspace-write', approval_policy: 'managed' }; } });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const result = await coordinator.dispatch(state, { ...request, role: 'review', requirements: { ...request.requirements, capabilities: ['review'] }, implementation_identity: 'implementer-1', implementation_session_id: 'implementation-session', reviewer_identity: 'reviewer-2' });
  assert.equal(result.state.status, 'waiting_for_runtime');
  assert.equal(result.dispatch.stop_reason.code, 'review_readonly_unavailable');
  assert.equal(adapter.starts(), 0);
});

test('ARA-S-4 review validates started identity and contains the wrong runtime', async () => {
  let cancelled = false;
  const adapter = fakeAdapter({
    async start() { return { provider_run_id: 'wrong-review', agent_identity: 'implementer-1', session_id: 'wrong-session' }; },
    async cancel() { cancelled = true; },
    async status() { return { status: cancelled ? 'cancelled' : 'running' }; }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const result = await coordinator.dispatch(state, { ...request, role: 'review', requirements: { ...request.requirements, capabilities: ['review'] }, implementation_identity: 'implementer-1', implementation_session_id: 'implementation-session', reviewer_identity: 'reviewer-2' });
  assert.equal(cancelled, true);
  assert.equal(result.state.status, 'failed');
  assert.equal(result.dispatch.stop_reason.code, 'review_identity_not_separate');
  assert.equal(result.dispatch.provider_terminal_status, 'cancelled');
});

test('ARA-S-2 permission wait during polling becomes a typed Run stop', async () => {
  const adapter = fakeAdapter({ async status() { return { status: 'permission_wait', message: 'approval required' }; } });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, request);
  const result = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(result.state.status, 'waiting_for_runtime');
  assert.equal(result.state.stop_reason.code, 'permission_wait');
  assert.equal(result.dispatch.status, 'permission_wait');
});

test('ARA-S-2 permission wait clears stale Run stop after provider resumes', async () => {
  let providerStatus = 'permission_wait';
  const adapter = fakeAdapter({ async status() { return { status: providerStatus, message: 'approval required' }; } });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, request);
  const waitingResult = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  providerStatus = 'running';
  const resumed = await coordinator.poll(waitingResult.state, started.dispatch.dispatch_id);
  assert.equal(resumed.state.status, 'running');
  assert.equal(resumed.state.stop_reason, null);
  assert.equal(resumed.dispatch.status, 'running');
});

test('ARA-S-5 adapter id participates in dispatch identity', async () => {
  const first = createAgentRuntimeCoordinator({ adapters: [fakeAdapter()] });
  const secondAdapter = { ...fakeAdapter(), id: 'other' };
  const second = createAgentRuntimeCoordinator({ adapters: [secondAdapter] });
  const firstResult = await first.dispatch(state, request);
  const secondResult = await second.dispatch(state, { ...request, adapter_id: 'other' });
  assert.notEqual(firstResult.dispatch.dispatch_id, secondResult.dispatch.dispatch_id);
});

test('ARA-S-6 provider operations enforce the requested timeout', async () => {
  const adapter = fakeAdapter({ async probe() { return new Promise(() => {}); } });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const result = await coordinator.dispatch(state, { ...request, requirements: { ...request.requirements, timeout_ms: 5 } });
  assert.equal(result.state.status, 'waiting_for_runtime');
  assert.equal(result.dispatch.stop_reason.code, 'runtime_probe_timeout');
  assert.match(result.dispatch.stop_reason.message, /exceeded 5ms/);
});

test('ARA-S-5 duplicate dispatch is reused and cancel confirms terminal runtime', async () => {
  const adapter = fakeAdapter();
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, request);
  const duplicate = await coordinator.dispatch(started.state, request);
  assert.equal(duplicate.reused, true);
  assert.equal(adapter.starts(), 1);
  const cancelled = await coordinator.cancel(duplicate.state, duplicate.dispatch.dispatch_id);
  assert.equal(cancelled.dispatch.status, 'cancelled');
  assert.equal(cancelled.dispatch.stop_reason.code, 'runtime_cancelled');
});

test('CDI-S-4 CDI-S-10 terminal failure cannot replacement-spawn the same logical dispatch', async () => {
  const adapter = fakeAdapter({ async status() { return { status: 'failed', message: 'bounded attempt exhausted' }; } });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, request);
  const failed = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  const replay = await coordinator.dispatch(failed.state, request);

  assert.equal(failed.dispatch.status, 'failed');
  assert.equal(replay.reused, true);
  assert.equal(replay.dispatch.provider_run_id, 'provider-1');
  assert.equal(replay.dispatch.started_at, started.dispatch.started_at);
  assert.equal(adapter.starts(), 1);
});

test('ARA-S-5 nonterminal cancel fails closed as orphaned agent', async () => {
  const adapter = fakeAdapter({ async cancel() {}, async status() { return { status: 'running' }; } });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, request);
  const cancelled = await coordinator.cancel(started.state, started.dispatch.dispatch_id);
  assert.equal(cancelled.state.status, 'failed');
  assert.equal(cancelled.dispatch.stop_reason.code, 'orphaned_agent');
});

test('ARA-S-5 cancel escalates to force before declaring an orphan', async () => {
  let forced = false;
  const adapter = fakeAdapter({
    async cancel({ force }) { forced = force === true; },
    async status() { return { status: forced ? 'cancelled' : 'running' }; }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, request);
  const cancelled = await coordinator.cancel(started.state, started.dispatch.dispatch_id);
  assert.equal(forced, true);
  assert.equal(cancelled.dispatch.status, 'cancelled');
});

test('ARA-S-6 cancel provider failure escalates and reports an orphan when containment fails', async () => {
  const adapter = fakeAdapter({ async cancel() { throw new Error('provider offline'); } });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, request);
  const cancelled = await coordinator.cancel(started.state, started.dispatch.dispatch_id);
  assert.equal(cancelled.state.status, 'failed');
  assert.equal(cancelled.dispatch.stop_reason.code, 'orphaned_agent');
});

test('ARA-S-5 start timeout invokes dispatch-scoped force containment', async () => {
  let containedDispatch = null;
  const adapter = fakeAdapter({
    async start() { return new Promise(() => {}); },
    async cancel(input) { containedDispatch = input; return { status: 'cancelled' }; }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const result = await coordinator.dispatch(state, { ...request, requirements: { ...request.requirements, timeout_ms: 5 } });
  assert.equal(result.state.status, 'failed');
  assert.equal(result.dispatch.stop_reason.code, 'runtime_start_timeout');
  assert.equal(containedDispatch.dispatch_id, result.dispatch.dispatch_id);
  assert.equal(containedDispatch.force, true);
  assert.equal(result.dispatch.provider_terminal_status, 'cancelled');
});

test('ARA-S-5 start timeout is orphaned unless dispatch-scoped containment confirms terminal status', async () => {
  let starts = 0;
  const adapter = fakeAdapter({ async start() { starts += 1; return new Promise(() => {}); }, async cancel() {} });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const result = await coordinator.dispatch(state, { ...request, requirements: { ...request.requirements, timeout_ms: 5 } });
  assert.equal(result.dispatch.stop_reason.code, 'orphaned_agent');
  const retried = await coordinator.dispatch(result.state, { ...request, requirements: { ...request.requirements, timeout_ms: 5 } });
  assert.equal(retried.reused, true);
  assert.equal(starts, 1);
});

test('ARA-S-5 generic start failure is contained before redispatch can occur', async () => {
  let cancelCalls = 0;
  const adapter = fakeAdapter({
    async start() { throw new Error('response lost after provider accepted start'); },
    async cancel() { cancelCalls += 1; return { status: 'cancelled' }; }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const result = await coordinator.dispatch(state, request);
  assert.equal(cancelCalls, 1);
  assert.equal(result.state.status, 'failed');
  assert.equal(result.dispatch.stop_reason.code, 'runtime_start_failed');
  assert.equal(result.dispatch.provider_terminal_status, 'cancelled');
});

test('ARA-S-6 timeout and malformed success never become completion', async () => {
  const timedAdapter = fakeAdapter();
  const timedCoordinator = createAgentRuntimeCoordinator({ adapters: [timedAdapter] });
  const started = await timedCoordinator.dispatch(state, request);
  timedAdapter.timeout();
  const timed = await timedCoordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(timed.state.status, 'failed');
  assert.equal(timed.dispatch.stop_reason.code, 'runtime_timeout');

  const malformedAdapter = fakeAdapter({ async status() { return { status: 'completed' }; }, async collect_result() { return { completion_status: 'completed' }; } });
  const malformedCoordinator = createAgentRuntimeCoordinator({ adapters: [malformedAdapter] });
  const malformedStarted = await malformedCoordinator.dispatch(state, request);
  const malformed = await malformedCoordinator.poll(malformedStarted.state, malformedStarted.dispatch.dispatch_id);
  assert.equal(malformed.state.status, 'failed');
  assert.equal(malformed.dispatch.stop_reason.code, 'invalid_runtime_result');
});

test('ARA-S-5 operation timeout contains the provider runtime before allowing redispatch', async () => {
  let statusCalls = 0;
  let cancelled = false;
  const adapter = fakeAdapter({
    async status() {
      statusCalls += 1;
      if (statusCalls === 1) return new Promise(() => {});
      return { status: cancelled ? 'cancelled' : 'running' };
    },
    async cancel({ force }) {
      if (force !== true) cancelled = true;
    }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, { ...request, requirements: { ...request.requirements, timeout_ms: 5 } });
  const timed = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(cancelled, true);
  assert.equal(timed.state.status, 'failed');
  assert.equal(timed.dispatch.stop_reason.code, 'runtime_status_timeout');
  assert.equal(timed.dispatch.provider_terminal_status, 'cancelled');
});

test('ARA-S-5 operation timeout reports an orphan when containment cannot confirm terminal state', async () => {
  const adapter = fakeAdapter({
    async status() { return new Promise(() => {}); },
    async cancel() {}
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, { ...request, requirements: { ...request.requirements, timeout_ms: 5 } });
  const timed = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(timed.state.status, 'failed');
  assert.equal(timed.dispatch.stop_reason.code, 'orphaned_agent');
  const retried = await coordinator.dispatch(timed.state, { ...request, requirements: { ...request.requirements, timeout_ms: 5 } });
  assert.equal(retried.reused, true);
  assert.equal(retried.dispatch.stop_reason.code, 'orphaned_agent');
});

test('ARA-S-5 result timeout contains the provider runtime before failing', async () => {
  let cancelled = false;
  let statusCalls = 0;
  const adapter = fakeAdapter({
    async status() { statusCalls += 1; return { status: statusCalls === 1 ? 'completed' : (cancelled ? 'cancelled' : 'running') }; },
    async collect_result() { return new Promise(() => {}); },
    async cancel() { cancelled = true; }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(state, { ...request, requirements: { ...request.requirements, timeout_ms: 5 } });
  const result = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(cancelled, true);
  assert.equal(result.state.status, 'failed');
  assert.equal(result.dispatch.stop_reason.code, 'runtime_result_timeout');
  assert.equal(result.dispatch.provider_terminal_status, 'cancelled');
});

test('ARA-S-7 adapter definition rejects incomplete provider contracts', () => {
  assert.throws(() => defineAgentRuntimeAdapter({ id: 'bad', probe() {} }), { code: 'invalid_adapter' });
});
