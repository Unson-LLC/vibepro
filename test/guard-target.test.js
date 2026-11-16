import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../src/cli.js';

function captureIo(env) {
  let stdout = '';
  let stderr = '';
  return {
    env,
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
    read: () => ({ stdout, stderr })
  };
}

test('guard target returns the exact matched repository contract as JSON', async () => {
  const io = captureIo({ ...process.env, VIBEPRO_EXPECTED_REPOSITORY: 'example/private' });
  const result = await runCli([
    'guard', 'target', process.cwd(),
    '--push-url', 'git@github.com:example/private.git',
    '--json'
  ], io);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(io.read().stdout), {
    schema_version: 'repository-target-v1',
    repository: 'example/private',
    status: 'matched'
  });
  assert.equal(io.read().stderr, '');
});

test('guard target fails closed when the expected repository is missing or mismatched', async () => {
  for (const env of [
    { ...process.env },
    { ...process.env, VIBEPRO_EXPECTED_REPOSITORY: 'example/private' }
  ]) {
    const io = captureIo(env);
    const pushUrl = env.VIBEPRO_EXPECTED_REPOSITORY
      ? 'https://github.com/example/public.git'
      : 'https://github.com/example/private.git';
    const result = await runCli([
      'guard', 'target', process.cwd(),
      '--push-url', pushUrl,
      '--json'
    ], io);

    assert.equal(result.exitCode, 1);
    assert.equal(io.read().stdout, '');
    assert.match(io.read().stderr, /"ok": false/);
    assert.match(io.read().stderr, /repository target|Push destination/i);
  }
});

test('guard help documents the target validator', async () => {
  const io = captureIo({ ...process.env });
  const result = await runCli(['guard', '--help'], io);
  assert.equal(result.exitCode, 0);
  assert.match(io.read().stdout, /vibepro guard target \[repo\] --push-url <URL> \[--json\]/);
});
