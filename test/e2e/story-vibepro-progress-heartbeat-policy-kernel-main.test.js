// VibePro acceptance E2E for story-vibepro-progress-heartbeat-policy-kernel.
//
// One test block per acceptance criterion (AC1-AC5). Every block exercises REAL behavior:
// AC1/AC2 drive the policy kernel (src/progress-deadline.js) directly with an injected fake
// clock (no sleeps, no real time passing). AC3 drives the public codex-subagent-runtime
// adapter surface (src/codex-subagent-runtime-adapter.js) end to end through a fake Codex
// host, verifying the kernel-delegated stalled verdict shape is preserved. AC4 spawns a real
// (tiny) silent child process through the exported graphify-adapter runProcess with
// millisecond-scale overridden bounds. AC5 spawns real child processes through the exported
// verification-runner executeCommand: one that streams parseable test-completion progress
// past its own no-progress deadline, and one that is killed by an external (non-policy)
// SIGTERM.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import { classifyTermination, createProgressDeadline } from '../../src/progress-deadline.js';
import { runProcess } from '../../src/graphify-adapter.js';
import { executeCommand } from '../../src/verification-runner.js';
import { createCodexSubagentRuntimeAdapter } from '../../src/codex-subagent-runtime-adapter.js';

function fakeClock(startMs) {
  let value = startMs;
  return { now: () => value, advance: (ms) => { value += ms; return value; } };
}

// Minimal fake Codex host, reduced from test/codex-subagent-runtime-adapter.test.js's
// fakeCodexHost() to just the surface AC3 needs: spawn/subscribe/status/shutdown/wake.
function fakeCodexHost() {
  let callback;
  let spawns = 0;
  let shutdowns = 0;
  let lastShutdownReason = null;
  return {
    metrics: () => ({ spawns, shutdowns, lastShutdownReason }),
    async probe() { return { available: true, capabilities: ['review'], sandbox: 'read-only', approval_policy: 'managed' }; },
    async spawn() {
      spawns += 1;
      return { provider_run_id: `codex-provider-${spawns}`, agent_identity: 'reviewer-codex', thread_id: 'thread-codex' };
    },
    async status() { return { status: 'running', usage_accounting: { cost_usd: 0 } }; },
    async shutdown(input) { shutdowns += 1; lastShutdownReason = input.reason; return { status: 'cancelled' }; },
    async subscribeCompletion({ onEvent }) { callback = onEvent; return { subscription_id: 'subscription-1' }; },
    async wake() {},
    async detach() {},
    emit: async (event) => callback(event)
  };
}

function reviewRequest(repoRoot, dispatchId) {
  return {
    adapter_id: 'codex-subagent', task_id: 'agent-review', role: 'review', reviewer_identity: 'reviewer-codex',
    implementation_identity: 'implementer', implementation_session_id: 'implementation-thread',
    inspection_surface_hash: 'surface-a', dispatch_id: dispatchId, story_id: 'story-ac3', run_id: 'run-ac3',
    requirements: {
      capabilities: ['review'], timeout_ms: 1000, monitor_boundary_ms: 600000,
      no_progress_deadline_ms: 1000, max_wall_clock_ms: 3600000, max_attempts: 1, max_cost_usd: 5,
      managed_worktree: repoRoot
    }
  };
}

test('AC1: duplicate progress values must not extend the no-progress deadline', () => {
  const clock = fakeClock(0);
  const kernel = createProgressDeadline({
    no_progress_deadline_ms: 1000,
    max_wall_clock_ms: 1_000_000,
    started_at: 0,
    now: clock.now
  });
  assert.equal(kernel.observe('checkpoint-1'), true);
  clock.advance(900);
  const duplicateExtended = kernel.observe('checkpoint-1');
  clock.advance(200); // total no-progress elapsed since checkpoint-1: 1100ms > 1000ms deadline
  const verdict = kernel.check();

  // story-vibepro-progress-heartbeat-policy-kernel ac:1 duplicate progress must not extend the no-progress deadline
  assert.equal(duplicateExtended, false, 'duplicate progress must not extend the no-progress deadline');
  assert.equal(verdict.ok, false, 'duplicate progress must not extend the no-progress deadline');
  assert.equal(verdict.kill.code, 'no_progress_deadline_exceeded', 'duplicate progress must not extend the no-progress deadline');
});

test('AC2: structured cause distinguishes no_progress / hard cap / external_signal', () => {
  const noProgressKernel = createProgressDeadline({
    no_progress_deadline_ms: 100,
    max_wall_clock_ms: 1_000_000,
    started_at: 0,
    now: () => 150
  });
  const noProgressVerdict = noProgressKernel.check();

  const wallClockKernel = createProgressDeadline({
    no_progress_deadline_ms: 1_000_000,
    max_wall_clock_ms: 50,
    started_at: 0,
    now: () => 150
  });
  const wallClockVerdict = wallClockKernel.check();

  const attemptsKernel = createProgressDeadline({
    no_progress_deadline_ms: 1_000_000,
    max_wall_clock_ms: 1_000_000,
    max_attempts: 1,
    started_at: 0,
    now: () => 0
  });
  const attemptsVerdict = attemptsKernel.check({ attempts: 2 });

  const externalTermination = classifyTermination({ signal: 'SIGTERM', sentSignals: [] });
  const policyTermination = classifyTermination({ signal: 'SIGTERM', sentSignals: ['SIGTERM'] });

  // story-vibepro-progress-heartbeat-policy-kernel ac:2 structured cause distinguishes no_progress / hard cap / external_signal
  assert.equal(noProgressVerdict.kill.code, 'no_progress_deadline_exceeded', 'structured cause distinguishes no_progress / hard cap / external_signal');
  assert.equal(wallClockVerdict.kill.code, 'max_wall_clock_exceeded', 'structured cause distinguishes no_progress / hard cap / external_signal');
  assert.equal(attemptsVerdict.kill.code, 'max_attempts_exceeded', 'structured cause distinguishes no_progress / hard cap / external_signal');
  assert.equal(externalTermination.kind, 'external_signal', 'structured cause distinguishes no_progress / hard cap / external_signal');
  assert.equal(policyTermination.kind, 'policy_kill', 'structured cause distinguishes no_progress / hard cap / external_signal');
});

test('AC3: evaluateProgressBounds stalled contract preserved via kernel delegation', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-heartbeat-kernel-ac3-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  let clock = new Date('2026-08-02T01:00:00.000Z');
  const host = fakeCodexHost();
  // Drives the public adapter surface directly (start -> emit a heartbeat-only event ->
  // reconcile), the same CDI-S-5 scenario test/codex-subagent-runtime-adapter.test.js uses,
  // but through adapter.reconcile() rather than the coordinator so the raw kernel-delegated
  // verdict shape (status/message/stop_reason) is observed instead of the coordinator's
  // generic 'runtime_stalled' wrapper.
  const adapter = createCodexSubagentRuntimeAdapter({ repoRoot, host, now: () => clock });
  const request = reviewRequest(repoRoot, 'dispatch-ac3-stalled');
  const started = await adapter.start(request);
  // A heartbeat event carries no checkpoint_id and is not a partial_result, so it must not
  // count as progress (mirrors AC1's duplicate-progress rejection at the adapter layer).
  await host.emit({ event_id: 'heartbeat-1', kind: 'progress', observed_at: clock.toISOString(), payload: { heartbeat: true } });
  clock = new Date('2026-08-02T01:00:02.000Z'); // 2000ms elapsed > 1000ms no_progress_deadline_ms
  const stalled = await adapter.reconcile({ provider_run_id: started.provider_run_id, dispatch_id: request.dispatch_id });

  // story-vibepro-progress-heartbeat-policy-kernel ac:3 evaluateProgressBounds stalled contract preserved via kernel delegation
  assert.equal(stalled.status, 'stalled', 'evaluateProgressBounds stalled contract preserved via kernel delegation');
  assert.equal(stalled.stop_reason.code, 'no_progress_deadline_exceeded', 'evaluateProgressBounds stalled contract preserved via kernel delegation');
  assert.equal(typeof stalled.stop_reason.message, 'string', 'evaluateProgressBounds stalled contract preserved via kernel delegation');
  assert.equal(typeof stalled.stop_reason.details, 'object', 'evaluateProgressBounds stalled contract preserved via kernel delegation');
  assert.equal(host.metrics().shutdowns, 1, 'evaluateProgressBounds stalled contract preserved via kernel delegation');
});

test('AC4: graphify subprocess killed SIGTERM then SIGKILL with structured stop_reason and bounded stdout', async () => {
  const script = `
    process.on('SIGTERM', () => {}); // ignore the grace signal to force escalation to SIGKILL
    process.stdout.write('a'.repeat(2000)); // immediate burst of output, then silence
    setInterval(() => {}, 1000);
  `;
  const result = await runProcess(process.execPath, ['-e', script], {
    maxWallClockMs: 5000,
    noProgressDeadlineMs: 100,
    terminationGraceMs: 60,
    pollIntervalMs: 10,
    maxOutputBytes: 50
  });

  // story-vibepro-progress-heartbeat-policy-kernel ac:4 graphify subprocess killed SIGTERM then SIGKILL with structured stop_reason and bounded stdout
  assert.equal(result.stopReason?.code, 'no_progress_deadline_exceeded', 'graphify subprocess killed SIGTERM then SIGKILL with structured stop_reason and bounded stdout');
  assert.equal(result.termination.kind, 'policy_kill', 'graphify subprocess killed SIGTERM then SIGKILL with structured stop_reason and bounded stdout');
  assert.equal(result.termination.signal, 'SIGKILL', 'graphify subprocess killed SIGTERM then SIGKILL with structured stop_reason and bounded stdout');
  assert.equal(result.stdoutTruncated, true, 'graphify subprocess killed SIGTERM then SIGKILL with structured stop_reason and bounded stdout');
  assert.ok(result.stdout.length < 2000 + 40, 'graphify subprocess killed SIGTERM then SIGKILL with structured stop_reason and bounded stdout');
});

test('AC5: streaming test-completion progress extends life; external SIGTERM recorded timed_out=false external kill', async () => {
  // Sub-assertion 1: parseable "# tests N" progress (the same format node --test emits, per
  // verification-runner.js's extractOutputCounts) keeps arriving every 50ms for 750ms total,
  // well past the 500ms no-progress deadline — proving the run survives on genuine streamed
  // progress rather than merely finishing before the deadline would have tripped.
  const streamingScript = [
    'let i = 0;',
    'const t = setInterval(() => {',
    '  i += 1;',
    "  process.stdout.write(`# tests ${i}\\n# pass ${i}\\n# fail 0\\n`);",
    '  if (i >= 15) { clearInterval(t); process.exit(0); }',
    '}, 50);'
  ].join('\n');
  const startedAt = Date.now();
  const streamingResult = await executeCommand(process.cwd(), [process.execPath, '-e', streamingScript], {
    timeoutMs: 5000,
    noProgressDeadlineMs: 500,
    maxOutputBytes: 1_000_000,
    env: process.env
  });
  const streamingElapsedMs = Date.now() - startedAt;

  // Sub-assertion 2: a signal verify run did not itself send (a self-delivered SIGTERM,
  // standing in for an external `kill` or an OOM killer) must be recorded as an external
  // kill, never folded into timed_out — the exact misdiagnosis this story's kernel adoption
  // fixes in verification-runner.js.
  const externalKillScript = "setTimeout(() => { process.kill(process.pid, 'SIGTERM'); }, 50); setInterval(() => {}, 1000);";
  const externalResult = await executeCommand(process.cwd(), [process.execPath, '-e', externalKillScript], {
    timeoutMs: 5000,
    noProgressDeadlineMs: 5000,
    maxOutputBytes: 1_000_000,
    env: process.env
  });

  // story-vibepro-progress-heartbeat-policy-kernel ac:5 streaming test-completion progress extends life; external SIGTERM recorded timed_out=false external kill
  assert.equal(streamingResult.exitCode, 0, 'streaming test-completion progress extends life; external SIGTERM recorded timed_out=false external kill');
  assert.equal(streamingResult.timedOut, false, 'streaming test-completion progress extends life; external SIGTERM recorded timed_out=false external kill');
  assert.ok(streamingElapsedMs > 500, 'streaming test-completion progress extends life; external SIGTERM recorded timed_out=false external kill');
  assert.equal(externalResult.timedOut, false, 'streaming test-completion progress extends life; external SIGTERM recorded timed_out=false external kill');
  assert.equal(externalResult.externalKillSignal, 'SIGTERM', 'streaming test-completion progress extends life; external SIGTERM recorded timed_out=false external kill');
});
