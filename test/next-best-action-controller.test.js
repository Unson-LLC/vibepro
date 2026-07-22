import assert from 'node:assert/strict';
import test from 'node:test';

import { selectNextBestAction } from '../src/next-best-action-controller.js';
import { selectSafeActionCandidate } from '../src/safe-action-orchestrator.js';

function candidate(action_id, metrics = {}, extra = {}) {
  return {
    action_id,
    classification: 'repo_local_safe',
    policy_allowed: true,
    dependency_ready: true,
    metrics,
    ...extra
  };
}

test('NBA-S-1 excludes policy, dependency, and classification violations', () => {
  const result = selectNextBestAction({
    checkpoint_reason: 'run_started', state_delta: { head: 'a' },
    candidates: [
      candidate('safe', { expected_progress: 1 }),
      candidate('denied', { expected_progress: 99 }, { policy_allowed: false }),
      candidate('not-ready', { expected_progress: 99 }, { dependency_ready: false }),
      candidate('shell', { expected_progress: 99 }, { classification: 'forbidden' })
    ]
  });
  assert.equal(result.selected_action_id, 'safe');
  assert.deepEqual(result.candidates.map((item) => item.action_id), ['safe']);
});

test('AAD-S-1 admits only the typed autonomous runtime classifications', () => {
  for (const classification of ['agent_runtime_guarded', 'agent_runtime_read_only']) {
    const result = selectNextBestAction({
      checkpoint_reason: 'autonomous_action',
      state_delta: { head: 'a' },
      candidates: [candidate('runtime', {}, { classification })]
    });
    assert.equal(result.selected_action_id, 'runtime');
  }
  const denied = selectNextBestAction({
    checkpoint_reason: 'autonomous_action',
    state_delta: { head: 'a' },
    candidates: [candidate('runtime', {}, { classification: 'agent_runtime_unrestricted' })]
  });
  assert.equal(denied.selected_action_id, null);
});

test('NBA-S-2 and NBA-S-4 record every metric and preserve unknown costs', () => {
  const result = selectNextBestAction({
    checkpoint_reason: 'before_expensive_action', state_delta: {},
    candidates: [candidate('targeted_test', { expected_progress: 2, estimated_time: 1 })]
  });
  assert.equal(result.candidates[0].metrics.estimated_tokens_or_cost, 'unknown');
  assert.equal(result.candidates[0].metrics.risk_reduction, 'unknown');
  assert.ok(Object.hasOwn(result.candidates[0].metrics, 'confidence'));
});

test('NBA-S-3 selection and tie-break are deterministic', () => {
  const input = {
    checkpoint_reason: 'failure', state_delta: { b: 2, a: 1 },
    candidates: [candidate('beta', { expected_progress: 2 }), candidate('alpha', { expected_progress: 2 })]
  };
  assert.equal(selectNextBestAction(input).selected_action_id, 'alpha');
  assert.deepEqual(selectNextBestAction(input), selectNextBestAction(input));
});

test('NBA-S-5 reuses a decision when no material state changed', () => {
  const input = {
    checkpoint_reason: 'head_mutation', state_delta: { head: 'abc' },
    candidates: [candidate('prepare', { expected_progress: 1 })]
  };
  const previous = selectNextBestAction(input);
  const reused = selectNextBestAction({ ...input, previous_decision: previous });
  assert.equal(reused.reused, true);
  assert.equal(reused.selected_action_id, 'prepare');
});

test('NBA-S-6 prefers a cheap uncertainty reduction before expensive validation', () => {
  const result = selectNextBestAction({
    checkpoint_reason: 'before_expensive_action', state_delta: { gate: 'unknown' },
    candidates: [
      candidate('full_suite', { expected_progress: 3, uncertainty_reduction: 1, estimated_time: 8, estimated_tokens_or_cost: 4 }),
      candidate('targeted_test', { expected_progress: 2, uncertainty_reduction: 4, estimated_time: 1, estimated_tokens_or_cost: 1 })
    ]
  });
  assert.equal(result.selected_action_id, 'targeted_test');
});

test('NBA-S-6 Pareto dominance prevents expected-progress weight from selecting a costlier equal-information action', () => {
  const result = selectNextBestAction({
    checkpoint_reason: 'before_expensive_action', state_delta: { gate: 'unknown' },
    candidates: [
      candidate('expensive', { expected_progress: 100, uncertainty_reduction: 3, estimated_time: 8, estimated_tokens_or_cost: 8 }),
      candidate('cheap_probe', { expected_progress: 0, uncertainty_reduction: 3, estimated_time: 1, estimated_tokens_or_cost: 1 })
    ]
  });
  assert.equal(result.selected_action_id, 'cheap_probe');
});

test('NBA-S-7 two no-progress checkpoints force an explicit escape action', () => {
  const result = selectNextBestAction({
    checkpoint_reason: 'no_progress', state_delta: { finding: 'same' }, no_progress_count: 2,
    candidates: [
      candidate('retry', { expected_progress: 99 }),
      candidate('stop', { expected_progress: 0 }, { classification: 'approval_required' }),
      candidate('ask', { uncertainty_reduction: 3 }, { classification: 'approval_required' })
    ]
  });
  assert.equal(result.selected_action_id, 'ask');
  assert.deepEqual(result.candidates.map((item) => item.action_id), ['ask', 'stop']);
  assert.equal(result.selection_reason, 'no_progress_escape');
});

test('NBA-S-8 decision record contains bounded rationale, not raw transcript', () => {
  const result = selectNextBestAction({
    checkpoint_reason: 'budget_pressure', state_delta: { budget: 2 },
    candidates: [candidate('wait', { estimated_time: 1 }, { classification: 'approval_required' })]
  });
  assert.equal(result.selection_reason, 'highest_expected_value');
  assert.deepEqual(result.state_delta, { budget: 2 });
  assert.equal(JSON.stringify(result).includes('transcript'), false);
  assert.deepEqual(result.rejected, []);
});

test('NBA-S-8 rejects an unbounded state delta instead of persisting raw context', () => {
  assert.throws(() => selectNextBestAction({
    checkpoint_reason: 'budget_pressure',
    state_delta: { diagnostic_payload: 'x'.repeat(5000) },
    candidates: [candidate('wait', {}, { classification: 'approval_required' })]
  }), /state_delta exceeds bounded decision record limit/);
  assert.throws(() => selectNextBestAction({
    checkpoint_reason: 'budget_pressure',
    state_delta: { nested: { raw_transcript: 'private reasoning' } },
    candidates: [candidate('wait', {}, { classification: 'approval_required' })]
  }), /forbidden raw context key/);
});

test('NBA-S-1 controller consumes only dependency-ready Safe Action registry candidates', () => {
  const state = {
    run_id: 'run-1', story_id: 'story-1', current_head_sha: 'abc',
    status: 'running', action_journal: []
  };
  const first = selectSafeActionCandidate(state, {
    checkpointReason: 'run_started',
    metrics: {
      pr_prepare: { expected_progress: 1 },
      pr_autopilot_safe: { expected_progress: 99 }
    }
  });
  assert.equal(first.selected_action_id, 'pr_prepare');
  assert.deepEqual(first.candidates.map((item) => item.action_id), ['pr_prepare']);
});

test('NBA-S-1 controller rejects non-canonical escape candidate injection', () => {
  const state = {
    run_id: 'run-1', story_id: 'story-1', current_head_sha: 'abc',
    status: 'running', action_journal: []
  };
  assert.throws(
    () => selectSafeActionCandidate(state, { escapeActionIds: ['deploy_anywhere'] }),
    /Unknown canonical escape action/
  );
  const decision = selectSafeActionCandidate(state, {
    escapeActionIds: ['ask'],
    noProgressCount: 2,
    metrics: { ask: { uncertainty_reduction: 3 } }
  });
  assert.equal(decision.selected_action_id, 'ask');
  assert.deepEqual(decision.candidates.map((item) => item.action_id), ['ask']);
});
