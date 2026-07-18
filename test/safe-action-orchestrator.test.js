import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  assert.equal(result.state.stop_reason.details.recovery.failure, 'boom');
  assert.match(result.state.stop_reason.details.recovery.next_command, /execute resume .*--until pr-ready/);
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

test('SAO-S-4 unknown action cannot claim repo_local_safe classification', async () => {
  let calls = 0;
  const result = await runSafeActionPlan(state, {
    plan: [{ id: 'unknown_repo_action', classification: 'repo_local_safe', depends_on: [] }],
    runners: { unknown_repo_action: async () => { calls += 1; return { status: 'pr_ready' }; } }
  });
  assert.equal(calls, 0);
  assert.equal(result.state.status, 'blocked');
  assert.equal(result.state.stop_reason.code, 'action_forbidden');
  assert.equal(result.state.action_journal[0].action_id, 'unknown_repo_action');
  assert.equal(result.state.action_journal[0].status, 'forbidden');
});

test('SAO-S-4 canonical metadata spoofing is rejected before idempotency skip', async () => {
  const canonicalKey = buildSafeActionPlan(state)[1].idempotency_key;
  const completedState = {
    ...state,
    action_journal: [{
      action_id: 'pr_autopilot_safe', node_id: 'pr_autopilot_safe', input_head_sha: 'aaa',
      idempotency_key: canonicalKey, status: 'completed'
    }]
  };
  const cases = [
    { id: 'pr_autopilot_safe', classification: 'read_only', depends_on: ['pr_prepare'], idempotency_key: canonicalKey },
    { id: 'pr_autopilot_safe', classification: 'repo_local_safe', depends_on: [], idempotency_key: canonicalKey },
    { id: 'pr_autopilot_safe', classification: 'repo_local_safe', depends_on: ['pr_prepare', 'extra'], idempotency_key: canonicalKey },
    { id: 'pr_autopilot_safe', classification: 'repo_local_safe', idempotency_key: canonicalKey },
    { id: 'pr_autopilot_safe', classification: 'repo_local_safe', depends_on: 'pr_prepare', idempotency_key: canonicalKey },
    { id: 'pr_autopilot_safe', classification: 'repo_local_safe', depends_on: ['wrong_dependency'], idempotency_key: canonicalKey }
  ];
  for (const action of cases) {
    let calls = 0;
    const result = await runSafeActionPlan(completedState, {
      plan: [action],
      runners: { pr_autopilot_safe: async () => { calls += 1; return { status: 'pr_ready' }; } }
    });
    assert.equal(calls, 0);
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.stop_reason.code, 'action_forbidden');
    assert.equal(result.state.action_journal.at(-1).status, 'forbidden');
    assert.equal(result.state.action_journal.at(-1).artifact, null);
    assert.equal(result.state.action_journal.at(-1).result_summary, 'action_forbidden');
  }
});

test('SAO-S-4 canonical action without a registered runner is rejected before idempotency skip', async () => {
  const action = buildSafeActionPlan(state)[1];
  const completedState = {
    ...state,
    action_journal: [{
      action_id: action.id, node_id: action.node_id, input_head_sha: 'aaa',
      idempotency_key: action.idempotency_key, status: 'completed'
    }]
  };
  const result = await runSafeActionPlan(completedState, { plan: [action], runners: {} });
  assert.equal(result.state.status, 'blocked');
  assert.equal(result.state.stop_reason.code, 'action_forbidden');
  assert.equal(result.state.action_journal.at(-1).status, 'forbidden');
  assert.equal(result.state.action_journal.at(-1).artifact, null);
  assert.equal(result.state.action_journal.at(-1).result_summary, 'action_forbidden');
});

test('SAO-S-2 forged execution identity cannot bypass a completed canonical checkpoint', async () => {
  const action = buildSafeActionPlan(state)[1];
  const completedState = {
    ...state,
    action_journal: [{
      action_id: action.id, node_id: action.node_id, input_head_sha: action.input_head_sha,
      idempotency_key: action.idempotency_key, status: 'completed'
    }]
  };
  const cases = [
    { ...action, idempotency_key: 'forged-key' },
    { ...action, node_id: 'forged-node' },
    { ...action, input_head_sha: 'forged-head' }
  ];
  for (const forgedAction of cases) {
    let calls = 0;
    const result = await runSafeActionPlan(completedState, {
      plan: [forgedAction],
      runners: { pr_autopilot_safe: async () => { calls += 1; return { status: 'pr_ready' }; } }
    });
    assert.equal(calls, 0);
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.stop_reason.code, 'action_forbidden');
    assert.equal(result.state.action_journal.at(-1).status, 'forbidden');
  }
});

test('SAO-S-2 forged journal identity cannot silently skip a canonical action', async () => {
  const action = buildSafeActionPlan(state)[0];
  const baseEntry = {
    action_id: action.id, node_id: action.node_id, input_head_sha: action.input_head_sha,
    idempotency_key: action.idempotency_key, status: 'completed'
  };
  const cases = [
    { ...baseEntry, action_id: 'forged-action' },
    { ...baseEntry, node_id: 'forged-node' },
    { ...baseEntry, input_head_sha: 'forged-head' }
  ];
  for (const forgedEntry of cases) {
    let calls = 0;
    const result = await runSafeActionPlan({ ...state, action_journal: [forgedEntry] }, {
      plan: [action],
      runners: { pr_prepare: async () => { calls += 1; return { status: 'pr_ready' }; } }
    });
    assert.equal(calls, 1);
    assert.equal(result.state.status, 'pr_ready');
    assert.equal(result.state.action_journal.at(-1).action_id, 'pr_prepare');
    assert.equal(result.state.action_journal.at(-1).status, 'completed');
  }
});

test('SAO-S-1 injected plan cannot omit, reorder, or duplicate canonical dependencies', async () => {
  const [prepare, autopilot] = buildSafeActionPlan(state);
  const cases = [
    [autopilot],
    [autopilot, prepare],
    [prepare, prepare, autopilot]
  ];
  for (const plan of cases) {
    let autopilotCalls = 0;
    const result = await runSafeActionPlan(state, {
      plan,
      runners: {
        pr_prepare: async () => ({ status: 'continue' }),
        pr_autopilot_safe: async () => { autopilotCalls += 1; return { status: 'pr_ready' }; }
      }
    });
    assert.equal(autopilotCalls, 0);
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.stop_reason.code, 'action_forbidden');
    assert.equal(result.state.action_journal.at(-1).status, 'forbidden');
  }
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
  const failed = await make([{ kind: 'unit', status: 'fail', binding: { status: 'current' } }])('.', {});
  assert.equal(failed.stop_reason, 'verification_failed');
  assert.deepEqual(failed.recovery.failed_kinds, ['unit']);
  assert.equal((await make([{ kind: 'unit', status: 'pass', binding: { status: 'current' } }])('.', {})).status, 'pr_ready');
  assert.equal(prepareCalls, 4);
});

test('SAO-S-5 S-005 S-006 S-007 safe adapter resolves CLI, config, and pr_prepare verification inputs without execution', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-safe-adapter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    pr_autopilot: { verification_commands: [{ kind: 'integration', command: 'touch config-forbidden' }] }
  }));
  const safe = createSafeAutopilotPullRequest({
    preparePullRequest: async () => ({
      preparation: {
        story: { story_id: 'story-safe' },
        git: { head_sha: 'aaa' },
        gate_status: { ready_for_pr_create: true },
        pr_context: { verification_commands: [{ kind: 'e2e', command: 'touch prepare-forbidden' }] }
      }
    }),
    readEvidence: async () => ({ commands: [] }),
    bindEvidence: async (_repoRoot, evidence) => evidence
  });

  const result = await safe(root, { verifyCommands: ['unit=touch cli-forbidden'] });
  assert.equal(result.status, 'waiting_for_runtime');
  assert.equal(result.stop_reason, 'runtime_required');
  assert.deepEqual(result.recovery.missing_kinds.sort(), ['e2e', 'integration', 'unit']);
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

test('SAO-S-5 production safe adapter maps critical and human Gate outcomes', async () => {
  const run = async (gateStatus) => createSafeAutopilotPullRequest({
    preparePullRequest: async () => ({
      preparation: { story: { story_id: 'story-safe' }, git: { head_sha: 'aaa' }, gate_status: gateStatus }
    }),
    resolveCommands: async () => [{ kind: 'unit', command: 'never execute this' }],
    readEvidence: async () => ({ commands: [{ kind: 'unit', status: 'pass', binding: { status: 'current' } }] }),
    bindEvidence: async (_root, evidence) => evidence
  })('.', {});

  const critical = await run({
    ready_for_pr_create: false,
    unresolved_gates: [{ id: 'gate:critical', severity: 'critical' }]
  });
  assert.equal(critical.status, 'blocked');
  assert.equal(critical.stop_reason, 'gate:critical');
  assert.deepEqual(critical.recovery.required_actions, []);

  const generic = await run({
    ready_for_pr_create: false,
    next_required_actions: ['record deploy evidence']
  });
  assert.equal(generic.status, 'blocked');
  assert.deepEqual(generic.recovery.required_actions, ['record deploy evidence']);

  const human = await run({
    ready_for_pr_create: false,
    human_judgments_required: [{ kind: 'scope', reason: 'choose a boundary' }]
  });
  assert.equal(human.status, 'waiting_for_human');
  assert.equal(human.stop_reason, 'human_judgment_required');
  assert.deepEqual(human.recovery.judgments, [{ kind: 'scope', reason: 'choose a boundary' }]);
});
