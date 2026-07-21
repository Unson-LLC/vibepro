import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAgentRuntimeCoordinator } from '../../src/agent-runtime-adapter.js';
import { createCodexSubagentRuntimeAdapter } from '../../src/codex-subagent-runtime-adapter.js';

test('CDI-S-9 E2E Codex spawn crosses 600000ms boundary, detaches, delivers completion, and closes review lifecycle', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-e2e-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  let completionHandler;
  let spawns = 0;
  let shutdowns = 0;
  const host = {
    async probe() { return { available: true, capabilities: ['review'], sandbox: 'read-only', approval_policy: 'managed' }; },
    async spawn({ idempotency_key }) { spawns += 1; return { provider_run_id: `codex-${idempotency_key}`, agent_identity: 'codex-reviewer', thread_id: 'codex-thread' }; },
    async status() { return { status: 'running' }; },
    async shutdown() { shutdowns += 1; return { status: 'cancelled' }; },
    async subscribeCompletion({ onEvent }) { completionHandler = onEvent; return { subscription_id: 'codex-subscription' }; },
    async wake() {},
    async detach() {}
  };
  const coordinator = createAgentRuntimeCoordinator({ adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host })] });
  const state = { story_id: 'story-vibepro-codex-detached-completion-inbox', run_id: 'run-20260722T010203Z-aabbccdd', current_head_sha: 'head-e2e', status: 'running', runtime_dispatches: [] };
  const request = {
    adapter_id: 'codex-subagent', task_id: 'logical-review', role: 'review', reviewer_identity: 'codex-reviewer',
    implementation_identity: 'implementer', implementation_session_id: 'implementation-thread', inspection_surface_hash: 'surface-e2e',
    requirements: { capabilities: ['review'], timeout_ms: 1000, monitor_boundary_ms: 600000, no_progress_deadline_ms: 900000, max_wall_clock_ms: 3600000, max_attempts: 1, max_cost_usd: 5, managed_worktree: repoRoot }
  };
  const started = await coordinator.dispatch(state, request);
  const detached = await coordinator.detach(started.state, started.dispatch.dispatch_id);
  assert.equal(detached.dispatch.requirements.monitor_boundary_ms, 600000);
  assert.equal(detached.dispatch.status, 'running_detached');
  assert.equal(shutdowns, 0);

  await completionHandler({
    event_id: 'e2e-completion', kind: 'completed', surface_hash: 'surface-e2e',
    result: { completion_status: 'completed', changed_files: [], head_sha: 'head-e2e', test_suggestions: [], summary: 'E2E review complete', agent_identity: 'codex-reviewer', thread_id: 'codex-thread', lifecycle: 'closed' }
  });
  const closed = await coordinator.reconcile(detached.state, detached.dispatch.dispatch_id);
  const replay = await coordinator.dispatch(closed.state, request);
  assert.equal(closed.dispatch.result.review_provenance.lifecycle, 'closed');
  assert.equal(replay.reused, true);
  assert.equal(spawns, 1);
  assert.equal(shutdowns, 0);
});
