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

test('IRO-S-3 persists stopped operations, closes their lifecycle, and restart never repolls', async () => {
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
  assert.equal(checkpoints.at(-1).at(-1).operation, 'close');
  assert.equal(checkpoints.at(-1).find((entry) => entry.operation === 'poll').result.status, 'waiting_for_runtime');

  const resumedEvents = [];
  const resumed = await orchestrateIndependentReview({
    stages: [{ stage: 'architecture', roles: ['architecture'] }],
    journal: checkpoints.at(-1),
    boundaries: boundaries({ events: resumedEvents })
  });
  assert.equal(resumed.verdict, 'block');
  assert.equal(resumed.stop_reason.code, 'runtime_timeout');
  assert.equal(resumedEvents.some((event) => event.startsWith('dispatch:')), false);
  assert.equal(resumedEvents.some((event) => event.startsWith('poll:')), false);
  assert.equal(events.filter((event) => event.startsWith('close:')).length, 1);
});

test('IRO-S-3 reserves dispatch before the external boundary and reconciles its idempotency key after a crash', async () => {
  let durable = [];
  let persistCount = 0;
  const providerRuns = new Map();
  const dispatchedKeys = [];
  const firstBoundaries = boundaries();
  firstBoundaries.dispatch = async ({ operation }) => {
    dispatchedKeys.push(operation.idempotency_key);
    if (!providerRuns.has(operation.idempotency_key)) providerRuns.set(operation.idempotency_key, { dispatch_id: 'provider-run-1' });
    return providerRuns.get(operation.idempotency_key);
  };
  await assert.rejects(orchestrateIndependentReview({
    stages: [{ stage: 'architecture', roles: ['architecture'] }],
    boundaries: firstBoundaries,
    persistCheckpoint: async (journal) => {
      persistCount += 1;
      if (journal.at(-1)?.operation === 'dispatch' && journal.at(-1)?.state === 'completed') throw new Error('crash after provider accepted dispatch');
      durable = structuredClone(journal);
    }
  }), /crash after provider accepted dispatch/);
  assert.equal(durable.at(-1).operation, 'dispatch');
  assert.equal(durable.at(-1).state, 'reserved');

  const resumedBoundaries = boundaries();
  resumedBoundaries.dispatch = firstBoundaries.dispatch;
  const resumed = await orchestrateIndependentReview({
    stages: [{ stage: 'architecture', roles: ['architecture'] }], journal: durable, boundaries: resumedBoundaries
  });
  assert.equal(resumed.verdict, 'pass');
  assert.equal(providerRuns.size, 1);
  assert.deepEqual(dispatchedKeys, ['architecture:architecture:dispatch', 'architecture:architecture:dispatch']);
  assert.ok(persistCount > 0);
});

test('IRO-S-3 resumes a reserved record with the same idempotency key', async () => {
  let durable = [];
  const recordedKeys = [];
  const reviewRecords = new Map();
  const firstBoundaries = boundaries();
  firstBoundaries.record = async ({ operation }) => {
    recordedKeys.push(operation.idempotency_key);
    if (!reviewRecords.has(operation.idempotency_key)) reviewRecords.set(operation.idempotency_key, { verdict: 'pass' });
    return reviewRecords.get(operation.idempotency_key);
  };
  await assert.rejects(orchestrateIndependentReview({
    stages: [{ stage: 'architecture', roles: ['architecture'] }],
    boundaries: firstBoundaries,
    persistCheckpoint: async (journal) => {
      durable = structuredClone(journal);
      if (journal.at(-1)?.operation === 'record' && journal.at(-1)?.state === 'reserved') throw new Error('crash after record reservation');
    }
  }), /crash after record reservation/);

  const resumedBoundaries = boundaries();
  resumedBoundaries.record = firstBoundaries.record;
  const resumed = await orchestrateIndependentReview({
    stages: [{ stage: 'architecture', roles: ['architecture'] }], journal: durable, boundaries: resumedBoundaries
  });
  assert.equal(resumed.verdict, 'pass');
  assert.equal(reviewRecords.size, 1);
  assert.deepEqual(recordedKeys, ['architecture:architecture:record']);
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

test('IRO-S-5 timeout, schema_failure, retry_or_async_failure, auth_denied, workflow_state_regression, and provenance stops never become pass', async () => {
  for (const [operation, code] of [
    ['dispatch', 'auth_denied'],
    ['poll', 'runtime_timeout'],
    ['poll', 'retry_or_async_failure'],
    ['record', 'schema_failure'],
    ['record', 'evidence_lifecycle_regression'],
    ['record', 'workflow_state_regression'],
    ['record', 'invalid_runtime_review']
  ]) {
    const events = [];
    const result = await orchestrateIndependentReview({ stages: [stages[0]], boundaries: boundaries({ events, stop: { [operation]: { status: 'waiting_for_runtime', stop_reason: { code, message: code } } } }) });
    assert.equal(result.verdict, 'block');
    assert.equal(result.stop_reason.code, code);
    if (operation === 'dispatch' || operation === 'poll') assert.equal(events.some((event) => event.startsWith('close:')), true);
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
  const passed = await passRunner({ state: { current_head_sha: 'head-a', action_journal: [] }, action: { id: 'review' } });
  assert.equal(passed.status, 'continue');
  assert.equal(passed.verdict, 'pass');
  assert.equal(passed.checkpoint.filter((entry) => entry.operation === 'record').length, 3);

  const repairRunner = createIndependentReviewActionRunner({
    resolveStages: async () => [stages[0]],
    boundaries: boundaries({ verdict: 'needs_changes' })
  });
  const repair = await repairRunner({ state: { current_head_sha: 'head-a', action_journal: [] }, action: { id: 'review' } });
  assert.equal(repair.status, 'continue');
  assert.equal(repair.verdict, 'needs_changes');
});

test('IRO-S-7 repair HEAD invalidates the old review checkpoint and dispatches a fresh review', async () => {
  const events = [];
  const runner = createIndependentReviewActionRunner({
    resolveStages: async () => [{ stage: 'implementation', roles: ['runtime'] }],
    boundaries: boundaries({ events })
  });
  const oldCheckpoint = [{
    kind: 'independent_review',
    stage: 'implementation',
    role: 'runtime',
    operation: 'record',
    idempotency_key: 'implementation:runtime:record',
    result: { verdict: 'needs_changes', findings: [{ id: 'old-head-finding' }] }
  }];
  const result = await runner({
    state: {
      current_head_sha: 'head-after-repair',
      action_journal: [{
        action_id: 'review',
        status: 'completed',
        output_head_sha: 'head-before-repair',
        checkpoint: oldCheckpoint
      }]
    },
    action: { id: 'review' }
  });
  assert.equal(result.verdict, 'pass');
  assert.equal(events.filter((event) => event.startsWith('dispatch:implementation:runtime')).length, 1);
  assert.equal(result.checkpoint.some((entry) =>
    entry.operation === 'record' && entry.result?.findings?.some((finding) => finding.id === 'old-head-finding')), false);
});
