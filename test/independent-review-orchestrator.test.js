import assert from 'node:assert/strict';
import test from 'node:test';

import { createIndependentReviewActionRunner, orchestrateIndependentReview } from '../src/independent-review-orchestrator.js';

function boundaries({ verdict = 'pass', stop = null, events = [] } = {}) {
  const call = (name, result = {}) => async (input) => { events.push(`${name}:${input.stage}:${input.role ?? '*'}`); return stop?.[name] ?? result; };
  return {
    prepare: call('prepare'), authorize: call('authorize', { action: 'dispatch' }), start: call('start', { lifecycle_id: 'lifecycle' }),
    dispatch: call('dispatch', { dispatch_id: 'dispatch' }), poll: call('poll', { status: 'completed' }), close: call('close', { status: 'closed' }),
    record: call('record', { verdict })
  };
}

const stages = [{ stage: 'architecture', roles: ['architecture', 'tests'] }, { stage: 'final', roles: ['quality'] }];

test('IRO-S-1 runs roles in a stage concurrently and keeps the next stage behind its record barrier', async () => {
  const events = [];
  const result = await orchestrateIndependentReview({ stages, boundaries: boundaries({ events }) });
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(events.filter((event) => event.startsWith('prepare')), ['prepare:architecture:*']);
  assert.equal(events.some((event) => event.includes(':final:')), false);
  assert.equal(events.filter((event) => event.startsWith('dispatch:architecture')).length, 2);
});

test('IRO-S-3 restart reuses every completed journal operation exactly once', async () => {
  const events = [];
  const first = await orchestrateIndependentReview({ stages, boundaries: boundaries({ events }) });
  const second = await orchestrateIndependentReview({ stages, journal: first.journal, boundaries: boundaries({ events }) });
  assert.equal(events.filter((event) => event.startsWith('prepare:architecture')).length, 1);
  assert.equal(events.filter((event) => event.startsWith('record:architecture')).length, 2);
  assert.equal(second.stage, 'final');
});

test('IRO-S-3 persists every successful operation before the next operation and restart never redispatches', async () => {
  const events = [];
  const checkpoints = [];
  const interrupted = boundaries({ events });
  interrupted.poll = async (input) => {
    events.push(`poll:${input.stage}:${input.role}`);
    return { status: 'waiting_for_runtime', stop_reason: { code: 'runtime_timeout', message: 'paused after dispatch' } };
  };
  const first = await orchestrateIndependentReview({
    stages: [{ stage: 'architecture', roles: ['architecture'] }],
    boundaries: interrupted,
    persistCheckpoint: async (journal) => { checkpoints.push(journal); }
  });
  assert.equal(first.status, 'waiting_for_runtime');
  assert.equal(checkpoints.at(-1).at(-1).operation, 'dispatch');
  assert.equal(checkpoints.at(-1).some((entry) => entry.operation === 'poll'), false);

  const resumedEvents = [];
  const resumed = await orchestrateIndependentReview({
    stages: [{ stage: 'architecture', roles: ['architecture'] }],
    journal: checkpoints.at(-1),
    boundaries: boundaries({ events: resumedEvents })
  });
  assert.equal(resumed.verdict, 'pass');
  assert.equal(resumedEvents.some((event) => event.startsWith('dispatch:')), false);
});

test('IRO-S-3 serializes parallel-role checkpoint writes so an older snapshot cannot win', async () => {
  const persisted = [];
  await orchestrateIndependentReview({
    stages: [{ stage: 'architecture', roles: ['architecture', 'tests'] }],
    boundaries: boundaries(),
    persistCheckpoint: async (journal) => {
      if (journal.length === 2) await new Promise((resolve) => setTimeout(resolve, 10));
      persisted.push(journal);
    }
  });
  for (let index = 1; index < persisted.length; index += 1) {
    assert.ok(persisted[index].length >= persisted[index - 1].length);
  }
  assert.equal(persisted.at(-1).filter((entry) => entry.operation === 'record').length, 2);
});

test('IRO-S-4 preserves existing pass, needs_changes, and block verdicts', async () => {
  for (const verdict of ['pass', 'needs_changes', 'block']) {
    const result = await orchestrateIndependentReview({ stages: [stages[0]], boundaries: boundaries({ verdict }) });
    assert.equal(result.verdict, verdict);
    if (verdict === 'block') assert.equal(result.stop_reason.code, 'review_blocked');
  }
});

test('IRO-S-3 a malformed persisted review record fails closed after restart', async () => {
  const result = await orchestrateIndependentReview({
    stages: [{ stage: 'architecture', roles: ['architecture'] }],
    journal: [{
      kind: 'independent_review', stage: 'architecture', role: 'architecture', operation: 'record',
      idempotency_key: 'architecture:architecture:record', result: { verdict: 'unknown' }
    }],
    boundaries: boundaries()
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.verdict, 'block');
  assert.equal(result.stop_reason.code, 'invalid_review_verdict');
});

test('IRO-S-5 typed runtime/auth/timeout/provenance stops never become pass', async () => {
  for (const [operation, code] of [['dispatch', 'auth_denied'], ['poll', 'runtime_timeout'], ['record', 'invalid_runtime_review']]) {
    const result = await orchestrateIndependentReview({ stages: [stages[0]], boundaries: boundaries({ stop: { [operation]: { status: 'waiting_for_runtime', stop_reason: { code, message: code } } } }) });
    assert.equal(result.verdict, 'block');
    assert.equal(result.stop_reason.code, code);
  }
});

test('IRO-S-6 same-session/runtime rejection and a needs_changes result are contained', async () => {
  const rejected = await orchestrateIndependentReview({ stages: [stages[0]], boundaries: boundaries({ stop: { dispatch: { status: 'waiting_for_runtime', stop_reason: { code: 'review_session_not_separate', message: 'same session' } } } }) });
  assert.equal(rejected.stop_reason.code, 'review_session_not_separate');
  const needsChanges = await orchestrateIndependentReview({ stages: [stages[0]], boundaries: boundaries({ verdict: 'needs_changes' }) });
  assert.equal(needsChanges.verdict, 'needs_changes');
});

test('IRO-S-7 Guarded Run adapter completes serial stages and preserves needs_changes for repair', async () => {
  const passRunner = createIndependentReviewActionRunner({ resolveStages: async () => stages, boundaries: boundaries() });
  const passed = await passRunner({ state: { action_journal: [] }, action: { id: 'review' } });
  assert.equal(passed.status, 'continue');
  assert.equal(passed.verdict, 'pass');
  assert.equal(passed.checkpoint.filter((entry) => entry.operation === 'record').length, 3);

  const repairRunner = createIndependentReviewActionRunner({
    resolveStages: async () => [stages[0]],
    boundaries: boundaries({ verdict: 'needs_changes' })
  });
  const repair = await repairRunner({ state: { action_journal: [] }, action: { id: 'review' } });
  assert.equal(repair.status, 'continue');
  assert.equal(repair.verdict, 'needs_changes');
});
