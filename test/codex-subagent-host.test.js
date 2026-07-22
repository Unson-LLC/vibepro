import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAgentRuntimeCoordinator } from '../src/agent-runtime-adapter.js';
import { createCodexSubagentRuntimeAdapter } from '../src/codex-subagent-runtime-adapter.js';
import { createCodexSubagentHost } from '../src/codex-subagent-host.js';

test('production Codex host executes a detached CLI worker, dedupes spawn, and delivers completion after parent polling', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-production-codex-host-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const fakeCodex = path.join(repoRoot, 'fake-codex.mjs');
  await writeFile(fakeCodex, `
    import { writeFile } from 'node:fs/promises';
    const args = process.argv.slice(2);
    if (args.includes('--version')) process.exit(0);
    const output = args[args.indexOf('-o') + 1];
    process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'real-codex-session-1' }) + '\\n');
    process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150, cost_usd: 0.75 } }) + '\\n');
    await writeFile(output, JSON.stringify({
      summary: 'detached Codex result', test_suggestions: ['node --test'],
      judgments: [{ judgment_id: 'correctness', verdict: 'pass', detail: 'schema-valid bounded detail' }],
      review_record: { status: 'pass', summary: 'host review pass', findings: [],
        inspection_summary: 'Inspected runtime host', inspection_evidence: 'test/codex-subagent-host.test.js',
        judgment_deltas: ['detached worker -> completed event'] }
    }));
  `);
  const callerRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-production-codex-caller-'));
  t.after(() => rm(callerRoot, { recursive: true, force: true }));
  const host = createCodexSubagentHost({ cwd: callerRoot, codexExecutable: process.execPath, codexExecutableArgs: [fakeCodex] });
  assert.equal((await host.probe()).available, true);
  const request = runtimeRequest(repoRoot);
  const deliveredEvents = [];
  const delivered = new Promise((resolve) => {
    host.subscribeCompletion({ dispatch_id: request.dispatch_id, onEvent: async (event) => {
      deliveredEvents.push(event);
      if (event.kind === 'completed') resolve();
    } });
  });
  const [first, duplicate] = await Promise.all([host.spawn(request), host.spawn(request)]);
  assert.equal(duplicate.provider_run_id, first.provider_run_id);
  await Promise.race([delivered, new Promise((_, reject) => setTimeout(() => reject(new Error('completion timeout')), 10000))]);
  const completion = deliveredEvents.find((event) => event.kind === 'completed');
  assert.deepEqual(deliveredEvents.map((event) => event.kind), ['partial_result', 'completed']);
  assert.equal(deliveredEvents[0].payload.detail, 'schema-valid bounded detail');
  assert.equal(completion.kind, 'completed');
  assert.equal(completion.result.thread_id, first.thread_id);
  assert.equal(completion.result.review_record.status, 'pass');
  assert.deepEqual(completion.result.usage_accounting, { input_tokens: 120, output_tokens: 30, total_tokens: 150, cost_usd: 0.75 });
  await waitFor(async () => (await host.status({ provider_run_id: first.provider_run_id })).status === 'completed');
  assert.deepEqual((await host.status({ provider_run_id: first.provider_run_id })).usage_accounting,
    { input_tokens: 120, output_tokens: 30, total_tokens: 150, cost_usd: 0.75 });
  const runsRoot = path.join(repoRoot, '.vibepro', 'codex-host', 'runs');
  const [runName] = await readdir(runsRoot);
  await waitFor(async () => access(path.join(runsRoot, runName, 'worker-finished.json')).then(() => true, () => false));
  const persisted = await readFile(path.join(runsRoot, runName, 'completion-event.json'), 'utf8');
  assert.doesNotMatch(persisted, /raw_transcript|thread\.started/);

  const successorHost = createCodexSubagentHost({ cwd: callerRoot, codexExecutable: process.execPath, codexExecutableArgs: [fakeCodex] });
  const successorStatus = await successorHost.status({ provider_run_id: first.provider_run_id, repo_root: repoRoot });
  assert.equal(successorStatus.status, 'completed');
  const successorEvents = await successorHost.drainCompletion({ dispatch_id: request.dispatch_id, repo_root: repoRoot });
  assert.deepEqual(successorEvents.map((event) => event.kind), ['partial_result', 'completed']);
});

test('production Codex host without cost telemetry fails closed instead of spawning a recovery attempt', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-production-codex-no-cost-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const fakeCodex = path.join(repoRoot, 'fake-codex-no-cost.mjs');
  await writeFile(fakeCodex, `
    import { writeFile } from 'node:fs/promises';
    const args = process.argv.slice(2);
    if (args.includes('--version')) process.exit(0);
    const output = args[args.indexOf('-o') + 1];
    process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'real-codex-session-no-cost' }) + '\\n');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await writeFile(output, JSON.stringify({ summary: 'late', test_suggestions: [], judgments: [],
      review_record: { status: 'pass', summary: 'late', findings: [], inspection_summary: 'late',
        inspection_evidence: 'test/codex-subagent-host.test.js', judgment_deltas: ['late'] } }));
  `);
  let clock = new Date('2026-07-22T01:00:00.000Z');
  const host = createCodexSubagentHost({ cwd: repoRoot, codexExecutable: process.execPath, codexExecutableArgs: [fakeCodex] });
  const coordinator = createAgentRuntimeCoordinator({
    adapters: [createCodexSubagentRuntimeAdapter({ repoRoot, host, now: () => clock })], now: () => clock
  });
  const request = coordinatorRuntimeRequest(repoRoot);
  const started = await coordinator.dispatch({
    story_id: 'story-host', run_id: 'run-host', current_head_sha: 'head-host', status: 'running', runtime_dispatches: []
  }, request);
  clock = new Date('2026-07-22T01:00:02.000Z');
  const stopped = await coordinator.reconcile(started.state, started.dispatch.dispatch_id);
  assert.equal(stopped.dispatch.stop_reason.code, 'runtime_stalled');
  const runsRoot = path.join(repoRoot, '.vibepro', 'codex-host', 'runs');
  const runNames = await readdir(runsRoot);
  assert.equal(runNames.length, 1);
  const state = JSON.parse(await readFile(path.join(runsRoot, runNames[0], 'state.json'), 'utf8'));
  assert.equal(state.stop_reason.code, 'cost_accounting_unavailable');
});

test('production Codex host shutdown contains the detached worker process group', { skip: process.platform === 'win32' }, async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-production-codex-containment-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const childPidPath = path.join(repoRoot, 'codex-child.pid');
  const fakeCodex = path.join(repoRoot, 'fake-codex-sleep.mjs');
  await writeFile(fakeCodex, `
    import { writeFile } from 'node:fs/promises';
    if (process.argv.includes('--version')) process.exit(0);
    await writeFile(process.argv[2], String(process.pid));
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  `);
  const host = createCodexSubagentHost({
    cwd: repoRoot,
    codexExecutable: process.execPath,
    codexExecutableArgs: [fakeCodex, childPidPath]
  });
  const started = await host.spawn(runtimeRequest(repoRoot));
  await waitFor(async () => access(childPidPath).then(() => true, () => false));
  const childPid = Number(await readFile(childPidPath, 'utf8'));
  assert.equal(isProcessAlive(childPid), true);
  await host.shutdown({ provider_run_id: started.provider_run_id, repo_root: repoRoot, reason: 'containment_test' });
  await waitFor(async () => !isProcessAlive(childPid));
  assert.equal(isProcessAlive(childPid), false);
});

test('production Codex host keeps containment inside the worker sandbox boundary', { skip: process.platform === 'win32' }, async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-production-codex-containment-eperm-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const childPidPath = path.join(repoRoot, 'codex-child.pid');
  const childStoppedPath = path.join(repoRoot, 'codex-child-stopped.txt');
  const fakeCodex = path.join(repoRoot, 'fake-codex-sleep.mjs');
  await writeFile(fakeCodex, `
    import { writeFileSync } from 'node:fs';
    import { writeFile } from 'node:fs/promises';
    if (process.argv.includes('--version')) process.exit(0);
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.once(signal, () => {
        writeFileSync(process.argv[3], signal);
        process.exit(signal === 'SIGTERM' ? 143 : 130);
      });
    }
    await writeFile(process.argv[2], String(process.pid));
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  `);
  let deniedGroupSignals = 0;
  const host = createCodexSubagentHost({
    cwd: repoRoot,
    codexExecutable: process.execPath,
    codexExecutableArgs: [fakeCodex, childPidPath, childStoppedPath],
    killProcess(pid, signal) {
      if (pid < 0) {
        deniedGroupSignals += 1;
        const error = new Error('sandbox denied process-group signal');
        error.code = 'EPERM';
        throw error;
      }
      return process.kill(pid, signal);
    }
  });
  const started = await host.spawn(runtimeRequest(repoRoot));
  await waitFor(async () => access(childPidPath).then(() => true, () => false));

  await host.shutdown({ provider_run_id: started.provider_run_id, repo_root: repoRoot, reason: 'containment_eperm_test' });

  await waitFor(async () => access(childStoppedPath).then(() => true, () => false));
  assert.equal(await readFile(childStoppedPath, 'utf8'), 'SIGTERM');
  assert.equal(deniedGroupSignals, 0);
});

test('explicit managed authority cannot be shadowed by the caller root for status, delivery, subscription, or shutdown', async (t) => {
  const callerRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-shadow-caller-'));
  const managedRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-codex-shadow-managed-'));
  t.after(() => Promise.all([
    rm(callerRoot, { recursive: true, force: true }),
    rm(managedRoot, { recursive: true, force: true })
  ]));
  const dispatchId = 'dispatch-shadow-authority';
  const providerRunId = 'provider-shadow-authority';
  const sourceRun = path.join(callerRoot, '.vibepro', 'codex-host', 'runs', 'source-shadow');
  const managedRun = path.join(managedRoot, '.vibepro', 'codex-host', 'runs', 'managed-authority');
  await Promise.all([mkdir(path.join(sourceRun, 'events'), { recursive: true }), mkdir(path.join(managedRun, 'events'), { recursive: true })]);
  await Promise.all([
    writeFile(path.join(sourceRun, 'state.json'), JSON.stringify({ status: 'running', provider_run_id: providerRunId, dispatch_id: dispatchId })),
    writeFile(path.join(managedRun, 'state.json'), JSON.stringify({ status: 'running_detached', provider_run_id: providerRunId, dispatch_id: dispatchId })),
    writeFile(path.join(sourceRun, 'events', '001.json'), JSON.stringify({ event_id: 'source-shadow', dispatch_id: dispatchId, kind: 'partial_result' })),
    writeFile(path.join(managedRun, 'events', '001.json'), JSON.stringify({ event_id: 'managed-authority', dispatch_id: dispatchId, kind: 'partial_result' }))
  ]);
  const host = createCodexSubagentHost({ cwd: callerRoot, codexExecutable: process.execPath });
  const status = await host.status({ provider_run_id: providerRunId, repo_root: managedRoot });
  assert.equal(status.status, 'running_detached');
  const drained = await host.drainCompletion({ dispatch_id: dispatchId, repo_root: managedRoot });
  assert.deepEqual(drained.map((event) => event.event_id), ['managed-authority']);
  let subscribedEvent = null;
  await host.subscribeCompletion({ dispatch_id: dispatchId, repo_root: managedRoot, onEvent: async (event) => { subscribedEvent = event; } });
  await waitFor(async () => subscribedEvent?.event_id === 'managed-authority');
  await host.shutdown({ provider_run_id: providerRunId, repo_root: managedRoot, reason: 'test_shutdown' });
  assert.equal(JSON.parse(await readFile(path.join(managedRun, 'state.json'), 'utf8')).status, 'cancelled');
  assert.equal(JSON.parse(await readFile(path.join(sourceRun, 'state.json'), 'utf8')).status, 'running');
});

function runtimeRequest(repoRoot) {
  return {
    dispatch_id: 'dispatch-production-host', idempotency_key: 'dispatch-production-host', story_id: 'story-host',
    run_id: 'run-host', task_id: 'review-host', role: 'review', reviewer_identity: 'reviewer-host',
    input_head_sha: 'head-host', inspection_surface_hash: 'surface-host', requested_judgments: [{ judgment_id: 'correctness' }],
    review_binding: { stage: 'gate', role: 'gate_evidence', inspection_inputs: ['src/codex-subagent-host.js'] },
    requirements: { managed_worktree: repoRoot }, completion_delivery: { protocol: 'vibepro-runtime-inbox-v1' }
  };
}

function coordinatorRuntimeRequest(repoRoot) {
  return {
    adapter_id: 'codex-subagent', task_id: 'review-host', role: 'review', reviewer_identity: 'reviewer-host',
    implementation_identity: 'implementer-host', implementation_session_id: 'implementation-session-host',
    inspection_surface_hash: 'surface-host', requested_judgments: [{ judgment_id: 'correctness' }],
    review_binding: { stage: 'gate', role: 'gate_evidence', inspection_inputs: ['src/codex-subagent-host.js'] },
    requirements: { capabilities: ['review'], timeout_ms: 10000, monitor_boundary_ms: 600000,
      no_progress_deadline_ms: 1000, max_wall_clock_ms: 3600000, max_attempts: 2,
      max_cost_usd: 1, managed_worktree: repoRoot }
  };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition timeout');
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}
