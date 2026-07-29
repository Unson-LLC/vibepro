import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-runner-direct-evidence';

// Acceptance-level replay of the Story's user-visible flow: an agent asks VibePro to
// verify something, and the artifact that comes back describes the execution rather than
// the agent's account of it. Each case names the acceptance criterion it replays.
async function acceptanceFixture({ passing = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-runner-e2e-'));
  await mkdir(path.join(root, 'tests'), { recursive: true });
  await writeFile(path.join(root, 'tests', 'acceptance.test.js'), `import test from 'node:test';
import assert from 'node:assert/strict';
test('subject one', () => assert.equal(1, 1));
test('subject two', () => assert.equal(${passing ? '2' : '3'}, 2));
`);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', STORY_ID, '--title', 'Runner-direct evidence']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  return root;
}

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function cli(args) {
  const stdout = [];
  const stderr = [];
  const result = await runCli(args, {
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: (value) => stderr.push(value) }
  });
  return { ...result, stdout: stdout.join(''), stderr: stderr.join('') };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function evidenceFor(root) {
  return path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-evidence.json');
}

function runArtifactFor(root, kind = 'unit') {
  return path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs', `${kind}.json`);
}

test('AC-1 (RDE-1): verify run executes the command and derives the recorded status from its exit code, and refuses an agent-declared status', async () => {
  const root = await acceptanceFixture();
  const passing = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/acceptance.test.js',
    '--scenario', 'scenario_clause_e2e: AC-1 status is computed from the observed exit code',
    '--', 'node', '--test', 'tests/acceptance.test.js'
  ]);
  assert.equal(passing.result.status, 'pass');
  assert.equal(passing.result.exit_code, 0);
  const passRecord = (await readJson(evidenceFor(root))).commands.find((item) => item.kind === 'unit');
  assert.equal(passRecord.status, 'pass');

  const failingRoot = await acceptanceFixture({ passing: false });
  const failing = await cli([
    'verify', 'run', failingRoot, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/acceptance.test.js',
    '--', 'node', '--test', 'tests/acceptance.test.js'
  ]);
  assert.equal(failing.result.status, 'fail');
  assert.notEqual(failing.result.exit_code, 0);
  const failRecord = (await readJson(evidenceFor(failingRoot))).commands.find((item) => item.kind === 'unit');
  assert.equal(failRecord.status, 'fail');

  const declared = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit', '--status', 'pass',
    '--', 'node', '--test', 'tests/acceptance.test.js'
  ]);
  assert.notEqual(declared.exitCode, 0);
  assert.match(declared.stderr, /verify run does not accept --status/);
});

test('AC-2 (RDE-2): the run artifact carries the execution exhaust — exit code, counts, duration, head sha, stdout hash — with no agent input on that path', async () => {
  const root = await acceptanceFixture();
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/acceptance.test.js',
    '--scenario', 'scenario_clause_e2e: AC-2 execution exhaust reaches the artifact directly',
    '--', 'node', '--test', 'tests/acceptance.test.js'
  ]);
  const artifact = await readJson(runArtifactFor(root));
  assert.equal(artifact.run.exit_code, 0);
  assert.equal(artifact.run.counts.tests, 2);
  assert.equal(artifact.run.counts.pass, 2);
  assert.equal(artifact.run.counts.fail, 0);
  assert.ok(Number.isFinite(artifact.run.duration_ms));
  assert.match(artifact.observed.stdout_sha256, /^[0-9a-f]{64}$/);
  const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  assert.equal(artifact.run.head_sha_before, head);
  assert.equal(artifact.run.head_sha_after, head);
  // The counts in the artifact are the counts the command actually printed.
  const log = await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-runs', 'unit.log'), 'utf8');
  assert.match(log, new RegExp(`tests ${artifact.run.counts.tests}`));
  assert.equal(result.result.counts.tests, artifact.run.counts.tests);
});

test('AC-3 (RDE-3): an agent value written into a computed field is replaced by the computed value and survives only as a visible diff', async () => {
  const root = await acceptanceFixture();
  await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/acceptance.test.js',
    '--scenario', 'scenario_clause_e2e: AC-3 agent-written computed fields are overwritten with a retained diff',
    '--observed', 'tests=9999', '--observed', 'exit_code=0', '--observed', 'analyst_note=kept',
    '--', 'node', '--test', 'tests/acceptance.test.js'
  ]);
  const record = (await readJson(evidenceFor(root))).commands.find((item) => item.kind === 'unit');
  assert.equal(record.observation.values.tests, '2');
  assert.equal(record.observation.values.analyst_note, 'kept');
  const overrides = record.observation_overrides;
  assert.deepEqual(overrides.map((item) => item.key).sort(), ['exit_code', 'tests']);
  assert.equal(overrides.find((item) => item.key === 'tests').agent_value, '9999');
  assert.equal(overrides.find((item) => item.key === 'tests').computed_value, '2');
  const artifact = await readJson(runArtifactFor(root));
  assert.equal(artifact.discarded_agent_observations.length, 2);
});

test('AC-4 (RDE-4): runner-direct and self-reported records are distinguishable on the artifact and the marker is not settable from the CLI', async () => {
  const root = await acceptanceFixture();
  await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/acceptance.test.js',
    '--scenario', 'scenario_clause_e2e: AC-4 evidence_source separates computed from self-reported records',
    '--', 'node', '--test', 'tests/acceptance.test.js'
  ]);
  await writeFile(path.join(root, 'status.json'), `${JSON.stringify({ status: 'pass', exit_code: 0 })}\n`);
  await cli([
    'verify', 'record', root, '--id', STORY_ID, '--kind', 'typecheck', '--status', 'pass',
    '--command', 'npm run typecheck', '--artifact', 'status.json',
    '--target', 'tests/acceptance.test.js', '--observed', 'exit_code=0'
  ]);
  const commands = (await readJson(evidenceFor(root))).commands;
  assert.equal(commands.find((item) => item.kind === 'unit').evidence_source, 'runner_direct');
  assert.equal(commands.find((item) => item.kind === 'typecheck').evidence_source, 'self_reported');

  // No CLI surface sets the marker: passing it as a flag leaves the record self-reported.
  await cli([
    'verify', 'record', root, '--id', STORY_ID, '--kind', 'typecheck', '--status', 'pass',
    '--command', 'npm run typecheck', '--artifact', 'status.json',
    '--target', 'tests/acceptance.test.js', '--observed', 'exit_code=0',
    '--evidence-source', 'runner_direct'
  ]);
  const afterFlag = (await readJson(evidenceFor(root))).commands.find((item) => item.kind === 'typecheck');
  assert.equal(afterFlag.evidence_source, 'self_reported');
});

test('AC-5 (RDE-5): a tree that moves mid-run is recorded with both head shas and a warning', async () => {
  const root = await acceptanceFixture();
  await writeFile(path.join(root, 'tests', 'acceptance.test.js'), `import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test('commits while the verification is running', () => {
  execFileSync('git', ['commit', '--allow-empty', '-m', 'mid-run'], { cwd: process.cwd() });
  assert.ok(true);
});
`);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'mutating test']);
  const before = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const result = await cli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/acceptance.test.js',
    '--scenario', 'scenario_clause_e2e: AC-5 a mid-run tree change stays visible after the fact',
    '--', 'node', '--test', 'tests/acceptance.test.js'
  ]);
  const after = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  assert.notEqual(before, after);
  assert.equal(result.result.tree_mutated_during_run, true);
  const record = (await readJson(evidenceFor(root))).commands.find((item) => item.kind === 'unit');
  assert.equal(record.observation.values.head_sha_before, before);
  assert.equal(record.observation.values.head_sha_after, after);
  assert.ok(record.warnings.some((warning) => warning.id === 'verification_tree_mutated_during_run'));
});

test('AC-6 (RDE-6): verify record keeps its behaviour and record shape, and pre-existing records without evidence_source stay readable', async () => {
  const root = await acceptanceFixture();
  await writeFile(path.join(root, 'status.json'), `${JSON.stringify({ status: 'pass', exit_code: 0 })}\n`);
  const legacyPath = path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-evidence.json');
  await mkdir(path.dirname(legacyPath), { recursive: true });
  await writeFile(legacyPath, `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    warnings: [],
    commands: [{ kind: 'build', status: 'pass', command: 'npm run build', summary: 'recorded before evidence_source existed' }]
  }, null, 2)}\n`);

  await cli([
    'verify', 'record', root, '--id', STORY_ID, '--kind', 'unit', '--status', 'pass',
    '--command', 'node --test tests/acceptance.test.js', '--artifact', 'status.json',
    '--target', 'tests/acceptance.test.js',
    '--scenario', 'scenario_clause_e2e: AC-6 the self-reported path is unchanged',
    '--observed', 'exit_code=0'
  ]);
  const evidence = await readJson(legacyPath);
  const legacy = evidence.commands.find((item) => item.kind === 'build');
  // The pre-existing record is preserved verbatim; absence of the marker means self-reported.
  assert.equal(legacy.command, 'npm run build');
  assert.equal(legacy.evidence_source, undefined);
  const recorded = evidence.commands.find((item) => item.kind === 'unit');
  assert.equal(recorded.evidence_source, 'self_reported');
  assert.equal(recorded.observation.values.exit_code, '0');
  assert.equal(recorded.observation_check.status, 'recorded');
  assert.equal(recorded.artifact_check.status, 'verified');
  assert.equal(recorded.observation_overrides, undefined);
  assert.equal(recorded.computed_observation, undefined);
});
