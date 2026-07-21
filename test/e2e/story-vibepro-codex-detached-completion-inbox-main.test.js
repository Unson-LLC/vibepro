import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCodexGuardedRunBridge } from '../../src/codex-runtime-bridge.js';

const STORY_ID = 'story-vibepro-codex-detached-completion-inbox';
const RUN_ID = 'run-20260722T010203Z-01020304';

test('CDI-S-9 E2E Guarded Run crosses 600000ms, persists detached authority, and a successor closes the Inbox review', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-e2e-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await mkdir(path.join(repoRoot, '.vibepro'), { recursive: true });
  await writeFile(path.join(repoRoot, '.vibepro', 'config.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    brainbase: { stories: [{ story_id: STORY_ID, title: 'Codex detached completion Inbox' }] }
  }, null, 2)}\n`);

  const headSha = 'a'.repeat(40);
  const gitCommonDir = path.join(repoRoot, '.git-common');
  let clock = '2026-07-22T01:02:03.000Z';
  let completionHandler;
  let spawns = 0;
  let shutdowns = 0;
  let wakeHandler;
  let pushResume;
  const lifecycle = [];
  const reviews = [];
  const host = {
    async probe() { return { available: true, capabilities: ['review'], sandbox: 'read-only', approval_policy: 'managed' }; },
    async subscribeCompletion({ onEvent }) { lifecycle.push('subscribe'); completionHandler = onEvent; return { subscription_id: 'codex-subscription' }; },
    async spawn({ idempotency_key }) { lifecycle.push('spawn'); spawns += 1; return { provider_run_id: `codex-${idempotency_key}`, agent_identity: 'codex-reviewer', thread_id: 'codex-thread' }; },
    async status() { return { status: 'running', attempts: 1, usage_accounting: { cost_usd: 0.1 } }; },
    async shutdown() { shutdowns += 1; return { status: 'cancelled' }; },
    registerResumeHandler({ resume }) { lifecycle.push('register-resume'); wakeHandler = resume; },
    async wake(notification) {
      lifecycle.push(`wake:${notification.event_id}`);
      pushResume = wakeHandler?.({ story_id: STORY_ID, run_id: RUN_ID, ...notification });
      return pushResume;
    },
    async detach() { lifecycle.push('detach'); }
  };
  const legacy = {
    schema_version: '0.1.0', story_id: STORY_ID, target: 'pr_create',
    managed_worktree: { status: 'disabled', required: false, mode: 'disabled', source_repo: repoRoot, source_relative_path: null, path: null, relative_path: null, branch: 'codex/story-e2e', actual_branch: null, branch_match: null, base_ref: 'main', created_from_sha: headSha, current_head_sha: null, dirty: null, dirty_paths: [], dirty_check_error: null, failure_reason: null }
  };
  const guardedRunDependencies = {
    now: () => new Date(clock),
    randomBytes: () => Buffer.from([1, 2, 3, 4]),
    resolveGitIdentity: async () => ({ root_realpath: repoRoot, git_dir_realpath: path.join(gitCommonDir, 'source'), git_common_dir_realpath: gitCommonDir, head_sha: headSha }),
    startExecution: async () => ({ state: legacy, found: true }),
    readGateReadiness: async () => ({ ready_for_pr_create: false })
  };
  const createBridge = () => createCodexGuardedRunBridge({
    repoRoot,
    host,
    now: () => new Date(clock),
    guardedRunDependencies,
    recordAgentReview: async (repo, review) => { reviews.push({ repo, review }); return { status: 'pass' }; }
  });

  const parent = createBridge();
  await parent.ready;
  const run = await parent.session.run(repoRoot, { storyId: STORY_ID });
  assert.equal(run.run_id, RUN_ID);
  const request = {
    adapter_id: 'codex-subagent', task_id: 'logical-review', role: 'review', reviewer_identity: 'codex-reviewer',
    implementation_identity: 'implementer', implementation_session_id: 'implementation-thread', inspection_surface_hash: 'surface-e2e',
    requirements: { capabilities: ['review'], timeout_ms: 1000, monitor_boundary_ms: 600000, no_progress_deadline_ms: 900000, max_wall_clock_ms: 3600000, max_attempts: 1, max_cost_usd: 5, managed_worktree: repoRoot }
  };
  const started = await parent.session.dispatchRuntime(repoRoot, { storyId: STORY_ID, runId: RUN_ID, request });
  assert.deepEqual(lifecycle.slice(0, 3), ['register-resume', 'subscribe', 'spawn']);

  clock = '2026-07-22T01:12:03.000Z';
  const detached = await parent.session.pollRuntime(repoRoot, { storyId: STORY_ID, runId: RUN_ID, dispatchId: started.dispatch.dispatch_id });
  assert.equal(detached.dispatch.status, 'running_detached');
  assert.equal(shutdowns, 0);
  assert.equal((await parent.session.status(repoRoot, { storyId: STORY_ID, runId: RUN_ID })).runtime_dispatches[0].status, 'running_detached');

  const successor = createBridge();
  await successor.ready;
  await completionHandler({
    event_id: 'e2e-completion', kind: 'completed', surface_hash: 'surface-e2e',
    result: { completion_status: 'completed', changed_files: [], head_sha: headSha, test_suggestions: [], summary: 'E2E review complete', agent_identity: 'codex-reviewer', thread_id: 'codex-thread', lifecycle: 'closed' }
  });
  assert.ok(lifecycle.includes('wake:e2e-completion'));

  const closed = await pushResume;
  assert.equal(closed.dispatch.result.review_provenance.lifecycle, 'closed');
  const recorded = await successor.session.recordRuntimeReview(repoRoot, {
    storyId: STORY_ID, runId: RUN_ID, dispatchId: started.dispatch.dispatch_id,
    review: { stage: 'gate', role: 'gate_evidence', status: 'pass', summary: 'successor recovered persistent Inbox result' }
  });
  assert.equal(recorded.review.status, 'pass');
  assert.equal(reviews[0].review.agentClosed, true);

  const replay = await successor.session.dispatchRuntime(repoRoot, { storyId: STORY_ID, runId: RUN_ID, request });
  assert.equal(replay.reused, true);
  assert.equal(spawns, 1);
  assert.equal(shutdowns, 0);
  await stat(path.join(repoRoot, '.vibepro', 'runtime-inbox', started.dispatch.dispatch_id));
});
