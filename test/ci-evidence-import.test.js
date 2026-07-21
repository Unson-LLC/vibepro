import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { readValidationSequence, recordValidationPhase, writeValidationSequence } from '../src/validation-sequencing.js';

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
  await mkdir(path.join(root, '.github'), { recursive: true });
  await writeFile(path.join(root, '.github', 'vibepro-ci-coverage.json'), JSON.stringify({
    schema_version: '0.1.0',
    coverage: [
      { check: 'test (20)', workflow: 'CI', command: 'node --test', test_fingerprint: 'suite-v1' },
      { check: 'test (20)', workflow: 'CI', command: 'node --test test/security-boundary.test.js', test_fingerprint: 'security-v2' }
    ]
  }, null, 2));
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

async function writePhaseEvidence(root, headSha, command) {
  const target = path.join(root, '.vibepro', 'pr', 'story-ci', 'verification-evidence.json');
  await mkdir(path.dirname(target), { recursive: true });
  const fingerprint = command === 'node --test' ? 'suite-v1' : 'security-v2';
  const nativeCommand = (kind, phase, extra = {}) => ({
    kind, status: 'pass', command, executed_at: new Date().toISOString(),
    git_context: { head_sha: headSha }, artifact_check: { status: 'verified', format: 'vitest_jest' },
    artifact_observed_values: { numTotalTests: '1' },
    observation_check: { status: 'recorded' }, content_binding: { schema_version: '0.1.0', recorded_head_sha: headSha },
    observation: { values: { test_fingerprint: fingerprint, validation_phase: phase, ...extra } }
  });
  await writeFile(target, JSON.stringify({
    schema_version: '0.1.0', story_id: 'story-ci', commands: [
      nativeCommand('unit', 'targeted_validation'),
      nativeCommand('integration', 'preflight_review', { review_role: 'boundary_reviewer', review_surface: 'core_workflow_state' })
    ]
  }));
}

async function advanceSequenceToFreeze(root, headSha, command, fingerprint, sequenceArgs) {
  assert.equal((await runCli([...sequenceArgs, '--phase', 'targeted_validation'])).exitCode, 0);
  let state = await readValidationSequence(root, 'story-ci');
  state = recordValidationPhase(state, {
    phase: 'preflight_review', headSha, verificationCommand: command, testFingerprint: fingerprint,
    evidence: '.vibepro/reviews/story-ci/architecture_spec/review-result-workflow_reviewer.json',
    evidenceValidation: { status: 'verified' },
    reviewProvenance: { role: 'workflow_reviewer', status: 'pass' }
  });
  await writeValidationSequence(root, state);
  assert.equal((await runCli([...sequenceArgs, '--phase', 'code_frozen'])).exitCode, 0);
}

test('import-ci records successful CI checks as head-bound verification evidence', async () => {
  const root = await setupRepo();
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const gh = await makeFakeGhChecks(rollup(headSha));
  const result = await runCli(
    ['verify', 'import-ci', root, '--id', 'story-ci', '--pr', '300', '--coverage', 'test (20)=node --test::suite-v1', '--json'],
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

test('import-ci public path records frozen node test coverage from realistic CI checks', async () => {
  const root = await setupRepo();
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await writePhaseEvidence(root, headSha, 'node --test');
  const sequenceArgs = ['sequence', 'record', root, '--id', 'story-ci', '--head', headSha, '--command', 'node --test', '--test-fingerprint', 'suite-v1', '--evidence', '.vibepro/pr/story-ci/verification-evidence.json', '--json'];
  assert.equal((await runCli(['sequence', 'plan', root, '--id', 'story-ci', '--head', headSha, '--risk-profile', 'workflow_heavy', '--surface', 'core_workflow_state', '--command', 'node --test', '--test-fingerprint', 'suite-v1', '--json'])).exitCode, 0);
  await advanceSequenceToFreeze(root, headSha, 'node --test', 'suite-v1', sequenceArgs);

  const gh = await makeFakeGhChecks(rollup(headSha));
  const result = await runCli(
    ['verify', 'import-ci', root, '--id', 'story-ci', '--pr', '300', '--coverage', 'test (20)=node --test::suite-v1', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.validation_sequence.recorded, true);
  const persisted = await readValidationSequence(root, 'story-ci');
  assert.equal(persisted.phases.expensive_verification.status, 'passed');
  assert.equal(persisted.phases.expensive_verification.source, 'ci_import');
  assert.equal(persisted.phases.expensive_verification.binding.verification_command, 'node --test');
});

test('import-ci does not treat an unrelated same-kind check as frozen command coverage', async () => {
  const root = await setupRepo();
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await writePhaseEvidence(root, headSha, 'node --test test/security-boundary.test.js');
  const sequenceArgs = ['sequence', 'record', root, '--id', 'story-ci', '--head', headSha, '--command', 'node --test test/security-boundary.test.js', '--test-fingerprint', 'security-v2', '--evidence', '.vibepro/pr/story-ci/verification-evidence.json', '--json'];
  await runCli(['sequence', 'plan', root, '--id', 'story-ci', '--head', headSha, '--risk-profile', 'workflow_heavy', '--surface', 'auth_boundary', '--command', 'node --test test/security-boundary.test.js', '--test-fingerprint', 'security-v2', '--json']);
  await advanceSequenceToFreeze(root, headSha, 'node --test test/security-boundary.test.js', 'security-v2', sequenceArgs);
  const gh = await makeFakeGhChecks(rollup(headSha));
  const result = await runCli(
    ['verify', 'import-ci', root, '--id', 'story-ci', '--pr', '300', '--coverage', 'test (20)=node --test::suite-v1', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );
  assert.equal(result.result.validation_sequence.recorded, false);
  assert.match(result.result.validation_sequence.reason, /proves frozen verification command/);
  assert.equal((await readValidationSequence(root, 'story-ci')).phases.expensive_verification.status, 'pending');
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

test('import-ci rejects caller-declared coverage absent from the committed HEAD contract', async () => {
  const root = await setupRepo();
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const gh = await makeFakeGhChecks(rollup(headSha));
  const result = await runCli(
    ['verify', 'import-ci', root, '--id', 'story-ci', '--pr', '300', '--coverage', 'test (20)=npm run imaginary::caller-claim', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );
  assert.equal(result.exitCode, 1);
});

test('import-ci does not grant coverage to a same-name check from another workflow', async () => {
  const root = await setupRepo();
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const gh = await makeFakeGhChecks({
    ...rollup(headSha),
    statusCheckRollup: [
      { name: 'test (20)', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'Untrusted', detailsUrl: 'https://ci.example/untrusted/20' }
    ]
  });
  const result = await runCli(
    ['verify', 'import-ci', root, '--id', 'story-ci', '--pr', '300', '--coverage', 'test (20)=node --test::suite-v1', '--json'],
    { env: { ...process.env, PATH: `${gh.binDir}${path.delimiter}${process.env.PATH}` } }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.imported[0].covered_command, undefined);
});
