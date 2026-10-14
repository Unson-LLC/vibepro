import assert from 'node:assert/strict';
import test from 'node:test';

import { monotonicElapsed, monotonicNow } from '../src/monotonic-clock.js';

test('a backwards clock step clamps elapsed time to zero', () => {
  // 1000 -> 722 is a 278ms step backwards, the failure mode of measuring a
  // timeout with Date.now() while the wall clock jumps.
  assert.equal(monotonicElapsed(1_000, 722), 0);
  assert.equal(monotonicElapsed(1_000, 1_000), 0);
  assert.equal(monotonicElapsed(1_000, 1_500), 500);
});

test('successive monotonic samples do not produce a negative elapsed time', async () => {
  const startedAt = monotonicNow();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const elapsed = monotonicElapsed(startedAt);
  assert.equal(Number.isFinite(elapsed), true);
  assert.equal(elapsed >= 0, true);
});

test('monotonicElapsed rejects a non-finite timestamp', () => {
  assert.throws(() => monotonicElapsed(Number.NaN, 1), TypeError);
  assert.throws(() => monotonicElapsed(0, Number.POSITIVE_INFINITY), TypeError);
});
