import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  executeManagedCommand,
  executeManagedOperation
} from '../src/managed-command-executor.js';

test('managed command finitely settles, escalates SIGTERM to SIGKILL, and observes close', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-managed-command-hang-'));
  const pidFile = path.join(root, 'pid');
  t.after(async () => rm(root, { recursive: true, force: true }));
  const script = `trap '' TERM; echo $$ > '${pidFile}'; while :; do sleep 1; done`;

  const startedAt = Date.now();
  const result = await executeManagedCommand({
    command: ['/bin/sh', ['-c', script]],
    stage: 'fixture.real-hanging-child',
    timeoutMs: 300,
    terminationGraceMs: 40,
    closeTimeoutMs: 500
  });

  assert.equal(result.status, 'timed_out');
  assert.equal(result.failure_kind, 'command_timeout');
  assert.equal(result.termination.term_sent, true);
  assert.equal(result.termination.kill_sent, true);
  assert.equal(result.termination.close_observed, true);
  assert.ok(Date.now() - startedAt < 2_000, 'timeout lifecycle must finitely settle');
  const pid = Number(await readFile(pidFile, 'utf8'));
  await assertProcessGone(pid);
});

test('managed command forces non-interactive env and preserves ordinary exit compatibility', async () => {
  const success = await executeManagedCommand({
    command: [process.execPath, ['-e', `process.stdout.write(JSON.stringify({
      git: process.env.GIT_TERMINAL_PROMPT,
      gh: process.env.GH_PROMPT_DISABLED,
      gcm: process.env.GCM_INTERACTIVE
    }))`]],
    stage: 'fixture.non-interactive'
  });
  assert.equal(success.status, 'succeeded');
  assert.equal(success.exit_code, 0);
  assert.deepEqual(JSON.parse(success.stdout), { git: '0', gh: '1', gcm: 'Never' });

  const failure = await executeManagedCommand({
    command: [process.execPath, ['-e', 'process.exit(23)']],
    stage: 'fixture.nonzero'
  });
  assert.equal(failure.status, 'failed');
  assert.equal(failure.exit_code, 23);
});

test('managed command bounds and redacts stdout stderr and command diagnostics', async () => {
  const secret = 'ghp_MANAGED_EXECUTOR_SECRET_123456';
  const result = await executeManagedCommand({
    command: [process.execPath, ['-e', `
      process.stdout.write(${JSON.stringify(secret)} + 'x'.repeat(4096));
      process.stderr.write('Authorization: Bearer ${secret}\\n' + 'y'.repeat(4096));
      process.exit(7);
    `, secret]],
    stage: 'fixture.redaction',
    maxOutputBytes: 256,
    redactValues: [secret]
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.exit_code, 7);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.ok(Buffer.byteLength(result.stdout) <= 320);
  assert.ok(Buffer.byteLength(result.stderr) <= 320);
  assert.match(result.stdout, /truncated/);
  assert.match(result.stderr, /truncated/);
});

test('managed operation enforces an outer deadline on a non-settling injected runner', async () => {
  let aborted = false;
  const startedAt = Date.now();
  const result = await executeManagedOperation({
    stage: 'fixture.injected-runner',
    timeoutMs: 50,
    runner: ({ signal }) => new Promise(() => {
      signal.addEventListener('abort', () => { aborted = true; });
    })
  });

  assert.equal(result.status, 'timed_out');
  assert.equal(result.failure_kind, 'runner_timeout');
  assert.equal(result.termination.abort_requested, true);
  assert.equal(aborted, true);
  assert.ok(Date.now() - startedAt < 1_000);
});

async function assertProcessGone(pid) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`child process ${pid} remained alive after managed timeout cleanup`);
}
