import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  GuardedRunError,
  buildBootstrapBindingFingerprint,
  createGuardedRunSession,
  deriveRunEfficiencyMetrics,
  renderGuardedRunError,
  renderGuardedRunSummary
} from '../src/guarded-run-session.js';
import { runCli } from '../src/cli.js';
import { resolveGitIdentity } from '../src/git-identity.js';
import { createHumanDecision } from '../src/human-decision-checkpoint.js';
import { createAgentRuntimeCoordinator } from '../src/agent-runtime-adapter.js';

const STORY_ID = 'story-guarded-run-test';
const FIRST_TIME = '2026-07-15T01:02:03.000Z';
const RUN_ID = 'run-20260715T010203Z-01020304';
const execFileAsync = promisify(execFile);
const CLI_BIN = fileURLToPath(new URL('../bin/vibepro.js', import.meta.url));

function stopReason(label) {
  return { code: label, message: `${label} message`, details: {} };
}

function fixtureHumanDecision() {
  return {
    type: 'clarification',
    question: 'Choose the fixture boundary?',
    material_reason: 'The answer changes the fixture execution boundary.',
    impact_scope: ['fixture']
  };
}

test('GRS-S-9 INV-004 factory rejects unknown dependencies and whole-service replacement seams', () => {
  assert.throws(() => createGuardedRunSession({ service: {} }), /Unknown guarded Run dependency/);
  assert.throws(() => createGuardedRunSession({ artifactIo: { cp() {} } }), /Unknown guarded Run artifact I\/O dependency/);
});

test('RCC-S-4 guarded Run persistence emits capsule refresh events after authority commit', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const events = [];
  const session = fixture.session({
    refreshContextCapsule: async (event) => {
      events.push({
        reason: event.reason,
        run_id: event.state.run_id,
        status: event.state.status,
        authority_exists: await stat(event.authorityFile).then(() => true, () => false)
      });
    }
  });
  await session.run(fixture.source, { storyId: STORY_ID });
  await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'waiting_for_human',
    reason: 'decision_required',
    stopReason: stopReason('decision_required'),
    pendingDecision: {
      type: 'clarification',
      question: 'Continue?',
      material_reason: 'The answer changes the selected implementation boundary.',
      impact_scope: ['implementation'],
      stop_node_id: 'spec_boundary'
    }
  });

  assert.deepEqual(events, [
    { reason: 'run_started', run_id: RUN_ID, status: 'running', authority_exists: true },
    { reason: 'human_decision', run_id: RUN_ID, status: 'waiting_for_human', authority_exists: true }
  ]);
});

test('ARA-S-1 ARA-S-3 ARA-S-4 GAH-S-3 Guarded Run persists adapter state and bridges completed review provenance into Agent Review', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let runtimeStatus = 'running';
  const reviews = [];
  const coordinator = createAgentRuntimeCoordinator({ adapters: [{
    id: 'fixture-runtime',
    async probe() { return { available: true, capabilities: ['review'], sandbox: 'read-only', approval_policy: 'managed' }; },
    async start() { return { provider_run_id: 'provider-review', agent_identity: 'reviewer-2', session_id: 'review-session', thread_id: 'review-thread' }; },
    async status() { return { status: runtimeStatus }; },
    async cancel() { runtimeStatus = 'cancelled'; },
    async collect_result() {
      return { completion_status: 'completed', changed_files: [], head_sha: fixture.identity(fixture.source).head_sha, test_suggestions: [], summary: 'review pass', agent_identity: 'reviewer-2', lifecycle: 'closed' };
    }
  }] });
  const session = fixture.session({
    agentRuntimeCoordinator: coordinator,
    recordAgentReview: async (repo, review) => { reviews.push({ repo, review }); return { status: 'pass' }; }
  });
  const run = await session.run(fixture.source, { storyId: STORY_ID });
  const managedWorktree = run.execution_context.root_realpath;
  const started = await session.dispatchRuntime(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    request: {
      adapter_id: 'fixture-runtime', task_id: 'review-runtime', role: 'review',
      reviewer_identity: 'reviewer-2', implementation_identity: 'implementer-1', implementation_session_id: 'implementation-session',
      requirements: { capabilities: ['review'], timeout_ms: 1000, managed_worktree: managedWorktree }
    }
  });
  assert.equal(started.state.runtime_dispatches[0].status, 'running');
  runtimeStatus = 'completed';
  const completed = await session.pollRuntime(fixture.source, { storyId: STORY_ID, runId: RUN_ID, dispatchId: started.dispatch.dispatch_id });
  assert.equal(completed.dispatch.result.review_provenance.lifecycle, 'closed');
  const persisted = await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(persisted.runtime_dispatches[0].status, 'completed');
  const gated = await session.recordRuntimeReview(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    dispatchId: started.dispatch.dispatch_id,
    review: { stage: 'gate', role: 'gate_evidence', status: 'pass', summary: 'runtime review' }
  });
  assert.equal(gated.review.status, 'pass');
  assert.equal(reviews[0].repo, managedWorktree);
  assert.equal(reviews[0].review.executionMode, 'parallel_subagent');
  assert.equal(reviews[0].review.agentId, 'reviewer-2');
  assert.equal(reviews[0].review.agentClosed, true);
  assert.equal(reviews[0].review.implementationSessionId, 'implementation-session');
  assert.equal(run.current_head_sha, persisted.current_head_sha);
});

test('Guarded Run rejects provider identities already persisted in a separate Run artifact', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  const run = await session.run(fixture.source, { storyId: STORY_ID });
  const foreignRunId = 'run-20260715T010204Z-01020305';
  const foreignDispatch = {
    adapter_id: 'fixture-runtime',
    dispatch_id: 'dispatch-foreign',
    run_id: foreignRunId,
    provider_run_id: 'provider-foreign',
    provider_session_id: 'session-foreign',
    thread_id: 'thread-foreign'
  };
  await mkdir(path.dirname(fixture.runFile(fixture.source, foreignRunId)), { recursive: true });
  await writeFile(fixture.runFile(fixture.source, foreignRunId), `${JSON.stringify({
    ...run,
    run_id: foreignRunId,
    runtime_dispatches: [foreignDispatch]
  }, null, 2)}\n`);
  assert.equal((JSON.parse(await readFile(fixture.runFile(fixture.source, foreignRunId), 'utf8'))
    .runtime_dispatches[0].lineage), undefined);

  let starts = 0;
  const coordinator = createAgentRuntimeCoordinator({ adapters: [{
    id: 'fixture-runtime',
    async probe() { return { available: true, capabilities: ['workspace_write'], sandbox: 'workspace-write', approval_policy: 'managed' }; },
    async start() {
      starts += 1;
      return { provider_run_id: 'provider-foreign', agent_identity: 'agent-1', session_id: 'session-foreign', thread_id: 'thread-foreign' };
    },
    async status() { return { status: 'cancelled' }; },
    async cancel() {},
    async collect_result() { return { completion_status: 'completed', changed_files: [], head_sha: run.current_head_sha, summary: 'unused' }; }
  }] });
  const guarded = fixture.session({ agentRuntimeCoordinator: coordinator });
  await assert.rejects(guarded.dispatchRuntime(fixture.source, {
    storyId: STORY_ID,
    runId: run.run_id,
    request: {
      adapter_id: 'fixture-runtime',
      task_id: 'cross-run-conflict',
      role: 'implementation',
      requirements: { capabilities: ['workspace_write'], timeout_ms: 1000, managed_worktree: fixture.source }
    }
  }), { code: 'provider_identity_conflict' });

  assert.equal(starts, 1);
  assert.deepEqual((await guarded.status(fixture.source, { storyId: STORY_ID, runId: run.run_id })).runtime_dispatches ?? [], []);
});

test('Guarded Run reuses the same persisted legacy dispatch identity within one Run and dispatch', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let starts = 0;
  const coordinator = createAgentRuntimeCoordinator({ adapters: [{
    id: 'fixture-runtime',
    async probe() { return { available: true, capabilities: ['workspace_write'], sandbox: 'workspace-write', approval_policy: 'managed' }; },
    async start() {
      starts += 1;
      return { provider_run_id: 'provider-same-run', agent_identity: 'agent-1', session_id: 'session-same-run', thread_id: 'thread-same-run' };
    },
    async status() { return { status: 'running' }; },
    async cancel() {},
    async collect_result() { return { completion_status: 'completed', changed_files: [], head_sha: fixture.identity(fixture.source).head_sha, summary: 'unused' }; }
  }] });
  const firstSession = fixture.session({ agentRuntimeCoordinator: coordinator });
  const run = await firstSession.run(fixture.source, { storyId: STORY_ID });
  const request = {
    adapter_id: 'fixture-runtime',
    task_id: 'same-dispatch-retry',
    role: 'implementation',
    requirements: { capabilities: ['workspace_write'], timeout_ms: 1000, managed_worktree: fixture.source }
  };
  const first = await firstSession.dispatchRuntime(fixture.source, { storyId: STORY_ID, runId: run.run_id, request });
  const persisted = JSON.parse(await readFile(fixture.runFile(fixture.source, run.run_id), 'utf8'));
  assert.equal(persisted.runtime_dispatches[0].provider_run_id, 'provider-same-run');

  const reloadedSession = fixture.session({ agentRuntimeCoordinator: coordinator });
  const retry = await reloadedSession.dispatchRuntime(fixture.source, { storyId: STORY_ID, runId: run.run_id, request });

  assert.equal(starts, 1);
  assert.equal(retry.reused, true);
  assert.equal(retry.dispatch.dispatch_id, first.dispatch.dispatch_id);
  assert.equal(retry.dispatch.provider_run_id, first.dispatch.provider_run_id);
  assert.equal((await reloadedSession.status(fixture.source, { storyId: STORY_ID, runId: run.run_id })).runtime_dispatches.length, 1);
});

test('ARA-S-3 Guarded Run collects an implementation result after the managed worktree HEAD advances and rebinds authority', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'created' });
  const nextHead = 'b'.repeat(40);
  let runtimeStatus = 'running';
  const coordinator = createAgentRuntimeCoordinator({ adapters: [{
    id: 'fixture-runtime',
    async probe() { return { available: true, capabilities: ['workspace_write'], sandbox: 'workspace-write' }; },
    async start() { return { provider_run_id: 'provider-implementation', agent_identity: 'implementer-1', session_id: 'implementation-session' }; },
    async status() { return { status: runtimeStatus }; },
    async cancel() { return { status: 'cancelled' }; },
    async collect_result() { return { completion_status: 'completed', changed_files: ['src/change.js'], head_sha: nextHead, test_suggestions: ['node --test'], summary: 'implemented' }; }
  }] });
  const session = fixture.session({ agentRuntimeCoordinator: coordinator });
  const run = await session.run(fixture.source, { storyId: STORY_ID });
  const started = await session.dispatchRuntime(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    request: {
      adapter_id: 'fixture-runtime', task_id: 'implementation-runtime', role: 'implementation',
      requirements: { capabilities: ['workspace_write'], timeout_ms: 1000, managed_worktree: run.managed_worktree.path }
    }
  });
  fixture.setHead(fixture.managed, nextHead);
  runtimeStatus = 'completed';
  const completed = await session.pollRuntime(fixture.source, { storyId: STORY_ID, runId: RUN_ID, dispatchId: started.dispatch.dispatch_id });
  assert.ok(completed.dispatch.result, JSON.stringify(completed));
  assert.equal(completed.dispatch.result.head_sha, nextHead);
  assert.equal(completed.dispatch.lineage.head_sha, nextHead);
  assert.equal(completed.state.current_head_sha, nextHead);
  assert.equal((await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID })).current_head_sha, nextHead);
});

test('ARA-S-3 Guarded Run rejects an implementation result whose reported HEAD differs from the managed worktree', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'created' });
  let runtimeStatus = 'running';
  const coordinator = createAgentRuntimeCoordinator({ adapters: [{
    id: 'fixture-runtime',
    async probe() { return { available: true, capabilities: ['workspace_write'], sandbox: 'workspace-write' }; },
    async start() { return { provider_run_id: 'provider-implementation', agent_identity: 'implementer-1' }; },
    async status() { return { status: runtimeStatus }; },
    async cancel() { return { status: 'cancelled' }; },
    async collect_result() { return { completion_status: 'completed', changed_files: ['src/change.js'], head_sha: 'c'.repeat(40), test_suggestions: [], summary: 'implemented' }; }
  }] });
  const session = fixture.session({ agentRuntimeCoordinator: coordinator });
  const run = await session.run(fixture.source, { storyId: STORY_ID });
  const started = await session.dispatchRuntime(fixture.source, {
    storyId: STORY_ID, runId: RUN_ID,
    request: { adapter_id: 'fixture-runtime', task_id: 'implementation-runtime', role: 'implementation', requirements: { capabilities: ['workspace_write'], timeout_ms: 1000, managed_worktree: run.managed_worktree.path } }
  });
  fixture.setHead(fixture.managed, 'b'.repeat(40));
  runtimeStatus = 'completed';
  await assert.rejects(session.pollRuntime(fixture.source, { storyId: STORY_ID, runId: RUN_ID, dispatchId: started.dispatch.dispatch_id }), errorWithCode('runtime_head_mismatch'));
});

test('Guarded Run rejects dispatch when managed authority is partial even with execution_context present', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'created' });
  const session = fixture.session({ agentRuntimeCoordinator: createAgentRuntimeCoordinator({ adapters: [] }) });
  const run = await session.run(fixture.source, { storyId: STORY_ID });
  const partial = {
    ...run,
    managed_worktree: { ...run.managed_worktree, path: null, branch: null },
    worktree_root: fixture.source,
    branch: 'caller-observed-branch'
  };
  await Promise.all([fixture.managed, fixture.source].map((root) => writeFile(fixture.runFile(root, run.run_id), `${JSON.stringify(partial, null, 2)}\n`)));

  await assert.rejects(
    session.dispatchRuntime(fixture.source, {
      storyId: STORY_ID,
      runId: run.run_id,
      request: {
        adapter_id: 'fixture-runtime', task_id: 'partial-authority', role: 'implementation',
        requirements: { capabilities: ['workspace_write'], timeout_ms: 1000, managed_worktree: fixture.source }
      }
    }),
    errorWithCode('worktree_mismatch')
  );
});

test('ARA-S-4 Agent Review bridge revalidates persisted review provenance fail closed', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let runtimeStatus = 'running';
  const coordinator = createAgentRuntimeCoordinator({ adapters: [{
    id: 'fixture-runtime',
    async probe() { return { available: true, capabilities: ['review'], sandbox: 'read-only' }; },
    async start() { return { provider_run_id: 'provider-review', agent_identity: 'reviewer-2', session_id: 'review-session' }; },
    async status() { return { status: runtimeStatus }; },
    async cancel() { return { status: 'cancelled' }; },
    async collect_result() { return { completion_status: 'completed', changed_files: [], head_sha: fixture.identity(fixture.source).head_sha, test_suggestions: [], summary: 'pass', agent_identity: 'reviewer-2', lifecycle: 'closed' }; }
  }] });
  let recordCalls = 0;
  const session = fixture.session({ agentRuntimeCoordinator: coordinator, recordAgentReview: async () => { recordCalls += 1; return { status: 'pass' }; } });
  const run = await session.run(fixture.source, { storyId: STORY_ID });
  const started = await session.dispatchRuntime(fixture.source, {
    storyId: STORY_ID, runId: RUN_ID,
    request: { adapter_id: 'fixture-runtime', task_id: 'review-runtime', role: 'review', reviewer_identity: 'reviewer-2', implementation_identity: 'implementer-1', implementation_session_id: 'implementation-session', requirements: { capabilities: ['review'], timeout_ms: 1000, managed_worktree: run.execution_context.root_realpath } }
  });
  runtimeStatus = 'completed';
  await session.pollRuntime(fixture.source, { storyId: STORY_ID, runId: RUN_ID, dispatchId: started.dispatch.dispatch_id });
  const stateFile = fixture.runFile(fixture.source, RUN_ID);
  const validState = JSON.parse(await readFile(stateFile, 'utf8'));
  const corruptions = [
    (dispatch) => { dispatch.sandbox = 'workspace-write'; },
    (dispatch) => { dispatch.requirements.capabilities.push('workspace_write'); },
    (dispatch) => { dispatch.result.changed_files = ['src/forged.js']; },
    (dispatch) => { dispatch.result.head_sha = 'f'.repeat(40); },
    (dispatch) => { dispatch.result.review_provenance.execution_mode = 'manual_review'; },
    (dispatch) => { dispatch.result.review_provenance.agent_identity = 'implementer-1'; },
    (dispatch) => { dispatch.result.review_provenance.session_id = 'implementation-session'; },
    (dispatch) => {
      dispatch.reviewer_identity = 'forged-reviewer';
      dispatch.agent_identity = 'forged-reviewer';
      dispatch.result.review_provenance.agent_identity = 'forged-reviewer';
    },
    (dispatch) => {
      dispatch.result.review_provenance.session_id = 'substituted-review-session';
      dispatch.result.review_provenance.thread_id = 'substituted-review-thread';
    }
  ];
  for (const corrupt of corruptions) {
    const forged = structuredClone(validState);
    corrupt(forged.runtime_dispatches[0]);
    await writeFile(stateFile, `${JSON.stringify(forged, null, 2)}\n`);
    await assert.rejects(session.recordRuntimeReview(fixture.source, { storyId: STORY_ID, runId: RUN_ID, dispatchId: started.dispatch.dispatch_id, review: { status: 'pass' } }), errorWithCode('invalid_runtime_review'));
  }
  assert.equal(recordCalls, 0);
});

test('HDC-S-3 HDC-S-6 waiting Run resumes only after its typed decision is resolved', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  await session.run(fixture.source, { storyId: STORY_ID });
  const waiting = await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'waiting_for_human',
    reason: 'material_scope_decision',
    stopReason: stopReason('material_scope_decision'),
    pendingDecision: { ...fixtureHumanDecision(), stop_node_id: 'pr_prepare' }
  });
  await assert.rejects(session.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), errorWithCode('decision_answer_required'));
  const unchanged = await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(unchanged.status, 'waiting_for_human');
  const resumed = await session.resume(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    decisionId: waiting.pending_decision.decision_id,
    answer: 'keep the boundary',
    answeredBy: 'operator',
    reflectedIn: ['docs/specs/example.md']
  });
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.human_decision_journal.at(-1).decision_id, waiting.pending_decision.decision_id);
  assert.equal(resumed.human_decision_journal.at(-1).stop_node_id, 'pr_prepare');
  assert.equal(resumed.resume_from_node_id, 'pr_prepare');
  assert.deepEqual(resumed.human_decision_journal.at(-1).reflected_in, ['docs/specs/example.md']);
});

test('HDC-S-3 waiting Run is side-effect free until the human decision is answered', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let prepareCalls = 0;
  let autopilotCalls = 0;
  const session = fixture.session({
    preparePullRequest: async () => { prepareCalls += 1; return {}; },
    safeAutopilotPullRequest: async () => { autopilotCalls += 1; return {}; }
  });
  await session.run(fixture.source, { storyId: STORY_ID });
  const waiting = await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'waiting_for_human',
    reason: 'material_scope_decision',
    stopReason: stopReason('material_scope_decision'),
    pendingDecision: fixtureHumanDecision()
  });

  const result = await session.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });

  assert.deepEqual(result.plan, []);
  assert.deepEqual(result.state, waiting);
  assert.equal(prepareCalls, 0);
  assert.equal(autopilotCalls, 0);
});

test('HDC-S-3 HDC-S-6 CLI resume answers a typed decision and continues the same Run', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const dependencies = fixture.dependencies();
  const session = createGuardedRunSession(dependencies);
  await session.run(fixture.source, { storyId: STORY_ID });
  const waiting = await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'waiting_for_human',
    reason: 'material_scope_decision',
    stopReason: stopReason('material_scope_decision'),
    pendingDecision: fixtureHumanDecision()
  });
  const stdout = capture();

  const result = await runCli([
    'execute', 'resume', fixture.source, '--story-id', STORY_ID, '--run-id', RUN_ID,
    '--decision', waiting.pending_decision.decision_id,
    '--answer', 'keep the current boundary', '--answered-by', 'operator',
    '--reflected-in', 'docs/specs/example.md,docs/architecture/example.md', '--json'
  ], { stdout, stderr: capture(), guardedRunDependencies: dependencies });

  assert.equal(result.exitCode, 0);
  const resumed = JSON.parse(stdout.text());
  assert.equal(resumed.run_id, RUN_ID);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.human_decision_journal.at(-1).decision_id, waiting.pending_decision.decision_id);
  assert.deepEqual(resumed.human_decision_journal.at(-1).reflected_in, [
    'docs/specs/example.md',
    'docs/architecture/example.md'
  ]);

  const restarted = createGuardedRunSession(dependencies);
  const persistedRun = await restarted.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  const decisionsDir = path.join(fixture.source, '.vibepro', 'executions', STORY_ID, 'runs', RUN_ID, 'decisions');
  const index = JSON.parse(await readFile(path.join(decisionsDir, 'index.json'), 'utf8'));
  const indexed = index.decisions.find((item) => item.decision_id === waiting.pending_decision.decision_id);
  const persistedDecision = JSON.parse(await readFile(path.join(decisionsDir, `${indexed.decision_id}.json`), 'utf8'));
  const journalEntry = persistedRun.human_decision_journal.find((item) => item.decision_id === indexed.decision_id);

  assert.equal(indexed.status, 'resolved');
  assert.equal(persistedDecision.question, fixtureHumanDecision().question);
  assert.equal(persistedDecision.answer, 'keep the current boundary');
  assert.equal(journalEntry.answered_by, 'operator');
  assert.equal(journalEntry.answered_at, persistedDecision.answered_at);
  assert.deepEqual(journalEntry.reflected_in, persistedDecision.reflected_in);
});

test('GRS-S-1 GRS-S-2 GRS-S-4 GAH-S-1 repository Run persists guarded defaults and repeated cancel is byte-stable', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  const created = await session.run(fixture.source, { storyId: STORY_ID });

  assert.deepEqual(created, {
    schema_version: '0.2.0',
    run_id: RUN_ID,
    story_id: STORY_ID,
    target: 'pr_ready',
    autonomy_mode: 'guarded',
    created_at: FIRST_TIME,
    updated_at: FIRST_TIME,
    status: 'running',
    stop_reason: null,
    attempt: 1,
    iteration: 0,
    budget: { max_attempts: 3, max_iterations: 12, max_duration_ms: 3600000, max_tokens: null, max_cost_usd: null },
    deadline: '2026-07-15T02:02:03.000Z',
    retry_policy: {
      retryable_stop_codes: [
        'runtime_required', 'runtime_quota', 'runtime_timeout', 'runtime_unavailable',
        'quota_exceeded', 'runtime_probe_timeout', 'runtime_start_timeout',
        'runtime_status_timeout', 'runtime_result_timeout', 'ci_pending', 'review_timeout', 'action_failed'
      ],
      backoff_ms: 0
    },
    provider_fallbacks: [],
    usage_accounting: { total_tokens: null, cost_usd: null, status: 'unknown', source: null, updated_at: null },
    last_progress_at: FIRST_TIME,
    pending_decision: null,
    current_head_sha: fixture.identity(fixture.source).head_sha,
    execution_context: {
      authority_kind: 'repository',
      root_realpath: fixture.source,
      git_dir_realpath: fixture.identity(fixture.source).git_dir_realpath
    },
    managed_worktree: fixture.disabledBinding,
    action_journal: [],
    next_best_action_decisions: [],
    human_decision_journal: [],
    retry_journal: [],
    transitions: [{
      sequence: 1,
      from: null,
      to: 'running',
      reason: 'run_created',
      timestamp: FIRST_TIME
    }]
  });

  assert.deepEqual(await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), created);
  assert.deepEqual(await session.watch(fixture.source, { storyId: STORY_ID }), created);
  await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'fixture_blocked',
    stopReason: { code: 'fixture_blocked', message: 'blocked', details: {} }
  });
  const resumed = await session.resume(fixture.source, { storyId: STORY_ID });
  assert.equal(resumed.attempt, 2);
  assert.equal(resumed.budget.max_attempts, 3);
  assert.equal(resumed.iteration, 0);
  assert.deepEqual(resumed.retry_journal, [{
    sequence: 1,
    stop_code: 'fixture_blocked',
    retryable: false,
    backoff_ms: 0,
    stopped_at: FIRST_TIME,
    resumed_at: FIRST_TIME,
    elapsed_ms: 0,
    backoff_satisfied: true,
    resumed_by: 'operator'
  }]);
  const cancelled = await session.cancel(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  const artifact = fixture.runFile(fixture.source, RUN_ID);
  const before = await readFile(artifact, 'utf8');
  assert.deepEqual(await session.cancel(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), cancelled);
  assert.equal(await readFile(artifact, 'utf8'), before);

  const repairBefore = JSON.parse(before);
  await assert.rejects(
    session.watch(fixture.source, { storyId: STORY_ID, runId: RUN_ID, repairLinkedCopy: true }),
    errorWithCode('linked_copy_not_configured')
  );
  const repairAfterRaw = await readFile(artifact, 'utf8');
  const repairAfter = JSON.parse(repairAfterRaw);
  assert.equal(repairAfterRaw, before);
  assert.equal(repairAfter.updated_at, repairBefore.updated_at);
  assert.deepEqual(repairAfter.transitions, repairBefore.transitions);
  await assert.rejects(stat(fixture.runFile(fixture.managed, RUN_ID)), { code: 'ENOENT' });
});

test('GAH-S-1 GAH-S-2 budget deadline retry and provider policy produce typed non-success stops', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  const created = await session.run(fixture.source, {
    storyId: STORY_ID,
    maxAttempts: 1,
    maxIterations: 2,
    maxDurationMs: 1000,
    maxTokens: 100,
    maxCostUsd: 1.5
  });
  assert.equal(created.status, 'running');
  assert.equal(created.usage_accounting.status, 'unknown');
  await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'fixture_blocked',
    stopReason: { code: 'action_failed', message: 'retry', details: {} }
  });
  const stopped = await session.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(stopped.status, 'blocked');
  assert.equal(stopped.stop_reason.code, 'max_attempts_exceeded');
  assert.equal(stopped.stop_reason.details.retryable, false);

  const second = await createFixture(t, { mode: 'disabled' });
  const deadlineSession = second.session();
  await deadlineSession.run(second.source, { storyId: STORY_ID, maxDurationMs: 1000 });
  second.setTime('2026-07-15T01:02:05.000Z');
  const deadline = await deadlineSession.orchestrate(second.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(deadline.state.status, 'blocked');
  assert.equal(deadline.state.stop_reason.code, 'deadline_exceeded');
});

test('GAH-S-2 persisted retry policy rejects non-retryable and interrupted backoff before resuming', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  await session.run(fixture.source, {
    storyId: STORY_ID,
    retryBackoffMs: 1000,
    retryableStopCodes: ['action_failed']
  });
  await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'retryable_failure',
    stopReason: { code: 'action_failed', message: 'retry later', details: { retry_policy_scope: 'managed' } }
  });
  await assert.rejects(
    session.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('retry_backoff_pending')
  );
  assert.deepEqual((await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID })).retry_journal, []);
  fixture.setTime('2026-07-15T01:02:05.000Z');
  const resumed = await session.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.retry_journal[0].retryable, true);
  assert.equal(resumed.retry_journal[0].backoff_satisfied, true);

  const second = await createFixture(t, { mode: 'disabled' });
  const secondSession = second.session();
  await secondSession.run(second.source, { storyId: STORY_ID, retryableStopCodes: ['action_failed'], retryBackoffMs: 0 });
  await secondSession.transition(second.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'non_retryable_failure',
    stopReason: { code: 'action_denied', message: 'do not retry', details: { retry_policy_scope: 'managed' } }
  });
  await assert.rejects(
    secondSession.resume(second.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('retry_not_allowed')
  );
});

test('GAH-S-2 persisted retry policy governs arbitrary configured stop codes', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  await session.run(fixture.source, {
    storyId: STORY_ID,
    retryBackoffMs: 1000,
    retryableStopCodes: ['vendor_transient']
  });
  await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'custom_transient',
    stopReason: { code: 'vendor_transient', message: 'retry later', details: {} }
  });
  await assert.rejects(
    session.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('retry_backoff_pending')
  );

  const second = await createFixture(t, { mode: 'disabled' });
  const secondSession = second.session();
  await secondSession.run(second.source, {
    storyId: STORY_ID,
    retryableStopCodes: ['vendor_transient']
  });
  await secondSession.transition(second.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'custom_permanent',
    stopReason: { code: 'vendor_permanent', message: 'do not retry', details: { retry_policy_scope: 'managed' } }
  });
  await assert.rejects(
    secondSession.resume(second.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('retry_not_allowed')
  );
});

test('GAH-S-8 GAH-S-9 cockpit preserves unknown usage instead of converting it to zero', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const created = await fixture.session().run(fixture.source, { storyId: STORY_ID });
  const summary = renderGuardedRunSummary(created);
  assert.match(summary, /tokens: unknown/);
  assert.match(summary, /cost_usd: unknown/);
  assert.match(summary, /automated_steps: 0/);
  assert.match(summary, /human_interruptions: 0/);
  assert.match(summary, /active_ms: 0/);
  assert.match(summary, /wait_ms: 0/);
  assert.match(summary, /full_suite_runs: unknown/);
  assert.match(summary, /evidence_reuse: unknown/);
  assert.match(summary, /accepted_defects: unknown/);
  assert.match(summary, /risk_reductions: unknown/);
  assert.match(summary, /efficiency_basis: trusted_pr_ready\+accepted_defects\+risk_reductions_vs_active_wait_token_cost/);
});

test('GAH-S-10 efficiency metrics use only typed completed measurements and preserve unknown', () => {
  const state = {
    story_id: STORY_ID,
    run_id: RUN_ID,
    status: 'running',
    created_at: FIRST_TIME,
    updated_at: FIRST_TIME,
    transitions: [],
    action_journal: [
      { status: 'completed', action_id: 'full_suite evidence_reuse', result_summary: 'mentions only' },
      { status: 'failed', measurements: { full_suite_count: 9, evidence_reuse_count: 8 } },
      { status: 'completed', measurements: { full_suite_count: 1, evidence_reuse_count: 2, evidence_invalidation_count: 1, accepted_defect_count: 2, risk_reduction_count: 3 } }
    ]
  };
  assert.deepEqual(deriveRunEfficiencyMetrics({ ...state, action_journal: [] }), {
    story_id: STORY_ID,
    run_id: RUN_ID,
    trusted_pr_ready_ms: null,
    active_ms: null,
    wait_ms: null,
    total_tokens: null,
    cost_usd: null,
    full_suite_count: null,
    evidence_reuse_count: null,
    evidence_invalidation_count: null,
    human_interruption_count: null,
    accepted_defect_count: null,
    risk_reduction_count: null
  });
  const metrics = deriveRunEfficiencyMetrics(state);
  assert.equal(metrics.full_suite_count, 1);
  assert.equal(metrics.evidence_reuse_count, 2);
  assert.equal(metrics.evidence_invalidation_count, 1);
  assert.equal(metrics.accepted_defect_count, 2);
  assert.equal(metrics.risk_reduction_count, 3);
});

test('GAH-S-10 typed outcome measurements survive authority persistence validation', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  await session.run(fixture.source, { storyId: STORY_ID });
  const artifact = fixture.runFile(fixture.source, RUN_ID);
  const persisted = JSON.parse(await readFile(artifact, 'utf8'));
  persisted.action_journal.push({
    action_id: 'outcome_evidence',
    node_id: 'outcome_evidence',
    input_head_sha: persisted.current_head_sha,
    output_head_sha: persisted.current_head_sha,
    idempotency_key: 'outcome-evidence-current-head',
    status: 'completed',
    measurements: { accepted_defect_count: 2, risk_reduction_count: 3 },
    started_at: FIRST_TIME,
    completed_at: FIRST_TIME
  });
  await writeFile(artifact, `${JSON.stringify(persisted, null, 2)}\n`);

  const loaded = await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(loaded.action_journal.at(-1).measurements.accepted_defect_count, 2);
  assert.equal(deriveRunEfficiencyMetrics(loaded).risk_reduction_count, 3);
});

test('GAH-S-3 provider fallback tries persisted adapters in order and retains failed attempts for audit', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const probes = [];
  const coordinator = createAgentRuntimeCoordinator({ adapters: [
    {
      id: 'primary-runtime',
      async probe() { probes.push('primary-runtime'); return { available: false, reason: 'runtime_unavailable' }; },
      async start() { throw new Error('unreachable'); }, async status() { return { status: 'failed' }; },
      async cancel() { return { status: 'cancelled' }; }, async collect_result() { throw new Error('unreachable'); }
    },
    {
      id: 'fallback-runtime',
      async probe() { probes.push('fallback-runtime'); return { available: true, capabilities: ['workspace_write'], sandbox: 'workspace-write' }; },
      async start() { return { provider_run_id: 'provider-fallback', agent_identity: 'implementer-2', session_id: 'fallback-session' }; },
      async status() { return { status: 'running' }; }, async cancel() { return { status: 'cancelled' }; },
      async collect_result() { throw new Error('unreachable'); }
    }
  ] });
  const session = fixture.session({ agentRuntimeCoordinator: coordinator });
  const run = await session.run(fixture.source, { storyId: STORY_ID, providerFallbacks: ['fallback-runtime'] });
  const result = await session.dispatchRuntime(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    request: {
      adapter_id: 'primary-runtime', task_id: 'implementation-runtime', role: 'implementation',
      requirements: { capabilities: ['workspace_write'], timeout_ms: 1000, managed_worktree: run.execution_context.root_realpath }
    }
  });

  assert.deepEqual(probes, ['primary-runtime', 'fallback-runtime']);
  assert.equal(result.dispatch.adapter_id, 'fallback-runtime');
  assert.equal(result.dispatch.status, 'running');
  assert.deepEqual(result.state.runtime_dispatches.map((entry) => [entry.adapter_id, entry.stop_reason?.code ?? null]), [
    ['primary-runtime', 'runtime_unavailable'],
    ['fallback-runtime', null]
  ]);
  const loaded = await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(loaded.runtime_dispatches.length, 2);
});

test('GAH-S-2 CLI rejects guarded policy options outside execute run', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const stderr = capture();
  const result = await runCli([
    'execute', 'status', fixture.source, '--story-id', STORY_ID, '--run-id', RUN_ID,
    '--max-attempts', '9', '--json'
  ], { stdout: capture(), stderr, guardedRunDependencies: fixture.dependencies() });
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(stderr.text()).stop_reason.code, 'policy_options_not_supported');
});

test('GAH-S-1 GAH-S-8 runtime usage is accumulated and budget enforcement remains typed', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let runtimeStatus = 'running';
  const coordinator = createAgentRuntimeCoordinator({ adapters: [{
    id: 'usage-runtime',
    async probe() { return { available: true, capabilities: ['workspace_write'], sandbox: 'workspace-write', approval_policy: 'managed' }; },
    async start() { return { provider_run_id: 'provider-usage', agent_identity: 'implementer-1', session_id: 'implementation-session' }; },
    async status() { return { status: runtimeStatus }; },
    async cancel() { runtimeStatus = 'cancelled'; },
    async collect_result() {
      return {
        completion_status: 'completed', changed_files: [], head_sha: fixture.identity(fixture.source).head_sha,
        test_suggestions: [], summary: 'measured', usage_accounting: { total_tokens: 125, cost_usd: 0.25, source: 'fixture-runtime' }
      };
    }
  }] });
  const session = fixture.session({ agentRuntimeCoordinator: coordinator });
  const run = await session.run(fixture.source, { storyId: STORY_ID, maxTokens: 100, maxCostUsd: 1 });
  const started = await session.dispatchRuntime(fixture.source, {
    storyId: STORY_ID, runId: RUN_ID,
    request: {
      adapter_id: 'usage-runtime', task_id: 'usage', role: 'implementation', implementation_identity: 'implementer-1',
      requirements: { capabilities: ['workspace_write'], timeout_ms: 1000, managed_worktree: run.execution_context.root_realpath }
    }
  });
  runtimeStatus = 'completed';
  const completed = await session.pollRuntime(fixture.source, { storyId: STORY_ID, runId: RUN_ID, dispatchId: started.dispatch.dispatch_id });
  assert.deepEqual(completed.state.usage_accounting, {
    total_tokens: 125, cost_usd: 0.25, status: 'known', source: 'fixture-runtime', updated_at: FIRST_TIME
  });
  const restarted = fixture.session({ agentRuntimeCoordinator: coordinator });
  const repolled = await restarted.pollRuntime(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    dispatchId: started.dispatch.dispatch_id
  });
  assert.deepEqual(repolled.state.usage_accounting, completed.state.usage_accounting);
  const stopped = await session.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(stopped.state.status, 'blocked');
  assert.equal(stopped.state.stop_reason.code, 'token_budget_exceeded');
  assert.equal(stopped.state.stop_reason.details.retryable, false);
});

test('GAH-S-2 exhausted runtime fallback stop codes remain resumable by the default policy', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const coordinator = createAgentRuntimeCoordinator({ adapters: [{
    id: 'quota-runtime',
    async probe() { return { available: false, capabilities: [], reason: 'quota_exceeded' }; },
    async start() { throw new Error('start must not run when probe reports quota exhaustion'); },
    async status() { return { status: 'failed' }; },
    async cancel() {},
    async collect_result() { throw new Error('no result exists'); }
  }] });
  const session = fixture.session({ agentRuntimeCoordinator: coordinator });
  const run = await session.run(fixture.source, { storyId: STORY_ID });
  const blocked = await session.dispatchRuntime(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    request: {
      adapter_id: 'quota-runtime', task_id: 'quota', role: 'implementation',
      requirements: { capabilities: ['workspace_write'], timeout_ms: 1000, managed_worktree: run.execution_context.root_realpath }
    }
  });
  assert.equal(blocked.state.stop_reason.code, 'quota_exceeded');
  assert.doesNotReject(session.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID }));
});

for (const timeoutPhase of ['start', 'status', 'result']) {
  test(`GAH-S-2 contained runtime ${timeoutPhase} timeout persists and resumes under the default policy`, async (t) => {
    const fixture = await createFixture(t, { mode: 'disabled' });
    let cancelled = false;
    let statusCalls = 0;
    const coordinator = createAgentRuntimeCoordinator({ adapters: [{
      id: `timeout-${timeoutPhase}-runtime`,
      async probe() { return { available: true, capabilities: ['workspace_write'], sandbox: 'workspace-write' }; },
      async start() {
        if (timeoutPhase === 'start') return new Promise(() => {});
        return { provider_run_id: `provider-${timeoutPhase}`, agent_identity: 'implementer-1', session_id: 'implementation-session' };
      },
      async status() {
        statusCalls += 1;
        if (timeoutPhase === 'status' && statusCalls === 1) return new Promise(() => {});
        if (timeoutPhase === 'result' && statusCalls === 1) return { status: 'completed' };
        return { status: cancelled ? 'cancelled' : 'running' };
      },
      async cancel() { cancelled = true; return { status: 'cancelled' }; },
      async collect_result() {
        if (timeoutPhase === 'result') return new Promise(() => {});
        throw new Error('result collection is not expected');
      }
    }] });
    const session = fixture.session({ agentRuntimeCoordinator: coordinator });
    const run = await session.run(fixture.source, { storyId: STORY_ID });
    const dispatched = await session.dispatchRuntime(fixture.source, {
      storyId: STORY_ID,
      runId: RUN_ID,
      request: {
        adapter_id: `timeout-${timeoutPhase}-runtime`, task_id: `timeout-${timeoutPhase}`, role: 'implementation',
        requirements: { capabilities: ['workspace_write'], timeout_ms: 5, managed_worktree: run.execution_context.root_realpath }
      }
    });
    const stopped = timeoutPhase === 'start'
      ? dispatched
      : await session.pollRuntime(fixture.source, { storyId: STORY_ID, runId: RUN_ID, dispatchId: dispatched.dispatch.dispatch_id });
    assert.equal(stopped.state.stop_reason.code, `runtime_${timeoutPhase}_timeout`);
    assert.equal(stopped.dispatch.provider_terminal_status, 'cancelled');

    const restarted = fixture.session({ agentRuntimeCoordinator: coordinator });
    const resumed = await restarted.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
    assert.equal(resumed.status, 'running');
    assert.equal(resumed.retry_journal.at(-1).stop_code, `runtime_${timeoutPhase}_timeout`);
    assert.equal(resumed.retry_journal.at(-1).retryable, true);
  });
}

test('GAH-S-2 guarded CLI exposes auditable retry and provider fallback policy controls', async () => {
  const stdout = capture();
  const result = await runCli(['help'], { stdout, stderr: capture() });
  assert.equal(result.exitCode, 0);
  assert.match(stdout.text(), /--retry-backoff-ms <ms>/);
  assert.match(stdout.text(), /--retryable-stop-codes <csv>/);
  assert.match(stdout.text(), /--provider-fallbacks <csv>/);
});

test('Portfolio creation request identity returns the same guarded Run exactly once', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  const creationRequestId = 'portfolio-0123456789abcdef01234567';
  const created = await session.run(fixture.source, { storyId: STORY_ID, creationRequestId });
  const retried = await session.run(fixture.source, { storyId: STORY_ID, creationRequestId });
  assert.equal(created.run_id, retried.run_id);
  assert.equal(retried.creation_request_id, creationRequestId);
  const entries = await readdir(path.dirname(fixture.runFile(fixture.source, created.run_id)));
  assert.ok(entries.includes('state.json'));
});

test('Portfolio creation request fails closed when any Run candidate is corrupt', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  const creationRequestId = 'portfolio-0123456789abcdef01234567';
  await session.run(fixture.source, { storyId: STORY_ID, creationRequestId });
  const corruptRunId = 'run-20260715T010204Z-05060708';
  const corruptFile = fixture.runFile(fixture.source, corruptRunId);
  await mkdir(path.dirname(corruptFile), { recursive: true });
  await writeFile(corruptFile, '{not-json\n');
  await assert.rejects(
    session.run(fixture.source, { storyId: STORY_ID, creationRequestId }),
    (cause) => cause.code === 'creation_request_scan_blocked'
      && cause.details.run_id === corruptRunId
      && cause.details.artifact === corruptFile
  );
});

test('GRS-S-8 GRS-S-10 S-002 C-007 managed Run commits authority then mirror and repairs only from authority', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'created' });
  const session = fixture.session();
  const created = await session.run(fixture.source, { storyId: STORY_ID });
  assert.equal(created.execution_context.authority_kind, 'managed');
  assert.equal(created.execution_context.root_realpath, fixture.managed);
  const authorityFile = fixture.runFile(fixture.managed, RUN_ID);
  const mirrorFile = fixture.runFile(fixture.source, RUN_ID);
  assert.equal(await readFile(authorityFile, 'utf8'), await readFile(mirrorFile, 'utf8'));

  await writeFile(mirrorFile, `${JSON.stringify({ ...created, iteration: 99 }, null, 2)}\n`);
  await assert.rejects(
    session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('linked_copy_out_of_sync')
  );
  const driftError = capture();
  const driftResult = await runCli([
    'execute', 'status', fixture.source,
    '--story-id', STORY_ID,
    '--run-id', RUN_ID
  ], { stdout: capture(), stderr: driftError, guardedRunDependencies: fixture.dependencies() });
  assert.equal(driftResult.exitCode, 2);
  assert.match(driftError.text(), new RegExp(`story_id: ${STORY_ID}`));
  assert.match(
    driftError.text(),
    new RegExp(`vibepro execute watch ${fixture.source} --story-id ${STORY_ID} --run-id ${RUN_ID} --repair-linked-copy`)
  );
  const authorityRaw = await readFile(authorityFile, 'utf8');
  await writeFile(authorityFile, `${JSON.stringify({ ...created, story_id: 'story-safe; touch /tmp/copied-command' }, null, 2)}\n`);
  const tamperedError = capture();
  const tamperedResult = await runCli([
    'execute', 'status', fixture.source,
    '--story-id', STORY_ID,
    '--run-id', RUN_ID
  ], { stdout: capture(), stderr: tamperedError, guardedRunDependencies: fixture.dependencies() });
  assert.equal(tamperedResult.exitCode, 2);
  assert.match(
    tamperedError.text(),
    new RegExp(`vibepro execute watch ${fixture.source} --story-id ${STORY_ID} --run-id ${RUN_ID} --repair-linked-copy`)
  );
  assert.doesNotMatch(tamperedError.text(), /story-safe; touch/);
  await writeFile(authorityFile, authorityRaw);
  const repaired = await session.watch(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    repairLinkedCopy: true
  });
  assert.deepEqual(repaired, created);
  assert.equal(await readFile(authorityFile, 'utf8'), await readFile(mirrorFile, 'utf8'));

  await rm(fixture.managed, { recursive: true, force: true });
  await assert.rejects(
    session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('worktree_unavailable')
  );
  assert.equal((await readFile(mirrorFile, 'utf8')).includes(RUN_ID), true);
});

test('GRS-S-3 GRS-S-8 INV-004 symlink legacy source root is persisted canonically and remains an allowed control root', async (t) => {
  const fixture = await createFixture(t, {
    mode: 'preferred',
    managedStatus: 'created',
    preexistingLegacy: true,
    sourceAlias: true
  });
  await writeLegacy(fixture.managed, fixture.legacy);
  const session = fixture.session();
  const created = await session.run(fixture.sourceAlias, { storyId: STORY_ID });

  assert.equal(created.managed_worktree.source_repo, fixture.source);
  assert.deepEqual(await session.status(fixture.sourceAlias, { storyId: STORY_ID, runId: RUN_ID }), created);
  assert.deepEqual(await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), created);
  assert.deepEqual(await session.watch(fixture.sourceAlias, { storyId: STORY_ID, runId: RUN_ID }), created);
  assert.deepEqual(await session.watch(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), created);

  await session.transition(fixture.managed, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'fixture_blocked',
    stopReason: stopReason('fixture_blocked')
  });
  assert.equal((await session.resume(fixture.sourceAlias, { storyId: STORY_ID, runId: RUN_ID })).status, 'running');
  assert.equal((await session.cancel(fixture.source, { storyId: STORY_ID, runId: RUN_ID })).status, 'cancelled');
});

test('GRS-S-8 GRS-S-9 managed metadata cannot downgrade its Run authority kind', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'created' });
  const session = fixture.session();
  const created = await session.run(fixture.source, { storyId: STORY_ID });
  const authorityFile = fixture.runFile(fixture.managed, RUN_ID);
  const mirrorFile = fixture.runFile(fixture.source, RUN_ID);
  const invalid = structuredClone(created);
  invalid.execution_context.authority_kind = 'repository';
  const raw = `${JSON.stringify(invalid, null, 2)}\n`;
  await Promise.all([writeFile(authorityFile, raw), writeFile(mirrorFile, raw)]);

  await assert.rejects(
    session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('invalid_state')
  );
  assert.equal(await readFile(authorityFile, 'utf8'), raw);
  assert.equal(await readFile(mirrorFile, 'utf8'), raw);
});

test('GRS-S-3 GRS-S-8 S-001 S-009 C-007 source fallback survives restart paths and rejects repair without mutation, but pre-existing unavailable fails closed', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'unavailable' });
  const session = fixture.session();
  const created = await session.run(fixture.source, { storyId: STORY_ID });
  assert.equal(created.execution_context.authority_kind, 'source_fallback');
  assert.equal(
    created.managed_worktree.bootstrap_binding_fingerprint,
    buildBootstrapBindingFingerprint(created.managed_worktree)
  );
  assert.deepEqual(await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), created);

  const restarted = fixture.session();
  assert.deepEqual(await restarted.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), created);
  assert.deepEqual(await restarted.watch(fixture.source, { storyId: STORY_ID }), created);
  assert.deepEqual(await restarted.watch(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), created);
  await restarted.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'source_fallback_restart_blocked',
    stopReason: stopReason('source_fallback_restart_blocked')
  });
  assert.equal((await restarted.resume(fixture.source, { storyId: STORY_ID })).status, 'running');
  assert.equal((await restarted.cancel(fixture.source, { storyId: STORY_ID, runId: RUN_ID })).status, 'cancelled');

  const authorityFile = fixture.runFile(fixture.source, RUN_ID);
  const repairBeforeRaw = await readFile(authorityFile, 'utf8');
  const repairBefore = JSON.parse(repairBeforeRaw);
  await assert.rejects(
    restarted.watch(fixture.source, { storyId: STORY_ID, runId: RUN_ID, repairLinkedCopy: true }),
    errorWithCode('linked_copy_not_configured')
  );
  const repairAfterRaw = await readFile(authorityFile, 'utf8');
  const repairAfter = JSON.parse(repairAfterRaw);
  assert.equal(repairAfterRaw, repairBeforeRaw);
  assert.equal(repairAfter.updated_at, repairBefore.updated_at);
  assert.deepEqual(repairAfter.transitions, repairBefore.transitions);
  await assert.rejects(stat(fixture.runFile(fixture.managed, RUN_ID)), { code: 'ENOENT' });

  const second = await createFixture(t, { mode: 'preferred', managedStatus: 'unavailable', preexistingLegacy: true });
  let bootstrapCalls = 0;
  const secondSession = second.session({
    startExecution: async () => {
      bootstrapCalls += 1;
      throw new Error('must not bootstrap');
    }
  });
  await assert.rejects(secondSession.run(second.source, { storyId: STORY_ID }), errorWithCode('worktree_unavailable'));
  assert.equal(bootstrapCalls, 0);

  const required = await createFixture(t, { mode: 'required', managedStatus: 'unavailable' });
  await assert.rejects(
    required.session().run(required.source, { storyId: STORY_ID }),
    errorWithCode('worktree_unavailable')
  );
  await assert.rejects(stat(required.runFile(required.source, RUN_ID)), { code: 'ENOENT' });
});

test('GRS-S-3 S-009 copied unavailable metadata cannot grant source fallback control to another root', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'unavailable' });
  const session = fixture.session();
  await session.run(fixture.source, { storyId: STORY_ID });
  await writeLegacy(fixture.managed, fixture.legacy);

  await assert.rejects(
    session.status(fixture.managed, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('worktree_mismatch')
  );
});

test('GRS-S-3 GRS-S-7 S-005 source fallback authority and fingerprint failures are non-mutating', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'unavailable' });
  const session = fixture.session();
  const created = await session.run(fixture.source, { storyId: STORY_ID });
  const artifact = fixture.runFile(fixture.source, RUN_ID);

  for (const [mutate, code] of [
    [(state) => { delete state.managed_worktree.bootstrap_binding_fingerprint; }, 'invalid_state'],
    [(state) => { state.managed_worktree.bootstrap_binding_fingerprint = '0'.repeat(64); }, 'worktree_mismatch'],
    [(state) => { state.execution_context.authority_kind = 'foreign'; }, 'invalid_state']
  ]) {
    const invalid = structuredClone(created);
    mutate(invalid);
    const raw = `${JSON.stringify(invalid, null, 2)}\n`;
    await writeFile(artifact, raw);
    await assert.rejects(
      session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
      errorWithCode(code)
    );
    assert.equal(await readFile(artifact, 'utf8'), raw);
  }
});

test('GRS-S-8 S-008 existing creation lock fails closed without bootstrapping and preserves the lock', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const lock = fixture.creationLock();
  await mkdir(lock, { recursive: true });
  let bootstrapCalls = 0;
  const dependencies = fixture.dependencies({
    startExecution: async () => {
      bootstrapCalls += 1;
      throw new Error('must not bootstrap while locked');
    }
  });
  const session = createGuardedRunSession(dependencies);

  await assert.rejects(
    session.run(fixture.source, { storyId: STORY_ID }),
    (error) => {
      assert.equal(error.code, 'run_creation_locked');
      assert.equal(error.details.lock_artifact, lock);
      return true;
    }
  );

  const jsonError = capture();
  const jsonResult = await runCli([
    'execute', 'run', fixture.source,
    '--story-id', STORY_ID,
    '--json'
  ], {
    stdout: capture(),
    stderr: jsonError,
    guardedRunDependencies: dependencies
  });
  assert.equal(jsonResult.exitCode, 2);
  assert.equal(JSON.parse(jsonError.text()).stop_reason.details.lock_artifact, lock);

  const humanError = capture();
  const humanResult = await runCli([
    'execute', 'run', fixture.source,
    '--story-id', STORY_ID
  ], {
    stdout: capture(),
    stderr: humanError,
    guardedRunDependencies: dependencies
  });
  assert.equal(humanResult.exitCode, 2);
  assert.ok(humanError.text().includes(`- lock_artifact: ${lock}\n`));
  assert.equal(bootstrapCalls, 0);
  assert.equal((await stat(lock)).isDirectory(), true);
});

test('GRS-S-8 INV-004 source and managed callers use the same Story creation lock', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'created', preexistingLegacy: true });
  await writeLegacy(fixture.managed, fixture.legacy);
  const sourceLock = fixture.creationLock();
  await mkdir(sourceLock, { recursive: true });

  await assert.rejects(
    fixture.session().run(fixture.managed, { storyId: STORY_ID }),
    errorWithCode('run_creation_locked')
  );
  await assert.rejects(stat(fixture.runFile(fixture.managed, RUN_ID)), { code: 'ENOENT' });
});

test('GRS-S-8 INV-004 concurrent linked worktrees share the bootstrap lock before legacy authority exists', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let releaseBootstrap;
  let reportBootstrapEntered;
  let bootstrapCalls = 0;
  const bootstrapEntered = new Promise((resolve) => { reportBootstrapEntered = resolve; });
  const bootstrapReleased = new Promise((resolve) => { releaseBootstrap = resolve; });
  const session = fixture.session({
    startExecution: async (repoRoot) => {
      bootstrapCalls += 1;
      if (path.resolve(repoRoot) !== fixture.source) {
        throw new Error('secondary worktree entered bootstrap');
      }
      reportBootstrapEntered();
      await bootstrapReleased;
      await writeLegacy(fixture.source, fixture.legacy);
      return { state: fixture.legacy, found: true };
    }
  });

  const first = session.run(fixture.source, { storyId: STORY_ID });
  await bootstrapEntered;
  await assert.rejects(
    session.run(fixture.managed, { storyId: STORY_ID }),
    errorWithCode('run_creation_locked')
  );
  releaseBootstrap();
  await first;
  assert.equal(bootstrapCalls, 1);
});

test('GRS-S-10 S-008 partial legacy bootstrap stops Run creation, releases the lock, and makes the next attempt fail closed', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'unavailable' });
  let bootstrapCalls = 0;
  const session = fixture.session({
    startExecution: async () => {
      bootstrapCalls += 1;
      await writeLegacy(fixture.source, fixture.legacy);
      throw new Error('fixture bootstrap interrupted after legacy commit');
    }
  });

  let failure;
  try {
    await session.run(fixture.source, { storyId: STORY_ID });
  } catch (error) {
    failure = error;
  }
  const legacyArtifact = path.join(fixture.source, '.vibepro', 'executions', STORY_ID, 'state.json');
  const legacyRaw = `${JSON.stringify(fixture.legacy, null, 2)}\n`;
  assert.equal(failure?.code, 'legacy_bootstrap_partial');
  assert.equal(failure?.details?.legacy_artifact, legacyArtifact);
  assert.equal(failure?.details?.cause, 'fixture bootstrap interrupted after legacy commit');
  assert.equal(bootstrapCalls, 1);
  assert.equal(await readFile(legacyArtifact, 'utf8'), legacyRaw);
  await assert.rejects(
    stat(fixture.creationLock()),
    { code: 'ENOENT' }
  );
  await assert.rejects(stat(fixture.runFile(fixture.source, RUN_ID)), { code: 'ENOENT' });
  await assert.rejects(stat(fixture.runFile(fixture.managed, RUN_ID)), { code: 'ENOENT' });

  await assert.rejects(session.run(fixture.source, { storyId: STORY_ID }), errorWithCode('worktree_unavailable'));
  assert.equal(bootstrapCalls, 1);

  for (const json of [true, false]) {
    const cliFixture = await createFixture(t, { mode: 'preferred', managedStatus: 'unavailable' });
    let cliBootstrapCalls = 0;
    const dependencies = cliFixture.dependencies({
      startExecution: async () => {
        cliBootstrapCalls += 1;
        await writeLegacy(cliFixture.source, cliFixture.legacy);
        throw new Error('fixture CLI bootstrap interrupted after legacy commit');
      }
    });
    const stdout = capture();
    const stderr = capture();
    const args = ['execute', 'run', cliFixture.source, '--story-id', STORY_ID];
    if (json) args.push('--json');
    const result = await runCli(args, {
      stdout,
      stderr,
      guardedRunDependencies: dependencies
    });
    const cliLegacyArtifact = path.join(cliFixture.source, '.vibepro', 'executions', STORY_ID, 'state.json');
    assert.equal(result.exitCode, 2);
    assert.equal(stdout.text(), '');
    if (json) {
      const envelope = JSON.parse(stderr.text());
      assert.equal(envelope.stop_reason.code, 'legacy_bootstrap_partial');
      assert.equal(envelope.stop_reason.details.legacy_artifact, cliLegacyArtifact);
      assert.equal(envelope.stop_reason.details.cause, 'fixture CLI bootstrap interrupted after legacy commit');
    } else {
      assert.match(stderr.text(), /code: legacy_bootstrap_partial/);
      assert.equal(stderr.text().includes(`legacy_artifact: ${cliLegacyArtifact}`), true);
      assert.match(stderr.text(), /cause: fixture CLI bootstrap interrupted after legacy commit/);
    }
    assert.equal(await readFile(cliLegacyArtifact, 'utf8'), `${JSON.stringify(cliFixture.legacy, null, 2)}\n`);
    await assert.rejects(stat(cliFixture.creationLock()), { code: 'ENOENT' });
    await assert.rejects(stat(cliFixture.runFile(cliFixture.source, RUN_ID)), { code: 'ENOENT' });
    await assert.rejects(stat(cliFixture.runFile(cliFixture.managed, RUN_ID)), { code: 'ENOENT' });

    const retryStderr = capture();
    const retryResult = await runCli([
      'execute', 'run', cliFixture.source, '--story-id', STORY_ID, '--json'
    ], {
      stdout: capture(),
      stderr: retryStderr,
      guardedRunDependencies: dependencies
    });
    assert.equal(retryResult.exitCode, 2);
    assert.equal(JSON.parse(retryStderr.text()).stop_reason.code, 'worktree_unavailable');
    assert.equal(cliBootstrapCalls, 1);
  }
});

test('GRS-S-10 C-006 bootstrap failure without a legacy commit uses the CLI internal-error path', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const stdout = capture();
  const stderr = capture();
  const result = await runCli([
    'execute', 'run', fixture.source,
    '--story-id', STORY_ID,
    '--json'
  ], {
    stdout,
    stderr,
    guardedRunDependencies: fixture.dependencies({
      startExecution: async () => {
        throw new Error('fixture bootstrap exploded');
      }
    })
  });
  assert.equal(result.exitCode, 1);
  assert.equal(stdout.text(), '');
  assert.equal(stderr.text(), 'fixture bootstrap exploded\n');
  await assert.rejects(stat(fixture.runFile(fixture.source, RUN_ID)), { code: 'ENOENT' });
});

test('GRS-S-10 S-002 managed mirror failure reports the committed authority artifact and leaves no mirror Run', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'created' });
  const session = fixture.session({
    artifactIo: {
      rename: async (from, to) => {
        if (to === fixture.runFile(fixture.source, RUN_ID)) {
          const error = new Error('fixture mirror unavailable');
          error.code = 'EACCES';
          throw error;
        }
        return rename(from, to);
      }
    }
  });

  let failure;
  try {
    await session.run(fixture.source, { storyId: STORY_ID });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, 'linked_copy_sync_failed');
  assert.equal(failure?.details?.run_id, RUN_ID);
  assert.equal(failure?.details?.authority_artifact, fixture.runFile(fixture.managed, RUN_ID));
  assert.equal(JSON.parse(await readFile(fixture.runFile(fixture.managed, RUN_ID), 'utf8')).run_id, RUN_ID);
  await assert.rejects(stat(fixture.runFile(fixture.source, RUN_ID)), { code: 'ENOENT' });
});

test('GRS-S-10 S-002 existing mutation commits once across mirror failure and explicit repair', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'created' });
  await fixture.session().run(fixture.source, { storyId: STORY_ID });
  const authorityFile = fixture.runFile(fixture.managed, RUN_ID);
  const mirrorFile = fixture.runFile(fixture.source, RUN_ID);
  const failing = fixture.session({
    artifactIo: {
      rename: async (from, to) => {
        if (to === mirrorFile) {
          const error = new Error('fixture mutation mirror unavailable');
          error.code = 'EACCES';
          throw error;
        }
        return rename(from, to);
      }
    }
  });

  await assert.rejects(
    failing.transition(fixture.source, {
      storyId: STORY_ID,
      runId: RUN_ID,
      to: 'blocked',
      reason: 'fixture_blocked_once',
      stopReason: stopReason('fixture_blocked_once')
    }),
    errorWithCode('linked_copy_sync_failed')
  );
  const committed = JSON.parse(await readFile(authorityFile, 'utf8'));
  assert.equal(committed.status, 'blocked');
  assert.equal(committed.transitions.filter((item) => item.reason === 'fixture_blocked_once').length, 1);
  await assert.rejects(
    fixture.session().status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('linked_copy_out_of_sync')
  );
  const repaired = await fixture.session().watch(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    repairLinkedCopy: true
  });
  assert.equal(repaired.transitions.filter((item) => item.reason === 'fixture_blocked_once').length, 1);
  assert.equal(await readFile(authorityFile, 'utf8'), await readFile(mirrorFile, 'utf8'));
});

test('GRS-S-8 C-005 implicit Run selection orders by created_at then lexical run_id', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const first = await fixture.session().run(fixture.source, { storyId: STORY_ID });
  const sameTimeHigherId = await fixture.session({
    randomBytes: () => Buffer.from([255, 255, 255, 255])
  }).run(fixture.source, { storyId: STORY_ID });
  const later = await fixture.session({
    now: () => new Date('2026-07-15T02:00:00.000Z'),
    randomBytes: () => Buffer.from([0, 0, 0, 1])
  }).run(fixture.source, { storyId: STORY_ID });

  assert.equal((await fixture.session().watch(fixture.source, { storyId: STORY_ID })).run_id, later.run_id);
  await rm(path.dirname(fixture.runFile(fixture.source, later.run_id)), { recursive: true, force: true });
  assert.equal((await fixture.session().watch(fixture.source, { storyId: STORY_ID })).run_id, sameTimeHigherId.run_id);
  assert.equal(first.created_at, sameTimeHigherId.created_at);
  assert.equal(sameTimeHigherId.run_id > first.run_id, true);
});

test('GRS-S-8 C-005 implicit Run selection fails closed when any candidate is rejected', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const valid = await fixture.session().run(fixture.source, { storyId: STORY_ID });
  const invalidRunId = 'run-20260715T030000Z-ffffffff';
  const invalid = {
    ...valid,
    run_id: invalidRunId,
    created_at: '2026-07-15T03:00:00.000Z',
    story_id: 'story-another-registered-looking-id'
  };
  const invalidFile = fixture.runFile(fixture.source, invalidRunId);
  await mkdir(path.dirname(invalidFile), { recursive: true });
  await writeFile(invalidFile, `${JSON.stringify(invalid, null, 2)}\n`);

  let failure;
  try {
    await fixture.session().watch(fixture.source, { storyId: STORY_ID });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, 'run_selection_blocked');
  assert.deepEqual(failure?.details?.rejected_candidates, [{
    run_id: invalidRunId,
    code: 'invalid_state',
    message: 'Run Story identity does not match its artifact path.',
    artifact: invalidFile
  }]);
  assert.equal((await fixture.session().watch(fixture.source, {
    storyId: STORY_ID,
    runId: valid.run_id
  })).run_id, valid.run_id);
  const stderr = capture();
  const cliFailure = await runCli([
    'execute', 'watch', fixture.source, '--story-id', STORY_ID
  ], { stdout: capture(), stderr, guardedRunDependencies: fixture.dependencies() });
  assert.equal(cliFailure.exitCode, 2);
  assert.match(stderr.text(), new RegExp(`rejected_candidate: ${invalidRunId} \\(invalid_state\\)`));
  assert.match(stderr.text(), /rerun with --run-id <validated-run-id>/);
  assert.equal(JSON.parse(await readFile(invalidFile, 'utf8')).story_id, invalid.story_id);
});

test('GRS-S-6 C-006 human errors expose linked-copy recovery handles and exact repair command', () => {
  const error = new GuardedRunError(
    'linked_copy_sync_failed',
    'Run authority committed but linked mirror synchronization failed.',
    {
      run_id: RUN_ID,
      story_id: STORY_ID,
      authority_artifact: '/authority/state.json',
      mirror_artifact: '/mirror/state.json'
    }
  );
  const output = renderGuardedRunError(error);
  assert.match(output, new RegExp(`run_id: ${RUN_ID}`));
  assert.match(output, /authority_artifact: \/authority\/state\.json/);
  assert.match(output, /mirror_artifact: \/mirror\/state\.json/);
  assert.match(output, new RegExp(`vibepro execute watch \\. --story-id ${STORY_ID} --run-id ${RUN_ID} --repair-linked-copy`));

  const explicitRepo = "/tmp/VibePro user's repo";
  const explicitOutput = renderGuardedRunError(error, { repoRoot: explicitRepo });
  assert.match(
    explicitOutput,
    new RegExp(`vibepro execute watch '/tmp/VibePro user'\\\\''s repo' --story-id ${STORY_ID} --run-id ${RUN_ID} --repair-linked-copy`)
  );

  const quotedIdentifiers = renderGuardedRunError(new GuardedRunError(
    'linked_copy_out_of_sync',
    'Run authority and linked mirror are out of sync.',
    { run_id: "run-safe; touch /tmp/run", story_id: "story-safe; touch /tmp/story" }
  ));
  assert.match(quotedIdentifiers, /--story-id 'story-safe; touch \/tmp\/story'/);
  assert.match(quotedIdentifiers, /--run-id 'run-safe; touch \/tmp\/run'/);
});

test('GRS-S-6 C-006 guarded CLI rejects incompatible target instead of ignoring it', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const stderr = capture();
  const result = await runCli([
    'execute', 'run', fixture.source,
    '--story-id', STORY_ID,
    '--target', 'pr_create',
    '--json'
  ], { stdout: capture(), stderr, guardedRunDependencies: fixture.dependencies() });
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(stderr.text()).stop_reason.code, 'invalid_target');
  const humanError = capture();
  const humanResult = await runCli([
    'execute', 'watch', fixture.source,
    '--story-id', STORY_ID,
    '--target', 'pr_create'
  ], { stdout: capture(), stderr: humanError, guardedRunDependencies: fixture.dependencies() });
  assert.equal(humanResult.exitCode, 2);
  assert.match(humanError.text(), /code: invalid_target/);
  assert.match(humanError.text(), /support only target=pr_ready/);
  await assert.rejects(stat(fixture.runFile(fixture.source, RUN_ID)), { code: 'ENOENT' });
});

test('GRS-S-6 C-001 repair-linked-copy CLI returns repaired authority in JSON and human forms', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'created' });
  const created = await fixture.session().run(fixture.source, { storyId: STORY_ID });
  const mirror = fixture.runFile(fixture.source, created.run_id);
  await writeFile(mirror, `${JSON.stringify({ ...created, iteration: 7 }, null, 2)}\n`);
  const jsonOut = capture();
  const jsonResult = await runCli([
    'execute', 'watch', fixture.source,
    '--story-id', STORY_ID,
    '--run-id', created.run_id,
    '--repair-linked-copy',
    '--json'
  ], { stdout: jsonOut, stderr: capture(), guardedRunDependencies: fixture.dependencies() });
  assert.equal(jsonResult.exitCode, 0);
  assert.deepEqual(JSON.parse(jsonOut.text()), created);

  await writeFile(mirror, `${JSON.stringify({ ...created, iteration: 8 }, null, 2)}\n`);
  const humanOut = capture();
  const humanResult = await runCli([
    'execute', 'watch', fixture.source,
    '--story-id', STORY_ID,
    '--run-id', created.run_id,
    '--repair-linked-copy'
  ], { stdout: humanOut, stderr: capture(), guardedRunDependencies: fixture.dependencies() });
  assert.equal(humanResult.exitCode, 0);
  assert.match(humanOut.text(), new RegExp(`run_id: ${created.run_id}`));
  assert.equal(await readFile(mirror, 'utf8'), await readFile(fixture.runFile(fixture.managed, created.run_id), 'utf8'));
});

test('GRS-S-6 C-006 repair-linked-copy is rejected before dispatch for every non-watch execute surface', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const commands = [
    ['run'],
    ['status'],
    ['status', '--run-id', RUN_ID],
    ['resume'],
    ['cancel'],
    ['start'],
    ['next'],
    ['reconcile'],
    ['merge']
  ];

  for (const [index, commandArgs] of commands.entries()) {
    const json = index % 2 === 0;
    const stdout = capture();
    const stderr = capture();
    const result = await runCli([
      'execute', commandArgs[0], fixture.source, ...commandArgs.slice(1),
      '--story-id', STORY_ID,
      '--repair-linked-copy',
      ...(json ? ['--json'] : [])
    ], {
      stdout,
      stderr,
      guardedRunDependencies: { service: {} }
    });
    assert.equal(result.exitCode, 2, commandArgs.join(' '));
    assert.equal(stdout.text(), '', commandArgs.join(' '));
    if (json) {
      assert.equal(JSON.parse(stderr.text()).stop_reason.code, 'repair_linked_copy_not_supported');
    } else {
      assert.match(stderr.text(), /code: repair_linked_copy_not_supported/);
      assert.match(stderr.text(), /supported only by execute watch/);
    }
  }

  const unknownStdout = capture();
  const unknownStderr = capture();
  const unknownResult = await runCli([
    'execute', 'nonsense', fixture.source,
    '--story-id', STORY_ID,
    '--repair-linked-copy',
    '--json'
  ], {
    stdout: unknownStdout,
    stderr: unknownStderr,
    guardedRunDependencies: { service: {} }
  });
  assert.equal(unknownResult.exitCode, 1);
  assert.equal(unknownStdout.text(), '');
  assert.match(unknownStderr.text(), /Unknown execute command: nonsense/);
  assert.doesNotMatch(unknownStderr.text(), /repair_linked_copy_not_supported/);

  await assert.rejects(
    readdir(path.join(fixture.source, '.vibepro', 'executions')),
    (error) => error.code === 'ENOENT'
  );
});

test('GRS-S-5 GRS-S-7 INV-002 resume fails closed on a stale authoritative HEAD without mutating the Run', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  await session.run(fixture.source, { storyId: STORY_ID });
  await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'fixture_blocked',
    stopReason: stopReason('fixture_blocked')
  });
  const before = await readFile(fixture.runFile(fixture.source, RUN_ID), 'utf8');
  fixture.setHead(fixture.source, 'b'.repeat(40));

  await assert.rejects(session.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), errorWithCode('stale_head'));
  assert.equal(await readFile(fixture.runFile(fixture.source, RUN_ID), 'utf8'), before);
});

test('GRS-S-5 resume from another worktree fails closed without mutating either artifact', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  await session.run(fixture.source, { storyId: STORY_ID });
  const authorityArtifact = fixture.runFile(fixture.source, RUN_ID);
  await persistBlockedState(authorityArtifact, '2026-07-15T01:03:00.000Z');
  const authorityBefore = await readFile(authorityArtifact, 'utf8');
  const copiedArtifact = fixture.runFile(fixture.managed, RUN_ID);
  await mkdir(path.dirname(copiedArtifact), { recursive: true });
  await writeFile(copiedArtifact, authorityBefore);

  await assert.rejects(
    session.resume(fixture.managed, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('worktree_mismatch')
  );
  assert.equal(await readFile(authorityArtifact, 'utf8'), authorityBefore);
  assert.equal(await readFile(copiedArtifact, 'utf8'), authorityBefore);
});

test('GRS-S-4 GRS-S-5 INV-005 failed Run can return to running only through resume', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  await session.run(fixture.source, { storyId: STORY_ID });
  await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'failed',
    reason: 'fixture_failed',
    stopReason: stopReason('fixture_failed')
  });
  const before = await readFile(fixture.runFile(fixture.source, RUN_ID), 'utf8');

  await assert.rejects(session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'running',
    reason: 'operator_resume'
  }), errorWithCode('invalid_transition'));
  assert.equal(await readFile(fixture.runFile(fixture.source, RUN_ID), 'utf8'), before);
  assert.equal((await session.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID })).status, 'running');

  await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'fixture_blocked',
    stopReason: stopReason('fixture_blocked')
  });
  await assert.rejects(session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'fixture_duplicate'
  }), errorWithCode('invalid_transition'));
  const cancelled = await session.cancel(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  await assert.rejects(session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'cancelled',
    reason: 'fixture_duplicate'
  }), errorWithCode('invalid_transition'));
  assert.deepEqual(await session.cancel(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), cancelled);
});

test('GRS-S-4 GRS-S-5 INV-005 GAH-S-7 lifecycle matrix accepts only the closed transition set', async (t) => {
  const statuses = [
    'running',
    'waiting_for_human',
    'waiting_for_runtime',
    'blocked',
    'failed',
    'cancelled',
    'pr_ready'
  ];
  const recoverable = new Set(['waiting_for_human', 'waiting_for_runtime', 'blocked', 'failed']);
  const allows = (from, to) => {
    if (from === 'pr_ready') return to === 'pr_ready';
    if (from === 'cancelled') return false;
    if (recoverable.has(from) && to === 'running') return false;
    if (from === 'running') return recoverable.has(to) || to === 'cancelled' || to === 'pr_ready';
    return to === 'running'
      || (recoverable.has(to) && to !== from)
      || to === 'cancelled'
      || to === 'pr_ready';
  };

  for (const from of statuses) {
    for (const to of statuses) {
      const fixture = await createFixture(t, { mode: 'disabled' });
      const session = fixture.session({ readGateReadiness: async () => ({ ready_for_pr_create: true }) });
      await session.run(fixture.source, { storyId: STORY_ID });
      if (from !== 'running') {
        const setupStopReason = recoverable.has(from) ? stopReason(`fixture_to_${from}`) : undefined;
        await session.transition(fixture.source, {
          storyId: STORY_ID,
          runId: RUN_ID,
          to: from,
          reason: `fixture_to_${from}`,
          ...(setupStopReason ? { stopReason: setupStopReason } : {}),
          ...(from === 'waiting_for_human' ? { pendingDecision: fixtureHumanDecision() } : {})
        });
      }
      const artifact = fixture.runFile(fixture.source, RUN_ID);
      const before = await readFile(artifact, 'utf8');
      if (allows(from, to)) {
        const expectedStopReason = recoverable.has(to) ? stopReason(`fixture_matrix_${to}`) : null;
        const result = await session.transition(fixture.source, {
          storyId: STORY_ID,
          runId: RUN_ID,
          to,
          reason: 'fixture_matrix',
          ...(recoverable.has(to) ? { stopReason: expectedStopReason } : {}),
          ...(to === 'waiting_for_human' ? { pendingDecision: fixtureHumanDecision() } : {})
        });
        assert.equal(result.status, to, `${from} -> ${to}`);
        if (recoverable.has(to) || to === 'running' || to === 'pr_ready') {
          assert.deepEqual(result.stop_reason, expectedStopReason, `${from} -> ${to} stop_reason`);
        }
      } else {
        await assert.rejects(
          session.transition(fixture.source, {
            storyId: STORY_ID,
            runId: RUN_ID,
            to,
            reason: 'fixture_matrix'
          }),
          errorWithCode('invalid_transition'),
          `${from} -> ${to}`
        );
        assert.equal(await readFile(artifact, 'utf8'), before, `${from} -> ${to}`);
      }
    }
  }
});

test('GRS-S-5 unknown persisted status and transition target fail closed without mutation', async (t) => {
  const transitionFixture = await createFixture(t, { mode: 'disabled' });
  const transitionSession = transitionFixture.session();
  await transitionSession.run(transitionFixture.source, { storyId: STORY_ID });
  const transitionArtifact = transitionFixture.runFile(transitionFixture.source, RUN_ID);
  const transitionBefore = await readFile(transitionArtifact, 'utf8');
  await assert.rejects(
    transitionSession.transition(transitionFixture.source, {
      storyId: STORY_ID,
      runId: RUN_ID,
      to: 'future_status',
      reason: 'fixture_future_transition'
    }),
    errorWithCode('unknown_status')
  );
  assert.equal(await readFile(transitionArtifact, 'utf8'), transitionBefore);

  const persistedFixture = await createFixture(t, { mode: 'disabled' });
  const persistedSession = persistedFixture.session();
  const persisted = await persistedSession.run(persistedFixture.source, { storyId: STORY_ID });
  const persistedArtifact = persistedFixture.runFile(persistedFixture.source, RUN_ID);
  const unknown = `${JSON.stringify({ ...persisted, status: 'future_status' }, null, 2)}\n`;
  await writeFile(persistedArtifact, unknown);
  await assert.rejects(
    persistedSession.status(persistedFixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('unknown_status')
  );
  assert.equal(await readFile(persistedArtifact, 'utf8'), unknown);
});

test('GRS-S-2 GRS-S-5 INV-002 recoverable transitions require a fresh typed stop reason without mutation', async (t) => {
  for (const to of ['waiting_for_human', 'waiting_for_runtime', 'blocked', 'failed']) {
    const fixture = await createFixture(t, { mode: 'disabled' });
    const session = fixture.session();
    await session.run(fixture.source, { storyId: STORY_ID });
    const artifact = fixture.runFile(fixture.source, RUN_ID);
    const before = await readFile(artifact, 'utf8');
    await assert.rejects(
      session.transition(fixture.source, { storyId: STORY_ID, runId: RUN_ID, to, reason: `missing_${to}` }),
      errorWithCode('invalid_state'),
      to
    );
    assert.equal(await readFile(artifact, 'utf8'), before, to);
  }

  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  await session.run(fixture.source, { storyId: STORY_ID });
  await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'waiting_for_runtime',
    reason: 'first_stop',
    stopReason: stopReason('first_stop')
  });
  const artifact = fixture.runFile(fixture.source, RUN_ID);
  const before = await readFile(artifact, 'utf8');
  await assert.rejects(
    session.transition(fixture.source, {
      storyId: STORY_ID,
      runId: RUN_ID,
      to: 'blocked',
      reason: 'must_not_inherit'
    }),
    errorWithCode('invalid_state')
  );
  assert.equal(await readFile(artifact, 'utf8'), before);

  await assert.rejects(session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'running',
    reason: 'manual_resume'
  }), errorWithCode('invalid_transition'));
  const resumed = await session.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(resumed.stop_reason, null);
});

test('GRS-S-2 GRS-S-5 INV-002 malformed transition metadata fails before persistence', async (t) => {
  const invalidStopReasons = [
    null,
    'not-an-object',
    {},
    { code: '', message: 'message' },
    { code: 'code', message: '' },
    { code: 'code', message: 'message', details: [] },
    { code: 'code', message: 'message', details: new Date(FIRST_TIME) },
    { code: 'code', message: 'message', details: { retry_policy_scope: 'unknown' } }
  ];
  for (const [index, value] of invalidStopReasons.entries()) {
    const fixture = await createFixture(t, { mode: 'disabled' });
    const session = fixture.session();
    await session.run(fixture.source, { storyId: STORY_ID });
    const artifact = fixture.runFile(fixture.source, RUN_ID);
    const before = await readFile(artifact, 'utf8');
    await assert.rejects(
      session.transition(fixture.source, {
        storyId: STORY_ID,
        runId: RUN_ID,
        to: 'blocked',
        reason: `malformed_stop_${index}`,
        stopReason: value
      }),
      errorWithCode('invalid_state')
    );
    assert.equal(await readFile(artifact, 'utf8'), before);
  }

  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session({ readGateReadiness: async () => ({ ready_for_pr_create: true }) });
  await session.run(fixture.source, { storyId: STORY_ID });
  const artifact = fixture.runFile(fixture.source, RUN_ID);
  const before = await readFile(artifact, 'utf8');
  await assert.rejects(session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'non_plain_pending_decision',
    stopReason: stopReason('non_plain_pending_decision'),
    pendingDecision: new Date(FIRST_TIME)
  }), errorWithCode('invalid_state'));
  assert.equal(await readFile(artifact, 'utf8'), before);
});

test('GRS-S-2 GRS-S-7 INV-001 INV-002 nullable state unions reject canonical and predecessor values without mutation', async (t) => {
  const invalidFields = [
    ['stop_reason', 'malformed'],
    ['stop_reason', { code: '', message: 'message' }],
    ['stop_reason', { code: 'code', message: '', details: {} }],
    ['stop_reason', { code: 'code', message: 'message', details: [] }],
    ['deadline', {}],
    ['deadline', '2026-08-01'],
    ['pending_decision', 42],
    ['pending_decision', []]
  ];
  for (const schemaVersion of ['0.1.0', '0.0.0']) {
    for (const [field, value] of invalidFields) {
      const fixture = await createFixture(t, { mode: 'disabled' });
      const session = fixture.session();
      const created = await session.run(fixture.source, { storyId: STORY_ID });
      const artifact = fixture.runFile(fixture.source, RUN_ID);
      const invalid = structuredClone(created);
      invalid.schema_version = schemaVersion;
      invalid[field] = value;
      const raw = `${JSON.stringify(invalid, null, 2)}\n`;
      await writeFile(artifact, raw);
      await assert.rejects(
        session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
        errorWithCode('invalid_state'),
        `${schemaVersion} ${field}`
      );
      assert.equal(await readFile(artifact, 'utf8'), raw, `${schemaVersion} ${field}`);
    }
  }
});

test('GRS-S-2 GRS-S-7 historical stopped null remains readable while valid typed stop surfaces are observable', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  const created = await session.run(fixture.source, { storyId: STORY_ID });
  const artifact = fixture.runFile(fixture.source, RUN_ID);
  const historical = structuredClone(created);
  historical.status = 'blocked';
  historical.updated_at = FIRST_TIME;
  historical.last_progress_at = FIRST_TIME;
  historical.transitions.push({
    sequence: 2,
    from: 'running',
    to: 'blocked',
    reason: 'historical_reasonless_stop',
    timestamp: FIRST_TIME
  });
  const historicalRaw = `${JSON.stringify(historical, null, 2)}\n`;
  await writeFile(artifact, historicalRaw);
  assert.equal((await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID })).stop_reason, null);
  assert.equal(await readFile(artifact, 'utf8'), historicalRaw);

  await writeFile(artifact, `${JSON.stringify(created, null, 2)}\n`);
  const expected = { code: 'operator_visible_stop', message: 'operator visible stop' };
  const stopped = await session.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'blocked',
    reason: 'operator_visible_stop',
    stopReason: expected
  });
  assert.deepEqual(stopped.stop_reason, expected);
  assert.deepEqual((await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID })).stop_reason, expected);
  const jsonOut = capture();
  const jsonResult = await runCli([
    'execute', 'status', fixture.source, '--story-id', STORY_ID, '--run-id', RUN_ID, '--json'
  ], { stdout: jsonOut, stderr: capture(), guardedRunDependencies: fixture.dependencies() });
  assert.equal(jsonResult.exitCode, 0);
  assert.deepEqual(JSON.parse(jsonOut.text()), stopped);
  const humanOut = capture();
  const humanResult = await runCli([
    'execute', 'status', fixture.source, '--story-id', STORY_ID, '--run-id', RUN_ID
  ], { stdout: humanOut, stderr: capture(), guardedRunDependencies: fixture.dependencies() });
  assert.equal(humanResult.exitCode, 0);
  assert.match(humanOut.text(), /stop_reason: operator_visible_stop: operator visible stop/);
});

test('GRS-S-7 GRS-S-9 S-005 S-006 S-007 migration changes schema only, corrupt state is quarantined, and future schema is preserved', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  const created = await session.run(fixture.source, { storyId: STORY_ID });
  const artifact = fixture.runFile(fixture.source, RUN_ID);
  const predecessor = structuredClone(created);
  delete predecessor.schema_version;
  delete predecessor.action_journal;
  predecessor.attempt = 7;
  predecessor.budget = { max_attempts: 2, max_iterations: 8 };
  predecessor.deadline = '2026-08-01T00:00:00.000Z';
  predecessor.pending_decision = { prompt: 'Choose the next action', options: ['retry', 'stop'] };
  predecessor.status = 'blocked';
  predecessor.stop_reason = stopReason('predecessor_blocked');
  predecessor.updated_at = '2026-07-15T02:00:00.000Z';
  predecessor.last_progress_at = '2026-07-15T02:00:00.000Z';
  predecessor.transitions.push({
    sequence: 2,
    from: 'running',
    to: 'blocked',
    reason: 'predecessor_blocked',
    timestamp: '2026-07-15T02:00:00.000Z'
  });
  await writeFile(artifact, `${JSON.stringify(predecessor, null, 2)}\n`);
  const migrated = await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(migrated.schema_version, '0.2.0');
  assert.deepEqual(migrated.action_journal, []);
  assert.equal(migrated.attempt, 7);
  assert.deepEqual(migrated.budget, predecessor.budget);
  assert.equal(migrated.deadline, predecessor.deadline);
  assert.deepEqual(migrated.pending_decision, predecessor.pending_decision);
  assert.deepEqual(migrated.stop_reason, predecessor.stop_reason);

  const future = { ...migrated, schema_version: '9.0.0' };
  const futureRaw = `${JSON.stringify(future, null, 2)}\n`;
  await writeFile(artifact, futureRaw);
  await assert.rejects(session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), errorWithCode('unsupported_schema'));
  assert.equal(await readFile(artifact, 'utf8'), futureRaw);

  await writeFile(artifact, '{broken');
  await assert.rejects(session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), errorWithCode('corrupt_state'));
  const names = await readdir(path.dirname(artifact));
  assert.equal(names.some((name) => name.startsWith('state.json.corrupt-20260715T010203Z')), true);
});

test('GAH-S-1 existing pre-hardening 0.2.0 Run migrates advisory limits before resume', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  const created = await session.run(fixture.source, { storyId: STORY_ID });
  const artifact = fixture.runFile(fixture.source, RUN_ID);
  const legacy = structuredClone(created);
  legacy.status = 'blocked';
  legacy.stop_reason = { code: 'legacy_operational_block', message: 'legacy stop', details: {} };
  legacy.attempt = 1;
  legacy.iteration = 0;
  legacy.budget = { max_attempts: 1, max_iterations: 0 };
  delete legacy.retry_policy;
  delete legacy.provider_fallbacks;
  delete legacy.usage_accounting;
  delete legacy.retry_journal;
  legacy.transitions.push({ sequence: 2, from: 'running', to: 'blocked', reason: 'legacy_stop', timestamp: FIRST_TIME });
  await writeFile(artifact, `${JSON.stringify(legacy, null, 2)}\n`);

  const migrated = await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.deepEqual(migrated.budget, {
    max_attempts: 3,
    max_iterations: 12,
    max_duration_ms: 3600000,
    max_tokens: null,
    max_cost_usd: null
  });
  assert.equal(migrated.usage_accounting.status, 'unknown');
  const resumed = await session.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.attempt, 2);
});

test('GRS-S-4 GRS-S-7 S-005 predecessor cancellation migrates once and missing fields never default', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  await session.run(fixture.source, { storyId: STORY_ID });
  const canonicalCancelled = await session.cancel(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  const artifact = fixture.runFile(fixture.source, RUN_ID);
  const predecessor = structuredClone(canonicalCancelled);
  predecessor.schema_version = '0.0.0';
  delete predecessor.action_journal;
  const predecessorRaw = `${JSON.stringify(predecessor, null, 2)}\n`;
  await writeFile(artifact, predecessorRaw);

  const migrated = await session.cancel(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(migrated.schema_version, '0.2.0');
  assert.deepEqual(migrated.action_journal, []);
  assert.equal(migrated.updated_at, predecessor.updated_at);
  assert.deepEqual(migrated.transitions, predecessor.transitions);
  const canonicalRaw = await readFile(artifact, 'utf8');
  await session.cancel(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(await readFile(artifact, 'utf8'), canonicalRaw);

  const missing = structuredClone(predecessor);
  delete missing.deadline;
  const missingRaw = `${JSON.stringify(missing, null, 2)}\n`;
  await writeFile(artifact, missingRaw);
  await assert.rejects(
    session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('invalid_state')
  );
  assert.equal(await readFile(artifact, 'utf8'), missingRaw);
});

test('GRS-S-7 GRS-S-10 S-002 managed predecessor migration commits authority once and requires explicit mirror repair', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'created' });
  const created = await fixture.session().run(fixture.source, { storyId: STORY_ID });
  const authorityFile = fixture.runFile(fixture.managed, RUN_ID);
  const mirrorFile = fixture.runFile(fixture.source, RUN_ID);
  const predecessor = structuredClone(created);
  delete predecessor.schema_version;
  delete predecessor.action_journal;
  const predecessorRaw = `${JSON.stringify(predecessor, null, 2)}\n`;
  await Promise.all([writeFile(authorityFile, predecessorRaw), writeFile(mirrorFile, predecessorRaw)]);

  const failing = fixture.session({
    artifactIo: {
      rename: async (from, to) => {
        if (to === mirrorFile) {
          const error = new Error('fixture migration mirror unavailable');
          error.code = 'EACCES';
          throw error;
        }
        return rename(from, to);
      }
    }
  });
  await assert.rejects(
    failing.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('linked_copy_sync_failed')
  );
  assert.equal(JSON.parse(await readFile(authorityFile, 'utf8')).schema_version, '0.2.0');
  assert.equal(await readFile(mirrorFile, 'utf8'), predecessorRaw);

  const session = fixture.session();
  await assert.rejects(
    session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('linked_copy_out_of_sync')
  );
  const repaired = await session.watch(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    repairLinkedCopy: true
  });
  assert.equal(repaired.schema_version, '0.2.0');
  assert.equal(await readFile(authorityFile, 'utf8'), await readFile(mirrorFile, 'utf8'));
  assert.deepEqual(repaired.transitions, created.transitions);
});

test('GRS-S-8 GRS-S-9 artifact path identity mismatches fail without mutation', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  const created = await session.run(fixture.source, { storyId: STORY_ID });
  const artifact = fixture.runFile(fixture.source, RUN_ID);

  for (const mutate of [
    (state) => { state.run_id = 'run-20260715T010203Z-ffffffff'; },
    (state) => { state.story_id = 'story-other'; }
  ]) {
    const invalid = structuredClone(created);
    mutate(invalid);
    const raw = `${JSON.stringify(invalid, null, 2)}\n`;
    await writeFile(artifact, raw);
    await assert.rejects(
      session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
      errorWithCode('invalid_state')
    );
    assert.equal(await readFile(artifact, 'utf8'), raw);
  }
});

test('GRS-S-9 malformed Story catalog and legacy JSON fail closed without mutating state', async (t) => {
  const catalogFixture = await createFixture(t, { mode: 'disabled' });
  const malformedCatalog = '{"brainbase":';
  const catalogArtifact = path.join(catalogFixture.source, '.vibepro', 'config.json');
  await writeFile(catalogArtifact, malformedCatalog);
  await assert.rejects(
    catalogFixture.session().run(catalogFixture.source, { storyId: STORY_ID }),
    errorWithCode('invalid_story_id')
  );
  assert.equal(await readFile(catalogArtifact, 'utf8'), malformedCatalog);
  await assert.rejects(
    readdir(path.join(catalogFixture.source, '.vibepro', 'executions')),
    (error) => error.code === 'ENOENT'
  );

  const legacyFixture = await createFixture(t, { mode: 'disabled' });
  const legacySession = legacyFixture.session();
  await legacySession.run(legacyFixture.source, { storyId: STORY_ID });
  const runArtifact = legacyFixture.runFile(legacyFixture.source, RUN_ID);
  const runBefore = await readFile(runArtifact, 'utf8');
  const legacyArtifact = path.join(legacyFixture.source, '.vibepro', 'executions', STORY_ID, 'state.json');
  const malformedLegacy = '{"managed_worktree":';
  await writeFile(legacyArtifact, malformedLegacy);

  await assert.rejects(
    legacySession.status(legacyFixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('invalid_state')
  );
  assert.equal(await readFile(legacyArtifact, 'utf8'), malformedLegacy);
  assert.equal(await readFile(runArtifact, 'utf8'), runBefore);
});

test('GRS-S-4 GRS-S-7 forbidden persisted transition history is invalid and non-mutating', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  const created = await session.run(fixture.source, { storyId: STORY_ID });
  const artifact = fixture.runFile(fixture.source, RUN_ID);
  const invalid = structuredClone(created);
  invalid.status = 'running';
  invalid.transitions.push({
    sequence: 2,
    from: 'running',
    to: 'running',
    reason: 'forbidden_self_transition',
    timestamp: FIRST_TIME
  });
  const raw = `${JSON.stringify(invalid, null, 2)}\n`;
  await writeFile(artifact, raw);

  await assert.rejects(
    session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('invalid_state')
  );
  assert.equal(await readFile(artifact, 'utf8'), raw);
});

test('GRS-S-9 INV-004 Gate readiness is the only positive pr_ready transition', async (t) => {
  const fixture = await createFixture(t, { mode: 'preferred', managedStatus: 'created' });
  const blocked = fixture.session({ readGateReadiness: async () => ({ ready_for_pr_create: false }) });
  const created = await blocked.run(fixture.source, { storyId: STORY_ID });
  const authorityFile = fixture.runFile(fixture.managed, RUN_ID);
  const mirrorFile = fixture.runFile(fixture.source, RUN_ID);
  const authorityBefore = await readFile(authorityFile, 'utf8');
  const mirrorBefore = await readFile(mirrorFile, 'utf8');
  await assert.rejects(
    blocked.transition(fixture.source, { storyId: STORY_ID, runId: RUN_ID, to: 'pr_ready' }),
    errorWithCode('invalid_transition')
  );
  assert.equal(await readFile(authorityFile, 'utf8'), authorityBefore);
  assert.equal(await readFile(mirrorFile, 'utf8'), mirrorBefore);
  const persisted = await blocked.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(persisted.status, 'running');
  assert.deepEqual(persisted.transitions, created.transitions);

  const ready = fixture.session({ readGateReadiness: async () => ({ ready_for_pr_create: true }) });
  const completed = await ready.transition(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    to: 'pr_ready',
    reason: 'gate_dag_ready'
  });
  assert.equal(completed.status, 'pr_ready');
  assert.equal(completed.transitions.length, created.transitions.length + 1);
  assert.deepEqual(completed.transitions.at(-1), {
    sequence: 2,
    from: 'running',
    to: 'pr_ready',
    reason: 'gate_dag_ready',
    timestamp: FIRST_TIME
  });
  const authorityAfter = await readFile(authorityFile, 'utf8');
  const mirrorAfter = await readFile(mirrorFile, 'utf8');
  assert.equal(authorityAfter, mirrorAfter);
  assert.deepEqual(JSON.parse(authorityAfter), completed);
  const terminalReplay = await ready.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(terminalReplay.state.status, 'pr_ready');
  assert.deepEqual(terminalReplay.state.next_best_action_decisions, []);
});

test('GRS-S-9 C-006 strict ids fail before path composition and CLI emits typed exit-2 JSON', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  await assert.rejects(session.run(fixture.source, { storyId: '../escape' }), errorWithCode('invalid_story_id'));
  await assert.rejects(
    session.status(fixture.source, { storyId: STORY_ID, runId: 'run-%2fescape' }),
    errorWithCode('invalid_run_id')
  );
  const stdout = capture();
  const stderr = capture();
  const result = await runCli([
    'execute', 'status', fixture.source,
    '--story-id', STORY_ID,
    '--run-id', 'invalid',
    '--json'
  ], {
    stdout,
    stderr,
    guardedRunDependencies: fixture.dependencies()
  });
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(stderr.text()).stop_reason.code, 'invalid_run_id');
  assert.equal(stdout.text(), '');

  const missingValueError = capture();
  const missingValue = await runCli([
    'execute', 'status', fixture.source,
    '--story-id', STORY_ID,
    '--run-id',
    '--json'
  ], {
    stdout: capture(),
    stderr: missingValueError,
    guardedRunDependencies: fixture.dependencies()
  });
  assert.equal(missingValue.exitCode, 2);
  assert.equal(JSON.parse(missingValueError.text()).stop_reason.code, 'invalid_run_id');
});

test('GRS-S-1 GRS-S-9 C-001 C-006 execute run rejects supplied valid and invalid Run ids before every side effect', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const baseDependencies = fixture.dependencies();
  let identityCalls = 0;
  let bootstrapCalls = 0;
  const dependencies = {
    ...baseDependencies,
    resolveGitIdentity: async (...args) => {
      identityCalls += 1;
      return baseDependencies.resolveGitIdentity(...args);
    },
    startExecution: async (...args) => {
      bootstrapCalls += 1;
      return baseDependencies.startExecution(...args);
    }
  };
  const session = createGuardedRunSession(dependencies);

  await assert.rejects(
    session.run(fixture.source, { storyId: STORY_ID, runId: RUN_ID }),
    errorWithCode('run_id_not_allowed')
  );
  await assert.rejects(
    session.run(fixture.source, { storyId: STORY_ID, runId: 'run-%2fescape' }),
    errorWithCode('invalid_run_id')
  );

  const humanStdout = capture();
  const humanStderr = capture();
  const validResult = await runCli([
    'execute', 'run', fixture.source,
    '--story-id', STORY_ID,
    '--run-id', RUN_ID
  ], {
    stdout: humanStdout,
    stderr: humanStderr,
    guardedRunDependencies: dependencies
  });
  assert.equal(validResult.exitCode, 2);
  assert.match(humanStderr.text(), /run_id_not_allowed/);
  assert.match(humanStderr.text(), /execute run generates its Run id/);
  assert.equal(humanStdout.text(), '');

  const jsonStdout = capture();
  const jsonStderr = capture();
  const invalidResult = await runCli([
    'execute', 'run', fixture.source,
    '--story-id', STORY_ID,
    '--run-id', 'invalid',
    '--json'
  ], {
    stdout: jsonStdout,
    stderr: jsonStderr,
    guardedRunDependencies: dependencies
  });
  assert.equal(invalidResult.exitCode, 2);
  assert.equal(JSON.parse(jsonStderr.text()).stop_reason.code, 'invalid_run_id');
  assert.equal(jsonStdout.text(), '');
  assert.equal(identityCalls, 0);
  assert.equal(bootstrapCalls, 0);
  await assert.rejects(
    readdir(path.join(fixture.source, '.vibepro', 'executions')),
    (error) => error.code === 'ENOENT'
  );
});

test('GRS-S-6 C-001 C-006 CLI success JSON equals persisted Run and legacy status without run-id stays on the legacy route', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const stdout = capture();
  const stderr = capture();
  const created = await runCli([
    'execute', 'run', fixture.source,
    '--story-id', STORY_ID,
    '--json'
  ], { stdout, stderr, guardedRunDependencies: fixture.dependencies() });
  assert.equal(created.exitCode, 0);
  const state = JSON.parse(stdout.text());
  assert.equal(state.run_id, RUN_ID);
  assert.equal(stdout.text(), await readFile(fixture.runFile(fixture.source, RUN_ID), 'utf8'));
  assert.equal(stderr.text(), '');

  const legacyOut = capture();
  const legacy = await runCli([
    'execute', 'status', fixture.source,
    '--story-id', STORY_ID,
    '--json'
  ], { stdout: legacyOut, stderr: capture(), guardedRunDependencies: { service: {} } });
  assert.equal(legacy.exitCode, 0);
  assert.equal(JSON.parse(legacyOut.text()).story_id, STORY_ID);
  assert.equal(JSON.parse(legacyOut.text()).run_id, undefined);
});

test('GRS-S-6 C-001 execute help advertises guarded commands without removing legacy commands', async () => {
  const stdout = capture();
  const result = await runCli(['execute', '--help'], { stdout, stderr: capture() });
  assert.equal(result.exitCode, 0);
  const usage = stdout.text().split('\n').find((line) => line.includes('vibepro execute <'));
  assert.ok(usage);
  for (const command of ['run', 'status', 'watch', 'resume', 'cancel', 'start', 'next', 'merge']) {
    assert.match(usage, new RegExp(`(?:<|\\|)${command}(?:\\||>)`));
  }
  assert.match(stdout.text(), /--run-idを省略したexecute statusは従来のstatus契約を維持します/);
  assert.match(stdout.text(), /pr_readyを目標に、再開可能なguarded Runを作成します/);
  assert.match(stdout.text(), /--until 未指定時は状態の永続化だけ/);
  assert.match(stdout.text(), /--until pr-ready 指定時はallowlist済みrepo-local Actionだけ/);
  assert.match(stdout.text(), /resumeは--until pr-readyを受け付け.*未完了のallowlist済みActionだけを再試行/);
  assert.match(stdout.text(), /watchは現在値を1回返して終了するsnapshotです/);
  assert.match(stdout.text(), /--targetはpr_readyだけを受け付け/);
  assert.match(stdout.text(), /vibepro execute watch \[repo\].*--repair-linked-copy/);
  assert.doesNotMatch(usage, /--repair-linked-copy/);

  const englishStdout = capture();
  const englishResult = await runCli(['execute', '--help', '--language', 'en'], {
    stdout: englishStdout,
    stderr: capture()
  });
  assert.equal(englishResult.exitCode, 0);
  const englishUsage = englishStdout.text().split('\n').find((line) => line.includes('vibepro execute <'));
  assert.ok(englishUsage);
  for (const command of ['run', 'status', 'watch', 'resume', 'cancel', 'start', 'next', 'merge']) {
    assert.match(englishUsage, new RegExp(`(?:<|\\|)${command}(?:\\||>)`));
  }
  assert.match(englishStdout.text(), /Without --run-id, execute status keeps the legacy status contract/);
  assert.match(englishStdout.text(), /Create a resumable guarded Run targeting pr_ready/);
  assert.match(englishStdout.text(), /Without --until this command only persists state/);
  assert.match(englishStdout.text(), /--until pr-ready executes only allowlisted repo-local Actions/);
  assert.match(englishStdout.text(), /resume accepts --until pr-ready to retry only incomplete allowlisted Actions/);
  assert.match(englishStdout.text(), /watch returns one current snapshot and exits; it does not stream/);
  assert.match(englishStdout.text(), /Guarded commands accept only --target pr_ready/);
  assert.match(englishStdout.text(), /vibepro execute watch \[repo\].*--repair-linked-copy/);
  assert.doesNotMatch(englishUsage, /--repair-linked-copy/);
});

test('GRS-S-8 INV-002 production Git identity resolves a real repository and linked worktree', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guarded-run-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const linked = path.join(root, 'linked');
  await mkdir(repo, { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await writeFile(path.join(repo, 'README.md'), '# fixture\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'test: initialize real git fixture']);
  await git(repo, ['worktree', 'add', '-b', 'feature/linked', linked]);

  const sourceIdentity = await resolveGitIdentity(repo);
  const linkedIdentity = await resolveGitIdentity(linked);
  assert.equal(sourceIdentity.root_realpath, await realpath(repo));
  assert.equal(linkedIdentity.root_realpath, await realpath(linked));
  assert.notEqual(sourceIdentity.git_dir_realpath, linkedIdentity.git_dir_realpath);
  assert.equal(sourceIdentity.git_common_dir_realpath, linkedIdentity.git_common_dir_realpath);
  assert.match(linkedIdentity.git_dir_realpath, /[/\\]worktrees[/\\]/);
  assert.equal(sourceIdentity.head_sha, linkedIdentity.head_sha);
});

test('GRS-S-8 INV-004 separate Git directories keep bootstrap locks repository-scoped', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guarded-run-separate-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const gitDirs = path.join(root, 'gitdirs');
  const repo = path.join(root, 'repo-b');
  const gitDir = path.join(gitDirs, 'repo-b.git');
  await Promise.all([mkdir(gitDirs, { recursive: true }), mkdir(repo, { recursive: true })]);
  await git(repo, ['init', '--separate-git-dir', gitDir, '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await writeConfig(repo, { managedWorktree: 'disabled' });
  await writeFile(path.join(repo, 'README.md'), '# separate git fixture\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'test: initialize separate git fixture']);

  const collisionLock = path.join(gitDirs, '.vibepro', 'executions', STORY_ID, '.run-creation.lock');
  const repositoryLock = path.join(gitDir, '.vibepro', 'executions', STORY_ID, '.run-creation.lock');
  await mkdir(collisionLock, { recursive: true });
  let bootstrapCalls = 0;
  const session = createGuardedRunSession({
    now: () => new Date(FIRST_TIME),
    randomBytes: () => Buffer.from([1, 2, 3, 4]),
    startExecution: async () => {
      bootstrapCalls += 1;
      assert.equal((await stat(repositoryLock)).isDirectory(), true);
      const legacy = {
        schema_version: '0.1.0',
        story_id: STORY_ID,
        target: 'pr_create',
        managed_worktree: {
          status: 'disabled',
          required: false,
          mode: 'disabled',
          source_repo: repo,
          source_relative_path: null,
          path: null,
          relative_path: null,
          branch: 'codex/story-guarded-run-test',
          actual_branch: 'codex/story-guarded-run-test',
          branch_match: true,
          base_ref: 'main',
          created_from_sha: (await resolveGitIdentity(repo)).head_sha,
          current_head_sha: (await resolveGitIdentity(repo)).head_sha,
          dirty: null,
          dirty_paths: [],
          dirty_check_error: null,
          failure_reason: null
        }
      };
      await writeLegacy(repo, legacy);
      return { state: legacy, found: true };
    }
  });

  const created = await session.run(repo, { storyId: STORY_ID });
  assert.equal(created.execution_context.root_realpath, await realpath(repo));
  assert.equal(bootstrapCalls, 1);
  assert.equal((await stat(collisionLock)).isDirectory(), true);
  await assert.rejects(stat(repositoryLock), { code: 'ENOENT' });
});

test('GRS-S-6 GRS-S-8 C-001 C-007 S-009 GAH-S-5 repository CLI survives fresh processes and repair is non-mutating', async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guarded-run-cli-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await writeConfig(repo, { managedWorktree: 'disabled' });
  await writeFile(path.join(repo, 'README.md'), '# guarded Run CLI fixture\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'test: initialize guarded Run CLI fixture']);

  const createdProcess = await runVibeproProcess([
    'execute', 'run', repo, '--story-id', STORY_ID, '--target', 'pr_ready', '--json'
  ], repo);
  const created = JSON.parse(createdProcess.stdout);
  assert.equal(created.status, 'running');
  assert.equal(created.execution_context.authority_kind, 'repository');
  assert.equal(created.execution_context.root_realpath, await realpath(repo));
  const humanCreated = await runVibeproProcess([
    'execute', 'run', repo, '--story-id', STORY_ID, '--target', 'pr_ready'
  ], repo);
  assert.match(humanCreated.stdout, /# VibePro Guarded Run/);
  assert.match(humanCreated.stdout, /status: running/);

  const jsonStatus = await runVibeproProcess([
    'execute', 'status', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
  ], repo);
  assert.deepEqual(JSON.parse(jsonStatus.stdout), created);
  const humanStatus = await runVibeproProcess([
    'execute', 'status', repo, '--story-id', STORY_ID, '--run-id', created.run_id
  ], repo);
  assert.match(humanStatus.stdout, new RegExp(`run_id: ${created.run_id}`));

  const jsonWatch = await runVibeproProcess([
    'execute', 'watch', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
  ], repo);
  assert.equal(JSON.parse(jsonWatch.stdout).run_id, created.run_id);
  const humanWatch = await runVibeproProcess([
    'execute', 'watch', repo, '--story-id', STORY_ID, '--run-id', created.run_id
  ], repo);
  assert.match(humanWatch.stdout, /status: running/);

  const stateFile = path.join(repo, '.vibepro', 'executions', STORY_ID, 'runs', created.run_id, 'state.json');
  const beforeRepair = await readFile(stateFile, 'utf8');
  await assert.rejects(
    runVibeproProcess([
      'execute', 'watch', repo, '--story-id', STORY_ID, '--run-id', created.run_id,
      '--repair-linked-copy', '--json'
    ], repo),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(`${error.stdout ?? ''}${error.stderr ?? ''}`, /linked_copy_not_configured/);
      return true;
    }
  );
  assert.equal(await readFile(stateFile, 'utf8'), beforeRepair);

  await persistBlockedState(stateFile, '2026-07-15T04:00:00.000Z');
  const jsonResume = await runVibeproProcess([
    'execute', 'resume', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
  ], repo);
  assert.equal(JSON.parse(jsonResume.stdout).status, 'running');
  await persistBlockedState(stateFile, '2026-07-15T04:01:00.000Z');
  const humanResume = await runVibeproProcess([
    'execute', 'resume', repo, '--story-id', STORY_ID, '--run-id', created.run_id
  ], repo);
  assert.match(humanResume.stdout, /status: running/);

  const jsonCancel = await runVibeproProcess([
    'execute', 'cancel', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
  ], repo);
  assert.equal(JSON.parse(jsonCancel.stdout).status, 'cancelled');
  const humanCancel = await runVibeproProcess([
    'execute', 'cancel', repo, '--story-id', STORY_ID, '--run-id', created.run_id
  ], repo);
  assert.match(humanCancel.stdout, /status: cancelled/);
});

test('SAO-S-1 SAO-S-4 execute orchestration persists journal and typed stop', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let prepareCalls = 0;
  const session = fixture.session({
    preparePullRequest: async () => { prepareCalls += 1; return { artifacts: { json: 'prepare.json' } }; },
    safeAutopilotPullRequest: async () => ({
      status: 'waiting_for_runtime',
      stop_reason: 'runtime_required',
      artifact: 'prepare.json',
      recovery: { missing_kinds: ['unit'] }
    })
  });
  await session.run(fixture.source, { storyId: STORY_ID });
  const result = await session.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(prepareCalls, 1);
  assert.equal(result.state.status, 'waiting_for_runtime');
  assert.equal(result.state.stop_reason.code, 'runtime_required');
  assert.deepEqual(result.state.stop_reason.details.recovery.missing_kinds, ['unit']);
  assert.match(result.state.stop_reason.details.recovery.next_command, /execute resume .*--until pr-ready/);
  assert.deepEqual(result.state.action_journal.map((entry) => entry.action_id), ['pr_prepare', 'pr_autopilot_safe']);
  assert.deepEqual(result.state.action_journal.map((entry) => entry.artifact), ['prepare.json', 'prepare.json']);
  assert.equal(result.state.next_best_action_decisions.length, 1);
  assert.equal(result.state.next_best_action_decisions[0].selected_action_id, 'pr_prepare');
  assert.equal(JSON.stringify(result.state.next_best_action_decisions).includes('transcript'), false);
  assert.deepEqual(await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), result.state);
  assert.deepEqual((await session.watch(fixture.source, { storyId: STORY_ID, runId: RUN_ID })).action_journal, result.state.action_journal);
  const cancelled = await session.cancel(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.deepEqual(cancelled.action_journal, result.state.action_journal);
  const artifact = fixture.runFile(fixture.source, RUN_ID);
  const cancelledBytes = await readFile(artifact, 'utf8');
  assert.deepEqual((await session.cancel(fixture.source, { storyId: STORY_ID, runId: RUN_ID })).action_journal, result.state.action_journal);
  assert.equal(await readFile(artifact, 'utf8'), cancelledBytes);
  const cancelledReplay = await session.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(cancelledReplay.state.status, 'cancelled');
  assert.equal(prepareCalls, 1);
  assert.equal(await readFile(artifact, 'utf8'), cancelledBytes);
});

test('NBA-S-7 production orchestration persists an escape decision after two no-progress checkpoints', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let prepareCalls = 0;
  const session = fixture.session({
    preparePullRequest: async () => { prepareCalls += 1; return { artifacts: { json: 'prepare.json' } }; },
    safeAutopilotPullRequest: async () => ({ status: 'continue', artifact: 'prepare.json' })
  });
  await session.run(fixture.source, { storyId: STORY_ID });

  const result = await session.orchestrate(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    checkpointReason: 'no_progress',
    noProgressCount: 2,
    stateDelta: { finding: 'unchanged' }
  });

  const decision = result.state.next_best_action_decisions.at(-1);
  assert.equal(decision.checkpoint_reason, 'no_progress');
  assert.equal(decision.no_progress_count, 2);
  assert.equal(['rediagnose', 'split', 'ask', 'stop'].includes(decision.selected_action_id), true);
  assert.equal(decision.selection_reason, 'no_progress_escape');
  assert.equal(result.state.status, 'waiting_for_human');
  assert.match(result.state.pending_decision.decision_id, /^decision-[0-9a-f]{16}$/);
  assert.equal(result.state.pending_decision.stop_node_id, 'pr_prepare');
  assert.equal(result.state.pending_decision.type, decision.selected_action_id === 'split' ? 'scope_split' : 'clarification');
  assert.equal(result.state.stop_reason.code, 'next_best_action_escape');
  assert.match(result.state.stop_reason.details.recovery.next_command, /--decision decision-[0-9a-f]{16} --answer <answer>/);
  assert.equal(result.state.action_journal.length, 0);
  assert.equal(prepareCalls, 0);
  assert.deepEqual(
    (await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }))
      .next_best_action_decisions.at(-1),
    decision
  );
  const resumed = await session.resume(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    decisionId: result.state.pending_decision.decision_id,
    answer: 'continue with the selected recovery action'
  });
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.human_decision_journal.at(-1).stop_node_id, 'pr_prepare');
  assert.equal(resumed.resume_from_node_id, 'pr_prepare');

  const continued = await session.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(continued.plan[0].node_id, 'pr_prepare');
  assert.equal(continued.state.resume_from_node_id, null);
  assert.equal(prepareCalls, 1);
});

test('HDC-S-3 resume rejects a different pending decision without mutating the waiting Run', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session();
  await session.run(fixture.source, { storyId: STORY_ID });
  const escaped = await session.orchestrate(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    checkpointReason: 'no_progress',
    noProgressCount: 2,
    stateDelta: { finding: 'unchanged' }
  });
  const unrelated = await createHumanDecision(fixture.source, escaped.state, {
    ...fixtureHumanDecision(),
    type: 'external_side_effect',
    material_reason: 'An unrelated external side effect requires separate approval.'
  });

  await assert.rejects(session.resume(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    decisionId: unrelated.decision_id,
    answer: 'approve unrelated decision'
  }), { code: 'decision_pending_mismatch' });
  const persisted = await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(persisted.status, 'waiting_for_human');
  assert.equal(persisted.pending_decision.decision_id, escaped.state.pending_decision.decision_id);
  assert.deepEqual(persisted.human_decision_journal, []);
});

test('HDC-S-3 resumed orchestration preserves its cursor across an action failure and restart', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let prepareCalls = 0;
  const failing = fixture.session({
    preparePullRequest: async () => {
      prepareCalls += 1;
      throw new Error('simulated crash before action checkpoint');
    }
  });
  await failing.run(fixture.source, { storyId: STORY_ID });
  const escaped = await failing.orchestrate(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    checkpointReason: 'no_progress',
    noProgressCount: 2,
    stateDelta: { finding: 'unchanged' }
  });
  const resumed = await failing.resume(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    decisionId: escaped.state.pending_decision.decision_id,
    answer: 'retry the canonical action'
  });
  assert.equal(resumed.resume_from_node_id, 'pr_prepare');

  const artifact = fixture.runFile(fixture.source, RUN_ID);
  const withHistoricalCheckpoint = JSON.parse(await readFile(artifact, 'utf8'));
  withHistoricalCheckpoint.action_journal.push({
    action_id: 'pr_prepare',
    node_id: 'pr_prepare',
    input_head_sha: 'historical-head',
    output_head_sha: 'historical-head',
    idempotency_key: 'historical-checkpoint',
    status: 'completed',
    artifact: 'historical-prepare.json',
    result_summary: 'completed on an older HEAD',
    started_at: FIRST_TIME,
    completed_at: FIRST_TIME
  });
  await writeFile(artifact, `${JSON.stringify(withHistoricalCheckpoint, null, 2)}\n`);

  const failed = await failing.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(failed.state.status, 'failed');
  assert.equal(failed.state.resume_from_node_id, 'pr_prepare');
  assert.equal(prepareCalls, 1);

  const restarted = fixture.session({
    preparePullRequest: async () => {
      prepareCalls += 1;
      return { artifacts: { json: 'prepare.json' } };
    },
    safeAutopilotPullRequest: async () => ({ status: 'continue', artifact: 'prepare.json' })
  });
  const retry = await restarted.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(retry.resume_from_node_id, 'pr_prepare');
  const continued = await restarted.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(continued.plan[0].node_id, 'pr_prepare');
  assert.equal(continued.state.resume_from_node_id, null);
  assert.equal(prepareCalls, 2);
});

test('NBA persisted legacy decisions omit additive fields while malformed present fields fail closed', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session({
    preparePullRequest: async () => ({ artifacts: { json: 'prepare.json' } }),
    safeAutopilotPullRequest: async () => ({ status: 'continue', artifact: 'prepare.json' })
  });
  await session.run(fixture.source, { storyId: STORY_ID });
  const result = await session.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  const artifact = fixture.runFile(fixture.source, RUN_ID);
  const legacy = structuredClone(result.state);
  delete legacy.next_best_action_decisions[0].state_delta;
  delete legacy.next_best_action_decisions[0].reused;
  await writeFile(artifact, `${JSON.stringify(legacy, null, 2)}\n`);

  const readback = await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(readback.next_best_action_decisions[0].selected_action_id, 'pr_prepare');
  assert.equal('state_delta' in readback.next_best_action_decisions[0], false);
  assert.equal('reused' in readback.next_best_action_decisions[0], false);

  for (const mutate of [
    (decision) => { decision.state_delta = { raw_transcript: 'forbidden' }; },
    (decision) => { decision.reused = 'yes'; }
  ]) {
    const malformed = structuredClone(legacy);
    mutate(malformed.next_best_action_decisions[0]);
    const malformedBytes = `${JSON.stringify(malformed, null, 2)}\n`;
    await writeFile(artifact, malformedBytes);
    await assert.rejects(session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }));
    assert.equal(await readFile(artifact, 'utf8'), malformedBytes);
  }
});

test('NBA rollback switch ignores escape handling and restores the complete canonical plan', async (t) => {
  const previous = process.env.VIBEPRO_NEXT_BEST_ACTION;
  process.env.VIBEPRO_NEXT_BEST_ACTION = 'off';
  t.after(() => {
    if (previous === undefined) delete process.env.VIBEPRO_NEXT_BEST_ACTION;
    else process.env.VIBEPRO_NEXT_BEST_ACTION = previous;
  });
  const fixture = await createFixture(t, { mode: 'disabled' });
  let prepareCalls = 0;
  let autopilotCalls = 0;
  const session = fixture.session({
    preparePullRequest: async () => { prepareCalls += 1; return { artifacts: { json: 'prepare.json' } }; },
    safeAutopilotPullRequest: async () => { autopilotCalls += 1; return { status: 'continue', artifact: 'prepare.json' }; }
  });
  await session.run(fixture.source, { storyId: STORY_ID });

  const result = await session.orchestrate(fixture.source, {
    storyId: STORY_ID,
    runId: RUN_ID,
    checkpointReason: 'no_progress',
    noProgressCount: 2
  });

  assert.equal(result.state.next_best_action_decisions.at(-1).selection_reason, 'no_progress_escape');
  assert.equal(prepareCalls, 1);
  assert.equal(autopilotCalls, 1);
  assert.deepEqual(result.state.action_journal.map((entry) => entry.action_id), ['pr_prepare', 'pr_autopilot_safe']);
  assert.notEqual(result.state.status, 'waiting_for_human');
});

test('SAO-S-3 SAO-S-5 human summary renders every actionable recovery detail', () => {
  const summary = renderGuardedRunSummary({
    run_id: RUN_ID,
    story_id: STORY_ID,
    target: 'pr_ready',
    autonomy_mode: 'guarded',
    status: 'waiting_for_human',
    attempt: 1,
    iteration: 0,
    current_head_sha: 'a'.repeat(40),
    execution_context: { authority_kind: 'repository', root_realpath: '/tmp/repo with space' },
    action_journal: [],
    next_best_action_decisions: [{
      selected_action_id: 'ask',
      checkpoint_reason: 'no_progress',
      no_progress_count: 2
    }],
    transitions: [],
    stop_reason: {
      code: 'human_judgment_required',
      message: 'human_judgment_required',
      details: {
        recovery: {
          failed_kinds: ['integration'],
          judgments: [{ kind: 'scope', reason: 'choose a boundary' }],
          required_actions: ['record current evidence'],
          failure: 'autopilot interrupted',
          next_command: `vibepro execute resume '/tmp/repo with space' --story-id ${STORY_ID} --run-id ${RUN_ID} --until pr-ready`
        }
      }
    }
  });

  assert.match(summary, /judgment: scope - choose a boundary/);
  assert.match(summary, /failed: integration/);
  assert.match(summary, /required_action: record current evidence/);
  assert.match(summary, /failure: autopilot interrupted/);
  assert.match(summary, /next_command: vibepro execute resume '\/tmp\/repo with space' .*--until pr-ready/);
  assert.match(summary, /next_best_action: ask \(checkpoint=no_progress; no_progress=2\)/);
});

test('GAH-S-8 human summary renders pending decision and a safe fallback when recovery is absent', () => {
  const summary = renderGuardedRunSummary({
    run_id: RUN_ID,
    story_id: STORY_ID,
    target: 'pr_ready',
    autonomy_mode: 'guarded',
    status: 'waiting_for_human',
    attempt: 1,
    iteration: 0,
    current_head_sha: 'a'.repeat(40),
    execution_context: { authority_kind: 'repository', root_realpath: '/tmp/repo with space' },
    action_journal: [],
    transitions: [],
    pending_decision: {
      decision_id: 'decision-1234567890abcdef',
      question: 'Which bounded scope should continue?',
      material_reason: 'The change crosses an ownership boundary.'
    },
    stop_reason: { code: 'human_judgment_required', message: 'human judgment required', details: {} }
  });

  assert.match(summary, /decision-1234567890abcdef/);
  assert.match(summary, /Which bounded scope should continue\?/);
  assert.match(summary, /The change crosses an ownership boundary\./);
  assert.match(summary, /next_command: vibepro execute status '\/tmp\/repo with space'/);
});

test('NBA-S-7 public CLI derives a bounded escape after repeated unchanged resumes', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const dependencies = {
    ...fixture.dependencies(),
    preparePullRequest: async () => ({ artifacts: { json: 'prepare.json' } }),
    safeAutopilotPullRequest: async () => ({
      status: 'waiting_for_runtime',
      stop_reason: 'runtime_required',
      artifact: 'prepare.json',
      recovery: { missing_kinds: ['unit'] }
    })
  };
  const started = await runCli([
    'execute', 'run', fixture.source, '--story-id', STORY_ID,
    '--until', 'pr-ready', '--json'
  ], { stdout: capture(), stderr: capture(), guardedRunDependencies: dependencies });
  assert.equal(started.exitCode, 0);
  const resumed = await runCli([
    'execute', 'resume', fixture.source, '--story-id', STORY_ID, '--run-id', RUN_ID,
    '--until', 'pr-ready', '--json'
  ], { stdout: capture(), stderr: capture(), guardedRunDependencies: dependencies });
  assert.equal(resumed.exitCode, 0);
  const escaped = capture();
  const escapedError = capture();
  const escapedResult = await runCli([
    'execute', 'resume', fixture.source, '--story-id', STORY_ID, '--run-id', RUN_ID,
    '--until', 'pr-ready', '--json'
  ], { stdout: escaped, stderr: escapedError, guardedRunDependencies: dependencies });
  assert.equal(escapedResult.exitCode, 0, escapedError.text());

  const decision = JSON.parse(escaped.text()).state.next_best_action_decisions.at(-1);
  assert.equal(decision.checkpoint_reason, 'no_progress');
  assert.equal(decision.no_progress_count, 2);
  assert.equal(decision.selection_reason, 'no_progress_escape');
  assert.equal(['rediagnose', 'split', 'ask', 'stop'].includes(decision.selected_action_id), true);

  const human = capture();
  await runCli([
    'execute', 'status', fixture.source, '--story-id', STORY_ID, '--run-id', RUN_ID
  ], { stdout: human, stderr: capture(), guardedRunDependencies: dependencies });
  assert.match(human.text(), /status: waiting_for_human/);
  assert.match(human.text(), /required_action: resolve controller escape action:/);
  assert.equal(human.text().includes(`next_command: vibepro execute resume ${fixture.source}`), true);
  assert.match(human.text(), /next_best_action: .*checkpoint=no_progress; no_progress=2/);
});

test('SAO-S-5 verification block persists failed kinds for public JSON and human status', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const dependencies = {
    ...fixture.dependencies(),
    preparePullRequest: async () => ({}),
    safeAutopilotPullRequest: async () => ({
      status: 'blocked',
      stop_reason: 'verification_failed',
      recovery: { failed_kinds: ['integration'] }
    })
  };
  const json = capture();
  await runCli([
    'execute', 'run', fixture.source, '--story-id', STORY_ID,
    '--until', 'pr-ready', '--json'
  ], { stdout: json, stderr: capture(), guardedRunDependencies: dependencies });
  const state = JSON.parse(json.text()).state;
  assert.equal(state.stop_reason.code, 'verification_failed');
  assert.deepEqual(state.stop_reason.details.recovery.failed_kinds, ['integration']);

  const human = capture();
  await runCli([
    'execute', 'status', fixture.source, '--story-id', STORY_ID, '--run-id', RUN_ID
  ], { stdout: human, stderr: capture(), guardedRunDependencies: dependencies });
  assert.match(human.text(), /failed: integration/);
  assert.match(human.text(), /next_command: vibepro execute resume .*--until pr-ready/);
});

test('SAO-S-1 SAO-S-2 non-dry CLI run and resume --until preserve checkpoints and typed output', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let prepareCalls = 0;
  let autopilotCalls = 0;
  const dependencies = {
    ...fixture.dependencies(),
    preparePullRequest: async () => { prepareCalls += 1; return {}; },
    safeAutopilotPullRequest: async () => {
      autopilotCalls += 1;
      if (autopilotCalls === 1) throw new Error('transient interruption');
      return {
        status: 'waiting_for_runtime',
        stop_reason: 'runtime_required',
        recovery: { missing_kinds: ['unit'] }
      };
    }
  };
  const runOut = capture();
  const first = await runCli([
    'execute', 'run', fixture.source, '--story-id', STORY_ID,
    '--until', 'pr-ready', '--json'
  ], { stdout: runOut, stderr: capture(), guardedRunDependencies: dependencies });
  assert.equal(first.exitCode, 0);
  assert.equal(JSON.parse(runOut.text()).state.status, 'failed');

  const resumeOut = capture();
  const resumed = await runCli([
    'execute', 'resume', fixture.source, '--story-id', STORY_ID, '--run-id', RUN_ID,
    '--until', 'pr-ready', '--json'
  ], { stdout: resumeOut, stderr: capture(), guardedRunDependencies: dependencies });
  assert.equal(resumed.exitCode, 0);
  const result = JSON.parse(resumeOut.text()).state;
  assert.equal(result.status, 'waiting_for_runtime');
  assert.equal(result.stop_reason.code, 'runtime_required');
  assert.equal(result.attempt, 2);
  assert.equal(prepareCalls, 1);
  assert.equal(autopilotCalls, 2);
  assert.deepEqual(result.action_journal.map((entry) => entry.status), [
    'completed', 'failed', 'completed'
  ]);
  const humanStatus = capture();
  await runCli([
    'execute', 'status', fixture.source, '--story-id', STORY_ID, '--run-id', RUN_ID
  ], { stdout: humanStatus, stderr: capture(), guardedRunDependencies: dependencies });
  assert.match(humanStatus.text(), /missing: unit/);
  assert.match(humanStatus.text(), new RegExp(`execute resume ${fixture.source.replaceAll('/', '\\/')} .*--until pr-ready`));
});

test('SAO-S-2 action checkpoint survives a later action failure', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  const session = fixture.session({
    preparePullRequest: async () => ({}),
    safeAutopilotPullRequest: async () => { throw new Error('autopilot interrupted'); }
  });
  await session.run(fixture.source, { storyId: STORY_ID });
  const result = await session.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(result.state.status, 'failed');
  assert.deepEqual(result.state.action_journal.map((entry) => entry.status), ['completed', 'failed']);
  assert.deepEqual(await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID }), result.state);
});

test('SAO-S-2 C-004 resume retries only the failed action and preserves the completed checkpoint', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let prepareCalls = 0;
  let autopilotCalls = 0;
  const session = fixture.session({
    preparePullRequest: async () => { prepareCalls += 1; return {}; },
    safeAutopilotPullRequest: async () => {
      autopilotCalls += 1;
      if (autopilotCalls === 1) throw new Error('transient interruption');
      return { status: 'waiting_for_runtime', stop_reason: 'runtime_required' };
    }
  });
  await session.run(fixture.source, { storyId: STORY_ID });
  const failed = await session.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(failed.state.status, 'failed');

  await session.resume(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  const retried = await session.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(retried.state.status, 'waiting_for_runtime');
  assert.equal(retried.state.attempt, 2);
  assert.equal(prepareCalls, 1);
  assert.equal(autopilotCalls, 2);
  assert.deepEqual(retried.state.action_journal.map((entry) => entry.status), [
    'completed', 'failed', 'completed'
  ]);
  assert.match(renderGuardedRunSummary(retried.state), /pr_autopilot_safe \(completed\): runtime_required/);
});

test('SAO-S-2 GAH-S-6 pr_ready is revoked until a changed HEAD passes the Gate DAG', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let prepareCalls = 0;
  const session = fixture.session({
    preparePullRequest: async () => {
      prepareCalls += 1;
      return prepareCalls === 1
        ? {}
        : { preparation: { gate_status: { ready_for_pr_create: false } } };
    },
    safeAutopilotPullRequest: async () => {
      fixture.setHead(fixture.source, 'changed-head');
      return { status: 'pr_ready' };
    }
  });
  await session.run(fixture.source, { storyId: STORY_ID });
  const result = await session.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  assert.equal(prepareCalls, 2);
  assert.equal(result.state.current_head_sha, 'changed-head');
  assert.equal(result.state.status, 'blocked');
  assert.equal(result.state.stop_reason.code, 'gate_recheck_required');
  assert.match(result.state.stop_reason.details.recovery.next_command, /execute resume .*--until pr-ready/);
  assert.deepEqual(result.state.stop_reason.details.recovery.required_actions, []);
  assert.deepEqual(result.state.action_journal.map((entry) => entry.action_id), [
    'pr_prepare', 'pr_autopilot_safe', 'rebind_head', 'pr_prepare_current_head'
  ]);
});

test('SAO-S-2 SAO-S-3 changed-HEAD Gate exception persists rebound and typed recovery', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let prepareCalls = 0;
  const session = fixture.session({
    preparePullRequest: async () => {
      prepareCalls += 1;
      if (prepareCalls === 2) throw new Error('Gate storage unavailable');
      return {};
    },
    safeAutopilotPullRequest: async () => {
      fixture.setHead(fixture.source, 'changed-head');
      return { status: 'pr_ready' };
    }
  });
  await session.run(fixture.source, { storyId: STORY_ID });
  const result = await session.orchestrate(fixture.source, { storyId: STORY_ID, runId: RUN_ID });
  const persisted = await session.status(fixture.source, { storyId: STORY_ID, runId: RUN_ID });

  assert.equal(result.state.status, 'failed');
  assert.equal(result.state.current_head_sha, 'changed-head');
  assert.equal(result.state.stop_reason.code, 'gate_recheck_failed');
  assert.equal(result.state.stop_reason.details.recovery.failure, 'Gate storage unavailable');
  assert.match(result.state.stop_reason.details.recovery.next_command, /execute resume .*--until pr-ready/);
  assert.deepEqual(result.state.action_journal.map((entry) => [entry.action_id, entry.status]), [
    ['pr_prepare', 'completed'],
    ['pr_autopilot_safe', 'completed'],
    ['rebind_head', 'completed'],
    ['pr_prepare_current_head', 'failed']
  ]);
  assert.deepEqual(persisted, result.state);
});

test('SAO-S-1 dry-run CLI is side-effect free and unknown --until fails typed', async (t) => {
  const fixture = await createFixture(t, { mode: 'disabled' });
  let bootstrapCalls = 0;
  let actionCalls = 0;
  const dependencies = {
    ...fixture.dependencies(),
    startExecution: async () => { bootstrapCalls += 1; },
    preparePullRequest: async () => { actionCalls += 1; },
    safeAutopilotPullRequest: async () => { actionCalls += 1; }
  };
  const stdout = capture();
  const result = await runCli([
    'execute', 'run', fixture.source, '--story-id', STORY_ID,
    '--until', 'pr-ready', '--dry-run', '--json'
  ], { stdout, stderr: capture(), guardedRunDependencies: dependencies });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(stdout.text()).plan.map((item) => item.id), ['pr_prepare', 'pr_autopilot_safe']);
  assert.equal(bootstrapCalls, 0);
  assert.equal(actionCalls, 0);
  await assert.rejects(access(fixture.runFile(fixture.source, RUN_ID)));
  await assert.rejects(access(path.join(fixture.source, '.vibepro', 'execution-state.json')));
  await assert.rejects(access(path.join(fixture.source, '.vibepro', 'pr', STORY_ID, 'pr-prepare.json')));

  const human = capture();
  const humanError = capture();
  const humanResult = await runCli([
    'execute', 'run', fixture.source, '--story-id', STORY_ID,
    '--until', 'pr-ready', '--dry-run'
  ], { stdout: human, stderr: humanError, guardedRunDependencies: dependencies });
  assert.equal(humanResult.exitCode, 0, humanError.text());
  assert.match(human.text(), /Planned Actions/);
  assert.match(human.text(), /pr_prepare \(repo_local_safe\)/);
  assert.match(human.text(), /pr_autopilot_safe \(repo_local_safe\)/);

  const stderr = capture();
  const invalid = await runCli([
    'execute', 'run', fixture.source, '--story-id', STORY_ID,
    '--until', 'merge', '--json'
  ], { stdout: capture(), stderr, guardedRunDependencies: dependencies });
  assert.equal(invalid.exitCode, 2);
  assert.equal(JSON.parse(stderr.text()).stop_reason.code, 'invalid_until');
  assert.equal(bootstrapCalls, 0);
});

test('GRS-S-9 INV-004 GAH-S-4 guarded Run source surface excludes runtime/waiver/merge imports and service replacement', async () => {
  const source = await readFile(new URL('../src/guarded-run-session.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"].*(agent|runtime|waiver|merge-manager).*['"]/i);
  assert.match(source, /from ['"].*safe-action-orchestrator\.js['"]/i);
  assert.doesNotMatch(source, /guardedRunSession|guardedRunService/);
  assert.match(source, /artifactIo/);
  assert.match(source, /readdir/);
});

async function createFixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guarded-run-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const managed = path.join(root, 'managed');
  const sourceAlias = path.join(root, 'source-alias');
  await Promise.all([mkdir(source, { recursive: true }), mkdir(managed, { recursive: true })]);
  if (options.sourceAlias) await symlink(source, sourceAlias, 'dir');
  await Promise.all([writeConfig(source), writeConfig(managed)]);
  const identities = new Map([
    [source, {
      root_realpath: source,
      git_dir_realpath: path.join(root, 'git', 'source'),
      git_common_dir_realpath: path.join(source, '.git'),
      head_sha: 'a'.repeat(40)
    }],
    [managed, {
      root_realpath: managed,
      git_dir_realpath: path.join(root, 'git', 'managed'),
      git_common_dir_realpath: path.join(source, '.git'),
      head_sha: 'a'.repeat(40)
    }]
  ]);
  if (options.sourceAlias) identities.set(sourceAlias, identities.get(source));
  const mode = options.mode ?? 'disabled';
  const managedStatus = options.managedStatus ?? (mode === 'disabled' ? 'disabled' : 'created');
  const binding = {
    status: managedStatus,
    required: mode === 'required',
    mode,
    source_repo: options.sourceAlias ? sourceAlias : source,
    source_relative_path: null,
    path: mode === 'disabled' || managedStatus === 'unavailable' ? null : managed,
    relative_path: mode === 'disabled' ? null : '.worktrees/vibepro/story-guarded-run-test',
    branch: 'codex/story-guarded-run-test',
    actual_branch: managedStatus === 'unavailable' ? null : 'codex/story-guarded-run-test',
    branch_match: managedStatus === 'unavailable' ? null : true,
    base_ref: 'main',
    created_from_sha: 'a'.repeat(40),
    current_head_sha: managedStatus === 'unavailable' ? null : 'a'.repeat(40),
    dirty: null,
    dirty_paths: [],
    dirty_check_error: null,
    failure_reason: managedStatus === 'unavailable' ? 'fixture_unavailable' : null
  };
  const legacy = {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    target: 'pr_create',
    managed_worktree: binding
  };
  if (options.preexistingLegacy) await writeLegacy(source, legacy);
  const clock = { value: FIRST_TIME };

  const fixture = {
    root,
    source,
    sourceAlias: options.sourceAlias ? sourceAlias : source,
    managed,
    legacy,
    disabledBinding: normalizeExpectedBinding(binding),
    identity(repo) {
      return identities.get(path.resolve(repo));
    },
    setHead(repo, headSha) {
      const resolved = path.resolve(repo);
      const identity = identities.get(resolved);
      if (!identity) throw new Error(`unknown fixture worktree: ${resolved}`);
      identity.head_sha = headSha;
    },
    setTime(value) {
      clock.value = value;
    },
    runFile(repo, runId) {
      return path.join(repo, '.vibepro', 'executions', STORY_ID, 'runs', runId, 'state.json');
    },
    creationLock(repo = source) {
      return path.join(
        fixture.identity(repo).git_common_dir_realpath,
        '.vibepro',
        'executions',
        STORY_ID,
        '.run-creation.lock'
      );
    },
    dependencies(overrides = {}) {
      return {
        now: () => new Date(clock.value),
        randomBytes: () => Buffer.from([1, 2, 3, 4]),
        resolveGitIdentity: async (repo) => {
          const resolved = path.resolve(repo);
          await stat(resolved);
          const identity = identities.get(resolved);
          if (!identity) throw new Error(`unknown fixture worktree: ${resolved}`);
          return { ...identity };
        },
        startExecution: async () => {
          await writeLegacy(source, legacy);
          if (managedStatus !== 'unavailable' && mode !== 'disabled') await writeLegacy(managed, legacy);
          return { state: legacy, found: true };
        },
        readGateReadiness: async () => ({ ready_for_pr_create: false }),
        ...overrides
      };
    },
    session(overrides = {}) {
      return createGuardedRunSession(fixture.dependencies(overrides));
    }
  };
  return fixture;
}

async function writeConfig(repo, options = {}) {
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    brainbase: { stories: [{ story_id: STORY_ID, title: 'Guarded Run test' }] },
    ...(options.managedWorktree ? { execution: { managed_worktree: options.managedWorktree } } : {})
  }, null, 2)}\n`);
}

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}

async function runVibeproProcess(args, cwd) {
  return execFileAsync(process.execPath, [CLI_BIN, ...args], { cwd, encoding: 'utf8' });
}

async function persistBlockedState(stateFile, timestamp) {
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.status = 'blocked';
  state.stop_reason = { code: 'fixture_blocked', message: 'fixture blocked', details: {} };
  state.updated_at = timestamp;
  state.last_progress_at = timestamp;
  state.transitions.push({
    sequence: state.transitions.length + 1,
    from: 'running',
    to: 'blocked',
    reason: 'fixture_blocked',
    timestamp
  });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

async function writeLegacy(repo, legacy) {
  const file = path.join(repo, '.vibepro', 'executions', STORY_ID, 'state.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(legacy, null, 2)}\n`);
}

function normalizeExpectedBinding(binding) {
  return {
    ...binding,
    source_repo: path.resolve(binding.source_repo),
    path: binding.path ? path.resolve(binding.path) : null
  };
}

function errorWithCode(code) {
  return (error) => error instanceof GuardedRunError && error.code === code;
}

function capture() {
  let value = '';
  return {
    write(chunk) { value += String(chunk); },
    text() { return value; }
  };
}
