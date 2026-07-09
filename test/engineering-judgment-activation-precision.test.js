import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function makeGitRepoWithStory() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-axis-precision-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-pr-prepare', '--title', 'Axis precision fixture', '--view', 'dev', '--period', '2026-06']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init story repo']);
  await git(repo, ['switch', '-c', 'feature/axis-precision']);
  return repo;
}

test('text-only workflow language does not activate execution topology axis', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Workflow review wording in docs only
architecture_docs:
  - docs/architecture/workflow-notes.md
---

# Story

## 背景

This note mentions workflow, review, artifact, and gate wording for human documentation only.

## 受け入れ基準

- [ ] docs wording stays consistent
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'workflow-notes.md'), '# Workflow Notes\n\nThis documentation mentions workflow review artifact language.\n');
  await git(repo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'docs/architecture/workflow-notes.md']);
  await git(repo, ['commit', '-m', 'docs: add workflow wording only']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const axis = result.result.preparation.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'execution_topology');
  assert.equal(axis.status, 'inactive');
  assert.equal(axis.activation_candidates.some((signal) => signal === 'text:execution_topology'), true);
  assert.deepEqual(axis.activation_signals, []);
  assert.equal(axis.activation_precision.status, 'insufficient_signal');
  assert.match(axis.activation_precision.reason, /text-derived candidates/);

  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.doesNotMatch(prBody, /Engineering Judgment: agent_workflow \/ dag=agent_workflow_dag/);
  assert.doesNotMatch(prBody, /suppressed=execution_topology\[insufficient_signal\]/);
  assert.doesNotMatch(prBody, /suppressed_candidates: execution_topology\[insufficient_signal\]/);
  const gateDag = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'gate-dag.json'), 'utf8'));
  assert.deepEqual(
    gateDag.summary.suppressed_judgment_axes.map((item) => [item.axis, item.precision_status]),
    [['execution_topology', 'insufficient_signal']]
  );
  const gateDagHtml = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'gate-dag.html'), 'utf8');
  assert.match(gateDagHtml, /Suppressed Axis Candidates/);
  assert.match(gateDagHtml, /execution_topology\[insufficient_signal\]/);
  const reviewCockpit = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'review-cockpit.html'), 'utf8');
  assert.match(reviewCockpit, /Suppressed Axes/);
  assert.match(reviewCockpit, /execution_topology: suppressed/);

  const refTopology = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'ref-topology.json'), 'utf8'));
  assert.equal(refTopology.fetch_performed, false);
  assert.equal(refTopology.refs.base_ref, 'main');
  assert.equal(refTopology.base_selection.rule, 'cli_option');
});

test('docs-only security path wording is suppressed until stronger topology or risk evidence appears', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'architecture', 'security-token-copy.md'), '# Security Token Copy\n\nA docs-only note about token naming.\n');
  await git(repo, ['add', 'docs/architecture/security-token-copy.md']);
  await git(repo, ['commit', '-m', 'docs: add security token wording']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const axis = result.result.preparation.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'security_boundary');
  assert.equal(axis.status, 'inactive');
  assert.equal(axis.activation_precision.status, 'insufficient_signal');
  assert.match(axis.activation_precision.reason, /docs\/UI composition/);
  assert.equal(axis.activation_precision.composition.docs_or_ui_composition_only, true);
});

test('non-text workflow corroboration activates execution topology axis', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: Workflow runtime change
---

# Story

- [ ] workflow replay remains reconstructable
`);
  await writeFile(path.join(repo, 'src', 'workflow-agent.js'), 'export function replayAgentWorkflow(){ return "agent workflow gate artifact replay"; }\n');
  await git(repo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'src/workflow-agent.js']);
  await git(repo, ['commit', '-m', 'feat: change workflow runtime']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const axis = result.result.preparation.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'execution_topology');
  assert.notEqual(axis.status, 'inactive');
  assert.equal(axis.activation_precision.status, 'active');
  assert.equal(axis.activation_precision.non_text_signal_count >= 1, true);
  assert.equal(axis.activation_signals.some((signal) => signal.startsWith('surface:') || signal.startsWith('changed_path:')), true);
});

test('runtime route corroboration activates public contract axis', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-pr-prepare.md'), `---
story_id: story-pr-prepare
title: CLI output contract runtime change
---

# Story

## 背景

This story updates CLI output contract wording and runtime behavior together.

## 受け入れ基準

- [ ] CLI output contract remains reviewable
`);
  await writeFile(path.join(repo, 'src', 'cli-output.js'), 'export function renderOutput(){ return \"public cli output format\"; }\n');
  await git(repo, ['add', 'docs/management/stories/active/story-pr-prepare.md', 'src/cli-output.js']);
  await git(repo, ['commit', '-m', 'feat: change cli output runtime']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-pr-prepare', '--json']);
  assert.equal(result.exitCode, 0);
  const axis = result.result.preparation.pr_context.engineering_judgment.judgment_axes.find((item) => item.axis === 'public_contract');
  assert.notEqual(axis.status, 'inactive');
  assert.equal(axis.activation_precision.status, 'active');
  assert.equal(
    axis.activation_signals.some((signal) => (
      signal.startsWith('pr_route:')
      || signal.startsWith('changed_path:')
      || signal.startsWith('file_group:')
      || signal.startsWith('network_contract:')
    )),
    true
  );
});
