import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function makeFakeGhChecks(state) {
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-ci-gh-bin-'));
  const ghPath = path.join(binDir, 'gh');
  const statePath = path.join(binDir, 'state.json');
  await writeFile(statePath, JSON.stringify(state, null, 2));
  await writeFile(ghPath, `#!/usr/bin/env node
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, 'utf8'));
const args = process.argv.slice(2);
if (args[0] === 'pr' && args[1] === 'view') {
  console.log(JSON.stringify({
    url: state.url,
    headRefName: state.headRefName,
    headRefOid: state.headRefOid,
    baseRefName: 'main',
    statusCheckRollup: state.statusCheckRollup
  }));
  process.exit(0);
}
process.stderr.write('unexpected gh command: ' + args.join(' '));
process.exit(1);
`);
  await chmod(ghPath, 0o755);
  return { binDir };
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-ci-import-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-ci', '--title', 'CI story']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/ci']);
  await writeFile(path.join(root, 'README.md'), '# Hello\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'feat: readme']);
  return root;
}

function rollup(headSha, overrides = []) {
  const base = [
    { name: 'test (20)', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI', detailsUrl: 'https://ci.example/run/20' },
    { name: 'test (22)', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI', detailsUrl: 'https://ci.example/run/22' },
    { name: 'analyze', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CodeQL', detailsUrl: 'https://ci.example/run/cq' }
  ];
  return { url: 'https://github.example/unson/vibepro/pull/300', headRefName: 'feature/ci', headRefOid: headSha, statusCheckRollup: [...base, ...overrides] };
}

function evidencePath(root) {
  return path.join(root, '.vibepro', 'pr', 'story-ci', 'verification-evidence.json');
}

test('import-ci records successful CI checks as head-bound verification evidence', async () => {
  const root = await setupRepo();
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const gh = await makeFakeGhChecks(rollup(headSha));
  const result = await runCli(
    ['verify', 'import-ci', root, '--id', 'story-ci', '--pr', '300', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.head_sha, headSha);
  const imported = result.result.imported.map((item) => item.check);
  assert.ok(imported.includes('test (20)'));
  assert.ok(imported.includes('test (22)'));
  const skipped = result.result.skipped.map((item) => item.check);
  assert.ok(skipped.includes('analyze'), 'unmapped check must be skipped, not imported');

  const evidence = await readJson(evidencePath(root));
  const integration = evidence.commands.find((cmd) => cmd.kind === 'integration');
  assert.ok(integration, 'mapped test check must be recorded as integration kind');
  assert.equal(integration.status, 'pass');
  assert.equal(integration.artifact_check.status, 'verified');
  assert.equal(integration.observation_check.status, 'recorded');
  assert.equal(integration.observation.values.head_sha, headSha);
  assert.match(integration.command, /ci\.example\/run/);
});

test('import-ci rejects when CI head does not match current HEAD', async () => {
  const root = await setupRepo();
  const gh = await makeFakeGhChecks(rollup('0000000000000000000000000000000000000000'));
  let stderr = '';
  const result = await runCli(
    ['verify', 'import-ci', root, '--id', 'story-ci', '--pr', '300', '--json'],
    {
      env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` },
      stderr: { write: (chunk) => { stderr += chunk; } }
    }
  );
  assert.notEqual(result.exitCode, 0, 'head SHA mismatch must be rejected');
  assert.match(stderr, /head/i);
});

test('import-ci does not record failing checks as pass', async () => {
  const root = await setupRepo();
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const gh = await makeFakeGhChecks({
    url: 'https://github.example/unson/vibepro/pull/300',
    headRefName: 'feature/ci',
    headRefOid: headSha,
    statusCheckRollup: [
      { name: 'test (20)', status: 'COMPLETED', conclusion: 'FAILURE', workflowName: 'CI', detailsUrl: 'https://ci.example/run/20' }
    ]
  });
  const result = await runCli(
    ['verify', 'import-ci', root, '--id', 'story-ci', '--pr', '300', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );
  assert.equal(result.exitCode, 0);
  assert.ok(!result.result.imported.some((item) => item.status === 'pass'), 'failing check must not be imported as pass');
  const failures = result.result.failures ?? [];
  assert.ok(failures.some((item) => item.check === 'test (20)'), 'failing check must be reported as a failure');
});

test('import-ci reports pending checks as incomplete without recording', async () => {
  const root = await setupRepo();
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const gh = await makeFakeGhChecks({
    url: 'https://github.example/unson/vibepro/pull/300',
    headRefName: 'feature/ci',
    headRefOid: headSha,
    statusCheckRollup: [
      { name: 'test (20)', status: 'IN_PROGRESS', conclusion: '', workflowName: 'CI', detailsUrl: 'https://ci.example/run/20' }
    ]
  });
  const result = await runCli(
    ['verify', 'import-ci', root, '--id', 'story-ci', '--pr', '300', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.imported.length, 0);
  assert.ok((result.result.pending ?? []).some((item) => item.check === 'test (20)'));
});

test('import-ci honors --check name=kind override mapping', async () => {
  const root = await setupRepo();
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const gh = await makeFakeGhChecks({
    url: 'https://github.example/unson/vibepro/pull/300',
    headRefName: 'feature/ci',
    headRefOid: headSha,
    statusCheckRollup: [
      { name: 'e2e-suite', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI', detailsUrl: 'https://ci.example/run/e2e' }
    ]
  });
  const result = await runCli(
    ['verify', 'import-ci', root, '--id', 'story-ci', '--pr', '300', '--check', 'e2e-suite=e2e', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );
  assert.equal(result.exitCode, 0);
  const evidence = await readJson(evidencePath(root));
  assert.ok(evidence.commands.some((cmd) => cmd.kind === 'e2e' && cmd.status === 'pass'));
});
