import './support/scratch-tmpdir.js';

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildRuntimeDoctorCheck,
  buildRuntimeIdentityDigest,
  evaluateRuntimeIntegrity
} from '../src/runtime-info.js';
import { runCli } from '../src/cli.js';

function gitRuntime(overrides = {}) {
  return {
    schema_version: '0.2.0',
    collected_at: '2026-08-11T00:00:00.000Z',
    mode: 'normal',
    source_kind: 'git_checkout',
    package: { name: 'vibepro', version: '0.2.0-beta.5', exact_version: '0.2.0-beta.5', root: '/repo/vibepro' },
    cli: {
      entrypoint: '/repo/vibepro/bin/vibepro.js',
      invoked_as: '/tmp/vibepro',
      runtime_module: '/repo/vibepro/src/runtime-info.js'
    },
    release_manifest: { status: 'not_applicable', manifest: null, errors: [] },
    source_git: {
      is_git_repo: true,
      commit: 'a'.repeat(40),
      branch: 'main',
      origin_url: 'https://github.com/Unson-LLC/vibepro.git',
      origin_main_commit: 'a'.repeat(40),
      origin_main_relation: 'same',
      dirty: false,
      dirty_summary: []
    },
    ...overrides
  };
}

function npmRuntime(overrides = {}) {
  const commit = 'b'.repeat(40);
  const runtime = {
    schema_version: '0.2.0',
    collected_at: '2026-08-11T00:00:00.000Z',
    mode: 'normal',
    source_kind: 'npm_package',
    package: { name: 'vibepro', version: '0.2.0-beta.5', exact_version: '0.2.0-beta.5', root: '/npm/vibepro' },
    cli: {
      entrypoint: '/npm/vibepro/bin/vibepro.js',
      invoked_as: '/Users/test/.local/bin/vibepro',
      runtime_module: '/npm/vibepro/src/runtime-info.js'
    },
    release_manifest: {
      status: 'valid',
      errors: [],
      manifest: {
        schema_version: '0.1.0',
        package: { name: 'vibepro', version: '0.2.0-beta.5' },
        source_git: {
          commit,
          origin_url: 'https://github.com/Unson-LLC/vibepro.git',
          origin_main_commit: commit,
          origin_main_relation: 'same',
          dirty: false
        }
      }
    },
    source_git: {
      is_git_repo: false,
      commit,
      branch: null,
      origin_url: 'https://github.com/Unson-LLC/vibepro.git',
      origin_main_commit: commit,
      origin_main_relation: 'published',
      dirty: false,
      dirty_summary: []
    },
    ...overrides
  };
  runtime.identity_digest = buildRuntimeIdentityDigest(runtime);
  return runtime;
}

test('normal mode rejects every Git checkout as runtime_mismatch', () => {
  const result = evaluateRuntimeIntegrity(gitRuntime(), { purpose: 'observation' });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'runtime_mismatch');
});

test('development mode observes a current Git checkout but cannot generate evidence', () => {
  const runtime = gitRuntime({ mode: 'development' });
  assert.equal(evaluateRuntimeIntegrity(runtime, { purpose: 'observation' }).status, 'trusted');
  const evidence = evaluateRuntimeIntegrity(runtime, { purpose: 'evidence_generation' });
  assert.equal(evidence.status, 'blocked');
  assert.equal(evidence.code, 'runtime_mismatch');
  assert.match(evidence.reasons.join('\n'), /development runtime cannot generate evidence/i);
});

test('behind and dirty development checkout is stale and never warning-suppressed', () => {
  const runtime = gitRuntime({
    mode: 'development',
    source_git: {
      ...gitRuntime().source_git,
      origin_main_commit: 'c'.repeat(40),
      origin_main_relation: 'behind',
      dirty: true,
      dirty_summary: [' M src/runtime-info.js']
    }
  });
  const result = evaluateRuntimeIntegrity(runtime, { purpose: 'observation' });
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'stale_runtime');
  const check = buildRuntimeDoctorCheck(runtime);
  assert.equal(check.status, 'manual');
  assert.equal(check.items[0].integrity.code, 'stale_runtime');
});

test('valid manifested npm runtime is trusted for evidence generation', () => {
  const result = evaluateRuntimeIntegrity(npmRuntime(), { purpose: 'evidence_generation' });
  assert.equal(result.status, 'trusted');
  assert.equal(result.code, null);
});

test('npm runtime without a valid matching manifest is runtime_mismatch', () => {
  const missing = npmRuntime({
    source_kind: 'unverified_package',
    release_manifest: { status: 'missing', manifest: null, errors: ['runtime-manifest.json is missing'] }
  });
  assert.equal(evaluateRuntimeIntegrity(missing).code, 'runtime_mismatch');

  const mismatch = npmRuntime({
    release_manifest: {
      ...npmRuntime().release_manifest,
      status: 'invalid',
      errors: ['manifest package version does not match package.json']
    }
  });
  assert.equal(evaluateRuntimeIntegrity(mismatch).code, 'runtime_mismatch');
});

test('tampered recorded npm identity is rejected before PR judgment', () => {
  const runtime = npmRuntime();
  runtime.package.exact_version = '0.2.0-beta.4';
  const verdict = evaluateRuntimeIntegrity(runtime, { purpose: 'pr_judgment' });
  assert.equal(verdict.status, 'blocked');
  assert.equal(verdict.code, 'runtime_mismatch');
});

test('identity digest is stable across timestamps and invocation aliases', () => {
  const first = npmRuntime();
  const second = npmRuntime({
    collected_at: '2026-08-11T01:02:03.000Z',
    cli: { ...npmRuntime().cli, invoked_as: '/another/launcher' }
  });
  assert.equal(buildRuntimeIdentityDigest(first), buildRuntimeIdentityDigest(second));
  assert.match(buildRuntimeIdentityDigest(first), /^[0-9a-f]{64}$/);
});

test('runtime identity CLI reports the same structured identity contract', async () => {
  const stdout = [];
  const result = await runCli(['runtime', 'identity', '--json'], {
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write() {} }
  });
  assert.equal(result.exitCode, 0);
  const identity = JSON.parse(stdout.join(''));
  assert.equal(identity.integrity.status, 'trusted');
  assert.equal(identity.mode, 'test');
  assert.match(identity.identity_digest, /^[0-9a-f]{64}$/);
});

test('doctor blocks an unexpected source runtime before fix or artifact writes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-runtime-doctor-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html>');
  await runCli(['init', root, '--story-id', 'story-runtime-doctor', '--title', 'Runtime doctor']);
  const doctorDir = path.join(root, '.vibepro', 'doctor');
  const doctorArtifact = path.join(doctorDir, 'doctor-result.json');
  await mkdir(doctorDir, { recursive: true });
  await writeFile(doctorArtifact, 'sentinel\n');
  const configPath = path.join(root, '.vibepro', 'config.json');
  const configBefore = await readFile(configPath, 'utf8');

  const result = await runCli(['doctor', root, '--fix', '--json'], {
    stdout: { write() {} },
    stderr: { write() {} },
    env: { ...process.env, NODE_TEST_CONTEXT: '', VIBEPRO_RUNTIME_MODE: 'normal' }
  });

  assert.equal(result.exitCode, 2);
  assert.equal(result.result.overall_status, 'blocked');
  assert.equal(result.result.runtime_identity.integrity.code, 'runtime_mismatch');
  assert.equal(await readFile(doctorArtifact, 'utf8'), 'sentinel\n');
  assert.equal(await readFile(configPath, 'utf8'), configBefore);
});
