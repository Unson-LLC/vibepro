import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { buildArtifactRemediationCommands } from '../src/pr-manager.js';
import {
  classifyRunnerArtifactProbe,
  recordVerificationEvidence,
  runnerArtifactDerivedObservationKeys
} from '../src/verification-evidence.js';
import {
  COMPUTED_OBSERVATION_KEYS,
  buildRunWarnings,
  compareWorktreeSamples,
  runArtifactProbeDocument,
  runnerArtifactCheckShape
} from '../src/verification-runner.js';

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

test('verify run records a parse failure as an unparsed count rather than inventing one', async () => {
  const root = await setupRepo();
  // Output that is not TAP and not the node spec summary, including lines that look like
  // a summary but are malformed: the parser must decline rather than half-read them.
  await writeFile(
    path.join(root, 'Makefile'),
    'all:\n\t@echo "Ran the checks"\n\t@echo "# tests"\n\t@echo "i pass many"\n\t@echo "{\\"tests\\": 42"\n'
  );
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'build',
    '--target', 'Makefile',
    '--', 'make'
  ]);
  assert.equal(result.result.status, 'pass');
  assert.equal(result.result.output_metrics, 'none');
  assert.equal(result.result.counts, null);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'build');
  // No fabricated counts land in the observation.
  assert.equal(record.observation.values.tests, undefined);
  assert.equal(record.observation.values.pass, undefined);
  assert.ok(record.warnings.some((warning) => warning.id === 'verification_run_counts_not_parsed'));
  assert.ok(!record.warnings.some((warning) => warning.id === 'verification_run_produced_no_output'));
});

test('verify run records a timeout kill as a failing run and names the timeout as its cause', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, 'Makefile'), 'all:\n\t@sleep 30\n');
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'build',
    '--target', 'Makefile', '--timeout-ms', '700',
    '--', 'make'
  ]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.status, 'fail');
  assert.equal(result.result.timed_out, true);
  assert.equal(result.result.output_limit_exceeded, false);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'build');
  assert.equal(record.status, 'fail');
  const warning = record.warnings.find((item) => item.id === 'verification_run_timed_out');
  assert.ok(warning);
  assert.match(warning.reason, /killed after 700ms/);
  assert.ok(!record.warnings.some((item) => item.id === 'verification_run_output_limit_exceeded'));
  const artifact = await readJson(runArtifactPath(root, 'build'));
  assert.equal(artifact.run.timed_out, true);
  assert.equal(artifact.run.timeout_ms, 700);
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

test('every value the runner computes is protected from agent input', async () => {
  const root = await setupRepo();
  await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  const artifact = await readJson(runArtifactPath(root, 'unit'));
  // The structural guarantee: a computed key outside the protected set would be
  // overwritable by --observed, since CLI observations win the merge.
  const unprotected = Object.keys(artifact.observed).filter((key) => !COMPUTED_OBSERVATION_KEYS.includes(key));
  assert.deepEqual(unprotected, []);

  // And the integrity anchors specifically: an agent value for them is discarded.
  const attacked = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--observed', 'output_sha256=0000000000000000000000000000000000000000000000000000000000000000',
    '--observed', 'worktree_sha256_after=fabricated',
    '--observed', 'log_truncated=false',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'unit');
  assert.notEqual(record.observation.values.output_sha256, '0'.repeat(64));
  assert.notEqual(record.observation.values.worktree_sha256_after, 'fabricated');
  assert.deepEqual(
    record.observation_overrides.map((item) => item.key).sort(),
    ['log_truncated', 'output_sha256', 'worktree_sha256_after']
  );
  assert.ok(attacked.result.warnings.some((warning) => warning.id === 'verification_observation_overridden'));
});

test('verify run rejects a kind-mismatched command before executing it, leaving the previous run artifact intact', async () => {
  const root = await setupRepo();
  await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  const before = await readJson(runArtifactPath(root, 'unit'));
  const beforeLog = await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs', 'unit.log'), 'utf8');

  const rejected = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'Makefile',
    '--', 'git', 'status'
  ]);
  assert.notEqual(rejected.exitCode, 0);
  assert.match(rejected.stderr, /verify run --kind unit/);
  // The recorded artifact and log the previous record points at are untouched.
  assert.deepEqual(await readJson(runArtifactPath(root, 'unit')), before);
  assert.equal(await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs', 'unit.log'), 'utf8'), beforeLog);
});

test('verify run surfaces the warnings it computed on its human summary', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, 'Makefile'), 'all:\n\t@sleep 30\n');
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'build',
    '--target', 'Makefile', '--timeout-ms', '700',
    '--', 'make'
  ]);
  // A killed run and a failing suite both print `status: fail`; only the warning separates them.
  assert.match(result.stdout, /## Warnings/);
  assert.match(result.stdout, /verification_run_timed_out/);
  assert.ok(result.result.warnings.some((warning) => warning.id === 'verification_run_timed_out'));
});

test('verify run rejects a bare runner invocation up front instead of after overwriting the previous run', async () => {
  const root = await setupRepo();
  await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  const before = await readJson(runArtifactPath(root, 'unit'));
  const beforeLog = await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs', 'unit.log'), 'utf8');
  const beforeEvidence = await readJson(evidencePath(root));

  // The runner's own artifact always parses as generic_status, so the record path can never
  // accept a bare `node --test`; the pre-flight must refuse it rather than grant an
  // allowance the record path will revoke after the command has already run.
  const rejected = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test'
  ]);
  assert.notEqual(rejected.exitCode, 0);
  assert.match(rejected.stderr, /verify run --kind unit/);
  assert.ok(!/verify record --kind/.test(rejected.stderr));
  assert.deepEqual(await readJson(runArtifactPath(root, 'unit')), before);
  assert.equal(await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs', 'unit.log'), 'utf8'), beforeLog);
  assert.equal((await readJson(evidencePath(root))).updated_at, beforeEvidence.updated_at);
});

test('verify run restores the previous run artifact when the record does not commit', async () => {
  const root = await setupRepo();
  await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  const before = await readJson(runArtifactPath(root, 'unit'));
  const beforeLog = await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs', 'unit.log'), 'utf8');

  // Hold the evidence lock so recordVerificationEvidence throws after the run has executed.
  const lockPath = path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-evidence.json.lock');
  await mkdir(lockPath, { recursive: true });
  try {
    const result = await cli([
      'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
      '--target', 'tests/sample.test.js',
      '--observed', 'note=second run',
      '--', 'node', '--test', 'tests/sample.test.js'
    ]);
    assert.notEqual(result.exitCode, 0);
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
  // The artifact and log the surviving record points at describe the run that was recorded.
  assert.deepEqual(await readJson(runArtifactPath(root, 'unit')), before);
  assert.equal(await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs', 'unit.log'), 'utf8'), beforeLog);
});

test('verify run reports an output-buffer kill as its own cause, not as a timeout', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, 'Makefile'), 'all:\n\t@node -e "process.stdout.write(\'x\'.repeat(200000))"\n');
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'build',
    '--target', 'Makefile', '--max-output-bytes', '4096',
    '--', 'make'
  ]);
  assert.equal(result.result.status, 'fail');
  assert.equal(result.result.output_limit_exceeded, true);
  assert.equal(result.result.timed_out, false);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'build');
  assert.ok(record.warnings.some((warning) => warning.id === 'verification_run_output_limit_exceeded'));
  assert.ok(!record.warnings.some((warning) => warning.id === 'verification_run_timed_out'));
});

test('a partially sampled worktree does not report a change that did not happen, and says so', () => {
  const complete = (status, diff) => ({ worktree: `${status}:${diff}`, status, diff, complete: true });
  const partial = (status) => ({ worktree: `${status}:none`, status, diff: null, complete: false });

  // The case the round-4 combined-hash comparison got wrong: the two samples used different
  // sampling modes, so their combined fingerprints differ while the tree did not change.
  const mixed = compareWorktreeSamples(complete('s1', 'd1'), partial('s1'));
  assert.equal(mixed.changed, false, 'a mode difference is not a tree change');
  assert.equal(mixed.sampled, true);
  assert.equal(mixed.complete, false, 'the sampling gap is reported separately from the verdict');

  // A status-line difference is a real change even when one sample was partial.
  assert.equal(compareWorktreeSamples(complete('s1', 'd1'), partial('s2')).changed, true);
  // A diff-only difference counts only when both samples captured the diff.
  assert.equal(compareWorktreeSamples(complete('s1', 'd1'), complete('s1', 'd2')).changed, true);
  assert.equal(compareWorktreeSamples(complete('s1', 'd1'), complete('s1', 'd1')).changed, false);
  // A sample that could not be taken at all is neither a change nor an unchanged tree.
  assert.deepEqual(
    compareWorktreeSamples({ worktree: null, status: null, diff: null, complete: false }, complete('s1', 'd1')),
    { sampled: false, complete: false, changed: false }
  );
});

test('a fully sampled run records completeness and carries no sampling caveat', async () => {
  const root = await setupRepo();
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  // This run samples completely, so the caveat must be absent and completeness recorded.
  assert.equal(result.result.tree_mutated_during_run, false);
  assert.equal(result.result.worktree_sampled, true);
  const artifact = await readJson(runArtifactPath(root, 'unit'));
  assert.equal(artifact.run.worktree_sampling_complete, true);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'unit');
  assert.equal(record.observation.values.worktree_sampling_complete, 'true');
  assert.ok(!record.warnings.some((warning) => warning.id === 'verification_worktree_sampling_partial'));
  assert.ok(!record.warnings.some((warning) => warning.id === 'verification_worktree_not_sampled'));
});

test('verify run records the declared limits whether or not they were hit', async () => {
  const root = await setupRepo();
  await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--timeout-ms', '600000', '--max-output-bytes', '1048576',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  const artifact = await readJson(runArtifactPath(root, 'unit'));
  assert.equal(artifact.run.timeout_ms, 600000);
  assert.equal(artifact.run.max_output_bytes, 1048576);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'unit');
  // A run capped low enough to matter leaves a trace even when it finished inside the cap.
  assert.equal(record.observation.values.max_output_bytes, '1048576');
  assert.equal(record.observation.values.timeout_ms, '600000');
  assert.equal(record.observation.values.timed_out, 'false');
  assert.equal(record.observation.values.output_limit_exceeded, 'false');
  assert.equal(record.observation.values.harness_env_removed, 'NODE_TEST_CONTEXT');
});

test('an agent cannot shadow a computed run fact that lives outside the observation payload', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, 'Makefile'), 'all:\n\t@sleep 30\n');
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'build',
    '--target', 'Makefile', '--timeout-ms', '700',
    '--observed', 'timed_out=false', '--observed', 'output_metrics=tap',
    '--', 'make'
  ]);
  assert.equal(result.result.timed_out, true);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'build');
  assert.equal(record.observation.values.timed_out, 'true');
  assert.equal(record.observation.values.output_metrics, 'none');
  assert.deepEqual(
    record.observation_overrides.map((item) => item.key).sort(),
    ['output_metrics', 'timed_out']
  );
});

test('a partial worktree sample emits its caveat even when a change was detected', () => {
  const ids = (warnings) => warnings.map((warning) => warning.id);
  // Every fact is required, so a caller that forgets one loses no caveat silently.
  const facts = (overrides) => ({
    treeMutated: false, headMoved: false, worktreeChanged: false,
    worktreeSampled: true, worktreeSamplingComplete: true,
    status: 'pass', outputEmpty: false, runCounts: { tests: 5 },
    timedOut: false, outputLimitExceeded: false, overrides: [],
    timeoutMs: 1000, maxOutputBytes: 1000, ...overrides
  });
  assert.throws(() => buildRunWarnings({ ...facts(), worktreeSampled: undefined }), /missing: worktreeSampled/);

  // Round 4 suppressed the caveat whenever a change was reported, which is exactly the
  // case where the reader most needs to know the sample was incomplete.
  const partialAndChanged = buildRunWarnings(facts({
    treeMutated: true, worktreeChanged: true, worktreeSamplingComplete: false
  }));
  assert.ok(ids(partialAndChanged).includes('verification_worktree_sampling_partial'));
  assert.ok(ids(partialAndChanged).includes('verification_tree_mutated_during_run'));

  const partialAndUnchanged = buildRunWarnings(facts({ worktreeSamplingComplete: false }));
  assert.ok(ids(partialAndUnchanged).includes('verification_worktree_sampling_partial'));

  const notSampled = buildRunWarnings(facts({ worktreeSampled: false, worktreeSamplingComplete: false }));
  assert.ok(ids(notSampled).includes('verification_worktree_not_sampled'));
  assert.ok(!ids(notSampled).includes('verification_worktree_sampling_partial'));

  assert.deepEqual(ids(buildRunWarnings(facts())), []);
});

test('verify run restores the previous run log when the artifact write fails', async () => {
  const root = await setupRepo();
  await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  const artifactFile = runArtifactPath(root, 'unit');
  const logFile = path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs', 'unit.log');
  const beforeArtifact = await readFile(artifactFile, 'utf8');
  const beforeLog = await readFile(logFile, 'utf8');

  // A second suite so run 2's output is unmistakably different from run 1's; otherwise a
  // "log unchanged" assertion could pass because the two logs happen to match.
  await writeFile(path.join(root, 'tests', 'extra.test.js'), `import test from 'node:test';
import assert from 'node:assert/strict';
test('extra one', () => assert.ok(true));
test('extra two', () => assert.ok(true));
`);
  assert.match(beforeLog, /tests 2/);

  // Read-only, not a directory: the snapshot can still read it, so the failure lands in
  // the artifact write — the window the previous fixture never reached.
  await chmod(artifactFile, 0o444);
  try {
    const result = await cli([
      'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
      '--target', 'tests/sample.test.js',
      '--scenario', 'second run whose artifact write fails',
      '--', 'node', '--test', 'tests/sample.test.js', 'tests/extra.test.js'
    ]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /EACCES|permission denied/);
  } finally {
    await chmod(artifactFile, 0o644);
  }
  // Both files the surviving record points at describe the run that was recorded: the
  // 4-test run 2 left no trace, and the log is byte-identical to run 1's.
  assert.equal(await readFile(artifactFile, 'utf8'), beforeArtifact);
  const restoredLog = await readFile(logFile, 'utf8');
  assert.equal(restoredLog, beforeLog);
  assert.match(restoredLog, /tests 2/);
  assert.ok(!/tests 4/.test(restoredLog), 'run 2 output must not survive in the restored log');
});

test('a restore that cannot put every file back reports it instead of failing silently', async () => {
  const root = await setupRepo();
  await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  const runsDir = path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs');
  const artifactFile = runArtifactPath(root, 'unit');
  await chmod(artifactFile, 0o444);
  // The directory is read-only too, so the restore write itself cannot succeed: the
  // operator must be told the run files no longer match the record.
  await chmod(runsDir, 0o555);
  try {
    const result = await cli([
      'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
      '--target', 'tests/sample.test.js',
      '--', 'node', '--test', 'tests/sample.test.js'
    ]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /could not be restored after this failure/);
    assert.match(result.stderr, /no longer/);
  } finally {
    await chmod(runsDir, 0o755);
    await chmod(artifactFile, 0o644);
  }
});

test('the reproduced round-5 attack stays closed: a computed verdict cannot be shadowed', async () => {
  const root = await setupRepo({ mutatesTree: true });
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    // The exact attack round 5 reproduced, plus the two path facts round 6 added.
    '--observed', 'tree_mutated_during_run=false',
    '--observed', 'head_moved_during_run=false',
    '--observed', 'run_artifact=somewhere-else.json',
    '--observed', 'run_log=somewhere-else.log',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  assert.equal(result.result.tree_mutated_during_run, true);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'unit');
  assert.equal(record.observation.values.tree_mutated_during_run, 'true');
  assert.equal(record.observation.values.head_moved_during_run, 'true');
  assert.match(record.observation.values.run_artifact, /verification-runs\/unit\.json$/);
  assert.match(record.observation.values.run_log, /verification-runs\/unit\.log$/);
  assert.deepEqual(
    record.observation_overrides.map((item) => item.key).sort(),
    ['head_moved_during_run', 'run_artifact', 'run_log', 'tree_mutated_during_run']
  );
  assert.ok(record.warnings.some((warning) => warning.id === 'verification_observation_overridden'));
  // computed_observation must mirror the asserted object, never compute a fact of its own.
  assert.equal(record.computed_observation.tree_mutated_during_run, true);
  assert.equal(record.computed_observation.run_artifact, record.observation.values.run_artifact);
  for (const key of Object.keys(record.computed_observation.values)) {
    assert.ok(COMPUTED_OBSERVATION_KEYS.includes(key), `${key} must be protected`);
  }
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

// Round 8, gate_evidence: the protection assert only ever checked the values this module
// computes. observation.values has a second producer — the extractor that lifts values back
// out of the written artifact — and a key added there was agent-writable with this module
// silent. These three tests bind the closure to the key set rather than to the call sites.

test('the artifact-derived observation keys are all inside the protected key set', async () => {
  const derived = runnerArtifactDerivedObservationKeys(runArtifactProbeDocument());
  assert.ok(derived.length > 0, 'the extractor must lift at least one top-level key');
  for (const key of derived) {
    assert.ok(
      COMPUTED_OBSERVATION_KEYS.includes(key),
      `${key} is lifted from the run artifact into observation.values but is not protected`
    );
  }
});

// Round 9, gate_evidence: the probe used to restate the artifact shape (`{format:
// 'generic_status'}` plus a hand-written body), so a future artifact field that reroutes the
// record path's format detection would change what is lifted while the probe kept reporting
// the old key set. The probe is now the real writer's output classified by the real parser.
test('the derivation follows the real artifact shape, so a format reroute changes what it reports', async () => {
  const probe = runArtifactProbeDocument();
  assert.equal(probe.producer, 'vibepro verify run', 'the probe must be the document the runner writes');
  assert.deepEqual(runnerArtifactDerivedObservationKeys(probe).sort(), ['exit_code', 'status']);
  assert.equal(classifyRunnerArtifactProbe(probe).format, 'generic_status');

  // A `success` flag added to the artifact reroutes detection to the vitest/jest branch, which
  // lifts a different, unprotected key set. The derivation reports that; a restated probe could not.
  const rerouted = classifyRunnerArtifactProbe({ ...probe, success: true });
  assert.equal(rerouted.format, 'vitest_jest');
  assert.ok(
    rerouted.derivedKeys.some((key) => !COMPUTED_OBSERVATION_KEYS.includes(key)),
    'a rerouted artifact must surface keys the protected set does not cover, so the assert fires'
  );

  // The same derivation drives the pre-flight artifact_check shape, so the check the runner
  // applies before executing cannot drift from the format the record path will actually see.
  assert.equal(runnerArtifactCheckShape().format, classifyRunnerArtifactProbe(probe).format);
});

test('verify run records the artifact-derived key set its protection assert checked', async () => {
  const root = await setupRepo();
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  assert.equal(result.exitCode, 0);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'unit');
  // The assert's result is carried onto the record, so removing the call site is a failure
  // rather than a silently dropped check.
  const derived = record.computed_observation.artifact_derived_keys;
  assert.deepEqual([...derived].sort(), ['exit_code', 'status']);
  for (const key of derived) {
    assert.ok(COMPUTED_OBSERVATION_KEYS.includes(key), `${key} must be protected`);
  }
});

// Round 9, gate_evidence: the forbidden-key rule was consulted in the --observed parser only.
// observation.values has a second caller-reachable producer — the values lifted back out of
// the artifact the caller chose — and it is the same route the genuine runner uses, so a
// caller-authored artifact put `runner_direct` onto a self_reported record unopposed.
test('a caller-written artifact cannot put the runner trust marker on a self-reported record', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, 'forged.json'), JSON.stringify({
    status: 'pass',
    exit_code: 0,
    observed: { evidence_source: 'runner_direct', tests: '52' }
  }));
  const result = await cli([
    'verify', 'record', root, '--id', STORY_ID, '--kind', 'unit', '--status', 'pass',
    '--command', 'node --test tests/sample.test.js',
    '--target', 'tests/sample.test.js',
    '--artifact', 'forged.json'
  ]);
  assert.equal(result.exitCode, 0);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'unit');
  assert.equal(record.evidence_source, 'self_reported');
  assert.equal(record.observation.values.evidence_source, undefined);
  assert.equal(record.artifact_observed_values.evidence_source, undefined);
  // Lifting arbitrary observed keys out of an artifact stays supported; only the key that
  // states how the record was produced is filtered.
  assert.equal(record.observation.values.tests, '52');
  const rejection = record.warnings.find((item) => item.id === 'verification_observation_caller_key_rejected');
  assert.ok(rejection, 'the strip must be visible on the record, not silent');
  assert.match(rejection.reason, /evidence_source="runner_direct"/);
  assert.match(rejection.reason, /self_reported/);
});

test('the runner keeps lifting its own computed evidence_source through the same extractor', async () => {
  const root = await setupRepo();
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  assert.equal(result.exitCode, 0);
  const record = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'unit');
  // Same route the forgery took; the receipt is what separates them.
  assert.equal(record.observation.values.evidence_source, 'runner_direct');
  assert.equal(record.evidence_source, 'runner_direct');
  assert.equal(
    (record.warnings ?? []).some((item) => item.id === 'verification_observation_caller_key_rejected'),
    false,
    'the receipt-backed path must not report its own computed key as caller input'
  );
});

// Round 9, gate_evidence: with evidence_source now on every runner-produced record's
// observation.values, the stale-evidence remediation command reconstructed it as
// `--observed evidence_source=runner_direct` — which `verify record` rejects, so the command
// pr prepare tells an operator to run could not run.
test('the emitted stale-evidence remediation command is runnable against a runner-produced record', async () => {
  const root = await setupRepo();
  const run = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--scenario', 'sample unit suite passes',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  assert.equal(run.exitCode, 0);
  const recorded = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'unit');
  assert.equal(recorded.observation.values.evidence_source, 'runner_direct', 'the fixture must carry the key');

  const [recordCommand] = buildArtifactRemediationCommands({
    artifact_type: 'verification_command',
    kind: recorded.kind,
    command: recorded.command,
    summary: recorded.summary,
    artifact: recorded.artifact,
    observation: recorded.observation,
    content_binding: recorded.content_binding
  }, STORY_ID);
  assert.ok(!recordCommand.includes('evidence_source'), `remediation command must not replay a rejected key: ${recordCommand}`);
  assert.match(recordCommand, /--observed exit_code=0/);

  // Executed, not only inspected: "unrunnable" is the finding, so the emitted string is run.
  const executable = recordCommand.replace(
    /^vibepro\b/,
    `${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve('bin/vibepro.js'))}`
  );
  await execFileAsync('/bin/sh', ['-c', executable], { cwd: root, encoding: 'utf8' });
  const rerecorded = (await readJson(evidencePath(root))).commands.find((item) => item.kind === 'unit');
  assert.equal(rerecorded.evidence_source, 'self_reported', 'replaying by hand must not inherit the runner trust marker');
  assert.equal(rerecorded.observation.values.evidence_source, undefined);
});

test('status and evidence_source are computed facts, not hand-listed exceptions', async () => {
  const root = await setupRepo();
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  assert.equal(result.exitCode, 0);
  const artifact = await readJson(runArtifactPath(root, 'unit'));
  // Both keys travel in the object assertComputedKeysProtected checks, so a future change
  // that stops computing them fails the assert instead of silently reopening the hole.
  assert.equal(artifact.observed.status, 'pass');
  assert.equal(artifact.observed.evidence_source, 'runner_direct');
  const evidence = await readJson(evidencePath(root));
  const record = evidence.commands.find((entry) => entry.kind === 'unit');
  assert.equal(record.observation.values.evidence_source, 'runner_direct');
  assert.ok(record.computed_observation.computed_keys.includes('status'));
  assert.ok(record.computed_observation.computed_keys.includes('evidence_source'));
});

test('a discarded agent status carries the real computed value, not null', async () => {
  const root = await setupRepo({ passing: false });
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/sample.test.js',
    '--observed', 'status=pass',
    '--', 'node', '--test', 'tests/sample.test.js'
  ]);
  assert.notEqual(result.exitCode, 0);
  const evidence = await readJson(evidencePath(root));
  const record = evidence.commands.find((entry) => entry.kind === 'unit');
  assert.equal(record.status, 'fail');
  const override = (record.observation_overrides ?? []).find((entry) => entry.key === 'status');
  assert.ok(override, 'the discarded status must be retained as an override');
  assert.equal(override.agent_value, 'pass');
  // Before this fix the entry read computed_value: null while the record said fail, so the
  // diff a reviewer reads under-reported the computed side for exactly this key.
  assert.equal(override.computed_value, 'fail');
});

test('verify record refuses to let a caller write the evidence_source trust marker', async () => {
  const root = await setupRepo();
  const result = await cli([
    'verify', 'record', root, '--id', STORY_ID, '--kind', 'unit', '--status', 'pass',
    '--command', 'node --test tests/sample.test.js',
    '--target', 'tests/sample.test.js',
    '--observed', 'evidence_source=runner_direct'
  ]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /cannot set evidence_source/);
});

// Round 8, gate_evidence: the typecheck evidence this Story records ran `npm run typecheck`,
// which was `node --check bin/vibepro.js && node --check src/*.js`. `node --check` treats
// only its first positional as the entry point and ignores the rest, so the run checked two
// files out of 143 and none of the five this Story changes. The recorded evidence proved a
// command exited 0, not that the changed code parses. These two tests bind both halves: the
// semantics that made it vacuous, and the script form that no longer relies on them.

test('node --check ignores every file after the first, so a glob form checks only one', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-typecheck-form-'));
  await writeFile(path.join(root, 'a-good.js'), 'export const a = 1;\n', 'utf8');
  await writeFile(path.join(root, 'b-broken.js'), 'const x = ;\n', 'utf8');

  // The old form: the broken file is second, and the check passes anyway.
  const globForm = await execFileAsync('sh', ['-c', 'node --check a-good.js b-broken.js'], { cwd: root })
    .then(() => 0)
    .catch((error) => error.code ?? 1);
  assert.equal(globForm, 0, 'node --check must be shown to ignore the second file');

  // The loop form: the same broken file is found.
  const loopForm = await execFileAsync('sh', ['-c', 'for f in a-good.js b-broken.js; do node --check "$f" || exit 1; done'], { cwd: root })
    .then(() => 0)
    .catch((error) => error.code ?? 1);
  assert.equal(loopForm, 1, 'the per-file loop must reject a broken file in any position');

  await rm(root, { recursive: true, force: true });
});

test('the typecheck script checks every file rather than only the glob head', async () => {
  const manifest = await readJson(path.join(process.cwd(), 'package.json'));
  const script = manifest.scripts.typecheck;
  // The real script string is executed against a fixture tree rather than pattern-matched,
  // so this binds the behaviour (every file is checked) and not one spelling of the fix.
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-typecheck-script-'));
  await mkdir(path.join(root, 'bin'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'bin', 'vibepro.js'), 'export const entry = 1;\n', 'utf8');
  await writeFile(path.join(root, 'src', 'a-good.js'), 'export const a = 1;\n', 'utf8');

  const run = async () => execFileAsync('sh', ['-c', script], { cwd: root })
    .then(() => 0)
    .catch((error) => error.code ?? 1);

  assert.equal(await run(), 0, 'a clean fixture tree must pass');

  // Broken, and deliberately not the first entry of the glob.
  await writeFile(path.join(root, 'src', 'z-broken.js'), 'const x = ;\n', 'utf8');
  assert.equal(await run(), 1, 'a broken file after the first must fail the script');

  await rm(root, { recursive: true, force: true });
});
