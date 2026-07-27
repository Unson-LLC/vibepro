import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { recordVerificationEvidence } from '../src/verification-evidence.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-test-runner';

async function cli(args) {
  const stderr = [];
  const stdout = [];
  const result = await runCli(args, {
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: (value) => stderr.push(value) }
  });
  return { ...result, stdout: stdout.join(''), stderr: stderr.join('') };
}

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function evidencePath(root) {
  return path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-evidence.json');
}

function runArtifactPath(root, kind) {
  return path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs', `${kind}.json`);
}

async function setupRepo({ passing = true, mutatesTree = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-verify-run-'));
  await mkdir(path.join(root, 'tests'), { recursive: true });
  const body = mutatesTree
    ? `import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test('mutates the tree while running', () => {
  execFileSync('git', ['commit', '--allow-empty', '-m', 'mid-run commit'], { cwd: process.cwd() });
  assert.ok(true);
});
`
    : `import test from 'node:test';
import assert from 'node:assert/strict';
test('first', () => assert.equal(1, 1));
test('second', () => assert.equal(${passing ? '2' : '3'}, 2));
`;
  await writeFile(path.join(root, 'tests', 'sample.test.js'), body);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', STORY_ID, '--title', 'Runner-direct evidence story']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  return root;
}

test('verify run records the executed outcome without accepting agent status input', async () => {
  const root = await setupRepo();
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--scenario', 'sample unit suite passes',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.status, 'pass');
  assert.equal(result.result.exit_code, 0);

  const evidence = await readJson(evidencePath(root));
  const command = evidence.commands.find((item) => item.kind === 'unit');
  assert.equal(command.evidence_source, 'runner_direct');
  assert.equal(command.status, 'pass');
  assert.equal(command.command, 'node --test tests/sample.test.js');
  // Counts and exit code come from the real execution, not from any CLI input.
  assert.equal(command.observation.values.exit_code, '0');
  assert.equal(command.observation.values.tests, '2');
  assert.equal(command.observation.values.pass, '2');
  assert.equal(command.observation.values.fail, '0');
  assert.equal(command.computed_observation.producer, 'vibepro verify run');
  assert.ok(command.computed_observation.computed_keys.includes('exit_code'));
  assert.ok(/^[0-9a-f]{64}$/.test(command.observation.values.stdout_sha256));

  const artifact = await readJson(runArtifactPath(root, 'unit'));
  assert.equal(artifact.evidence_source, 'runner_direct');
  assert.equal(artifact.exit_code, 0);
  assert.deepEqual(artifact.run.argv, ['node', '--test', 'tests/sample.test.js']);
  assert.equal(artifact.run.counts.tests, 2);
  assert.equal(artifact.run.tree_mutated_during_run, false);
  assert.ok(Number.isFinite(artifact.run.duration_ms));

  const log = await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs', 'unit.log'), 'utf8');
  assert.match(log, /tests 2/);
});

test('verify run rejects an agent-supplied --status', async () => {
  const root = await setupRepo();
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit', '--status', 'pass',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /verify run does not accept --status/);
});

test('verify run overwrites agent-supplied computed observations and keeps the discarded diff', async () => {
  const root = await setupRepo({ passing: false });
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--observed', 'exit_code=0', '--observed', 'pass=999', '--observed', 'reviewer_note=looks fine',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  // A failing command is recorded as a failing run and reported as a non-zero CLI exit.
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.status, 'fail');

  const evidence = await readJson(evidencePath(root));
  const command = evidence.commands.find((item) => item.kind === 'unit');
  assert.equal(command.status, 'fail');
  assert.notEqual(command.observation.values.exit_code, '0');
  assert.equal(command.observation.values.pass, '1');
  assert.equal(command.observation.values.fail, '1');
  // Declarations that are not computed by the runner survive untouched.
  assert.equal(command.observation.values.reviewer_note, 'looks fine');

  const overrides = command.observation_overrides;
  assert.deepEqual(overrides.map((item) => item.key).sort(), ['exit_code', 'pass']);
  const exitOverride = overrides.find((item) => item.key === 'exit_code');
  assert.equal(exitOverride.agent_value, '0');
  assert.equal(exitOverride.computed_value, command.observation.values.exit_code);
  const passOverride = overrides.find((item) => item.key === 'pass');
  assert.equal(passOverride.agent_value, '999');
  assert.equal(passOverride.computed_value, '1');
  assert.ok(command.warnings.some((warning) => warning.id === 'verification_observation_overridden'));

  const artifact = await readJson(runArtifactPath(root, 'unit'));
  assert.equal(artifact.status, 'fail');
  assert.equal(artifact.discarded_agent_observations.length, 2);
});

test('verify run records a tree mutated during the run as an append-visible warning', async () => {
  const root = await setupRepo({ mutatesTree: true });
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  assert.equal(result.result.status, 'pass');
  assert.equal(result.result.tree_mutated_during_run, true);
  assert.notEqual(result.result.head_sha_before, result.result.head_sha_after);

  const evidence = await readJson(evidencePath(root));
  const command = evidence.commands.find((item) => item.kind === 'unit');
  assert.equal(command.computed_observation.tree_mutated_during_run, true);
  assert.ok(command.warnings.some((warning) => warning.id === 'verification_tree_mutated_during_run'));
  assert.equal(command.observation.values.head_sha_before, result.result.head_sha_before);
  assert.equal(command.observation.values.head_sha_after, result.result.head_sha_after);
});

test('verify run rerun leaves a real diff in the run artifact', async () => {
  const root = await setupRepo();
  const args = [
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ];
  await cli(args);
  const first = await readJson(runArtifactPath(root, 'unit'));
  await cli(args);
  const second = await readJson(runArtifactPath(root, 'unit'));
  // This is the failure mode the Story is about: an honest rerun whose artifact was
  // byte-identical to the previous one, leaving nothing for a reviewer to check.
  assert.notEqual(first.run.started_at, second.run.started_at);
  assert.notEqual(JSON.stringify(first), JSON.stringify(second));
});

test('verify record stays self-reported and cannot claim a computed evidence source', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, 'status.json'), `${JSON.stringify({ status: 'pass', exit_code: 0 })}\n`);
  await cli([
    'verify', 'record', root, '--id', STORY_ID, '--kind', 'unit', '--status', 'pass',
    '--command', 'node --test tests/sample.test.js',
    '--artifact', 'status.json',
    '--target', 'tests/sample.test.js',
    '--observed', 'exit_code=0'
  ]);
  const evidence = await readJson(evidencePath(root));
  const command = evidence.commands.find((item) => item.kind === 'unit');
  assert.equal(command.evidence_source, 'self_reported');
  assert.equal(command.computed_observation, undefined);

  await assert.rejects(
    recordVerificationEvidence(root, {
      storyId: STORY_ID,
      kind: 'unit',
      status: 'pass',
      command: 'node --test tests/sample.test.js',
      artifact: 'status.json',
      targets: ['tests/sample.test.js'],
      evidenceSource: 'runner_direct'
    }),
    /source is decided by the recording path/
  );
});

test('verify run strips harness env markers that would make a nested runner exit green silently', async () => {
  const root = await setupRepo();
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  // This suite itself runs under node --test, so NODE_TEST_CONTEXT is present in the
  // parent environment; inherited, it makes the child run zero tests and exit 0.
  assert.ok(process.env.NODE_TEST_CONTEXT !== undefined);
  const artifact = await readJson(runArtifactPath(root, 'unit'));
  assert.deepEqual(artifact.run.harness_env_removed, ['NODE_TEST_CONTEXT']);
  assert.equal(result.result.counts.tests, 2);
});

test('verify run warns when a passing command produced no output at all', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, 'Makefile'), 'all:\n\t@true\n');
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'build',
    '--target', 'Makefile',
    '--', 'make'
  ]);
  assert.equal(result.result.status, 'pass');
  assert.equal(result.result.output_metrics, 'none');
  const evidence = await readJson(evidencePath(root));
  const command = evidence.commands.find((item) => item.kind === 'build');
  assert.ok(command.warnings.some((warning) => warning.id === 'verification_run_produced_no_output'));
});

test('verify run records a worktree change during the run even when HEAD does not move', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, 'tests', 'sample.test.js'), `import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
test('edits a tracked file without committing', () => {
  writeFileSync(path.join(process.cwd(), 'index.html'), '<!doctype html><title>Edited mid-run</title>');
  assert.ok(true);
});
`);
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'mutating test']);
  const before = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  const after = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  assert.equal(before, after, 'HEAD must not move in this case');
  assert.equal(result.result.tree_mutated_during_run, true);

  const artifact = await readJson(runArtifactPath(root, 'unit'));
  assert.equal(artifact.run.head_moved_during_run, false);
  assert.equal(artifact.run.worktree_changed_during_run, true);
  assert.notEqual(artifact.run.worktree_sha256_before, artifact.run.worktree_sha256_after);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'unit');
  const warning = record.warnings.find((item) => item.id === 'verification_tree_mutated_during_run');
  assert.ok(warning);
  assert.match(warning.reason, /working tree changed while the command was running/);
});

test('verify run hashes the exact stream the retained log is written from', async () => {
  const root = await setupRepo();
  // A recipe that writes to stderr and exits 0: node --test folds a child's stderr into
  // its own stdout report, so it cannot produce the stdout/stderr split this covers.
  await writeFile(path.join(root, 'Makefile'), 'all:\n\t@echo "a warning on stderr" >&2\n');
  await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'build',
    '--target', 'Makefile',
    '--', 'make'
  ]);
  const artifact = await readJson(runArtifactPath(root, 'build'));
  const log = await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs', 'build.log'), 'utf8');
  assert.match(log, /a warning on stderr/, 'the retained log must include stderr for this case to be meaningful');
  assert.equal(artifact.observed.log_truncated, 'false');
  // The retained log is re-derivable from the recorded hash when it is not truncated.
  assert.equal(createHash('sha256').update(log).digest('hex'), artifact.observed.output_sha256);
  // stdout alone hashes differently, so the two anchors are not interchangeable.
  assert.notEqual(artifact.observed.stdout_sha256, artifact.observed.output_sha256);
});

test('verify run warns when a passing run reports a count that cannot distinguish a real check from an empty file', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, 'tests', 'sample.test.js'), 'export const nothing = true;\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'test file with no tests']);
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  // node --test reports `tests 1 / pass 1` and exits 0 for a file that defines no tests.
  assert.equal(result.result.status, 'pass');
  assert.equal(result.result.counts.tests, 1);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'unit');
  assert.ok(record.warnings.some((warning) => warning.id === 'verification_run_counts_trivial'));
});

test('verify run keeps its computed summary sentence when the agent supplies one', async () => {
  const root = await setupRepo();
  await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--summary', 'everything is completely fine',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'unit');
  assert.match(record.summary, /exit_code=0/);
  assert.match(record.summary, /tests=2 pass=2 fail=0/);
  assert.match(record.summary, /agent summary: everything is completely fine/);
});

test('verify run requires an executable command after the separator', async () => {
  const root = await setupRepo();
  const result = await cli(['verify', 'run', root, '--id', STORY_ID, '--kind', 'unit']);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /requires the command to execute after/);
});

test('verify run rejects a command that does not match the declared kind', async () => {
  const root = await setupRepo();
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'e2e',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /requires a recognized executable e2e check/);
});
