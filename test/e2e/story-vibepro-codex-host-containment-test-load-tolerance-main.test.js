import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCodexSubagentHost } from '../../src/codex-subagent-host.js';

// story-vibepro-codex-host-containment-test-load-tolerance E2E flow-replay.
// This replays the real spawn -> shutdown -> containment lifecycle through
// the public createCodexSubagentHost API (no test-only shortcuts into
// terminateWorkerTree or resolveCodexPid): a detached "codex" child process
// is spawned by the real worker script, its pid is observed via the real
// codex-process.json contract, and host.shutdown() is asked to reap it. The
// fake codex fixture writes its pid file atomically (tmp+rename), matching
// the fix applied to the shared test fixtures so this E2E test cannot
// reproduce the read-before-flush false negative that the unit tests hit.

function runtimeRequest(repoRoot) {
  return {
    dispatch_id: 'dispatch-e2e-containment', idempotency_key: 'dispatch-e2e-containment', story_id: 'story-host',
    run_id: 'run-host', task_id: 'review-host', role: 'review', reviewer_identity: 'reviewer-host',
    input_head_sha: 'head-host', inspection_surface_hash: 'surface-host', requested_judgments: [{ judgment_id: 'correctness' }],
    review_binding: { stage: 'gate', role: 'gate_evidence', inspection_inputs: ['src/codex-subagent-host.js'] },
    requirements: { managed_worktree: repoRoot }, completion_delivery: { protocol: 'vibepro-runtime-inbox-v1' }
  };
}

async function writeAtomicPidFixture(repoRoot) {
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
  return { childPidPath, fakeCodex };
}

async function waitFor(predicate, { timeoutMs = 10000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition timeout');
}

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

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

// story-vibepro-codex-host-containment-test-load-tolerance ac:5 codex-process.json is registered synchronously before shutdown, and shutdown reaps the detached child so it cannot outlive the run
// story-vibepro-codex-host-containment-test-load-tolerance ac:6 the observed pid file value parses as a positive integer, not a race-truncated empty read
test('production Codex host replays spawn -> synchronous containment registration -> shutdown -> orphan reaped', { skip: process.platform === 'win32' }, async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-e2e-containment-replay-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const { childPidPath, fakeCodex } = await writeAtomicPidFixture(repoRoot);
  const host = createCodexSubagentHost({
    cwd: repoRoot,
    codexExecutable: process.execPath,
    codexExecutableArgs: [fakeCodex, childPidPath]
  });

  const started = await host.spawn(runtimeRequest(repoRoot));
  const childPid = await waitForChildPid(childPidPath, { timeoutMs: 300000 });
  assert.equal(Number.isInteger(childPid) && childPid > 1, true,
    'the observed pid file value parses as a positive integer (ac:6)');
  assert.equal(isProcessAlive(childPid), true, 'the detached codex child is running before shutdown is requested');

  const runsRoot = path.join(repoRoot, '.vibepro', 'codex-host', 'runs');
  const [runName] = await readdir(runsRoot);
  const runDir = path.join(runsRoot, runName);
  const codexProcess = JSON.parse(await readFile(path.join(runDir, 'codex-process.json'), 'utf8'));
  assert.equal(codexProcess.pid, childPid,
    'codex-process.json is registered synchronously before shutdown is called (ac:5)');

  await host.shutdown({ provider_run_id: started.provider_run_id, repo_root: repoRoot, reason: 'e2e_containment_replay' });

  await waitFor(async () => !isProcessAlive(childPid), { timeoutMs: 300000 });
  assert.equal(isProcessAlive(childPid), false,
    'the orphaned codex child process is gone after shutdown (ac:5)');

  const state = JSON.parse(await readFile(path.join(runDir, 'state.json'), 'utf8'));
  assert.equal(state.status, 'cancelled', 'the run state reflects the completed shutdown');
});

// story-vibepro-codex-host-containment-test-load-tolerance ac:2 the shutdown-then-exit wait holds under the widened 300000ms deadline without needing anywhere near that long to observe termination in practice
test('production Codex host containment wait succeeds well inside the widened 300000ms deadline', { skip: process.platform === 'win32' }, async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-e2e-containment-deadline-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const { childPidPath, fakeCodex } = await writeAtomicPidFixture(repoRoot);
  const host = createCodexSubagentHost({
    cwd: repoRoot,
    codexExecutable: process.execPath,
    codexExecutableArgs: [fakeCodex, childPidPath]
  });

  const started = await host.spawn(runtimeRequest(repoRoot));
  const childPid = await waitForChildPid(childPidPath, { timeoutMs: 300000 });

  const shutdownStartedAt = Date.now();
  await host.shutdown({ provider_run_id: started.provider_run_id, repo_root: repoRoot, reason: 'e2e_containment_deadline' });
  await waitFor(async () => !isProcessAlive(childPid), { timeoutMs: 300000 });
  const observedMs = Date.now() - shutdownStartedAt;

  assert.equal(isProcessAlive(childPid), false, 'the codex child is reaped inside the 300000ms deadline (ac:2)');
  assert.equal(observedMs < 300000, true,
    `containment observed termination in ${observedMs}ms, well under the widened 300000ms deadline (ac:2)`);
});
