import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
  return {
    metrics: () => ({ spawns, shutdowns, wakes }),
    async probe() { return { available: true, capabilities: ['review'], sandbox: 'read-only', approval_policy: 'managed' }; },
    async spawn() { spawns += 1; return { provider_run_id: 'codex-provider-1', agent_identity: 'reviewer-codex', thread_id: 'thread-codex' }; },
    async status() { return { status }; },
    async shutdown() { shutdowns += 1; status = 'cancelled'; return { status }; },
    async subscribeCompletion({ onEvent }) { callback = onEvent; return { subscription_id: 'subscription-1' }; },
    async wake() { wakes += 1; },
    async detach() {},
    emit: async (event) => callback(event)
  };
}

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
  await assert.rejects(host.emit({
    event_id: 'lost-wake-completion', kind: 'completed', observed_at: '2026-07-22T01:10:01.000Z', surface_hash: 'surface-a',
    result: { changed_files: [], head_sha: 'head-a', test_suggestions: [], summary: 'persisted first', agent_identity: 'reviewer-codex', thread_id: 'thread-codex', lifecycle: 'closed' }
  }), /parent session unavailable/);
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
