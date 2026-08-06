import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import {
  buildValidationSequencePlan,
  createValidationSequenceState,
  fingerprintValidationCommand,
  readValidationSequence,
  recordValidationPhase,
  validateValidationPhaseEvidence,
  writeValidationSequence
} from '../src/validation-sequencing.js';

// `vibepro sequence` was removed as a standalone CLI surface (review lifecycle
// accounting retirement); these helpers drive validation-sequencing.js
// directly the way the old CLI command did, since ci-evidence.js still
// consumes the module internally.
async function sequencePlan(root, storyId, headSha, { riskProfile = 'light', riskSurfaces = [], command = null, testFingerprint = null } = {}) {
  const plan = buildValidationSequencePlan({ storyId, riskProfile, riskSurfaces });
  const state = createValidationSequenceState({
    plan,
    headSha,
    testFingerprint: testFingerprint ?? (command ? fingerprintValidationCommand(command, []) : null),
    verificationCommand: command
  });
  await writeValidationSequence(root, state);
  return state;
}

async function sequenceRecordTargetedValidation(root, storyId, headSha, { command, testFingerprint, evidence }) {
  let state = await readValidationSequence(root, storyId);
  const evidenceValidation = await validateValidationPhaseEvidence(root, evidence, {
    storyId,
    phase: 'targeted_validation',
    headSha,
    verificationCommand: command,
    testFingerprint
  });
  state = recordValidationPhase(state, {
    phase: 'targeted_validation',
    status: 'passed',
    headSha,
    testFingerprint,
    verificationCommand: command,
    evidence,
    evidenceValidation,
    source: 'local'
  });
  await writeValidationSequence(root, state);
  return state;
}

async function sequenceRecordCodeFrozen(root, storyId, headSha) {
  let state = await readValidationSequence(root, storyId);
  const proposed = state.proposed_binding ?? {};
  state = recordValidationPhase(state, {
    phase: 'code_frozen',
    status: 'passed',
    headSha,
    testFingerprint: proposed.test_fingerprint,
    verificationCommand: proposed.verification_command,
    source: 'local'
  });
  await writeValidationSequence(root, state);
  return state;
}

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

async function advanceSequenceToFreeze(root, headSha, command, fingerprint) {
  await sequenceRecordTargetedValidation(root, 'story-ci', headSha, {
    command,
    testFingerprint: fingerprint,
    evidence: '.vibepro/pr/story-ci/verification-evidence.json'
  });
  let state = await readValidationSequence(root, 'story-ci');
  state = recordValidationPhase(state, {
    phase: 'preflight_review', headSha, verificationCommand: command, testFingerprint: fingerprint,
    evidence: '.vibepro/reviews/story-ci/architecture_spec/review-result-workflow_reviewer.json',
    evidenceValidation: { status: 'verified' },
    reviewProvenance: { role: 'workflow_reviewer', status: 'pass' }
  });
  await writeValidationSequence(root, state);
  await sequenceRecordCodeFrozen(root, 'story-ci', headSha);
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
  // The import transcribes a completed CI check at the current head, so the record must be
  // marked as computed rather than self-reported.
  assert.equal(integration.evidence_source, 'ci_import');
  assert.equal(integration.computed_observation.producer, 'vibepro verify import-ci');
  assert.equal(integration.computed_observation.values.head_sha, headSha);
  assert.equal(integration.computed_observation.output_metrics, 'ci_check_conclusion');
});

test('import-ci public path records frozen node test coverage from realistic CI checks', async () => {
  const root = await setupRepo();
  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await writePhaseEvidence(root, headSha, 'node --test');
  await sequencePlan(root, 'story-ci', headSha, {
    riskProfile: 'workflow_heavy',
    riskSurfaces: ['core_workflow_state'],
    command: 'node --test',
    testFingerprint: 'suite-v1'
  });
  await advanceSequenceToFreeze(root, headSha, 'node --test', 'suite-v1');

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
  await sequencePlan(root, 'story-ci', headSha, {
    riskProfile: 'workflow_heavy',
    riskSurfaces: ['auth_boundary'],
    command: 'node --test test/security-boundary.test.js',
    testFingerprint: 'security-v2'
  });
  await advanceSequenceToFreeze(root, headSha, 'node --test test/security-boundary.test.js', 'security-v2');
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
