import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSafeActionPlan, runSafeActionPlan } from '../src/safe-action-orchestrator.js';
import { createSafeAutopilotPullRequest } from '../src/pr-manager.js';

const state = {
  run_id: 'run-20260718T000000Z-1234abcd', story_id: 'story-safe',
  current_head_sha: 'aaa', status: 'running', attempt: 1, action_journal: []
};

test('SAO-S-1 dry-run returns a closed plan without invoking a runner', async () => {
  let calls = 0;
  const result = await runSafeActionPlan(state, {
    dryRun: true,
    runners: { pr_prepare: async () => { calls += 1; } }
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.plan.map((item) => item.id), ['pr_prepare', 'pr_autopilot_safe']);
  assert.equal(result.state, state);
});

test('SAO-S-2 completed same Run node and HEAD is skipped', async () => {
  let calls = 0;
  const key = buildSafeActionPlan(state)[0].idempotency_key;
  const current = { ...state, action_journal: [{ action_id: 'pr_prepare', node_id: 'pr_prepare', input_head_sha: 'aaa', idempotency_key: key, status: 'completed' }] };
  const result = await runSafeActionPlan(current, {
    runners: {
      pr_prepare: async () => { calls += 1; return { status: 'continue' }; },
      pr_autopilot_safe: async () => ({ status: 'pr_ready' })
    }
  });
  assert.equal(calls, 0);
  assert.equal(result.state.status, 'pr_ready');
});

test('SAO-S-3 action failure stops and records action_failed', async () => {
  const result = await runSafeActionPlan(state, { runners: { pr_prepare: async () => { throw new Error('boom'); } } });
  assert.equal(result.state.status, 'failed');
  assert.equal(result.state.stop_reason.code, 'action_failed');
  assert.equal(result.state.action_journal[0].status, 'failed');
});

test('SAO-S-4 forbidden action never invokes a runner', async () => {
  let calls = 0;
  const result = await runSafeActionPlan(state, {
    plan: [{ id: 'shell', classification: 'forbidden', depends_on: [] }],
    runners: { shell: async () => { calls += 1; } }
  });
  assert.equal(calls, 0);
  assert.equal(result.state.status, 'blocked');
  assert.equal(result.state.stop_reason.code, 'action_forbidden');
});

test('SAO-S-5 typed verification and critical stops are preserved', async () => {
  for (const stop of ['verification_failed', 'gate:critical']) {
    const result = await runSafeActionPlan(state, { runners: { pr_prepare: async () => ({ status: 'blocked', stop_reason: stop }) } });
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.stop_reason.code, stop);
  }
});

test('SAO-S-2 completed actions are checkpointed before the next action starts', async () => {
  const checkpoints = [];
  await runSafeActionPlan(state, {
    onProgress: async (current) => checkpoints.push(current.action_journal.map((entry) => entry.action_id)),
    runners: {
      pr_prepare: async () => ({ status: 'continue' }),
      pr_autopilot_safe: async () => ({ status: 'waiting_for_human', stop_reason: 'approval_required' })
    }
  });
  assert.deepEqual(checkpoints, [['pr_prepare']]);
});

test('SAO-S-5 safe autopilot classifies missing and failed current evidence without executing commands', async () => {
  const preparation = {
    story: { story_id: 'story-safe' },
    git: { head_sha: 'aaa' },
    gate_status: { ready_for_pr_create: true }
  };
  let prepareCalls = 0;
  const make = (commands) => createSafeAutopilotPullRequest({
    preparePullRequest: async () => { prepareCalls += 1; return { preparation }; },
    resolveCommands: async () => [{ kind: 'unit', command: 'touch forbidden' }],
    readEvidence: async () => ({ commands }),
    bindEvidence: async (_root, evidence) => evidence
  });
  assert.equal((await make([])('.', {})).stop_reason, 'runtime_required');
  assert.deepEqual((await make([])('.', {})).recovery.missing_kinds, ['unit']);
  assert.equal((await make([{ kind: 'unit', status: 'fail', binding: { status: 'current' } }])('.', {})).stop_reason, 'verification_failed');
  assert.equal((await make([{ kind: 'unit', status: 'pass', binding: { status: 'current' } }])('.', {})).status, 'pr_ready');
  assert.equal(prepareCalls, 4);
});

test('SAO-S-8 external safe autopilot options stop before preparation', async () => {
  let prepareCalls = 0;
  const safe = createSafeAutopilotPullRequest({ preparePullRequest: async () => { prepareCalls += 1; } });
  for (const option of [{ importCi: true }, { pr: 1 }, { ciChecks: ['x'] }, { env: { A: 'B' } }]) {
    const result = await safe('.', option);
    assert.equal(result.status, 'waiting_for_human');
    assert.equal(result.stop_reason, 'approval_required');
  }
  assert.equal(prepareCalls, 0);
});
