import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { createPullRequest, preparePullRequest } from '../src/pr-manager.js';
import { renderStoryPlan } from '../src/story-manager.js';

import {
  createDevelopmentSnapshot,
  collectConsumptionMetrics,
  collectStructuralMetrics,
  deriveConsumptionCaps,
  deriveDevelopmentControlDecision,
  evaluateConsumptionBudget,
  evaluateDevelopmentAdmission,
  evaluateStructuralBudget,
  extractConsumptionMetrics,
  getDevelopmentControlStatus,
  normalizeDevelopmentControl,
  recordDevelopmentOutcome
} from '../src/development-control.js';

const execFileAsync = promisify(execFile);

test('structural growth selects SIMPLIFY at the agreed thresholds', () => {
  const result = evaluateStructuralBudget(
    { loc: 100, import_edges: 100, file_count: 100, dependency_cycles: 1, workflow_control_surfaces: 10 },
    { loc: 110, import_edges: 109, file_count: 106, dependency_cycles: 1, workflow_control_surfaces: 10 }
  );

  assert.equal(result.mode, 'SIMPLIFY');
  assert.equal(result.findings.find((item) => item.metric === 'loc').status, 'simplify');
  assert.equal(result.findings.find((item) => item.metric === 'file_count').status, 'simplify');
});

test('a new cycle or workflow control surface selects SIMPLIFY immediately', () => {
  const result = evaluateStructuralBudget(
    { loc: 100, import_edges: 100, file_count: 100, dependency_cycles: 0, workflow_control_surfaces: 4 },
    { loc: 100, import_edges: 100, file_count: 100, dependency_cycles: 1, workflow_control_surfaces: 5 }
  );

  assert.equal(result.mode, 'SIMPLIFY');
  assert.deepEqual(
    result.findings.filter((item) => item.status === 'simplify').map((item) => item.metric),
    ['dependency_cycles', 'workflow_control_surfaces']
  );
});

test('rolling caps use max of twice recent median and p95', () => {
  const history = Array.from({ length: 20 }, (_, index) => ({ fresh_input_tokens: index + 1 }));
  const caps = deriveConsumptionCaps(history);

  assert.equal(caps.fresh_input_tokens.source, 'rolling');
  assert.equal(caps.fresh_input_tokens.median_5, 18);
  assert.equal(caps.fresh_input_tokens.p95_20, 19);
  assert.equal(caps.fresh_input_tokens.value, 36);
  assert.equal(caps.agent_executions.source, 'bootstrap');
});

test('unknown consumption routes to VALIDATE instead of zero or pass', () => {
  const consumption = evaluateConsumptionBudget({
    fresh_input_tokens: null,
    agent_executions: null,
    repair_batches: null,
    expensive_verifications: null,
    verification_duration_ms: null
  });
  const decision = deriveDevelopmentControlDecision({
    structural: { mode: 'VALUE', findings: [] },
    consumption
  });

  assert.equal(consumption.mode, 'VALIDATE');
  assert.equal(decision.mode, 'VALIDATE');
  assert.ok(consumption.unknown_metrics.includes('fresh_input_tokens'));
});

test('parallel usage is measured but admission constrains intent, not concurrency', () => {
  const metrics = extractConsumptionMetrics([{
    reviews: [
      { id: 'review-1', status: 'pass', agent_usage: { fresh_input_tokens: 100 } },
      { id: 'review-2', status: 'needs_changes', agent_usage: { input_tokens: 200 } }
    ],
    verification: { id: 'verify-1', kind: 'e2e', duration_ms: 1200 }
  }]);

  assert.equal(metrics.agent_executions, 2);
  assert.equal(metrics.fresh_input_tokens, 300);
  assert.equal(metrics.expensive_verifications, 1);
  assert.equal(metrics.repair_batches, 1);
  assert.equal(evaluateDevelopmentAdmission({ mode: 'SIMPLIFY', intent: 'simplification', enforcement: 'enforced' }).allowed, true);
  assert.equal(evaluateDevelopmentAdmission({ mode: 'SIMPLIFY', intent: 'value', enforcement: 'enforced' }).allowed, false);
  assert.equal(evaluateDevelopmentAdmission({ mode: 'SIMPLIFY', intent: 'value', enforcement: 'shadow' }).allowed, true);
});

test('partially missing token attribution stays unknown while observed zero repairs stays zero', () => {
  const metrics = extractConsumptionMetrics([{
    reviews: [
      { id: 'review-1', status: 'pass', agent_usage: { fresh_input_tokens: 100 } },
      { id: 'review-2', status: 'pass', agent_usage: {} }
    ]
  }]);

  assert.equal(metrics.fresh_input_tokens, null);
  assert.equal(metrics.agent_executions, 2);
  assert.equal(metrics.repair_batches, 0);
});

test('canonical verification run schema is measured once even when projected twice', () => {
  const verification = {
    kind: 'integration',
    head_sha: 'a'.repeat(40),
    observed: { run_artifact: '.vibepro/pr/story/verification-runs/integration.json', duration_ms: '144210' },
    run: { duration_ms: 144210 }
  };
  const metrics = extractConsumptionMetrics([verification, { commands: [verification] }]);

  assert.equal(metrics.expensive_verifications, 1);
  assert.equal(metrics.verification_duration_ms, 144210);
});

test('anonymous agent usages are counted conservatively instead of deduplicated by content', () => {
  const metrics = extractConsumptionMetrics([
    { agent_usage: { fresh_input_tokens: 100 } },
    { agent_usage: { fresh_input_tokens: 100 } }
  ]);
  assert.equal(metrics.agent_executions, 2);
  assert.equal(metrics.fresh_input_tokens, 200);
});

test('provenance-only agent executions are counted and deduplicated by provenance identity', () => {
  const metrics = extractConsumptionMetrics([
    { agent_provenance: { agent_id: 'reviewer-1', thread_id: 'thread-1' }, agent_usage: null },
    { projection: { agent_provenance: { agent_id: 'reviewer-1', thread_id: 'thread-1' }, agent_usage: null } },
    { agent_provenance: { agent_id: 'reviewer-1', thread_id: 'thread-2' }, agent_usage: null }
  ]);
  assert.equal(metrics.agent_executions, 2);
  assert.equal(metrics.fresh_input_tokens, null);
});

test('invalid enforcement configuration and unsafe status story ids fail closed', async () => {
  assert.throws(
    () => normalizeDevelopmentControl({ enforcement: 'enforeced' }),
    /must be shadow or enforced/
  );
  await assert.rejects(
    () => getDevelopmentControlStatus('/tmp/repo', { storyId: '../escape' }),
    /storyId must contain/
  );
  for (const invalid of [
    { structural: { loc_warning_ratio: -1 } },
    { structural: { reject_new_dependency_cycle: 'yes' } },
    { shadow_batches: 1.5 },
    { consumption: { rolling_median_window: 0 } },
    { consumption: { bootstrap: { agent_executions: Number.NaN } } }
  ]) {
    assert.throws(() => normalizeDevelopmentControl(invalid), /must be/);
  }
  assert.throws(() => evaluateDevelopmentAdmission({ mode: 'TYPO', intent: 'value', enforcement: 'enforced' }), /mode must be/);
  assert.throws(() => evaluateDevelopmentAdmission({ mode: 'VALUE', intent: 'value', enforcement: 'typo' }), /enforcement must be/);
});

test('first snapshot is shadow, the next batch is enforced, and only improved outcomes advance baseline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-development-control-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    development_control: { enforcement: 'enforced', shadow_batches: 1, baseline_commit: 'base' }
  }));
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-test.md'), `---\ndevelopment_intent: simplification\n---\n`);
  const metrics = {
    base: { ref: 'base', commit: 'a'.repeat(40), loc: 100, file_count: 10, import_edges: 10, dependency_cycles: 0, workflow_control_surfaces: 1 },
    HEAD: { ref: 'HEAD', commit: 'b'.repeat(40), loc: 90, file_count: 9, import_edges: 8, dependency_cycles: 0, workflow_control_surfaces: 1 },
    next: { ref: 'next', commit: 'c'.repeat(40), loc: 85, file_count: 8, import_edges: 7, dependency_cycles: 0, workflow_control_surfaces: 1 }
  };
  metrics['b'.repeat(40)] = metrics.HEAD;
  const runGit = async (_root, args) => {
    const ref = args.at(-1);
    if (args[0] === 'rev-parse') return `${metrics[ref].commit}\n`;
    if (args[0] === 'ls-tree') return 'src/a.js\n';
    if (args[0] === 'grep') return `${ref}:src/a.js:1:export const a = 1;\n`;
    throw new Error(`unexpected git args: ${args.join(' ')}`);
  };
  const created = await createDevelopmentSnapshot(root, {
    storyId: 'story-test',
    baseline: 'base',
    runGit,
    consumption: {
      fresh_input_tokens: 10,
      agent_executions: 2,
      repair_batches: 0,
      expensive_verifications: 0,
      verification_duration_ms: 100
    }
  });

  assert.equal(created.snapshot.enforcement, 'shadow');
  await assert.rejects(() => createDevelopmentSnapshot(root, {
    storyId: 'story-test', baseline: 'base', runGit, consumption: created.snapshot.consumption
  }), /already exists/);
  const status = await getDevelopmentControlStatus(root, { storyId: 'story-test' });
  assert.equal(status.enforcement, 'shadow');
  assert.equal(status.admission.allowed, true);
  const outcome = await recordDevelopmentOutcome(root, {
    storyId: 'story-test', adoptedCommit: 'b'.repeat(40), result: 'improved', summary: 'smaller'
  });
  assert.equal(outcome.receipt.baseline_eligible, true);
  const nextBatchStatus = await getDevelopmentControlStatus(root, { storyId: 'story-test' });
  assert.equal(nextBatchStatus.enforcement, 'enforced');
  const next = await createDevelopmentSnapshot(root, {
    storyId: 'story-test', commit: 'next', runGit, consumption: created.snapshot.consumption
  });
  assert.equal(next.snapshot.baseline_commit, 'b'.repeat(40));
  assert.equal(next.snapshot.baseline_source, 'improved_outcome');
  assert.equal(next.snapshot.enforcement, 'enforced');
  assert.equal(JSON.parse(await readFile(created.snapshotPath, 'utf8')).immutable, true);
  const portableState = JSON.parse(await readFile(path.join(root, 'docs', 'management', 'development-control-state.json'), 'utf8'));
  assert.equal(portableState.projection.adopted_commit, 'c'.repeat(40));
  assert.equal(portableState.history.length, 2);
});

test('historical replay distinguishes the growth trigger from slimming commits', () => {
  const replay = [
    ['d809d288', [143639, 271, 462, 0, 19], [144193, 273, 465, 0, 20], 'SIMPLIFY'],
    ['53011f8e', [188922, 350, 620, 1, 26], [189115, 350, 620, 1, 26], 'VALUE'],
    ['311d9155', [189115, 350, 620, 1, 26], [189115, 350, 620, 1, 26], 'VALUE'],
    ['f51c4c42', [146581, 292, 493, 2, 21], [144170, 285, 485, 2, 21], 'VALUE'],
    ['0755664d', [136269, 270, 457, 2, 19], [86242, 224, 293, 1, 9], 'VALUE']
  ];
  const asMetrics = ([loc, file_count, import_edges, dependency_cycles, workflow_control_surfaces]) => ({
    loc, file_count, import_edges, dependency_cycles, workflow_control_surfaces
  });
  const results = replay.map(([commit, baseline, observed, expected]) => ({
    commit, expected,
    decision: deriveDevelopmentControlDecision({
      structural: evaluateStructuralBudget(asMetrics(baseline), asMetrics(observed)),
      consumption: { mode: 'VALUE', findings: [] }
    })
  }));

  assert.deepEqual(results.map((item) => [item.commit, item.decision.mode]), replay.map(([commit, , , expected]) => [commit, expected]));
});

test('structural collection ignores docs for code size but counts nested workflow and skill control surfaces', async () => {
  const calls = [];
  const runGit = async (_root, args) => {
    calls.push(args);
    if (args[0] === 'ls-tree') return 'docs/archive.mjs\n.github/workflows/release.yml\nskills/internal/vibepro-workflow/SKILL.md\nsrc/index.js\nsrc/internal/review-runner.js\nsrc/internal/ordinary/runner.js\ntest/index.test.js\n';
    if (args[0] === 'grep') return 'HEAD:src/index.js:1:export const value = 1;\nHEAD:src/internal/review-runner.js:1:export const review = 1;\nHEAD:src/internal/ordinary/runner.js:1:export const runner = 1;\n';
    if (args[0] === 'rev-parse') return `${'d'.repeat(40)}\n`;
    throw new Error(`unexpected git args: ${args.join(' ')}`);
  };

  const metrics = await collectStructuralMetrics('/tmp/repo', 'HEAD', { runGit });
  const grepCall = calls.find((args) => args[0] === 'grep');
  assert.equal(metrics.file_count, 4);
  assert.ok(grepCall.includes('src'));
  assert.ok(grepCall.includes('test'));
  assert.ok(!grepCall.includes('docs'));
  assert.equal(metrics.workflow_control_surfaces, 3);
});

test('consumption collection matches exact Story path segments', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-consumption-scope-'));
  for (const [storyId, tokens] of [['story-foo', 10], ['story-foobar', 100]]) {
    const dir = path.join(root, '.vibepro', 'reviews', storyId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'review.json'), JSON.stringify({ agent_usage: { fresh_input_tokens: tokens } }));
  }
  const metrics = await collectConsumptionMetrics(root, 'story-foo');
  assert.equal(metrics.agent_executions, 1);
  assert.equal(metrics.fresh_input_tokens, 10);
});

test('outcome fallback requires both Story id and adopted commit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-outcome-scope-'));
  const commit = 'a'.repeat(40);
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({ development_control: { enforcement: 'enforced' } }));
  await writeFile(path.join(root, 'docs', 'management', 'development-control-state.json'), JSON.stringify({
    schema_version: '0.1.0', next_enforcement: 'enforced', completed_batches: 1, projection: null,
    history: [{ story_id: 'story-other', adopted_commit: commit, baseline_commit: 'b'.repeat(40), enforcement: 'enforced', decision: { mode: 'VALUE', reasons: [] }, consumption: {} }]
  }));
  await assert.rejects(
    () => recordDevelopmentOutcome(root, { storyId: 'story-target', adoptedCommit: commit, result: 'improved' }),
    /development snapshot not found/
  );
});

test('snapshot and outcome path identifiers reject traversal and abbreviated commits', async () => {
  await assert.rejects(
    () => createDevelopmentSnapshot('/tmp/repo', { storyId: '../escape' }),
    /storyId must contain only/
  );
  await assert.rejects(
    () => recordDevelopmentOutcome('/tmp/repo', { storyId: 'story-safe', adoptedCommit: '../escape', result: 'improved' }),
    /full commit SHA/
  );
});

test('Story plan markdown exposes the development control decision', () => {
  const markdown = renderStoryPlan({
    generated_at: '2026-08-09T00:00:00Z',
    development_control: {
      mode: 'SIMPLIFY', enforcement: 'enforced', intent: 'simplification',
      admission: { status: 'allowed' }, projection: { snapshot_ref: '.vibepro/development-control/snapshot.json' }
    },
    summary: { story_count: 0, coverage_status: 'complete', coverage_ratio: 1, uncovered_files: 0 },
    questions: [], priority_stories: [], task_candidates: [], next_commands: [],
    source_recovery_map: {}, source_alignment_findings: {}
  });

  assert.match(markdown, /## Development Control/);
  assert.match(markdown, /SIMPLIFY/);
  assert.match(markdown, /simplification/);
  assert.match(markdown, /allowed/);
});

test('enforced mismatched intent blocks both PR admission entrypoints before side effects', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-development-admission-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    execution: { managed_worktree: 'disabled' },
    development_control: { enforcement: 'enforced', shadow_batches: 1 }
  }));
  await writeFile(path.join(root, 'docs', 'management', 'development-control-state.json'), JSON.stringify({
    schema_version: '0.1.0', next_enforcement: 'enforced', completed_batches: 1,
    projection: { mode: 'SIMPLIFY', enforcement: 'shadow', reasons: [] }, history: []
  }));
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-value.md'), '---\ndevelopment_intent: value\n---\n');

  for (const subcommand of ['prepare', 'create']) {
    const capture = [];
    const result = await runCli(['pr', subcommand, root, '--story-id', 'story-value', '--base', 'main'], {
      stdout: { write: (value) => capture.push(String(value)) },
      stderr: { write: (value) => capture.push(String(value)) },
      env: {}
    });
    assert.equal(result.exitCode, 1);
    assert.match(capture.join(''), /development control blocked pr/);
  }
  for (const operation of [preparePullRequest, createPullRequest]) {
    await assert.rejects(
      () => operation(root, {
        storyId: 'story-value', baseRef: 'main', dryRun: true,
        developmentControl: { admission: { allowed: true } }
      }),
      /development control blocked pr prepare/
    );
  }

  await writeFile(path.join(root, 'docs', 'management', 'development-control-state.json'), JSON.stringify({
    schema_version: '0.1.0', next_enforcement: 'enforeced', completed_batches: 1,
    projection: { mode: 'TYPO', enforcement: 'enforced', reasons: [] }, history: []
  }));
  for (const args of [
    ['judgment', 'status', root, '--id', 'story-value', '--json'],
    ['pr', 'prepare', root, '--story-id', 'story-value', '--base', 'main', '--json'],
    ['pr', 'create', root, '--story-id', 'story-value', '--base', 'main', '--json']
  ]) {
    const capture = [];
    const result = await runCli(args, {
      stdout: { write: (value) => capture.push(String(value)) },
      stderr: { write: (value) => capture.push(String(value)) }, env: {}
    });
    assert.equal(result.exitCode, 1);
    assert.match(capture.join(''), /state next_enforcement must be shadow or enforced/);
  }

  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    execution: { managed_worktree: 'disabled' },
    development_control: { enforcement: 'shadow', shadow_batches: 1 }
  }));
  const rollbackStatus = await getDevelopmentControlStatus(root, { storyId: 'story-value' });
  assert.equal(rollbackStatus.enforcement, 'shadow');
  assert.equal(rollbackStatus.admission.allowed, true);

  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    execution: { managed_worktree: 'disabled' },
    development_control: { enforcement: 'enforeced', shadow_batches: 1 }
  }));
  for (const args of [
    ['judgment', 'status', root, '--id', 'story-value', '--json'],
    ['pr', 'prepare', root, '--story-id', 'story-value', '--base', 'main', '--json']
  ]) {
    const capture = [];
    const result = await runCli(args, {
      stdout: { write: (value) => capture.push(String(value)) },
      stderr: { write: (value) => capture.push(String(value)) },
      env: {}
    });
    assert.equal(result.exitCode, 1);
    assert.match(capture.join(''), /must be shadow or enforced/);
  }

  for (const args of [
    ['judgment', 'status', root, '--id', '../escape', '--json'],
    ['pr', 'prepare', root, '--story-id', '../escape', '--base', 'main', '--json'],
    ['pr', 'create', root, '--story-id', '../escape', '--base', 'main', '--json']
  ]) {
    const capture = [];
    const result = await runCli(args, {
      stdout: { write: (value) => capture.push(String(value)) },
      stderr: { write: (value) => capture.push(String(value)) },
      env: {}
    });
    assert.equal(result.exitCode, 1);
    assert.match(capture.join(''), /storyId must contain|valid story id/);
  }
});

test('development intent resolves from every supported Story source without substring collisions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-development-story-source-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'stories'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    development_control: { enforcement: 'enforced', shadow_batches: 0 }
  }));
  await writeFile(path.join(root, 'docs', 'management', 'development-control-state.json'), JSON.stringify({
    schema_version: '0.1.0', next_enforcement: 'enforced', completed_batches: 1,
    projection: { mode: 'VALIDATE', enforcement: 'enforced', reasons: [] }, history: []
  }));
  await writeFile(path.join(root, 'docs', 'stories', 'story-alt-extra.md'), [
    '---', 'story_id: story-alt-extra', 'development_intent: value', '---', ''
  ].join('\n'));
  await writeFile(path.join(root, 'docs', 'stories', 'noncanonical-name.md'), [
    '---', 'story_id: story-alt', 'development_intent: simplification', '---', ''
  ].join('\n'));

  const status = await getDevelopmentControlStatus(root, { storyId: 'story-alt' });
  assert.equal(status.intent, 'simplification');
  assert.equal(status.admission.allowed, true);
});

test('enforced repositories route missing control state to VALIDATE and fail closed at admission', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-development-missing-state-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    execution: { managed_worktree: 'disabled' },
    development_control: { enforcement: 'enforced', shadow_batches: 0 }
  }));
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-value.md'), [
    '---', 'story_id: story-value', 'development_intent: value', '---', ''
  ].join('\n'));

  const status = await getDevelopmentControlStatus(root, { storyId: 'story-value' });
  assert.equal(status.mode, 'VALIDATE');
  assert.equal(status.enforcement, 'enforced');
  assert.equal(status.projection, null);
  assert.equal(status.admission.allowed, false);

  for (const operation of [preparePullRequest, createPullRequest]) {
    await assert.rejects(
      () => operation(root, { storyId: 'story-value', baseRef: 'main', dryRun: true }),
      /development control blocked pr prepare/
    );
  }
});

test('public judgment CLI snapshots, reports status, and records an outcome receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-development-cli-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'src', 'index.js'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-cli.md'), '---\ndevelopment_intent: simplification\n---\n');
  await execFileAsync('git', ['init', '-q'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root });
  await execFileAsync('git', ['add', 'src/index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-qm', 'base'], { cwd: root });
  const { stdout: baseline } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    development_control: { enforcement: 'enforced', shadow_batches: 1, baseline_commit: baseline.trim() }
  }));
  await writeFile(path.join(root, 'src', 'index.js'), 'export const value = 2;\n');
  await execFileAsync('git', ['add', 'src/index.js'], { cwd: root });
  await execFileAsync('git', ['commit', '-qm', 'adopted'], { cwd: root });
  const { stdout: adopted } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  const capture = () => {
    const chunks = [];
    return { chunks, stream: { write: (value) => chunks.push(String(value)) } };
  };
  const snapshotOutput = capture();
  const snapshot = await runCli(['judgment', 'snapshot', root, '--id', 'story-cli', '--json'], {
    stdout: snapshotOutput.stream, stderr: snapshotOutput.stream, env: {}
  });
  assert.equal(snapshot.exitCode, 0);
  assert.equal(JSON.parse(snapshotOutput.chunks.join('')).enforcement, 'shadow');

  const statusOutput = capture();
  const status = await runCli(['judgment', 'status', root, '--id', 'story-cli', '--json'], {
    stdout: statusOutput.stream, stderr: statusOutput.stream, env: {}
  });
  assert.equal(status.exitCode, 0);
  assert.equal(JSON.parse(statusOutput.chunks.join('')).enforcement, 'shadow');

  const prepareOutput = capture();
  const prepare = await runCli([
    'pr', 'prepare', root, '--story-id', 'story-cli', '--base', baseline.trim(), '--head', 'HEAD', '--json'
  ], { stdout: prepareOutput.stream, stderr: prepareOutput.stream, env: {} });
  assert.equal(prepare.exitCode, 0);
  assert.equal(JSON.parse(prepareOutput.chunks.join('')).development_control.enforcement, 'shadow');

  const outcomeOutput = capture();
  const outcome = await runCli([
    'judgment', 'outcome', 'record', root, '--id', 'story-cli', '--batch', adopted.trim(), '--result', 'improved', '--json'
  ], { stdout: outcomeOutput.stream, stderr: outcomeOutput.stream, env: {} });
  assert.equal(outcome.exitCode, 0);
  assert.equal(JSON.parse(outcomeOutput.chunks.join('')).baseline_eligible, true);

  const nextStatusOutput = capture();
  await runCli(['judgment', 'status', root, '--id', 'story-cli', '--json'], {
    stdout: nextStatusOutput.stream, stderr: nextStatusOutput.stream, env: {}
  });
  assert.equal(JSON.parse(nextStatusOutput.chunks.join('')).enforcement, 'enforced');
});
