import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyTermination, createProgressDeadline } from '../src/progress-deadline.js';

function fakeClock(startMs) {
  let value = startMs;
  return { now: () => value, advance: (ms) => { value += ms; return value; } };
}

test('duplicate progress values do not extend the no-progress deadline', () => {
  const clock = fakeClock(0);
  const kernel = createProgressDeadline({
    no_progress_deadline_ms: 1000,
    max_wall_clock_ms: 1_000_000,
    started_at: 0,
    now: clock.now
  });
  assert.equal(kernel.observe('checkpoint-1'), true);
  clock.advance(900);
  // Same token again: heartbeat only, must NOT reset the clock.
  assert.equal(kernel.observe('checkpoint-1'), false);
  clock.advance(200); // total no-progress elapsed since checkpoint-1: 1100ms > 1000ms
  const verdict = kernel.check();
  assert.equal(verdict.ok, false);
  assert.equal(verdict.kill.code, 'no_progress_deadline_exceeded');
});

test('a NEW progress token extends the no-progress deadline', () => {
  const clock = fakeClock(0);
  const kernel = createProgressDeadline({
    no_progress_deadline_ms: 1000,
    max_wall_clock_ms: 1_000_000,
    started_at: 0,
    now: clock.now
  });
  assert.equal(kernel.observe('checkpoint-1'), true);
  clock.advance(900);
  assert.equal(kernel.observe('checkpoint-2'), true);
  clock.advance(900); // 900ms since checkpoint-2, still under the 1000ms deadline
  assert.deepEqual(kernel.check(), { ok: true });
});

test('null/undefined progress values are not observed', () => {
  const kernel = createProgressDeadline({
    no_progress_deadline_ms: 1000,
    max_wall_clock_ms: 1_000_000,
    started_at: 0,
    now: () => 0
  });
  assert.equal(kernel.observe(null), false);
  assert.equal(kernel.observe(undefined), false);
});

test('max_wall_clock_exceeded is independent of progress and cannot be extended', () => {
  const clock = fakeClock(0);
  const kernel = createProgressDeadline({
    no_progress_deadline_ms: 1_000_000,
    max_wall_clock_ms: 500,
    started_at: 0,
    now: clock.now
  });
  clock.advance(100);
  kernel.observe('checkpoint-1'); // fresh progress right before the wall clock trips
  clock.advance(500); // elapsed since started_at: 600ms > 500ms
  const verdict = kernel.check();
  assert.equal(verdict.ok, false);
  assert.equal(verdict.kill.code, 'max_wall_clock_exceeded');
});

test('max_attempts_exceeded fires independently of progress', () => {
  const kernel = createProgressDeadline({
    no_progress_deadline_ms: 1_000_000,
    max_wall_clock_ms: 1_000_000,
    max_attempts: 2,
    started_at: 0,
    now: () => 0
  });
  kernel.observe('checkpoint-1');
  const verdict = kernel.check({ attempts: 3 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.kill.code, 'max_attempts_exceeded');
  assert.equal(verdict.kill.details.attempts, 3);
});

test('max_cost_exceeded fires when cumulative cost reaches the cap', () => {
  const kernel = createProgressDeadline({
    no_progress_deadline_ms: 1_000_000,
    max_wall_clock_ms: 1_000_000,
    max_cost_usd: 5,
    started_at: 0,
    now: () => 0
  });
  assert.deepEqual(kernel.check({ costUsd: 4.99 }), { ok: true });
  const verdict = kernel.check({ costUsd: 5 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.kill.code, 'max_cost_exceeded');
});

test('max_cost_usd of 0 disables cost enforcement entirely', () => {
  const kernel = createProgressDeadline({
    no_progress_deadline_ms: 1_000_000,
    max_wall_clock_ms: 1_000_000,
    max_cost_usd: 0,
    started_at: 0,
    now: () => 0
  });
  assert.deepEqual(kernel.check({ costUsd: 1_000_000 }), { ok: true });
  assert.deepEqual(kernel.check({ costUsd: null }), { ok: true });
});

test('cost_accounting_unavailable fires when cost tracking is required but absent past the no-progress deadline', () => {
  const clock = fakeClock(0);
  const kernel = createProgressDeadline({
    no_progress_deadline_ms: 100,
    max_wall_clock_ms: 1_000_000,
    max_cost_usd: 5,
    started_at: 0,
    now: clock.now
  });
  clock.advance(150);
  const verdict = kernel.check({ costUsd: null });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.kill.code, 'cost_accounting_unavailable');
});

test('no_progress_deadline_exceeded fires when nothing new has been observed', () => {
  const clock = fakeClock(0);
  const kernel = createProgressDeadline({
    no_progress_deadline_ms: 100,
    max_wall_clock_ms: 1_000_000,
    started_at: 0,
    now: clock.now
  });
  clock.advance(150);
  const verdict = kernel.check();
  assert.equal(verdict.ok, false);
  assert.equal(verdict.kill.code, 'no_progress_deadline_exceeded');
});

test('precedence order: wall clock beats attempts beats cost beats cost_accounting_unavailable beats no_progress', () => {
  const clock = fakeClock(0);
  const makeKernel = () => createProgressDeadline({
    no_progress_deadline_ms: 1,
    max_wall_clock_ms: 10,
    max_attempts: 1,
    max_cost_usd: 1,
    started_at: 0,
    progress_started_at: 0,
    now: clock.now
  });

  // All five conditions are simultaneously true; only the highest-precedence cause wins.
  clock.advance(100); // trips wall clock, attempts, cost, cost_accounting_unavailable, no_progress all at once
  assert.equal(makeKernel().check({ attempts: 5, costUsd: 5 }).kill.code, 'max_wall_clock_exceeded');

  clock.advance(0);
  // Keep wall clock satisfied (elapsed <= max_wall_clock_ms) but trip the rest.
  const wallOkClock = fakeClock(0);
  const kernelAttempts = createProgressDeadline({
    no_progress_deadline_ms: 1, max_wall_clock_ms: 1000, max_attempts: 1, max_cost_usd: 1,
    started_at: 0, progress_started_at: 0, now: wallOkClock.now
  });
  wallOkClock.advance(5);
  assert.equal(kernelAttempts.check({ attempts: 5, costUsd: 5 }).kill.code, 'max_attempts_exceeded');

  const kernelCost = createProgressDeadline({
    no_progress_deadline_ms: 1, max_wall_clock_ms: 1000, max_attempts: 100, max_cost_usd: 1,
    started_at: 0, progress_started_at: 0, now: wallOkClock.now
  });
  assert.equal(kernelCost.check({ attempts: 1, costUsd: 5 }).kill.code, 'max_cost_exceeded');

  const kernelCostUnavailable = createProgressDeadline({
    no_progress_deadline_ms: 1, max_wall_clock_ms: 1000, max_attempts: 100, max_cost_usd: 1,
    started_at: 0, progress_started_at: 0, now: wallOkClock.now
  });
  assert.equal(kernelCostUnavailable.check({ attempts: 1, costUsd: null }).kill.code, 'cost_accounting_unavailable');

  const kernelNoProgress = createProgressDeadline({
    no_progress_deadline_ms: 1, max_wall_clock_ms: 1000, max_attempts: 100, max_cost_usd: 0,
    started_at: 0, progress_started_at: 0, now: wallOkClock.now
  });
  assert.equal(kernelNoProgress.check({ attempts: 1, costUsd: null }).kill.code, 'no_progress_deadline_exceeded');
});

test('observe() accepts an explicit `at` timestamp for replaying a historical event log', () => {
  const kernel = createProgressDeadline({
    no_progress_deadline_ms: 100,
    max_wall_clock_ms: 1_000_000,
    started_at: 0,
    progress_started_at: 0,
    now: () => 500
  });
  kernel.observe('checkpoint-1', { at: 450 });
  // no-progress elapsed relative to `now()`=500 is 50ms, under the 100ms deadline
  assert.deepEqual(kernel.check(), { ok: true });
});

test('createProgressDeadline validates required numeric options', () => {
  assert.throws(() => createProgressDeadline({ max_wall_clock_ms: 100, started_at: 0 }), TypeError);
  assert.throws(() => createProgressDeadline({ no_progress_deadline_ms: 100, started_at: 0 }), TypeError);
  assert.throws(() => createProgressDeadline({ no_progress_deadline_ms: 100, max_wall_clock_ms: 100 }), TypeError);
});

test('classifyTermination: no signal is a plain exit', () => {
  assert.deepEqual(classifyTermination({ signal: null }), { kind: 'exited', signal: null });
  assert.deepEqual(classifyTermination({}), { kind: 'exited', signal: null });
});

test('classifyTermination: a signal the policy sent is a policy kill', () => {
  const verdict = classifyTermination({ signal: 'SIGTERM', sentSignals: ['SIGTERM', 'SIGKILL'] });
  assert.deepEqual(verdict, { kind: 'policy_kill', signal: 'SIGTERM' });
});

test('classifyTermination: a signal the policy did not send is an external kill', () => {
  const verdict = classifyTermination({ signal: 'SIGTERM', sentSignals: [] });
  assert.deepEqual(verdict, { kind: 'external_signal', signal: 'SIGTERM' });

  const verdictOtherSignal = classifyTermination({ signal: 'SIGKILL', sentSignals: ['SIGTERM'] });
  assert.deepEqual(verdictOtherSignal, { kind: 'external_signal', signal: 'SIGKILL' });
});
