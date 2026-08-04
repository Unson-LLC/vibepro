import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { preparePullRequest } from '../src/pr-manager.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

function findGate(nodes, id) {
  return nodes.find((node) => node.id === id);
}

const STORY_ID = 'story-conformance-delta-shadow';

async function makeGitRepoWithStory({ withTargetModel = false } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-conformance-shadow-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli([
    'init',
    repo,
    '--story-id',
    STORY_ID,
    '--title',
    'Conformance delta shadow stage',
    '--view',
    'dev',
    '--period',
    '2026-W31'
  ]);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'infra.js'), 'export const infra = 1;\n');
  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n');
  if (withTargetModel) {
    await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
    const model = {
      schema_version: '0.1.0',
      status: 'draft',
      adjudicated_by: null,
      scope_roots: ['src'],
      modules: [{ name: 'infra', responsibility: 'shared kernel', paths: ['src/infra.js'] }],
      allowed_dependencies: {},
      budgets: { default_max_file_lines: 500, file_line_baseline: {} }
    };
    await writeFile(path.join(repo, 'docs', 'architecture', 'target-model.json'), `${JSON.stringify(model, null, 2)}\n`);
  }
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init conformance shadow stage fixture']);
  await git(repo, ['switch', '-c', 'feature/conformance-shadow']);
  return repo;
}

// --- CDL-S-7: shadow stage wiring ------------------------------------------

test('CDL-S-7: pr prepare via CLI wires the conformance delta runner and produces a passed info-only gate node', async () => {
  const repo = await makeGitRepoWithStory({ withTargetModel: true });
  await writeFile(path.join(repo, 'src', 'infra.js'), 'export const infra = 2;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: bump infra']);

  const result = await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const nodes = result.result.preparation.pr_context.gate_dag.nodes;
  const gate = findGate(nodes, 'gate:architecture_delta');
  assert.ok(gate, 'expected gate:architecture_delta node in gate_dag');
  assert.equal(gate.type, 'architecture_conformance_delta_gate');
  assert.equal(gate.required, false);
  assert.equal(gate.status, 'passed');
  assert.equal(gate.inconclusive, false);
  assert.ok(gate.artifacts.conformance);
  assert.ok(gate.artifacts.delta);

  const conformanceOnDisk = JSON.parse(await (await import('node:fs/promises')).readFile(
    path.join(repo, gate.artifacts.conformance), 'utf8'
  ));
  assert.ok(Array.isArray(conformanceOnDisk.violations));

  // senior-gap judgment's ideal_state must read a real conformance_summary, not null, once the
  // shadow stage has persisted conformance.json ahead of load_target_architecture_context.
  const idealState = result.result.preparation.pr_context.senior_gap_judgment?.ideal_state;
  assert.ok(idealState?.target_architecture, 'expected ideal_state.target_architecture to be present');
  assert.notEqual(idealState.target_architecture.conformance_summary, null);
});

test('CDL-S-7: gate:architecture_delta never contributes to needs_verification / block regardless of its status', async () => {
  // No target-model.json fixture: the shadow stage's own scan is inconclusive, but this must not
  // surface as a blocking or needs_verification-inducing gate -- only as an info node.
  const repo = await makeGitRepoWithStory({ withTargetModel: false });
  const result = await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(result.exitCode, 0);
  const gateDag = result.result.preparation.pr_context.gate_dag;
  const gate = findGate(gateDag.nodes, 'gate:architecture_delta');
  assert.ok(gate);
  assert.equal(gate.status, 'info');
  assert.equal(gate.inconclusive, true);
  assert.equal(gate.required, false);
  assert.match(gate.reason, /target model が存在しない|conformance delta/);
});

// --- CDL-S-8: derive-only, no evidence, no staleness contribution ---------

test('CDL-S-8: the shadow stage never causes an unrelated gate to regress, isolated from injection alone', async () => {
  // Compares the *same* commit prepared with vs. without the conformanceDelta runner injected.
  // This isolates the shadow stage's own causal effect from unrelated, pre-existing pr prepare
  // behavior (e.g. engineering-judgment axis routing legitimately depends on which files changed),
  // which a naive "run pr prepare before/after a docs commit" comparison would conflate with this
  // story's change.
  const repo = await makeGitRepoWithStory({ withTargetModel: true });

  const withoutInjection = await preparePullRequest(repo, { storyId: STORY_ID, baseRef: 'main' });
  const withInjection = await preparePullRequest(repo, {
    storyId: STORY_ID,
    baseRef: 'main',
    conformanceDelta: (root, options) => Promise.resolve({
      schema_version: '0.1.0',
      base_ref: options.baseRef,
      head_ref: options.headRef,
      base: { status: 'ok', violation_count: 0, summary: {} },
      head: { status: 'ok', violation_count: 0, summary: {} },
      delta: { status: 'ok', new: [], resolved: [], unchanged: [], summary: { new_count: 0, new_by_severity: {}, resolved_count: 0, unchanged_count: 0, by_kind: {} } }
    })
  });

  const otherNodes = (dag) => Object.fromEntries(
    dag.nodes.filter((node) => node.id !== 'gate:architecture_delta').map((node) => [node.id, node.status])
  );
  assert.deepEqual(
    otherNodes(withInjection.preparation.pr_context.gate_dag),
    otherNodes(withoutInjection.preparation.pr_context.gate_dag)
  );
  assert.equal(
    withInjection.preparation.pr_context.gate_dag.summary.needs_evidence_count,
    withoutInjection.preparation.pr_context.gate_dag.summary.needs_evidence_count
  );
  assert.equal(
    withInjection.preparation.pr_context.gate_dag.overall_status,
    withoutInjection.preparation.pr_context.gate_dag.overall_status
  );

  const injectedGate = findGate(withInjection.preparation.pr_context.gate_dag.nodes, 'gate:architecture_delta');
  assert.equal(injectedGate.status, 'passed');
  const fallbackGate = findGate(withoutInjection.preparation.pr_context.gate_dag.nodes, 'gate:architecture_delta');
  assert.equal(fallbackGate.status, 'info');
});

test('CDL-S-8: a docs-only commit re-run recomputes the delta without creating recorded evidence for this stage', async () => {
  const repo = await makeGitRepoWithStory({ withTargetModel: true });

  const first = await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(first.exitCode, 0);

  await writeFile(path.join(repo, 'docs', 'notes.md'), '# Notes\n\nDocs-only continuation.\n');
  await git(repo, ['add', 'docs/notes.md']);
  await git(repo, ['commit', '-m', 'docs: continue after first pr prepare']);

  const second = await runCli(['pr', 'prepare', repo, '--story-id', STORY_ID, '--base', 'main', '--json']);
  assert.equal(second.exitCode, 0);
  const secondGate = findGate(second.result.preparation.pr_context.gate_dag.nodes, 'gate:architecture_delta');
  assert.equal(secondGate.status, 'passed');
  assert.equal(secondGate.inconclusive, false);
  // Derive-only (CDL-S-8): no recorded-evidence directory was created for this stage; only the
  // always-overwritten conformance.json / delta.json derived artifacts exist.
  const fs = await import('node:fs/promises');
  const reviewDir = path.join(repo, '.vibepro', 'review', STORY_ID, 'architecture_conformance_delta');
  await assert.rejects(fs.readdir(reviewDir), { code: 'ENOENT' });
});

// --- Dependency injection fallback -----------------------------------------

test('preparePullRequest without an injected conformanceDelta option falls back to an inconclusive info node, never throws', async () => {
  const repo = await makeGitRepoWithStory({ withTargetModel: true });
  const result = await preparePullRequest(repo, { storyId: STORY_ID, baseRef: 'main' });
  const gate = findGate(result.preparation.pr_context.gate_dag.nodes, 'gate:architecture_delta');
  assert.ok(gate);
  assert.equal(gate.status, 'info');
  assert.equal(gate.inconclusive, true);
  assert.match(gate.reason, /not injected/);
});
