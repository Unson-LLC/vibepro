import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEntrypointIo, isDirectExecution, main, resolveEntrypointIo } from '../bin/vibepro.js';

const entrypointPath = fileURLToPath(new URL('../bin/vibepro.js', import.meta.url));

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

test('runtime commands bind the Codex host to the explicit repository instead of shell cwd', async (t) => {
  const shellRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-entrypoint-shell-'));
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-entrypoint-repo-'));
  t.after(() => rm(shellRoot, { recursive: true, force: true }));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await writeFile(path.join(shellRoot, 'host.mjs'), 'export function createCodexSubagentHost({ cwd }) { return { marker: cwd }; }\n');
  const io = await resolveEntrypointIo({
    stdout: { write() {} }, stderr: { write() {} }, env: { VIBEPRO_CODEX_HOST_MODULE: './host.mjs' }, cwd: () => shellRoot
  }, ['execute', 'runtime-poll', repoRoot, '--story-id', 'story']);
  assert.equal(io.codexSubagentHost.marker, repoRoot);
});

test('direct execution predicate accepts the real entrypoint and a symlink to it', async (t) => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'vibepro-entrypoint-'));
  t.after(() => rm(tempDirectory, { recursive: true, force: true }));
  const symlinkPath = path.join(tempDirectory, 'vibepro');
  await symlink(entrypointPath, symlinkPath);

  const moduleUrl = pathToFileURL(entrypointPath).href;
  assert.equal(isDirectExecution(moduleUrl, entrypointPath), true);
  assert.equal(isDirectExecution(moduleUrl, symlinkPath), true);
});

test('direct execution predicate rejects import and missing entrypoint input', () => {
  assert.equal(isDirectExecution(pathToFileURL(entrypointPath).href, import.meta.filename), false);
  assert.equal(isDirectExecution(pathToFileURL(entrypointPath).href, undefined), false);
  assert.equal(isDirectExecution(pathToFileURL(entrypointPath).href, '/missing/vibepro-entrypoint'), false);
});

test('direct execution predicate rejects a dangling symlink without throwing', async (t) => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'vibepro-entrypoint-'));
  t.after(() => rm(tempDirectory, { recursive: true, force: true }));
  const danglingSymlink = path.join(tempDirectory, 'vibepro');
  await symlink(path.join(tempDirectory, 'missing-entrypoint.js'), danglingSymlink);

  assert.equal(isDirectExecution(pathToFileURL(entrypointPath).href, danglingSymlink), false);
});

test('version executes identically through the real entrypoint and a symlink', async (t) => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'vibepro-entrypoint-'));
  t.after(() => rm(tempDirectory, { recursive: true, force: true }));
  const symlinkPath = path.join(tempDirectory, 'vibepro');
  await symlink(entrypointPath, symlinkPath);

  const direct = spawnSync(process.execPath, [entrypointPath, 'version'], { encoding: 'utf8' });
  const linked = spawnSync(symlinkPath, ['version'], { encoding: 'utf8' });

  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(linked.status, 0, linked.stderr);
  assert.equal(linked.stderr, '');
  assert.match(direct.stdout, /^\d+\.\d+\.\d+/);
  assert.equal(linked.stdout, direct.stdout);
});

test('module import alone does not execute the CLI', () => {
  const imported = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(entrypointPath).href)})`],
    { encoding: 'utf8' }
  );

  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, '');
  assert.equal(imported.stderr, '');
});
