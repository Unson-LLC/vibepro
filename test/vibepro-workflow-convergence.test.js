import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const skillPath = path.resolve('skills/vibepro-workflow/SKILL.md');

test('VibePro workflow publishes the minimal-core convergence contract', async () => {
  const policy = await readConvergencePolicy();

  assert.deepEqual(policy.workflow, [
    'story',
    'spec',
    'implement',
    'affected_tests',
    'single_review_wave',
    'github_pr',
    'ci',
    'merge'
  ]);
  assert.equal(policy.review_waves, 1);
  assert.equal(policy.max_parallel_review_roles, 3);
  assert.equal(policy.max_total_review_dispatches, 5);
  assert.equal(policy.verification_scope_during_development, 'affected_tests');
  assert.equal(policy.full_suite_location, 'ci');
  assert.deepEqual(policy.exact_head_scope, ['ci', 'release_readback']);
  assert.equal(policy.legacy_gate_projection, 'informational_only');
  assert.equal(policy.pr_command, 'gh pr create');
});

test('review findings converge instead of expanding the current Story', async () => {
  const policy = await readConvergencePolicy();

  assert.equal(policy.blocking_finding_action, 'fix_then_reverify_affected_surface');
  assert.equal(policy.non_blocking_finding_action, 'follow_up_story');
  assert.equal(
    policy.review_runtime_failure_action,
    'report_runtime_failure_without_product_finding'
  );

  const dispatches = Array.from(
    { length: policy.max_total_review_dispatches + 2 },
    (_, index) => index + 1
  );
  const executed = dispatches.filter((count) => count <= policy.max_total_review_dispatches);
  assert.equal(executed.length, 5);
  assert.equal(executed.at(-1), policy.max_total_review_dispatches);
});

test('E2E uses a deterministic fixture and at most one real fresh-task smoke', async () => {
  const policy = await readConvergencePolicy();

  assert.equal(policy.e2e.deterministic_fixture_required, true);
  assert.equal(policy.e2e.fresh_task_smoke_max, 1);
});

test('workflow no longer publishes the removed review-lifecycle loop', async () => {
  const skill = await readFile(skillPath, 'utf8');

  assert.doesNotMatch(skill, /subagent-recovery-policy:start/);
  assert.doesNotMatch(skill, /vibepro review authorize/);
  assert.doesNotMatch(skill, /vibepro review start/);
  assert.doesNotMatch(skill, /vibepro review close/);
  assert.doesNotMatch(skill, /vibepro review repair/);
  assert.doesNotMatch(skill, /gate_status\.ready_for_pr_create/);
  assert.match(skill, /A new commit SHA alone does not invalidate an unrelated test or review\./);
  assert.match(skill, /Treat any legacy Gate status[\s\S]*as informational only\./);
  assert.match(skill, /gh pr create/);
});

async function readConvergencePolicy() {
  const skill = await readFile(skillPath, 'utf8');
  const match = skill.match(
    /<!-- minimal-core-convergence-policy:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- minimal-core-convergence-policy:end -->/
  );
  assert.ok(match, 'workflow Skill must include its machine-tested convergence policy');
  return JSON.parse(match[1]);
}
