import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  closeAgentReviewLifecycle,
  prepareAgentReview,
  recordAgentReview,
  startAgentReviewLifecycle
} from '../../src/agent-review.js';
import {
  createDefaultAgentReviewOps,
  createGuardedIndependentReviewRunner,
  recordGuardedRuntimeReview
} from '../../src/independent-review-orchestrator.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-independent-review-e2e';
const RUN_ID = 'run-20260722T010203Z-01020304';

async function git(root, args) {
  return execFileAsync('git', args, { cwd: root, encoding: 'utf8' });
}

async function fixture(t, roles = ['gate_evidence']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-independent-review-e2e-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'README.md'), '# fixture\n');
  await writeFile(path.join(root, 'src', 'reviewed.js'), 'export const reviewed = true;\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'fixture']);
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'vibepro-manifest.json'), JSON.stringify({ schema_version: '0.1.0', selected_story_id: STORY_ID }));
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({ brainbase: { stories: [{ story_id: STORY_ID, title: 'Independent review E2E' }] } }));
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---\nstory_id: ${STORY_ID}\ntitle: Independent review E2E\n---\n\n# Story\n\n## Acceptance Criteria\n- Review is recorded.\n`);
  await prepareAgentReview(root, { storyId: STORY_ID, stage: 'gate', roles, language: 'en' });
  return root;
}

function reviewOptions(role, status, operationIdempotencyKey) {
  return {
    storyId: STORY_ID, stage: 'gate', role, status, summary: `${role} ${status}`,
    inspectionSummary: 'inspected the production review boundary and focused fixture source',
    inspectionInputs: ['src/reviewed.js', 'test/e2e/story-vibepro-independent-review-orchestration-acceptance.spec.ts'],
    judgmentDeltas: ['unverified runtime result -> verdict preserved after focused inspection'],
    agentSystem: 'codex', executionMode: 'parallel_subagent', agentId: `reviewer-${role}`,
    agentClosed: true, agentSessionId: `review-session-${role}`, operationIdempotencyKey
  };
}

async function lifecycle(root, role, startKey = `gate:${role}:start`) {
  return startAgentReviewLifecycle(root, {
    storyId: STORY_ID, stage: 'gate', role, agentSystem: 'codex', agentId: `reviewer-${role}`,
    agentSessionId: `review-session-${role}`, operationIdempotencyKey: startKey
  });
}

test('AC-3 S-001 actual lifecycle boundaries reconcile deterministic keys after crash before checkpoint', async (t) => {
  const root = await fixture(t);
  const started = await lifecycle(root, 'gate_evidence', 'gate:gate_evidence:start');
  // Simulate the process dying after the authoritative write and before the
  // Guarded Run persists its operation journal; restart repeats the same key.
  const restartedStart = await lifecycle(root, 'gate_evidence', 'gate:gate_evidence:start');
  assert.equal(restartedStart.lifecycle.lifecycle_id, started.lifecycle.lifecycle_id);

  const closed = await closeAgentReviewLifecycle(root, {
    storyId: STORY_ID, stage: 'gate', role: 'gate_evidence', lifecycleId: started.lifecycle.lifecycle_id,
    closeReason: 'completed', closeEvidence: 'runtime-completed', operationIdempotencyKey: 'gate:gate_evidence:close'
  });
  const restartedClose = await closeAgentReviewLifecycle(root, {
    storyId: STORY_ID, stage: 'gate', role: 'gate_evidence', lifecycleId: started.lifecycle.lifecycle_id,
    closeReason: 'completed', closeEvidence: 'runtime-completed', operationIdempotencyKey: 'gate:gate_evidence:close'
  });
  assert.equal(restartedClose.lifecycle.closed_at, closed.lifecycle.closed_at);

  const recorded = await recordAgentReview(root, reviewOptions('gate_evidence', 'pass', 'gate:gate_evidence:record'));
  const restartedRecord = await recordAgentReview(root, reviewOptions('gate_evidence', 'pass', 'gate:gate_evidence:record'));
  assert.equal(restartedRecord.review.recorded_at, recorded.review.recorded_at);
  const history = await readdir(path.join(root, '.vibepro', 'reviews', STORY_ID, 'gate', 'history'));
  assert.equal(history.filter((file) => file.startsWith('review-result-gate_evidence-')).length, 1, 'a replay after the post-side-effect crash must not append history');
});

test('AC-4 actual lifecycle recording preserves needs_changes and block verdicts', async (t) => {
  for (const verdict of ['needs_changes', 'block']) {
    const root = await fixture(t);
    const started = await lifecycle(root, 'gate_evidence', `gate:gate_evidence:start:${verdict}`);
    await closeAgentReviewLifecycle(root, {
      storyId: STORY_ID, stage: 'gate', role: 'gate_evidence', lifecycleId: started.lifecycle.lifecycle_id,
      closeReason: 'completed', closeEvidence: 'runtime-completed', operationIdempotencyKey: `gate:gate_evidence:close:${verdict}`
    });
    const recorded = await recordAgentReview(root, reviewOptions('gate_evidence', verdict, `gate:gate_evidence:record:${verdict}`));
    assert.equal(recorded.review.status, verdict);
  }
});

test('story-vibepro-independent-review-orchestration ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 S-002 scenario_clause_e2e workflow_state_transition production composer preserves parallel pass, needs_changes, block, same-session rejection, and restart', async (t) => {
  const root = await fixture(t, ['gate_evidence', 'pr_split_scope', 'release_risk']);
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const state = {
    story_id: STORY_ID, run_id: RUN_ID, current_head_sha: head,
    execution_context: { root_realpath: root },
    action_journal: [],
    runtime_dispatches: [{ role: 'implementation', status: 'completed', result: { head_sha: head }, agent_identity: 'implementer', session_id: 'implementation-session' }]
  };
  const dispatches = new Map();
  const verdicts = new Map([['gate_evidence', 'needs_changes'], ['pr_split_scope', 'block'], ['release_risk', 'pass']]);
  const dispatchRuntime = async (_state, request) => {
    const id = `dispatch-${createHash('sha256').update(`${RUN_ID}:${request.adapter_id}:${request.task_id}:${request.role}:${head}:${request.reviewer_identity}:implementation-session`).digest('hex').slice(0, 16)}`;
    const dispatch = { dispatch_id: id, run_id: RUN_ID, adapter_id: request.adapter_id, task_id: request.task_id, role: 'review', input_head_sha: head,
      reviewer_identity: request.reviewer_identity, implementation_identity: 'implementer', implementation_session_id: 'implementation-session', agent_identity: request.reviewer_identity,
      session_id: `review-session-${request.task_id.split(':').at(-1)}`, thread_id: `review-thread-${request.task_id.split(':').at(-1)}`, sandbox: 'read-only', requirements: request.requirements, status: 'completed' };
    dispatches.set(id, dispatch); state.runtime_dispatches = [...state.runtime_dispatches, dispatch];
    return { dispatch };
  };
  const pollRuntime = async (_state, id) => {
    const dispatch = dispatches.get(id); const role = dispatch.task_id.split(':').at(-1); const status = verdicts.get(role);
    dispatch.result = { head_sha: head, changed_files: [], review_provenance: { execution_mode: 'parallel_subagent', agent_identity: dispatch.agent_identity, session_id: dispatch.session_id, thread_id: dispatch.thread_id, lifecycle: 'closed' }, review: { status, summary: `${role} ${status}`, inspection_summary: 'reviewed source and acceptance contract', inspection_inputs: ['src/reviewed.js'], judgment_delta: ['runtime observation -> recorded verdict'], findings: [] } };
    return { dispatch };
  };
  const agentReviewOps = createDefaultAgentReviewOps({ authorize: async () => ({ action: 'dispatch', authorization: { authorization_id: null } }) });
  const runner = createGuardedIndependentReviewRunner({
    repoRoot: root, baseRef: 'HEAD', agentReviewOps,
    preparePullRequest: async () => ({ preparation: { pr_context: { agent_reviews: { parallel_dispatch: { required_stages: [{ stage: 'gate', roles: ['gate_evidence', 'pr_split_scope', 'release_risk'] }] } } } } }),
    dispatchRuntime, pollRuntime,
    recordRuntimeReview: (runState, dispatchId, review) => recordGuardedRuntimeReview({ deps: { agentReviewOps }, repoRoot: root, options: { dispatchId, review }, loadRun: async () => ({ state: runState }), createError: (code, message) => Object.assign(new Error(message), { code }) }),
    createError: (code, message) => Object.assign(new Error(message), { code })
  });
  let checkpoint = [];
  let crashOnce = true;
  await assert.rejects(runner({ state, action: { id: 'review', node_id: 'review' }, persistCheckpoint: async (next) => {
    checkpoint = structuredClone(next);
    if (crashOnce && next.some((entry) => entry.operation === 'record' && entry.state === 'reserved')) { crashOnce = false; throw new Error('crash after record reservation'); }
  } }), /crash after record reservation/);
  state.action_journal = [{ action_id: 'review', status: 'checkpoint', checkpoint: structuredClone(checkpoint) }];
  const restarted = await runner({ state, action: { id: 'review', node_id: 'review' }, persistCheckpoint: async (next) => { checkpoint = structuredClone(next); } });
  assert.equal(restarted.status, 'blocked');
  assert.equal(restarted.verdict, 'block');
  assert.equal(checkpoint.filter((entry) => entry.operation === 'record').length, 3);
  const history = await readdir(path.join(root, '.vibepro', 'reviews', STORY_ID, 'gate', 'history'));
  assert.equal(history.filter((file) => file.startsWith('review-result-gate_evidence-')).length, 1);

  const forged = structuredClone(dispatches.values().next().value);
  forged.result.review_provenance.session_id = 'implementation-session';
  state.runtime_dispatches = [state.runtime_dispatches[0], forged];
  await assert.rejects(recordGuardedRuntimeReview({ deps: { agentReviewOps }, repoRoot: root, options: { dispatchId: forged.dispatch_id, review: reviewOptions('gate_evidence', 'pass') }, loadRun: async () => ({ state }), createError: (code, message) => Object.assign(new Error(message), { code }) }), /only a current-HEAD/);
});
