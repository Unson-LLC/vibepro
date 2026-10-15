import { performance } from 'node:perf_hooks';

// Elapsed durations and timeouts use this clock. performance.now() does not
// follow NTP steps, so a wall-clock jump cannot shrink a duration below zero
// or expire a deadline early. Datetime records (ISO timestamps, file mtimes,
// identifiers) stay on Date.

export function monotonicNow() {
  return performance.now();
}

// A backwards sample clamps to 0. Callers that mix this with Date.now() or a
// file mtime get a useless comparison, so both arguments must come from the
// same monotonic timeline.
export function monotonicElapsed(startedAt, now = monotonicNow()) {
  const elapsed = now - startedAt;
  if (!Number.isFinite(elapsed)) {
    throw new TypeError('monotonicElapsed requires finite millisecond timestamps');
  }
  return elapsed > 0 ? elapsed : 0;
}
