import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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

test('production Codex host shutdown contains the detached worker process group', { skip: process.platform === 'win32' }, async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-production-codex-containment-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const childPidPath = path.join(repoRoot, 'codex-child.pid');
  const fakeCodex = path.join(repoRoot, 'fake-codex-sleep.mjs');
  await writeFile(fakeCodex, `
    import { rename, writeFile } from 'node:fs/promises';
    if (process.argv.includes('--version')) process.exit(0);
    const pidTarget = process.argv[2];
    const pidTemp = pidTarget + '.tmp';
    await writeFile(pidTemp, String(process.pid));
    await rename(pidTemp, pidTarget);
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  `);
  const host = createCodexSubagentHost({
    cwd: repoRoot,
    codexExecutable: process.execPath,
    codexExecutableArgs: [fakeCodex, childPidPath]
  });
  const started = await host.spawn(runtimeRequest(repoRoot));
  const childPid = await waitForChildPid(childPidPath);
  assert.equal(isProcessAlive(childPid), true);
  await host.shutdown({ provider_run_id: started.provider_run_id, repo_root: repoRoot, reason: 'containment_test' });
  await waitFor(async () => !isProcessAlive(childPid), { timeoutMs: 300000 });
  assert.equal(isProcessAlive(childPid), false);
});

test('production Codex host keeps containment inside the worker sandbox boundary', { skip: process.platform === 'win32' }, async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-production-codex-containment-eperm-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const childPidPath = path.join(repoRoot, 'codex-child.pid');
  const childStoppedPath = path.join(repoRoot, 'codex-child-stopped.txt');
  const fakeCodex = path.join(repoRoot, 'fake-codex-sleep.mjs');
  await writeFile(fakeCodex, `
    import { renameSync, writeFileSync } from 'node:fs';
    import { rename, writeFile } from 'node:fs/promises';
    if (process.argv.includes('--version')) process.exit(0);
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.once(signal, () => {
        const stoppedTarget = process.argv[3];
        const stoppedTemp = stoppedTarget + '.tmp';
        writeFileSync(stoppedTemp, signal);
        renameSync(stoppedTemp, stoppedTarget);
        process.exit(signal === 'SIGTERM' ? 143 : 130);
      });
    }
    const pidTarget = process.argv[2];
    const pidTemp = pidTarget + '.tmp';
    await writeFile(pidTemp, String(process.pid));
    await rename(pidTemp, pidTarget);
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
  await waitForChildPid(childPidPath);

  await host.shutdown({ provider_run_id: started.provider_run_id, repo_root: repoRoot, reason: 'containment_eperm_test' });

  await waitFor(async () => {
    const content = await readFile(childStoppedPath, 'utf8').then((value) => value, () => null);
    return typeof content === 'string' && content.trim().length > 0;
  }, { timeoutMs: 300000 });
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

async function waitFor(predicate, { timeoutMs = 10000 } = {}) {
  const deadline = Date.now() + timeoutMs;
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

// Reading a pid file the instant it becomes visible can race the writer's
// own content flush (even behind a rename, the directory entry can appear
// slightly before a concurrent reader's cached negative-lookup clears on some
// filesystems), so this polls until the content is a parsed, plausible pid
// rather than trusting a single readFile after an access() check.
async function waitForChildPid(childPidPath, options) {
  let childPid = null;
  await waitFor(async () => {
    const content = await readFile(childPidPath, 'utf8').then((value) => value, () => null);
    if (content === null) return false;
    const trimmed = content.trim();
    if (!/^\d+$/.test(trimmed)) return false;
    const parsed = Number(trimmed);
    if (!(parsed > 1)) return false;
    childPid = parsed;
    return true;
  }, options ?? { timeoutMs: 300000 });
  return childPid;
}
