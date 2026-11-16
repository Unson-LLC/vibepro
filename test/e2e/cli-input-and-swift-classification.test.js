import '../support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const VIBEPRO_BIN = path.resolve('bin/vibepro.js');

async function run(command, args, cwd, options = {}) {
  const { stdout } = await execFileAsync(command, args, { cwd, encoding: 'utf8', ...options });
  return stdout;
}

// Feed stdin explicitly: the async execFile has no `input` option, and a child that
// reads stdin would otherwise hang waiting for EOF.
function runWithStdin(command, args, cwd, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`exit ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

async function makeRepo(storyId) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-input-e2e-'));
  await run('git', ['init', '-b', 'main'], repo);
  await run('git', ['config', 'user.email', 'test@example.com'], repo);
  await run('git', ['config', 'user.name', 'Test User'], repo);
  await run(process.execPath, [VIBEPRO_BIN, 'init', repo, '--story-id', storyId, '--title', 'Input Regression'], repo);
  await run('git', ['add', '-A'], repo);
  await run('git', ['commit', '-m', 'chore: initialize repo'], repo);
  await run('git', ['switch', '-c', 'feature/input'], repo);
  return repo;
}

// Regression: `decision record --from-stdin` threw `stdin is not defined` because the
// handler referenced a bare `stdin` instead of `io.stdin ?? process.stdin`.
test('decision record --from-stdin reads structured evidence without ReferenceError', async () => {
  const storyId = 'story-input-decision';
  const repo = await makeRepo(storyId);
  const stdout = await runWithStdin(
    process.execPath,
    [VIBEPRO_BIN, 'decision', 'record', repo, '--id', storyId, '--type', 'noise',
      '--summary', 'fallback', '--source', 'finding:x', '--source-status', 'open',
      '--reason', 'noise finding', '--from-stdin', '--json'],
    repo,
    '{"evidence":{"detail":"structured payload from stdin"}}\n'
  );
  const result = JSON.parse(stdout);
  assert.equal(result.decision.type, 'noise');
  assert.match(result.decision.summary, /structured payload from stdin/);
});

