import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-design-input-judgment';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-design-input-'));
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'workflow.js'), 'export function workflowGate(){ return "ready"; }\n');
  await writeGraphifyOut(repo);
  await runCli(['init', repo, '--story-id', STORY_ID, '--title', 'Design input judgment']);
  return repo;
}

async function makeGitRepo() {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init design input fixture']);
  await git(repo, ['switch', '-c', 'feature/design-input']);
  return repo;
}

async function writeGraphifyOut(repo) {
  await mkdir(path.join(repo, 'graphify-out'), { recursive: true });
  await writeFile(path.join(repo, 'graphify-out', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'src/workflow.js', source_file: 'src/workflow.js' },
      { id: `docs/management/stories/active/${STORY_ID}.md`, source_file: `docs/management/stories/active/${STORY_ID}.md` }
    ],
    links: [
      { source: 'src/workflow.js', target: `docs/management/stories/active/${STORY_ID}.md` }
    ]
  }, null, 2));
  await writeFile(path.join(repo, 'graphify-out', 'GRAPH_REPORT.md'), '# Graphify Report\n');
}

async function writeCrossSurfaceDesignChange(repo) {
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---
story_id: ${STORY_ID}
title: Design input judgment
architecture_docs:
  - docs/architecture/design-input-judgment.md
spec_docs:
  - docs/specs/design-input-judgment.md
---

# Design input judgment

## Background

Workflow-heavy Architecture and Spec should be informed by diagnosis before implementation.

## Acceptance Criteria

- [ ] Design-input diagnosis is visible before Architecture and Spec are treated as settled
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'design-input-judgment.md'), '# Design Input Architecture\n\nThe workflow gate records early judgment evidence.\n');
  await writeFile(path.join(repo, 'docs', 'specs', 'design-input-judgment.md'), '# Design Input Spec\n\n- The diagnosis phase is recorded.\n');
  await writeFile(path.join(repo, 'src', 'workflow.js'), 'export function workflowGate(){ return "design-input"; }\n');
}

function findGate(prepare, id) {
  return prepare.pr_context.gate_dag.nodes.find((node) => node.id === id);
}

async function runCliCaptured(args) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdout: { write: (chunk) => { stdout += chunk; } },
    stderr: { write: (chunk) => { stderr += chunk; } }
  });
  return { ...result, stdout, stderr };
}

test('story diagnose --pre-architecture records design-input judgment evidence', async () => {
  const repo = await makeRepo();
  const result = await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--pre-architecture']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.diagnosis.run.phase, 'design_input');
  assert.equal(result.result.diagnosis.run.design_input_judgment.phase, 'design_input');

  const evidence = JSON.parse(await readFile(path.join(repo, '.vibepro', 'diagnostics', result.result.diagnosis.run.run_id, 'evidence.json'), 'utf8'));
  assert.equal(evidence.diagnosis_phase.phase, 'design_input');
  assert.equal(evidence.design_input_judgment.phase, 'design_input');
  assert.deepEqual(evidence.design_input_judgment.feeds, ['architecture', 'spec', 'implementation_plan']);
});

test('story diagnose rejects unsupported phase instead of silently defaulting [parse_failure]', async () => {
  const repo = await makeRepo();
  const result = await runCliCaptured(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--phase', 'after-spec']);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Unsupported diagnosis phase: after-spec/);
  assert.doesNotMatch(result.stdout, /"phase"\s*:\s*"design_input"/);
});

test('story diagnose --phase design-input records the same design-input evidence as --pre-architecture', async () => {
  const repo = await makeRepo();
  const result = await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--phase', 'design-input']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.diagnosis.run.phase, 'design_input');
  assert.equal(result.result.diagnosis.run.design_input_judgment.phase, 'design_input');

  const evidence = JSON.parse(await readFile(path.join(repo, '.vibepro', 'diagnostics', result.result.diagnosis.run.run_id, 'evidence.json'), 'utf8'));
  assert.equal(evidence.diagnosis_phase.phase, 'design_input');
  assert.equal(evidence.design_input_judgment.phase, 'design_input');
});

test('pr prepare warns on cross-surface Architecture/Spec without design-input diagnosis', async () => {
  const repo = await makeGitRepo();
  await writeCrossSurfaceDesignChange(repo);
  await git(repo, ['add', 'docs/management/stories/active', 'docs/architecture', 'docs/specs', 'src/workflow.js']);
  await git(repo, ['commit', '-m', 'feat: add cross-surface design change']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.preparation.pr_context.design_input_judgment.status, 'missing');

  const gate = findGate(result.result.preparation, 'gate:design_input_judgment');
  assert.equal(gate.status, 'needs_review');
  assert.equal(gate.required, false);
  assert.match(gate.reason, /Design|Workflow-heavy|cross-surface/);
  assert.equal(result.result.preparation.pr_context.gate_dag.summary.design_input_judgment_status, 'needs_review');
});

test('pr prepare passes design-input gate when pre-architecture diagnosis exists', async () => {
  const repo = await makeGitRepo();
  await writeCrossSurfaceDesignChange(repo);
  await git(repo, ['add', 'docs/management/stories/active', 'docs/architecture', 'docs/specs', 'src/workflow.js']);
  await git(repo, ['commit', '-m', 'feat: add cross-surface design change']);
  await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--pre-architecture']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.preparation.pr_context.design_input_judgment.status, 'present');

  const gate = findGate(result.result.preparation, 'gate:design_input_judgment');
  assert.equal(gate.status, 'passed');
  assert.equal(result.result.preparation.pr_context.gate_dag.summary.design_input_judgment_status, 'passed');
});

test('pr prepare warns when design-input run exists but evidence artifact is missing', async () => {
  const repo = await makeGitRepo();
  await writeCrossSurfaceDesignChange(repo);
  await git(repo, ['add', 'docs/management/stories/active', 'docs/architecture', 'docs/specs', 'src/workflow.js']);
  await git(repo, ['commit', '-m', 'feat: add cross-surface design change']);
  const diagnosis = await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', '001-design-input', '--pre-architecture']);
  await unlink(path.join(repo, diagnosis.result.diagnosis.run.artifacts.evidence));

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.preparation.pr_context.design_input_judgment.status, 'missing');
  assert.equal(result.result.preparation.pr_context.design_input_judgment.source, 'story_diagnosis_artifact_missing');
  assert.equal(result.result.preparation.pr_context.design_input_judgment.artifact_status, 'missing');
  assert.equal(result.result.preparation.pr_context.design_input_judgment.run_id, '001-design-input');

  const gate = findGate(result.result.preparation, 'gate:design_input_judgment');
  assert.equal(gate.status, 'needs_review');
  assert.match(gate.required_actions.join('\n'), /Regenerate the missing design-input diagnosis evidence artifact/);
});

test('pr prepare preserves design-input judgment after later pre-implementation diagnosis [evidence_lifecycle_regression]', async () => {
  const repo = await makeGitRepo();
  await writeCrossSurfaceDesignChange(repo);
  await git(repo, ['add', 'docs/management/stories/active', 'docs/architecture', 'docs/specs', 'src/workflow.js']);
  await git(repo, ['commit', '-m', 'feat: add cross-surface design change']);
  const designInputRun = await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', '001-design-input', '--pre-architecture']);
  const preImplementationRun = await runCli(['story', 'diagnose', repo, '--id', STORY_ID, '--from', 'graphify-out', '--run-id', '002-pre-implementation']);
  assert.equal(designInputRun.result.diagnosis.run.phase, 'design_input');
  assert.equal(preImplementationRun.result.diagnosis.run.phase, 'pre_implementation');

  const designInputEvidence = JSON.parse(await readFile(path.join(repo, '.vibepro', 'diagnostics', '001-design-input', 'evidence.json'), 'utf8'));
  const preImplementationEvidence = JSON.parse(await readFile(path.join(repo, '.vibepro', 'diagnostics', '002-pre-implementation', 'evidence.json'), 'utf8'));
  assert.equal(designInputEvidence.diagnosis_phase.phase, 'design_input');
  assert.equal(designInputEvidence.design_input_judgment.phase, 'design_input');
  assert.equal(preImplementationEvidence.diagnosis_phase.phase, 'pre_implementation');
  assert.equal(preImplementationEvidence.pre_implementation_judgment.phase, 'pre_implementation');
  assert.equal(preImplementationEvidence.design_input_judgment, undefined);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--json']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.preparation.pr_context.design_input_judgment.status, 'present');
  assert.equal(result.result.preparation.pr_context.design_input_judgment.run_id, '001-design-input');
  assert.equal(result.result.preparation.pr_context.pre_implementation_judgment.phase, 'pre_implementation');

  const gate = findGate(result.result.preparation, 'gate:design_input_judgment');
  assert.equal(gate.status, 'passed');
  assert.equal(result.result.preparation.pr_context.gate_dag.summary.design_input_judgment_status, 'passed');
});
