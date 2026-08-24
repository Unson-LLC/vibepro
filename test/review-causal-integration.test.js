import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  getAgentReviewStatus,
  prepareAgentReview,
  recordAgentReview
} from '../src/agent-review.js';
import { initWorkspace } from '../src/workspace.js';

const execFileAsync = promisify(execFile);

test('code-only delta keeps upstream product judgment current but invalidates runtime descendants using recorded surfaces', async () => {
  const repo = await setupRepo();
  await recordPass(repo, {
    stage: 'planning_spec',
    role: 'product_requirement',
    inspectionInputs: [storyPath, specPath, 'src/runtime.js', 'test/runtime.test.js']
  });
  await recordPass(repo, {
    stage: 'implementation',
    role: 'runtime_contract',
    inspectionInputs: [specPath, 'src/runtime.js', 'test/runtime.test.js']
  });

  await writeFile(path.join(repo, 'src/runtime.js'), 'export const runtime = 2;\n');
  await writeFile(path.join(repo, 'test/runtime.test.js'), 'export const expected = 2;\n');
  await commitAll(repo, 'implementation and test fix');

  const status = await getAgentReviewStatus(repo, { storyId });
  const product = findRole(status, 'planning_spec', 'product_requirement');
  const runtime = findRole(status, 'implementation', 'runtime_contract');
  assert.equal(product.effective_status, 'pass');
  assert.equal(product.binding_status, 'causal_reuse');
  assert.equal(product.causal_invalidation.reusable, true);
  assert.equal(product.causal_invalidation.invalidation_surface_used, true);
  assert.deepEqual(
    product.causal_invalidation.recorded_invalidation_surface.map((item) => item.domain).sort(),
    ['spec', 'story']
  );
  assert.equal(runtime.effective_status, 'stale');
  assert.equal(runtime.causal_invalidation.reusable, false);
  assert.equal(runtime.causal_invalidation.invalidation_surface_used, true);
  assert.deepEqual(runtime.causal_invalidation.relevant_changed_files.map((item) => item.domain).sort(), ['implementation', 'test']);
});

test('runtime failure is visible without masquerading as a product finding and a successful retry replaces it', async () => {
  const repo = await setupRepo();
  await recordAgentReview(repo, {
    storyId,
    stage: 'requirement',
    role: 'scope_risk',
    status: 'runtime_failed',
    summary: 'Reviewer returned no usable result.',
    runtimeFailureKind: 'empty_result',
    runtimeFailureDetail: 'subagent completed without a result payload',
    ...strongAgent('runtime-failed')
  });
  let status = await getAgentReviewStatus(repo, { storyId });
  let role = findRole(status, 'requirement', 'scope_risk');
  assert.equal(role.effective_status, 'runtime_failed');
  assert.equal(role.runtime_failure.kind, 'empty_result');
  assert.equal(role.finding_count, 0);

  await recordPass(repo, {
    stage: 'requirement',
    role: 'scope_risk',
    inspectionInputs: [storyPath, specPath, 'src/runtime.js'],
    suffix: 'retry'
  });
  status = await getAgentReviewStatus(repo, { storyId });
  role = findRole(status, 'requirement', 'scope_risk');
  assert.equal(role.effective_status, 'pass');
  assert.equal(role.runtime_failure, null);
});

test('HEAD-only change without a new review event does not advance convergence wave or no-progress count', async () => {
  const repo = await setupRepo();
  await recordPass(repo, {
    stage: 'planning_spec',
    role: 'product_requirement',
    inspectionInputs: [storyPath, specPath]
  });
  const before = await getAgentReviewStatus(repo, { storyId });
  await writeFile(path.join(repo, 'README.md'), '# unrelated head-only observation\n');
  await commitAll(repo, 'unrelated docs head');
  const after = await getAgentReviewStatus(repo, { storyId });
  assert.equal(after.convergence.wave_count, before.convergence.wave_count);
  assert.equal(after.convergence.no_progress_count, before.convergence.no_progress_count);
  assert.equal(after.convergence.event_advanced, false);
  assert.equal(after.convergence.progress_detected, false);
  assert.ok(after.convergence.progress_reasons.includes('head_only_observation'));
});

test('resolved-finding replacement is recorded as delta closure and preserves original decision dependencies', async () => {
  const repo = await setupRepo();
  await recordAgentReview(repo, {
    storyId,
    stage: 'requirement',
    role: 'scope_risk',
    status: 'needs_changes',
    summary: 'Scope finding requires a focused repair.',
    findings: [{ severity: 'high', id: 'scope-a', detail: 'runtime scope is too broad' }],
    inspectionSummary: 'Inspected Story, Spec, and runtime implementation.',
    inspectionInputs: [storyPath, specPath, 'src/runtime.js'],
    judgmentDeltas: ['assumed bounded scope -> found an unbounded runtime path'],
    ...strongAgent('finding')
  });
  await writeFile(path.join(repo, 'src/runtime.js'), 'export const runtime = "bounded";\n');
  await commitAll(repo, 'repair finding');
  const replacement = await recordPass(repo, {
    stage: 'requirement',
    role: 'scope_risk',
    inspectionInputs: ['src/runtime.js', 'test/runtime.test.js'],
    resolvedFindings: ['scope-a:test/runtime.test.js'],
    suffix: 'closure'
  });
  assert.equal(replacement.review.delta_closure.mode, 'delta_closure');
  assert.deepEqual(replacement.review.delta_closure.unresolved_finding_ids, []);
  assert.ok(replacement.review.causal_review.invalidation_surface.some((item) => item.path === storyPath));
  assert.ok(replacement.review.causal_review.invalidation_surface.some((item) => item.path === specPath));
});

test('strict-head final review remains stale after any candidate HEAD change', async () => {
  const repo = await setupRepo();
  const recorded = await recordPass(repo, {
    stage: 'gate',
    role: 'release_risk',
    inspectionInputs: [storyPath, specPath, 'src/runtime.js', 'test/runtime.test.js'],
    suffix: 'strict-fixture'
  });
  const artifactPath = path.join(repo, recorded.artifact);
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  artifact.freshness_policy = {
    schema_version: '0.1.0',
    configured_mode: 'strict_head',
    effective_mode: 'strict_head',
    source: 'role_policy',
    reason: 'fixture represents final candidate certification'
  };
  artifact.content_binding.mode = 'strict_head';
  artifact.content_binding.status = 'strict_head';
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  await writeFile(path.join(repo, 'README.md'), '# candidate changed\n');
  await commitAll(repo, 'new candidate head');
  const status = await getAgentReviewStatus(repo, { storyId });
  const role = findRole(status, 'gate', 'release_risk');
  assert.equal(role.effective_status, 'stale');
  assert.match(role.stale_reason, /strict HEAD/);
});

test('review_nonconvergent stops automatic redispatch while explicit human-directed retry remains possible', async () => {
  const repo = await setupRepo();
  const convergenceDir = path.join(repo, '.vibepro', 'reviews', storyId, 'convergence');
  await mkdir(convergenceDir, { recursive: true });
  await writeFile(path.join(convergenceDir, 'current.json'), `${JSON.stringify({
    schema_version: '0.2.0',
    model: 'vibepro-review-convergence-v2',
    status: 'review_nonconvergent',
    wave_count: 4,
    no_progress_count: 3,
    next_action: 'Escalate unresolved review state.',
    snapshot: {
      event_cursor: 'event-x',
      exact_signature: 'exact-x',
      progress_signature: 'progress-x'
    }
  }, null, 2)}\n`);

  const automatic = await prepareAgentReview(repo, { storyId, stage: 'requirement' });
  assert.deepEqual(automatic.plan.roles, []);
  assert.equal(automatic.plan.causal_review.dispatch_allowed, false);
  assert.equal(automatic.plan.parallel_dispatch.required, false);
  assert.equal(automatic.plan.parallel_dispatch.coordinator_behavior.expected, 'stop_nonconvergent');

  const explicit = await prepareAgentReview(repo, {
    storyId,
    stage: 'requirement',
    roles: ['scope_risk']
  });
  assert.deepEqual(explicit.plan.roles, ['scope_risk']);
  assert.equal(explicit.plan.causal_review.dispatch_allowed, true);
});

const storyId = 'story-test';
const storyPath = 'docs/management/stories/active/story-test.md';
const specPath = 'docs/specs/story-test.md';

async function setupRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-review-causal-integration-'));
  await execFileAsync('git', ['init'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  await initWorkspace(repo);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'test'), { recursive: true });
  await mkdir(path.join(repo, path.dirname(storyPath)), { recursive: true });
  await mkdir(path.join(repo, path.dirname(specPath)), { recursive: true });
  await writeFile(path.join(repo, storyPath), `---\nstory_id: ${storyId}\ntitle: Test Story\nstatus: active\n---\n# Story\n`);
  await writeFile(path.join(repo, specPath), `---\nstory_id: ${storyId}\n---\n# Spec\n`);
  await writeFile(path.join(repo, 'src/runtime.js'), 'export const runtime = 1;\n');
  await writeFile(path.join(repo, 'test/runtime.test.js'), 'export const expected = 1;\n');
  await commitAll(repo, 'initial');
  return repo;
}

async function commitAll(repo, message) {
  await execFileAsync('git', ['add', '-A'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', message], { cwd: repo });
}

async function recordPass(repo, {
  stage,
  role,
  inspectionInputs,
  resolvedFindings = [],
  suffix = 'pass'
}) {
  return recordAgentReview(repo, {
    storyId,
    stage,
    role,
    status: 'pass',
    summary: `${stage}:${role} passed`,
    inspectionSummary: `Inspected ${inspectionInputs.join(', ')}`,
    inspectionEvidence: `evidence-${suffix}`,
    inspectionInputs,
    judgmentDeltas: [`before ${suffix} -> after ${suffix}`],
    resolvedFindings,
    ...strongAgent(`${stage}-${role}-${suffix}`)
  });
}

function strongAgent(id) {
  return {
    agentSystem: 'codex',
    executionMode: 'parallel_subagent',
    agentId: `agent-${id}`,
    agentSessionId: `session-${id}`,
    implementationSessionId: `implementation-${id}`,
    reviewerIdentity: 'separate_session',
    agentClosed: true,
    agentCloseEvidence: `close-${id}`
  };
}

function findRole(status, stage, role) {
  return status.stages.find((item) => item.stage === stage).roles.find((item) => item.role === role);
}
