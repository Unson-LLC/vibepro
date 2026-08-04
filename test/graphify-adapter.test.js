import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';

import { runProcess } from '../src/graphify-adapter.js';

// All timeouts here are small (tens of ms) so the suite stays fast; runProcess()'s own
// defaults (10min wall clock, 2min no-progress) are overridden per call via options.

test('a fast, well-behaved process exits cleanly with no policy kill', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("ok"); process.exit(0);'], {
    maxWallClockMs: 5000,
    noProgressDeadlineMs: 2000,
    terminationGraceMs: 100
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stopReason, null);
  assert.equal(result.termination.kind, 'exited');
  assert.match(result.stdout, /ok/);
});

test('continuing output extends the no-progress deadline until the process finishes', async () => {
  const script = `
    let i = 0;
    const t = setInterval(() => {
      process.stdout.write('x');
      i += 1;
      if (i >= 6) { clearInterval(t); process.exit(0); }
    }, 30);
  `;
  const result = await runProcess(process.execPath, ['-e', script], {
    maxWallClockMs: 5000,
    // Shorter than the wall clock but generous enough to absorb Node subprocess startup
    // latency and still be well above the 30ms write interval: only sustained silence
    // after the process is actually running should kill this, not startup jitter.
    noProgressDeadlineMs: 400,
    terminationGraceMs: 100,
    pollIntervalMs: 10
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stopReason, null);
  assert.equal(result.stdout.length, 6);
});

test('silence past the no-progress deadline is killed with a structured cause, escalating SIGTERM to SIGKILL', async () => {
  const script = `
    process.on('SIGTERM', () => {}); // ignore the grace signal to force escalation
    setInterval(() => {}, 1000);
  `;
  const result = await runProcess(process.execPath, ['-e', script], {
    maxWallClockMs: 10000,
    // Generous enough that Node subprocess startup latency does not race the SIGTERM
    // handler registration inside the child (otherwise SIGTERM would arrive under Node's
    // default action before the handler line runs, and the escalation to SIGKILL would
    // never be exercised).
    noProgressDeadlineMs: 400,
    terminationGraceMs: 100,
    pollIntervalMs: 10
  });
  assert.equal(result.stopReason?.code, 'no_progress_deadline_exceeded');
  assert.equal(result.termination.kind, 'policy_kill');
  assert.equal(result.termination.signal, 'SIGKILL');
});

test('wall-clock cap kills the process even while progress keeps arriving', async () => {
  const script = `
    setInterval(() => { process.stdout.write('x'); }, 5);
  `;
  const result = await runProcess(process.execPath, ['-e', script], {
    maxWallClockMs: 60,
    noProgressDeadlineMs: 10000,
    terminationGraceMs: 50,
    pollIntervalMs: 10
  });
  assert.equal(result.stopReason?.code, 'max_wall_clock_exceeded');
});

test('stdout past the output cap is truncated with an explicit marker rather than growing unbounded', async () => {
  const script = `process.stdout.write('a'.repeat(1000)); process.exit(0);`;
  const result = await runProcess(process.execPath, ['-e', script], {
    maxWallClockMs: 5000,
    noProgressDeadlineMs: 2000,
    terminationGraceMs: 100,
    maxOutputBytes: 100
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutTruncated, true);
  assert.match(result.stdout, /truncated/);
});

test('a signal the policy did not send is attributed as an external kill, not a policy kill', async () => {
  const script = `
    setTimeout(() => { process.kill(process.pid, 'SIGTERM'); }, 20);
    setInterval(() => {}, 1000);
  `;
  const result = await runProcess(process.execPath, ['-e', script], {
    maxWallClockMs: 5000,
    noProgressDeadlineMs: 5000,
    terminationGraceMs: 100,
    pollIntervalMs: 10
  });
  assert.equal(result.stopReason, null);
  assert.equal(result.termination.kind, 'external_signal');
  assert.equal(result.termination.signal, 'SIGTERM');
});
