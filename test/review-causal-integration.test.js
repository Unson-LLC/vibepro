import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  getAgentReviewStatus,
  prepareAgentReview,
  recordAgentReview
} from '../src/agent-review.js';

const execFileAsync = promisify(execFile);

async function git(root, args) {
  return execFileAsync('git', args, { cwd: root, encoding: 'utf8' });
}

async function commitAll(root, message) {
  await git(root, ['add', 'src', 'test', 'docs']);
  await git(root, ['add', '-f', '.vibepro/vibepro-manifest.json']);
  await git(root, ['commit', '-m', message]);
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-causal-review-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(path.join(root, 'src', 'runtime.js'), 'export const runtime = 1;\n');
  await writeFile(path.join(root, 'test', 'runtime.test.js'), 'export const runtimeTest = 1;\n');
  await writeFile(
    path.join(root, 'docs', 'management', 'stories', 'active', 'story-test.md'),
    '---\nstory_id: story-test\ntitle: Causal review fixture\n---\n\n# Story\n\n## Acceptance Criteria\n- Preserve the product contract.\n'
  );
  await writeFile(path.join(root, 'docs', 'specs', 'story-test.md'), '# Spec\n\nPreserve the product contract.\n');
  await writeFile(
    path.join(root, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', selected_story_id: 'story-test' })
  );
  await commitAll(root, 'initial causal review fixture');
  return root;
}

function strongAgentOptions() {
  return {
    agentSystem: 'codex',
    executionMode: 'parallel_subagent',
    agentId: `agent-${Math.random().toString(16).slice(2)}`,
    agentThreadId: `thread-${Math.random().toString(16).slice(2)}`,
    agentClosed: true
  };
}

async function recordPass(root, { stage, role, summary = 'pass', resolvedFindings = [] }) {
  return recordAgentReview(root, {
    storyId: 'story-test',
    stage,
    role,
    status: 'pass',
    summary,
    inspectionSummary: 'Inspected Story, Spec, runtime source, and focused test.',
    inspectionEvidence: 'test/runtime.test.js',
    inspectionInputs: [
      'docs/management/stories/active/story-test.md',
      'docs/specs/story-test.md',
      'src/runtime.js',
      'test/runtime.test.js'
    ],
    judgmentDeltas: ['initial concern -> pass after causal dependency inspection'],
    resolvedFindings,
    ...strongAgentOptions()
  });
}

test('code-only delta keeps upstream product judgment current but invalidates runtime descendants', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'planning_spec', roles: ['product_requirement'], language: 'en' });
  await recordPass(root, { stage: 'planning_spec', role: 'product_requirement' });
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'implementation', roles: ['runtime_contract'], language: 'en' });
  await recordPass(root, { stage: 'implementation', role: 'runtime_contract' });

  await writeFile(path.join(root, 'src', 'runtime.js'), 'export const runtime = 2;\n');
  await writeFile(path.join(root, 'test', 'runtime.test.js'), 'export const runtimeTest = 2;\n');
  await commitAll(root, 'change runtime implementation and focused test only');

  const planning = await getAgentReviewStatus(root, { storyId: 'story-test', stage: 'planning_spec' });
  const productRole = planning.stages[0].roles[0];
  assert.equal(productRole.effective_status, 'pass');
  assert.equal(productRole.binding_status, 'causal_reuse');
  assert.deepEqual(productRole.causal_invalidation.relevant_changed_files, []);

  const implementation = await getAgentReviewStatus(root, { storyId: 'story-test', stage: 'implementation' });
  const runtimeRole = implementation.stages[0].roles[0];
  assert.equal(runtimeRole.effective_status, 'stale');
  assert.equal(runtimeRole.binding_status, 'stale');
  assert.ok(runtimeRole.causal_invalidation.relevant_changed_files.some((item) => item.path === 'src/runtime.js'));
});

test('runtime failure is visible without masquerading as a product finding', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'requirement', roles: ['scope_risk'], language: 'en' });
  const recorded = await recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'requirement',
    role: 'scope_risk',
    status: 'runtime_failed',
    summary: 'Reviewer returned no payload.',
    runtimeFailureKind: 'empty_result',
    runtimeFailureDetail: 'subagent completed without a result body',
    ...strongAgentOptions()
  });
  assert.equal(recorded.review.runtime_failure.product_finding, false);
  const status = await getAgentReviewStatus(root, { storyId: 'story-test', stage: 'requirement' });
  assert.equal(status.stages[0].roles[0].effective_status, 'runtime_failed');
  assert.equal(status.convergence.snapshot.runtime_failures[0].kind, 'empty_result');
  assert.match(status.stages[0].next_actions[0], /Retry review runtime/);
});

test('resolved-finding replacement is recorded as delta closure and preserves original decision dependencies', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'implementation', roles: ['runtime_contract'], language: 'en' });
  await recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'implementation',
    role: 'runtime_contract',
    status: 'needs_changes',
    summary: 'Runtime path lacks the required fallback.',
    findings: ['high:runtime-fallback:Fallback path is missing'],
    inspectionSummary: 'Inspected runtime source and focused test.',
    inspectionEvidence: 'test/runtime.test.js',
    inspectionInputs: ['src/runtime.js', 'test/runtime.test.js'],
    judgmentDeltas: ['runtime path looked complete -> fallback missing'],
    ...strongAgentOptions()
  });
  await writeFile(path.join(root, 'src', 'runtime.js'), 'export const runtime = 2;\n');
  await writeFile(path.join(root, 'test', 'runtime.test.js'), 'export const runtimeTest = 2;\n');
  await commitAll(root, 'close runtime fallback finding');

  const replacement = await recordPass(root, {
    stage: 'implementation',
    role: 'runtime_contract',
    summary: 'Focused finding closure passed.',
    resolvedFindings: ['runtime-fallback:test/runtime.test.js']
  });
  assert.equal(replacement.review.delta_closure.mode, 'delta_closure');
  assert.deepEqual(replacement.review.delta_closure.unresolved_finding_ids, []);
  assert.ok(replacement.review.causal_review.decision_dependencies.some((item) => item.path === 'src/runtime.js'));
});
