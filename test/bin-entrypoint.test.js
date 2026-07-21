import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEntrypointIo, main, resolveEntrypointIo } from '../bin/vibepro.js';

test('binary entrypoint IO keeps stdout, stderr, and environment reference identity', () => {
  const runtime = {
    stdout: { write() {} },
    stderr: { write() {} },
    env: { VIBEPRO_SENTINEL_SECRET: 'must-not-be-enumerated' }
  };

  const io = createEntrypointIo(runtime);

  assert.deepEqual(Object.keys(io), ['stdout', 'stderr', 'env']);
  assert.equal(io.stdout, runtime.stdout);
  assert.equal(io.stderr, runtime.stderr);
  assert.equal(io.env, runtime.env);
});

test('binary entrypoint does not enumerate environment values or print a secret sentinel', async () => {
  const stdout = [];
  const stderr = [];
  const env = new Proxy({ VIBEPRO_SENTINEL_SECRET: 'must-not-leak' }, {
    ownKeys() {
      throw new Error('entrypoint must not enumerate environment values');
    }
  });
  const runtime = {
    stdout: { write(chunk) { stdout.push(String(chunk)); } },
    stderr: { write(chunk) { stderr.push(String(chunk)); } },
    env,
    exitCode: null
  };

  const result = await main(['--help'], runtime);

  assert.equal(result.exitCode, 0);
  assert.equal(runtime.exitCode, 0);
  assert.doesNotMatch(`${stdout.join('')}\n${stderr.join('')}`, /must-not-leak/);
});

test('binary entrypoint resolves an explicit Codex host module without enumerating env', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-entrypoint-host-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'host.mjs'), 'export function createCodexSubagentHost({ cwd }) { return { marker: cwd }; }\n');
  const env = new Proxy({ VIBEPRO_CODEX_HOST_MODULE: './host.mjs' }, {
    ownKeys() { throw new Error('entrypoint must not enumerate environment values'); }
  });
  const io = await resolveEntrypointIo({
    stdout: { write() {} }, stderr: { write() {} }, env, cwd: () => root
  });
  assert.equal(io.codexSubagentHost.marker, root);
});
