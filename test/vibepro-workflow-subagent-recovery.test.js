import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const skillPath = path.resolve('skills/vibepro-workflow/SKILL.md');

test('VibePro workflow publishes a bounded same-owner subagent recovery policy', async () => {
  const policy = await readRecoveryPolicy();

  assert.equal(policy.owner_strategy, 'same_owner');
  assert.equal(policy.no_progress_limit, 3);
  assert.ok(Number.isFinite(policy.wait_timeout_seconds));
  assert.ok(policy.wait_timeout_seconds > 0);
  assert.equal(policy.before_limit_action, 'resume_same_owner');
  assert.equal(policy.at_limit_action, 'parent_direct_verification');
  assert.equal(policy.exact_head_success_action, 'stop');
  assert.deepEqual(policy.carry_forward_fields, [
    'objective',
    'head_sha',
    'cumulative_diff',
    'unresolved_conditions'
  ]);
});

test('three consecutive no-progress waits converge without owner proliferation', async () => {
  const policy = await readRecoveryPolicy();
  const owners = new Set(['reviewer-1']);
  const actions = [];

  for (let noProgressCount = 1; noProgressCount <= policy.no_progress_limit; noProgressCount += 1) {
    const action = noProgressCount < policy.no_progress_limit
      ? policy.before_limit_action
      : policy.at_limit_action;
    actions.push(action);
    if (action === 'resume_same_owner') owners.add('reviewer-1');
  }

  assert.deepEqual(actions, [
    'resume_same_owner',
    'resume_same_owner',
    'parent_direct_verification'
  ]);
  assert.equal(owners.size, 1);
  assert.notEqual(actions.at(-1), 'dispatch_replacement_owner');
});

test('exact-HEAD success stops before another wait or dispatch', async () => {
  const policy = await readRecoveryPolicy();
  const currentHead = 'abc123';
  const verifiedHead = 'abc123';
  const actions = [];

  if (currentHead === verifiedHead) actions.push(policy.exact_head_success_action);
  else actions.push('wait_or_dispatch');

  assert.deepEqual(actions, ['stop']);
});

async function readRecoveryPolicy() {
  const skill = await readFile(skillPath, 'utf8');
  const match = skill.match(
    /<!-- subagent-recovery-policy:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- subagent-recovery-policy:end -->/
  );
  assert.ok(match, 'workflow Skill must include its machine-testable subagent recovery policy');
  return JSON.parse(match[1]);
}
