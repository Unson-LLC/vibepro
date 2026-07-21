import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAgentRuntimeCoordinator } from '../src/agent-runtime-adapter.js';
import { createCodexSubagentRuntimeAdapter, planJudgmentRecovery } from '../src/codex-subagent-runtime-adapter.js';

const baseState = {
  story_id: 'story-codex-inbox', run_id: 'run-20260722T010203Z-01020304', current_head_sha: 'head-a', status: 'running', runtime_dispatches: []
};

function fakeCodexHost() {
  let callback;
  let spawns = 0;
  let shutdowns = 0;
  let wakes = 0;
  let status = 'running';
  let statusDetails = {};
  let lastSpawnRequest;
  let lastShutdownReason;
  let completionDuringSpawn = null;
  const lifecycleOrder = [];
  return {
    metrics: () => ({ spawns, shutdowns, wakes, lastSpawnRequest, lastShutdownReason, lifecycleOrder }),
    setStatus: (next, details = {}) => { status = next; statusDetails = details; },
    completeDuringSpawn: (event) => { completionDuringSpawn = event; },
    async probe() { return { available: true, capabilities: ['review'], sandbox: 'read-only', approval_policy: 'managed' }; },
    async spawn(request) {
      lifecycleOrder.push('spawn');
      spawns += 1;
      lastSpawnRequest = request;
      if (completionDuringSpawn) await callback(completionDuringSpawn);
      return { provider_run_id: 'codex-provider-1', agent_identity: 'reviewer-codex', thread_id: 'thread-codex' };
    },
    async status() { return { status, ...statusDetails }; },
    async shutdown(input) { shutdowns += 1; lastShutdownReason = input.reason; status = 'cancelled'; return { status }; },
    async subscribeCompletion({ onEvent }) { lifecycleOrder.push('subscribe'); callback = onEvent; return { subscription_id: 'subscription-1' }; },
    async wake() { wakes += 1; },
    async detach() {},
    emit: async (event) => callback(event)
  };
}

test('CDI-S-2 completion emitted during spawn is subscribed first and persisted without a loss window', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-immediate-completion-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const host = fakeCodexHost();
  host.completeDuringSpawn({
    event_id: 'immediate-completion', kind: 'completed', observed_at: '2026-07-22T01:00:00.000Z', surface_hash: 'surface-a',
    result: { changed_files: [], head_sha: 'head-a', test_suggestions: [], summary: 'completed inside spawn', agent_identity: 'reviewer-codex', thread_id: 'thread-codex', lifecycle: 'closed' }
  });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const started = await coordinator.dispatch(baseState, reviewRequest(repoRoot));
  const recovered = await coordinator.reconcile(started.state, started.dispatch.dispatch_id);
  assert.deepEqual(host.metrics().lifecycleOrder.slice(0, 2), ['subscribe', 'spawn']);
  assert.equal(recovered.dispatch.status, 'completed');
  assert.equal(recovered.dispatch.result.summary, 'completed inside spawn');
  assert.equal(host.metrics().spawns, 1);
});

test('CDI-S-4 concurrent starts for one dispatch share the in-flight spawn', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-concurrent-start-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const host = fakeCodexHost();
  const originalSpawn = host.spawn;
  let releaseSpawn;
  const spawnGate = new Promise((resolve) => { releaseSpawn = resolve; });
  host.spawn = async (request) => {
    await spawnGate;
    return originalSpawn(request);
  };
  const adapter = createCodexSubagentRuntimeAdapter({ repoRoot, host });
  const request = { ...reviewRequest(repoRoot), dispatch_id: 'dispatch-concurrent-start' };
  const first = adapter.start(request);
  const second = adapter.start(request);
  releaseSpawn();
  const [firstStarted, secondStarted] = await Promise.all([first, second]);
  assert.deepEqual(secondStarted, firstStarted);
  assert.equal(host.metrics().lifecycleOrder.filter((item) => item === 'subscribe').length, 1);
  assert.equal(host.metrics().spawns, 1);
});

function reviewRequest(repoRoot) {
  return {
    adapter_id: 'codex-subagent', task_id: 'agent-review', role: 'review', reviewer_identity: 'reviewer-codex',
    implementation_identity: 'implementer', implementation_session_id: 'implementation-thread', inspection_surface_hash: 'surface-a',
    requirements: { capabilities: ['review'], timeout_ms: 1000, monitor_boundary_ms: 600000, no_progress_deadline_ms: 900000, max_wall_clock_ms: 3600000, max_attempts: 1, max_cost_usd: 5, managed_worktree: repoRoot }
  };
}

test('CDI-S-1 CDI-S-2 CDI-S-3 CDI-S-4 CDI-S-9 Codex path detaches at ten minutes then completes through push/inbox/reconcile without replacement', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-path-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const host = fakeCodexHost();
  const adapter = createCodexSubagentRuntimeAdapter({ repoRoot, host });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter] });
  const started = await coordinator.dispatch(baseState, reviewRequest(repoRoot));
  const duplicate = await coordinator.dispatch(started.state, reviewRequest(repoRoot));
  const detached = await coordinator.detach(started.state, started.dispatch.dispatch_id);
  assert.equal(detached.dispatch.status, 'running_detached');
  assert.equal(host.metrics().shutdowns, 0);
  assert.equal(duplicate.reused, true);
  assert.equal(host.metrics().spawns, 1);

  await host.emit({
    event_id: 'codex-completion-1', kind: 'completed', observed_at: '2026-07-22T01:10:01.000Z', surface_hash: 'surface-a',
    result: { changed_files: [], head_sha: 'head-a', test_suggestions: [], summary: 'review passed', agent_identity: 'reviewer-codex', thread_id: 'thread-codex', lifecycle: 'closed', judgments: [{ judgment_id: 'correctness', verdict: 'pass' }] }
  });
  const recovered = await coordinator.reconcile(detached.state, detached.dispatch.dispatch_id);
  assert.equal(recovered.dispatch.status, 'completed');
  assert.equal(recovered.dispatch.result.review_provenance.lifecycle, 'closed');
  assert.equal(host.metrics().wakes, 1);
  assert.equal(host.metrics().shutdowns, 0);
  assert.equal(host.metrics().spawns, 1);
});

test('CDI-S-5 heartbeat without checkpoint cannot extend no-progress deadline', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-stalled-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  let clock = new Date('2026-07-22T01:00:00.000Z');
  const host = fakeCodexHost();
  const adapter = createCodexSubagentRuntimeAdapter({ repoRoot, host, now: () => clock });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [adapter], now: () => clock });
  const request = reviewRequest(repoRoot);
  request.requirements.no_progress_deadline_ms = 1000;
  const started = await coordinator.dispatch(baseState, request);
  await host.emit({ event_id: 'heartbeat-1', kind: 'progress', observed_at: clock.toISOString(), payload: { heartbeat: true } });
  clock = new Date('2026-07-22T01:00:02.000Z');
  const stalled = await coordinator.reconcile(started.state, started.dispatch.dispatch_id);
  assert.equal(stalled.dispatch.stop_reason.code, 'runtime_stalled');
  assert.equal(host.metrics().shutdowns, 1);
});

test('CDI-S-3 lost wake notification still reconciles the inbox result', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-lost-wake-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const host = fakeCodexHost();
  host.wake = async () => { throw new Error('parent session unavailable'); };
  const coordinator = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const started = await coordinator.dispatch(baseState, reviewRequest(repoRoot));
  await host.emit({
    event_id: 'lost-wake-completion', kind: 'completed', observed_at: '2026-07-22T01:10:01.000Z', surface_hash: 'surface-a',
    result: { changed_files: [], head_sha: 'head-a', test_suggestions: [], summary: 'persisted first', agent_identity: 'reviewer-codex', thread_id: 'thread-codex', lifecycle: 'closed' }
  });
  const recovered = await coordinator.reconcile(started.state, started.dispatch.dispatch_id);
  assert.equal(recovered.dispatch.status, 'completed');
  assert.equal(recovered.dispatch.result.summary, 'persisted first');
});

test('CDI-S-3 a successor process reconciles a persisted completion without adapter memory or redispatch', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-successor-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const host = fakeCodexHost();
  const firstCoordinator = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const started = await firstCoordinator.dispatch(baseState, reviewRequest(repoRoot));
  const detached = await firstCoordinator.detach(started.state, started.dispatch.dispatch_id);
  await host.emit({
    event_id: 'successor-completion', kind: 'completed', observed_at: '2026-07-22T01:10:01.000Z', surface_hash: 'surface-a',
    result: { changed_files: [], head_sha: 'head-a', test_suggestions: [], summary: 'successor recovered', agent_identity: 'reviewer-codex', thread_id: 'thread-codex', lifecycle: 'closed' }
  });

  const successor = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const recovered = await successor.reconcile(detached.state, detached.dispatch.dispatch_id);
  assert.equal(recovered.dispatch.status, 'completed');
  assert.equal(recovered.dispatch.result.summary, 'successor recovered');
  assert.equal(host.metrics().spawns, 1);
  assert.equal(host.metrics().shutdowns, 0);
});

test('CDI-S-7 budget and evidence timestamps do not change logical dispatch identity while surface changes do', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-surface-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const host = fakeCodexHost();
  const coordinator = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const original = await coordinator.dispatch(baseState, reviewRequest(repoRoot));
  const budgetOnly = reviewRequest(repoRoot);
  budgetOnly.requirements.max_cost_usd = 50;
  budgetOnly.evidence_timestamp = '2026-07-22T02:00:00.000Z';
  const reused = await coordinator.dispatch(original.state, budgetOnly);
  const changedSurface = await coordinator.dispatch(reused.state, { ...reviewRequest(repoRoot), inspection_surface_hash: 'surface-b' });
  assert.equal(reused.dispatch.dispatch_id, original.dispatch.dispatch_id);
  assert.notEqual(changedSurface.dispatch.dispatch_id, original.dispatch.dispatch_id);
  assert.equal(host.metrics().spawns, 2);
});

test('CDI-S-6 CDI-S-7 recovery reuses completed judgments and invalidates only changed surfaces', () => {
  const requested = [
    { judgment_id: 'runtime', surface_paths: ['src/runtime'] },
    { judgment_id: 'docs', surface_paths: ['docs'] },
    { judgment_id: 'new', surface_paths: ['test'] }
  ];
  const plan = planJudgmentRecovery({
    previous: [{ judgment_id: 'runtime', verdict: 'pass' }, { judgment_id: 'docs', verdict: 'pass' }],
    requested,
    previousSurfaceHash: 'surface-a', currentSurfaceHash: 'surface-b', changedPaths: ['docs/architecture.md']
  });
  assert.deepEqual(plan.reusable_judgments.map((item) => item.judgment_id), ['runtime']);
  assert.deepEqual(plan.invalidated_judgments, ['docs']);
  assert.deepEqual(plan.remaining_judgments.map((item) => item.judgment_id), ['docs', 'new']);
});

test('CDI-S-7 changed surface without a path diff invalidates completed judgments fail-closed', () => {
  const plan = planJudgmentRecovery({
    previous: [{ judgment_id: 'runtime', verdict: 'pass' }],
    requested: [{ judgment_id: 'runtime', surface_paths: ['src/runtime'] }],
    previousSurfaceHash: 'surface-a',
    currentSurfaceHash: 'surface-b',
    changedPaths: []
  });
  assert.deepEqual(plan.reusable_judgments, []);
  assert.deepEqual(plan.invalidated_judgments, ['runtime']);
  assert.deepEqual(plan.remaining_judgments.map((item) => item.judgment_id), ['runtime']);
});

test('CDI-S-1 monitor polling automatically detaches at the ten-minute boundary without shutdown', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-boundary-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  let clock = new Date('2026-07-22T01:00:00.000Z');
  const host = fakeCodexHost();
  const coordinator = createAgentRuntimeCoordinator({
    adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host, now: () => clock })], now: () => clock
  });
  const started = await coordinator.dispatch(baseState, reviewRequest(repoRoot));
  clock = new Date('2026-07-22T01:10:00.000Z');
  const detached = await coordinator.poll(started.state, started.dispatch.dispatch_id);
  assert.equal(detached.dispatch.status, 'running_detached');
  assert.equal(host.metrics().shutdowns, 0);
});

test('CDI-S-5 duplicate checkpoint and partial judgment do not extend the no-progress deadline', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-duplicate-progress-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  let clock = new Date('2026-07-22T01:00:00.000Z');
  const host = fakeCodexHost();
  const coordinator = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host, now: () => clock })], now: () => clock });
  const request = reviewRequest(repoRoot);
  request.requirements.no_progress_deadline_ms = 1000;
  const started = await coordinator.dispatch(baseState, request);
  await host.emit({ event_id: 'checkpoint-a', kind: 'progress', checkpoint_id: 'same', observed_at: clock.toISOString() });
  clock = new Date('2026-07-22T01:00:00.500Z');
  await host.emit({ event_id: 'checkpoint-a-repeat', kind: 'progress', checkpoint_id: 'same', observed_at: clock.toISOString() });
  await host.emit({ event_id: 'partial-a', kind: 'partial_result', observed_at: clock.toISOString(), payload: { judgment_id: 'security', verdict: 'pass' } });
  clock = new Date('2026-07-22T01:00:01.000Z');
  await host.emit({ event_id: 'partial-a-repeat', kind: 'partial_result', observed_at: clock.toISOString(), payload: { judgment_id: 'security', verdict: 'pass' } });
  clock = new Date('2026-07-22T01:00:01.600Z');
  const stalled = await coordinator.reconcile(started.state, started.dispatch.dispatch_id);
  assert.equal(stalled.dispatch.stop_reason.code, 'runtime_stalled');
});

test('CDI-S-5 successor process enforces wall-clock, attempt, and cost bounds from persisted dispatch state', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-successor-bounds-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  let clock = new Date('2026-07-22T01:00:00.000Z');
  const host = fakeCodexHost();
  const first = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host, now: () => clock })], now: () => clock });
  const request = reviewRequest(repoRoot);
  request.requirements.max_wall_clock_ms = 1000;
  request.requirements.max_attempts = 1;
  request.requirements.max_cost_usd = 1;
  const started = await first.dispatch(baseState, request);
  const detached = await first.detach(started.state, started.dispatch.dispatch_id);
  host.setStatus('running', { attempts: 2, usage_accounting: { cost_usd: 2 } });
  clock = new Date('2026-07-22T01:00:02.000Z');
  const successor = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host, now: () => clock })], now: () => clock });
  const stalled = await successor.reconcile(detached.state, detached.dispatch.dispatch_id);
  assert.equal(stalled.dispatch.stop_reason.code, 'runtime_stalled');
  assert.equal(host.metrics().lastShutdownReason, 'max_wall_clock_exceeded');
  assert.equal(host.metrics().spawns, 1);
});

test('CDI-S-5 attempt and cost caps independently stop a restarted detached dispatch', async (t) => {
  for (const scenario of [
    { name: 'attempt', status: { attempts: 2 }, expected: 'max_attempts_exceeded' },
    { name: 'cost', status: { attempts: 1, usage_accounting: { cost_usd: 2 } }, expected: 'max_cost_exceeded' }
  ]) {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), `vibepro-codex-${scenario.name}-bound-`));
    t.after(() => rm(repoRoot, { recursive: true, force: true }));
    const clock = new Date('2026-07-22T01:00:00.000Z');
    const host = fakeCodexHost();
    const first = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host, now: () => clock })], now: () => clock });
    const request = reviewRequest(repoRoot);
    request.requirements.max_wall_clock_ms = 3600000;
    request.requirements.no_progress_deadline_ms = 3600000;
    request.requirements.max_attempts = 1;
    request.requirements.max_cost_usd = 1;
    const started = await first.dispatch(baseState, request);
    const detached = await first.detach(started.state, started.dispatch.dispatch_id);
    host.setStatus('running', scenario.status);
    const successor = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host, now: () => clock })], now: () => clock });
    const stalled = await successor.reconcile(detached.state, detached.dispatch.dispatch_id);
    assert.equal(stalled.dispatch.stop_reason.code, 'runtime_stalled');
    assert.equal(host.metrics().lastShutdownReason, scenario.expected);
  }
});

test('CDI-S-6 actual spawn receives only unfinished judgments and completion merges reusable partials', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-recovery-wire-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const host = fakeCodexHost();
  const coordinator = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const request = reviewRequest(repoRoot);
  request.previous_surface_hash = 'surface-a';
  request.previous_judgments = [{ judgment_id: 'security', verdict: 'pass' }];
  request.requested_judgments = [{ judgment_id: 'security' }, { judgment_id: 'correctness' }];
  const started = await coordinator.dispatch(baseState, request);
  assert.deepEqual(host.metrics().lastSpawnRequest.requested_judgments.map((item) => item.judgment_id), ['correctness']);
  await host.emit({ event_id: 'recovery-done', kind: 'completed', surface_hash: 'surface-a', result: {
    changed_files: [], head_sha: 'head-a', test_suggestions: [], summary: 'remaining complete', agent_identity: 'reviewer-codex', thread_id: 'thread-codex', lifecycle: 'closed', judgments: [{ judgment_id: 'correctness', verdict: 'pass' }]
  } });
  const completed = await coordinator.reconcile(started.state, started.dispatch.dispatch_id);
  assert.deepEqual(completed.dispatch.result.judgments.map((item) => item.judgment_id), ['security', 'correctness']);
  assert.equal(host.metrics().spawns, 1);
});

test('CDI-S-7 HEAD change fails closed unless the caller explicitly proves the inspection surface is unchanged', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-rebase-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const host = fakeCodexHost();
  const coordinator = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const original = await coordinator.dispatch(baseState, reviewRequest(repoRoot));
  const rebasedState = { ...original.state, current_head_sha: 'head-b' };
  await assert.rejects(coordinator.dispatch(rebasedState, reviewRequest(repoRoot)), (error) => error.code === 'stale_head');
  const rebound = await coordinator.dispatch(rebasedState, { ...reviewRequest(repoRoot), surface_unchanged_after_rebase: true });
  assert.equal(rebound.reused, true);
  assert.equal(rebound.dispatch.surface_rebound_from_head_sha, 'head-a');
  assert.equal(host.metrics().spawns, 1);
});

test('CDI-S-8 missing completion delivery capability is rejected before spawn', () => {
  assert.throws(() => createCodexSubagentRuntimeAdapter({ repoRoot: '/tmp/repo', host: {
    probe() {}, spawn() {}, status() {}, shutdown() {}, wake() {}
  } }), /subscribeCompletion/);
});

test('CDI-S-8 provider completion correlation mismatch is rejected before Inbox persistence', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-provider-mismatch-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const host = fakeCodexHost();
  const coordinator = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const started = await coordinator.dispatch(baseState, reviewRequest(repoRoot));
  await assert.rejects(host.emit({
    event_id: 'wrong-provider', kind: 'completed', provider_run_id: 'another-provider', surface_hash: 'surface-a',
    result: { changed_files: [], head_sha: 'head-a', summary: 'must not persist' }
  }), /provider_run_id mismatch/);
  const observed = await coordinator.reconcile(started.state, started.dispatch.dispatch_id);
  assert.notEqual(observed.dispatch.status, 'completed');
});

test('CDI-S-7 completion for a different surface is contained and cannot close review', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-surface-mismatch-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const host = fakeCodexHost();
  const coordinator = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const started = await coordinator.dispatch(baseState, reviewRequest(repoRoot));
  await host.emit({ event_id: 'wrong-surface', kind: 'completed', surface_hash: 'surface-b', result: {
    changed_files: [], head_sha: 'head-a', test_suggestions: [], summary: 'wrong', agent_identity: 'reviewer-codex', thread_id: 'thread-codex', lifecycle: 'closed'
  } });
  const contained = await coordinator.reconcile(started.state, started.dispatch.dispatch_id);
  assert.notEqual(contained.dispatch.status, 'completed');
  assert.equal(contained.dispatch.stop_reason.code, 'invalid_runtime_result');
});

test('CDI-S-6 CDI-S-7 partial judgments from a different surface are not reused', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-partial-surface-mismatch-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const host = fakeCodexHost();
  const coordinator = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const started = await coordinator.dispatch(baseState, reviewRequest(repoRoot));
  await host.emit({
    event_id: 'wrong-partial', kind: 'partial_result', surface_hash: 'surface-b',
    payload: { judgment_id: 'security', verdict: 'pass' }
  });
  await host.emit({ event_id: 'right-completion', kind: 'completed', surface_hash: 'surface-a', result: {
    changed_files: [], head_sha: 'head-a', test_suggestions: [], summary: 'right surface', agent_identity: 'reviewer-codex', thread_id: 'thread-codex', lifecycle: 'closed'
  } });
  const completed = await coordinator.reconcile(started.state, started.dispatch.dispatch_id);
  assert.equal(completed.dispatch.status, 'completed');
  assert.deepEqual(completed.dispatch.result.partial_results, []);
  assert.deepEqual(completed.dispatch.result.judgments, []);
});

test('CDI-S-8 malformed persisted Inbox data remains fail-closed and recoverable in detached state', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-malformed-inbox-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const host = fakeCodexHost();
  const first = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const started = await first.dispatch(baseState, reviewRequest(repoRoot));
  const detached = await first.detach(started.state, started.dispatch.dispatch_id);
  const events = path.join(repoRoot, '.vibepro', 'runtime-inbox', started.dispatch.dispatch_id, 'events');
  await mkdir(events, { recursive: true });
  await writeFile(path.join(events, 'malformed.json'), '{not-json');
  const successor = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const observed = await successor.reconcile(detached.state, detached.dispatch.dispatch_id);
  assert.equal(observed.dispatch.status, 'running_detached');
  assert.equal(observed.dispatch.stop_reason.code, 'runtime_reconcile_failed');
  assert.equal(observed.dispatch.stop_reason.details.recoverable_from_inbox, true);
  assert.equal(host.metrics().shutdowns, 0);
});
