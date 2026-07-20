import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFindingRepairPlan,
  dispatchFindingRepair,
  recordFindingRepairAttempt,
  summarizeFindingRepairState
} from '../src/review-finding-repair-loop.js';

const review = (status = 'needs_changes', findings = [{
  id: 'missing-regression', severity: 'high', detail: 'src/api.js lacks a regression test',
  acceptance_clause: 'RFR-S-4', code_scope: ['src/api.js'], test_scope: ['test/api.test.js']
}]) => ({ status, head_commit: 'head-1', recorded_at: '2026-07-20T00:00:00Z', findings });

test('RFR-S-1 RFR-S-2 one-fix plan preserves verdict and creates a bounded task', () => {
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review(), maxAttempts: 3 });
  assert.equal(state.original_review.status, 'needs_changes');
  assert.equal(state.attempts[0].disposition, 'repairable');
  assert.deepEqual(state.attempts[0].task.code_scope, ['src/api.js']);
  assert.deepEqual(state.attempts[0].task.test_scope, ['test/api.test.js']);
  assert.equal(state.next_action.type, 'dispatch_implementation');
});

test('RFR-S-2 repair task delegates only through the Agent Runtime coordinator', async () => {
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() });
  let received;
  const next = await dispatchFindingRepair(state, {
    adapterId: 'codex', requirements: { capabilities: ['code'], timeout_ms: 1000, managed_worktree: '/tmp/work' },
    runState: { story_id: 'story-1' }, runtimeCoordinator: { dispatch: async (runState, request) => {
      received = { runState, request };
      return { state: { ...runState, status: 'running' }, dispatch: { dispatch_id: 'dispatch-1', status: 'running' } };
    } }
  });
  assert.equal(received.request.role, 'implementation');
  assert.equal(received.request.task_id, state.attempts[0].task.task_id);
  assert.equal(next.status, 'repairing');
});

test('RFR-S-3 unrepairable block creates a Human Checkpoint', () => {
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'security', role: 'security', review: review('block', [{
    id: 'security-boundary', severity: 'critical', detail: 'security architecture boundary requires owner decision'
  }]) });
  assert.equal(state.status, 'human_checkpoint');
  assert.equal(state.attempts[0].disposition, 'human_decision');
  assert.equal(state.next_action.type, 'human_checkpoint');
});

test('RFR-S-4 RFR-S-5 repaired attempt requires current-head verification and independent fresh re-review', () => {
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() });
  const next = recordFindingRepairAttempt(state, {
    headSha: 'head-2', implementationIdentity: 'impl', implementationSessionId: 'impl-session',
    verification: { status: 'pass', head_sha: 'head-2' }, prPrepare: { status: 'ready', head_sha: 'head-2' },
    rereview: { status: 'pass', head_sha: 'head-2', agent_identity: 'reviewer', session_id: 'review-session', lifecycle: 'closed', findings: [] }
  });
  assert.equal(next.status, 'converged');
  assert.equal(next.original_review.status, 'needs_changes');
  assert.equal(next.attempts[0].rereview.fresh_independent, true);
});

test('RFR-S-7 stale evidence cannot converge', () => {
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() });
  assert.throws(() => recordFindingRepairAttempt(state, {
    headSha: 'head-2', implementationIdentity: 'impl', implementationSessionId: 'same',
    verification: { status: 'pass', head_sha: 'head-1' }, prPrepare: { status: 'ready', head_sha: 'head-2' },
    rereview: { status: 'pass', head_sha: 'head-2', agent_identity: 'reviewer', session_id: 'same', lifecycle: 'closed', findings: [] }
  }), /current HEAD|independent/);
});

test('RFR-S-6 multi-attempt repeated fingerprint without HEAD progress stops no_progress', () => {
  let state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review(), maxAttempts: 3 });
  state = recordFindingRepairAttempt(state, {
    headSha: 'head-1', implementationIdentity: 'impl', implementationSessionId: 'impl-1',
    verification: { status: 'pass', head_sha: 'head-1' }, prPrepare: { status: 'ready', head_sha: 'head-1' },
    rereview: { status: 'needs_changes', head_sha: 'head-1', agent_identity: 'reviewer', session_id: 'review-1', lifecycle: 'closed', findings: review().findings }
  });
  assert.equal(state.status, 'no_progress');
  assert.equal(summarizeFindingRepairState(state).stop_reason, 'repeated_finding_without_head_progress');
});

test('RFR-S-6 maximum attempt budget stops a changing finding loop', () => {
  let state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review(), maxAttempts: 1 });
  state = recordFindingRepairAttempt(state, {
    headSha: 'head-2', implementationIdentity: 'impl', implementationSessionId: 'impl-1',
    verification: { status: 'pass', head_sha: 'head-2' }, prPrepare: { status: 'ready', head_sha: 'head-2' },
    rereview: { status: 'needs_changes', head_sha: 'head-2', agent_identity: 'reviewer', session_id: 'review-1', lifecycle: 'closed', findings: [{
      id: 'new-finding', severity: 'high', detail: 'src/next.js lacks coverage', acceptance_clause: 'RFR-S-4',
      code_scope: ['src/next.js'], test_scope: ['test/next.test.js']
    }] }
  });
  assert.equal(state.status, 'no_progress');
  assert.equal(state.stop_reason, 'max_attempts_reached');
});
