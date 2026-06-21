import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { createUsageReport } from '../src/usage-report.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-verify-obs-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-test-obs', '--title', 'Observation story']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  return root;
}

function evidencePath(root) {
  return path.join(root, '.vibepro', 'pr', 'story-test-obs', 'verification-evidence.json');
}

test('verify record persists structured observation from CLI options', async () => {
  const root = await setupRepo();
  await runCli([
    'verify', 'record', root, '--id', 'story-test-obs', '--kind', 'unit', '--status', 'pass',
    '--command', 'node --test test/widgets.test.js',
    '--target', 'src/widgets.js', '--target', 'test/widgets.test.js',
    '--scenario', 'widget creation returns 201',
    '--observed', 'tests_passed=4', '--observed', 'exit_code=0'
  ]);
  const evidence = await readJson(evidencePath(root));
  const command = evidence.commands.find((item) => item.kind === 'unit');
  assert.deepEqual(command.observation.targets, ['src/widgets.js', 'test/widgets.test.js']);
  assert.deepEqual(command.observation.scenarios, ['widget creation returns 201']);
  assert.equal(command.observation.values.tests_passed, '4');
  assert.equal(command.observation.values.exit_code, '0');
  assert.equal(command.observation_check.status, 'recorded');
});

test('verify record rejects malformed --observed input', async () => {
  const root = await setupRepo();
  const result = await runCli([
    'verify', 'record', root, '--id', 'story-test-obs', '--kind', 'unit', '--status', 'pass',
    '--command', 'node --test test/widgets.test.js',
    '--observed', 'not-a-key-value'
  ]);
  assert.notEqual(result.exitCode, 0);
});

test('generic status artifact observed values are merged with CLI priority', async () => {
  const root = await setupRepo();
  const artifact = path.join(root, 'status.json');
  await writeFile(artifact, JSON.stringify({
    status: 'pass',
    exit_code: 0,
    observed: { gap_rate: 0.525, story_count: 80 }
  }));
  await runCli([
    'verify', 'record', root, '--id', 'story-test-obs', '--kind', 'integration', '--status', 'pass',
    '--command', 'node bin/vibepro.js usage report . --json',
    '--target', 'src/usage-report.js',
    '--observed', 'story_count=81',
    '--artifact', 'status.json'
  ]);
  const evidence = await readJson(evidencePath(root));
  const command = evidence.commands.find((item) => item.kind === 'integration');
  assert.equal(command.observation.values.gap_rate, '0.525');
  assert.equal(command.observation.values.story_count, '81', 'CLI-provided value must win over artifact value');
  assert.equal(command.observation_check.status, 'recorded');
});

test('vitest artifact counts are auto-extracted into observation values', async () => {
  const root = await setupRepo();
  const artifact = path.join(root, 'vitest.json');
  await writeFile(artifact, JSON.stringify({ success: true, numFailedTests: 0, numPassedTests: 12 }));
  await runCli([
    'verify', 'record', root, '--id', 'story-test-obs', '--kind', 'unit', '--status', 'pass',
    '--command', 'npx vitest run test/widgets.test.js --reporter=json',
    '--target', 'test/widgets.test.js',
    '--artifact', 'vitest.json'
  ]);
  const evidence = await readJson(evidencePath(root));
  const command = evidence.commands.find((item) => item.kind === 'unit');
  assert.equal(command.observation.values.numFailedTests, '0');
  assert.equal(command.observation.values.numPassedTests, '12');
});

test('observation_check is missing for a passing claim without any observation', async () => {
  const root = await setupRepo();
  await runCli([
    'verify', 'record', root, '--id', 'story-test-obs', '--kind', 'build', '--status', 'pass',
    '--command', 'node build.js'
  ]);
  const evidence = await readJson(evidencePath(root));
  const command = evidence.commands.find((item) => item.kind === 'build');
  assert.equal(command.observation_check.status, 'missing');
  assert.ok(evidence.warnings.some((warning) => warning.id === 'verification_observation_missing'));
});

test('verify record clears stale observation warnings when the same kind is rerecorded with observations', async () => {
  const root = await setupRepo();
  await runCli([
    'verify', 'record', root, '--id', 'story-test-obs', '--kind', 'build', '--status', 'pass',
    '--command', 'node build.js'
  ]);
  let evidence = await readJson(evidencePath(root));
  assert.ok(evidence.warnings.some((warning) => warning.id === 'verification_observation_missing'));

  await runCli([
    'verify', 'record', root, '--id', 'story-test-obs', '--kind', 'build', '--status', 'pass',
    '--command', 'node build.js',
    '--target', 'src/build.js',
    '--scenario', 'build completes',
    '--observed', 'exit_code=0'
  ]);

  evidence = await readJson(evidencePath(root));
  const command = evidence.commands.find((item) => item.kind === 'build');
  assert.equal(command.observation_check.status, 'recorded');
  assert.equal(evidence.warnings.some((warning) => warning.id === 'verification_observation_missing'), false);
});

test('observation_check is partial when only values are present', async () => {
  const root = await setupRepo();
  await runCli([
    'verify', 'record', root, '--id', 'story-test-obs', '--kind', 'typecheck', '--status', 'pass',
    '--command', 'node --check src/widgets.js',
    '--observed', 'exit_code=0'
  ]);
  const evidence = await readJson(evidencePath(root));
  const command = evidence.commands.find((item) => item.kind === 'typecheck');
  assert.equal(command.observation_check.status, 'partial');
});

test('observation_check is not_applicable for needs_setup claims', async () => {
  const root = await setupRepo();
  await runCli([
    'verify', 'record', root, '--id', 'story-test-obs', '--kind', 'e2e', '--status', 'needs_setup',
    '--command', 'npx playwright test'
  ]);
  const evidence = await readJson(evidencePath(root));
  const command = evidence.commands.find((item) => item.kind === 'e2e');
  assert.equal(command.observation_check.status, 'not_applicable');
});

test('usage report counts stories with observation-missing pass claims', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-verify-obs-report-'));
  const storyDir = path.join(root, 'docs', 'management', 'stories', 'active');
  await mkdir(storyDir, { recursive: true });
  const writeStory = async (storyId) => {
    await writeFile(path.join(storyDir, `${storyId}.md`), `---\nstory_id: ${storyId}\ntitle: ${storyId}\nstatus: active\n---\n\n# ${storyId}\n`);
  };
  const writeEvidence = async (storyId, commands) => {
    const prDir = path.join(root, '.vibepro', 'pr', storyId);
    await mkdir(prDir, { recursive: true });
    await writeFile(path.join(prDir, 'pr-prepare.json'), JSON.stringify({
      schema_version: '0.1.0', created_at: '2026-06-12T00:00:00.000Z', story: { story_id: storyId }
    }));
    await writeFile(path.join(prDir, 'verification-evidence.json'), JSON.stringify({
      schema_version: '0.1.0', story_id: storyId, updated_at: '2026-06-12T00:00:00.000Z', warnings: [], commands
    }));
  };
  await writeStory('story-obs-missing');
  await writeEvidence('story-obs-missing', [
    { kind: 'unit', status: 'pass', command: 'node --test x', observation_check: { status: 'missing' } }
  ]);
  await writeStory('story-obs-recorded');
  await writeEvidence('story-obs-recorded', [
    {
      kind: 'unit', status: 'pass', command: 'node --test y',
      observation: { targets: ['src/y.js'], scenarios: [], values: { exit_code: '0' } },
      observation_check: { status: 'recorded' }
    }
  ]);
  await writeStory('story-obs-legacy');
  await writeEvidence('story-obs-legacy', [
    { kind: 'unit', status: 'pass', command: 'node --test z' }
  ]);

  const report = await createUsageReport(root);
  assert.equal(report.value_signals.verification_observation_missing_story_count, 1);
  const missing = report.stories.find((story) => story.story_id === 'story-obs-missing');
  assert.equal(missing.verification_observation_missing, true);
  const recorded = report.stories.find((story) => story.story_id === 'story-obs-recorded');
  assert.equal(recorded.verification_observation_missing, false);
  const legacy = report.stories.find((story) => story.story_id === 'story-obs-legacy');
  assert.equal(legacy.verification_observation_missing, false, 'legacy entries without observation_check are not retroactively flagged');
  // collecting verification evidence must not change gap semantics
  assert.equal(legacy.traceability_gaps.length, 0, 'pr-prepare.json still counts as a real PR artifact');
});

test('observation text contributes to judgment evidence classification', async () => {
  const root = await setupRepo();
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(
    path.join(root, 'docs', 'management', 'stories', 'active', 'story-test-obs.md'),
    '---\nstory_id: story-test-obs\ntitle: Observation story\n---\n\n# Story\n\n## Background\nImprove the gate review workflow artifact handling.\n\n## Acceptance Criteria\n- The gate artifact workflow stays consistent.\n'
  );
  await writeFile(
    path.join(root, 'observation-evidence.json'),
    JSON.stringify({ status: 'pass', source: 'observation' }, null, 2)
  );
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'docs: story']);
  await git(root, ['switch', '-c', 'feature/obs']);
  await writeFile(path.join(root, 'src-change.js'), 'export const x = 1;\n');
  await git(root, ['add', 'src-change.js']);
  await git(root, ['commit', '-m', 'feat: change']);
  // bland summary and command, but observation scenarios describe all workflow evidence kinds
  await runCli([
    'verify', 'record', root, '--id', 'story-test-obs', '--kind', 'e2e', '--status', 'pass',
    '--command', 'node run-check.js',
    '--summary', 'verification done',
    '--artifact', 'observation-evidence.json',
    '--target', 'src-change.js',
    '--scenario', 'flow_replay: gate review workflow was replayed',
    '--scenario', 'artifact_replay: generated gate-dag and pr-prepare outputs were replayed',
    '--scenario', 'scenario_clause_e2e: acceptance clause for gate artifact workflow was exercised'
  ]);
  await runCli(['pr', 'prepare', root, '--story-id', 'story-test-obs', '--base', 'main', '--json']);
  const gateDag = await readJson(path.join(root, '.vibepro', 'pr', 'story-test-obs', 'gate-dag.json'));
  const spine = gateDag.nodes.find((node) => node.id === 'gate:common_judgment_spine');
  assert.ok(spine, 'spine gate must exist');
  const currentReality = spine.subchecks.find((check) => check.id === 'current_reality');
  const doneEvidence = spine.subchecks.find((check) => check.id === 'done_evidence');
  const currentRealityKinds = currentReality.matched_evidence.map((item) => item.kind).sort();
  const doneEvidenceKinds = doneEvidence.matched_evidence.map((item) => item.kind).sort();
  assert.deepEqual(currentRealityKinds, ['artifact_replay', 'flow_replay', 'scenario_clause_e2e']);
  assert.deepEqual(doneEvidenceKinds, ['artifact_replay', 'flow_replay', 'scenario_clause_e2e']);
  assert.equal(currentReality.status, 'passed', 'workflow evidence passes only after all required observation kinds are present');
  assert.equal(doneEvidence.status, 'passed', 'workflow done evidence passes only after all required observation kinds are present');
});
