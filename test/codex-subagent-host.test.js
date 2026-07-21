import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  await waitFor(async () => (await host.status({ provider_run_id: first.provider_run_id })).status === 'completed');
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

function runtimeRequest(repoRoot) {
  return {
    dispatch_id: 'dispatch-production-host', idempotency_key: 'dispatch-production-host', story_id: 'story-host',
    run_id: 'run-host', task_id: 'review-host', role: 'review', reviewer_identity: 'reviewer-host',
    input_head_sha: 'head-host', inspection_surface_hash: 'surface-host', requested_judgments: [{ judgment_id: 'correctness' }],
    review_binding: { stage: 'gate', role: 'gate_evidence', inspection_inputs: ['src/codex-subagent-host.js'] },
    requirements: { managed_worktree: repoRoot }, completion_delivery: { protocol: 'vibepro-runtime-inbox-v1' }
  };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition timeout');
}
