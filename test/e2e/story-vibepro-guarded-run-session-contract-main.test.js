import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CLI_BIN = fileURLToPath(new URL('../../bin/vibepro.js', import.meta.url));
const STORY_ID = 'story-guarded-run-e2e';

test('GRS-S-1 GRS-S-3 GRS-S-4 GRS-S-6 GRS-S-7 guarded Run survives fresh CLI processes and replays its canonical artifact', async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guarded-run-e2e-'));
  t.after(() => rm(repo, { recursive: true, force: true }));

  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro E2E']);
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    brainbase: {
      stories: [{ story_id: STORY_ID, title: 'Guarded Run E2E' }]
    },
    execution: { managed_worktree: 'disabled' }
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'README.md'), '# Guarded Run E2E\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'test: initialize guarded Run E2E fixture']);

  const created = await runJson(repo, [
    'execute', 'run', repo, '--story-id', STORY_ID, '--target', 'pr_ready', '--json'
  ]);
  assert.equal(created.status, 'running');
  assert.equal(created.execution_context.authority_kind, 'repository');

  const stateFile = path.join(
    repo,
    '.vibepro',
    'executions',
    STORY_ID,
    'runs',
    created.run_id,
    'state.json'
  );
  const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.deepEqual(persisted, created);

  const statusFromFreshProcess = await runJson(repo, [
    'execute', 'status', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
  ]);
  assert.deepEqual(statusFromFreshProcess, persisted);

  const watchFromFreshProcess = await runJson(repo, [
    'execute', 'watch', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
  ]);
  assert.deepEqual(watchFromFreshProcess, persisted);

  const cancelled = await runJson(repo, [
    'execute', 'cancel', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
  ]);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.transitions.at(-1).reason, 'operator_cancelled');

  const terminalReplay = await runJson(repo, [
    'execute', 'status', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
  ]);
  assert.deepEqual(terminalReplay, JSON.parse(await readFile(stateFile, 'utf8')));
  assert.deepEqual(terminalReplay, cancelled);
});

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}

async function runJson(cwd, args) {
  const result = await execFileAsync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8'
  });
  return JSON.parse(result.stdout);
}
