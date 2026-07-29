import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../../src/cli.js';
import { createUsageReport } from '../../src/usage-report.js';
import { buildTraceabilityClauseMap } from '../../src/traceability.js';
import { getExecutionStatus, reconcileExecutionState } from '../../src/execution-state.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-test-runner-consumers';

// The runner adds fields to verification-evidence.json, which several existing consumers
// read. This exercises that seam end to end: a real command execution on one side, the
// unchanged consumers on the other, so an additive field cannot quietly break them.
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-runner-consumers-'));
  await mkdir(path.join(root, 'tests'), { recursive: true });
  await writeFile(path.join(root, 'tests', 'subject.test.js'), `import test from 'node:test';
import assert from 'node:assert/strict';
test('subject holds', () => assert.equal(1, 1));
`);
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'vibepro@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'VibePro Test'], { cwd: root });
  await runCli(['init', root, '--story-id', STORY_ID, '--title', 'Runner evidence consumers']);
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: root });
  return root;
}

async function readEvidence(root) {
  return JSON.parse(await readFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-evidence.json'), 'utf8'));
}

test('runner-direct evidence is consumed by the usage report, traceability clause map, and execution state without loss', async () => {
  const root = await fixture();
  await runCli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/subject.test.js',
    '--scenario', 'unit_regression: the subject suite holds at the current head',
    '--', 'node', '--test', 'tests/subject.test.js'
  ]);

  const evidence = await readEvidence(root);
  const record = evidence.commands.find((item) => item.kind === 'unit');
  assert.equal(record.evidence_source, 'runner_direct');

  // Consumer 1: the usage report must not count a runner-direct pass as observation-missing.
  const usage = await createUsageReport(root);
  assert.equal(usage.value_signals.verification_observation_missing_story_count, 0);
  const story = usage.stories.find((item) => item.story_id === STORY_ID);
  assert.equal(story.verification_observation_missing, false);

  // Consumer 2: the traceability clause map binds the computed evidence to an AC clause.
  const clauseMap = buildTraceabilityClauseMap({
    storyId: STORY_ID,
    storyText: '## Acceptance Criteria\n\n- [ ] AC-1: the subject suite passes at the current head\n',
    changedFiles: ['tests/subject.test.js'],
    tests: ['tests/subject.test.js'],
    evidence: [{
      type: 'verification_evidence',
      ref: record.artifact,
      summary: `${record.summary} | ${record.observation.scenarios.join(' | ')}`,
      targets: [...record.observation.targets, ...record.observation.scenarios, 'AC-1'],
      // pr prepare resolves the recorded content binding to a current-head binding; the
      // subject here is what the clause map does with a current-bound runner record.
      binding_status: 'current',
      artifact_quality: record.artifact_check?.status ?? null,
      strength: 'strong'
    }]
  });
  const clause = clauseMap.acceptance_criteria.find((item) => item.id === 'AC-1');
  assert.notEqual(clause.status, 'unmapped');
  assert.ok(clause.mapped_evidence.length > 0);

  // Consumer 3: execution state summarizes the record produced by the runner.
  await reconcileExecutionState(root, { storyId: STORY_ID, target: 'pr_create' }).catch(() => null);
  const state = await getExecutionStatus(root, { storyId: STORY_ID });
  const summary = JSON.stringify(state ?? {});
  assert.ok(summary.includes('unit'), summary.slice(0, 400));
});

test('a failing runner-direct run is recorded as failing and is not reported as a passing claim', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'tests', 'subject.test.js'), `import test from 'node:test';
import assert from 'node:assert/strict';
test('subject breaks', () => assert.equal(1, 2));
`);
  // negative_path: the same command shape, an outcome the agent cannot talk out of.
  const result = await runCli([
    'verify', 'run', root, '--id', STORY_ID, '--kind', 'unit',
    '--target', 'tests/subject.test.js',
    '--scenario', 'negative_path: a failing command is recorded as failing',
    '--', 'node', '--test', 'tests/subject.test.js'
  ]);
  assert.equal(result.exitCode, 1);
  const record = (await readEvidence(root)).commands.find((item) => item.kind === 'unit');
  assert.equal(record.status, 'fail');
  assert.equal(record.observation.values.fail, '1');
  assert.equal(record.evidence_source, 'runner_direct');
});

test('pr autopilot records its own executed outcome as a computed source, not as self-reported', async () => {
  const root = await fixture();
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.execution = { managed_worktree: 'disabled' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'runner-consumers-fixture',
    type: 'module',
    scripts: { test: 'node ./scripts/pass.js' }
  }, null, 2)}\n`);
  await writeFile(path.join(root, 'scripts', 'pass.js'), 'process.stdout.write("pass\\n");\n');
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'autopilot target'], { cwd: root });

  await runCli(['pr', 'autopilot', root, '--base', 'main', '--story-id', STORY_ID, '--verify', 'unit=npm test', '--json'], {
    stdout: { write: () => {} },
    stderr: { write: () => {} }
  });

  const record = (await readEvidence(root)).commands.find((item) => item.kind === 'unit');
  // Autopilot runs the command itself and derives status from the exit code, so the record
  // must carry a computed source; self_reported would misdescribe who produced the outcome.
  assert.equal(record.evidence_source, 'autopilot_run');
  assert.equal(record.computed_observation.producer, 'vibepro pr autopilot');
  assert.equal(record.computed_observation.values.exit_code, '0');
  assert.equal(record.computed_observation.output_metrics, 'exit_code_only');
});
