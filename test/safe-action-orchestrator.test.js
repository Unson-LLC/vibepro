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

test('SAO-S-4 GAH-S-4 unknown action cannot claim repo_local_safe classification', async () => {
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
      plan: buildSafeActionPlan(state),
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
    [prepare],
    [autopilot],
    [autopilot, prepare],
    [prepare, prepare, autopilot]
  ];
  for (const plan of cases) {
    let prepareCalls = 0;
    let autopilotCalls = 0;
    const result = await runSafeActionPlan(state, {
      plan,
      runners: {
        pr_prepare: async () => { prepareCalls += 1; return { status: 'continue' }; },
        pr_autopilot_safe: async () => { autopilotCalls += 1; return { status: 'pr_ready' }; }
      }
    });
    assert.equal(prepareCalls, 0);
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

test('AAD-S-1 autonomous profile exposes the closed implementation DAG', () => {
  const plan = buildSafeActionPlan(state, { profile: 'autonomous' });
  assert.deepEqual(plan.map((action) => action.id), [
    'diagnose', 'prepare_artifacts', 'implement', 'verify', 'review', 'repair', 'final_prepare'
  ]);
  assert.deepEqual(plan.map((action) => action.depends_on), [
    [], ['diagnose'], ['prepare_artifacts'], ['implement'], ['verify'], ['review'], ['repair']
  ]);
  assert.ok(plan.every((action) => action.action_profile === 'autonomous'));
});

test('AAD-S-2 autonomous checkpoints are idempotent for the same Run and HEAD', async () => {
  const autonomousState = { ...state, action_profile: 'autonomous' };
  const plan = buildSafeActionPlan(autonomousState);
  const calls = [];
  const runners = Object.fromEntries(plan.map(({ id }) => [id, async () => {
    calls.push(id);
    return { status: id === 'final_prepare' ? 'pr_ready' : 'continue' };
  }]));
  const first = await runSafeActionPlan(autonomousState, { runners });
  assert.equal(first.state.status, 'pr_ready');
  assert.deepEqual(calls, plan.map(({ id }) => id));
  calls.length = 0;
  const resumed = await runSafeActionPlan({ ...first.state, status: 'running' }, { runners });
  assert.deepEqual(calls, []);
  assert.equal(resumed.state.action_journal.length, plan.length);
});

test('AAD-S-3 HEAD-changing implement rebinds the remaining autonomous suffix', async () => {
  const oldHead = state.current_head_sha;
  const newHead = 'bbb';
  const autonomousState = { ...state, action_profile: 'autonomous' };
  const calls = [];
  const runners = Object.fromEntries(buildSafeActionPlan(autonomousState).map(({ id }) => [id, async () => {
    calls.push(id);
    if (id === 'implement') return { status: 'continue', output_head_sha: newHead };
    return { status: id === 'final_prepare' ? 'pr_ready' : 'continue' };
  }]));

  const result = await runSafeActionPlan(autonomousState, { runners });

  assert.equal(result.state.status, 'pr_ready');
  assert.equal(result.state.current_head_sha, newHead);
  assert.deepEqual(calls, [
    'diagnose', 'prepare_artifacts', 'implement', 'verify', 'review', 'repair', 'final_prepare'
  ]);
  assert.deepEqual(
    result.state.action_journal.map((entry) => [entry.action_id, entry.input_head_sha, entry.output_head_sha]),
    [
      ['diagnose', oldHead, oldHead],
      ['prepare_artifacts', oldHead, oldHead],
      ['implement', oldHead, newHead],
      ['verify', newHead, newHead],
      ['review', newHead, newHead],
      ['repair', newHead, newHead],
      ['final_prepare', newHead, newHead]
    ]
  );
  assert.notEqual(
    result.state.action_journal.find((entry) => entry.action_id === 'implement').idempotency_key,
    result.state.action_journal.find((entry) => entry.action_id === 'verify').idempotency_key
  );
});

test('AAD-S-3 autonomous profile rejects missing runners and forged plans', async () => {
  const autonomousState = { ...state, action_profile: 'autonomous' };
  const missing = await runSafeActionPlan(autonomousState, { runners: {} });
  assert.equal(missing.state.stop_reason.code, 'action_forbidden');
  const [diagnose, ...rest] = buildSafeActionPlan(autonomousState);
  const forged = await runSafeActionPlan(autonomousState, {
    plan: [{ ...diagnose, classification: 'repo_local_unsafe' }, ...rest],
    runners: Object.fromEntries([diagnose, ...rest].map(({ id }) => [id, async () => ({ status: 'continue' })]))
  });
  assert.equal(forged.state.stop_reason.code, 'action_forbidden');
});

test('AAD-S-4 autonomous runners must return a typed result', async () => {
  const autonomousState = { ...state, action_profile: 'autonomous' };
  const result = await runSafeActionPlan(autonomousState, {
    runners: { diagnose: async () => ({}) }
  });
  assert.equal(result.state.status, 'failed');
  assert.match(result.state.stop_reason.details.recovery.failure, /Invalid safe action result status/);
});

test('AAD-S-5 unknown action profiles fail closed', () => {
  assert.throws(() => buildSafeActionPlan(state, { profile: 'untrusted' }), /Unknown safe action profile/);
});

test('AAD-S-2 policy-denied autonomous actions fail closed before their runner executes', async () => {
  const autonomousState = { ...state, action_profile: 'autonomous' };
  let called = false;
  const result = await runSafeActionPlan(autonomousState, {
    policyDeniedActionIds: ['diagnose'],
    runners: { diagnose: async () => { called = true; return { status: 'continue' }; } }
  });
  assert.equal(called, false);
  assert.equal(result.state.status, 'blocked');
  assert.equal(result.state.stop_reason.code, 'action_forbidden');
});

test('AAD-S-4 only final_prepare may produce pr_ready', async () => {
  const autonomousState = { ...state, action_profile: 'autonomous' };
  const result = await runSafeActionPlan(autonomousState, {
    runners: { diagnose: async () => ({ status: 'pr_ready' }) }
  });
  assert.equal(result.state.status, 'failed');
  assert.match(result.state.stop_reason.details.recovery.failure, /Only autonomous final_prepare/);
});

test('AAD-S-4 final_prepare cannot continue past the terminal DAG node', async () => {
  const autonomousState = { ...state, action_profile: 'autonomous' };
  const runners = Object.fromEntries(buildSafeActionPlan(autonomousState).map(({ id }) => [
    id,
    async () => ({ status: 'continue' })
  ]));
  const result = await runSafeActionPlan(autonomousState, { runners });
  assert.equal(result.state.status, 'failed');
  assert.match(result.state.stop_reason.details.recovery.failure, /final_prepare must return pr_ready or a typed stop/);
});

for (const actionId of ['diagnose', 'prepare_artifacts', 'implement', 'verify', 'review', 'repair', 'final_prepare']) {
  for (const terminalStatus of ['waiting_for_human', 'waiting_for_runtime', 'blocked', 'failed']) {
    test(`AAD-S-6 ${actionId} ${terminalStatus} stops before dependent autonomous nodes`, async () => {
    const autonomousState = { ...state, action_profile: 'autonomous' };
    const calls = [];
    const runners = Object.fromEntries(buildSafeActionPlan(autonomousState).map(({ id }) => [id, async () => {
      calls.push(id);
      return id === actionId
        ? { status: terminalStatus, stop_reason: `${terminalStatus}_reason` }
        : { status: 'continue' };
    }]));
    const result = await runSafeActionPlan(autonomousState, {
      runners
    });
    assert.equal(calls.at(-1), actionId);
    assert.equal(result.state.status, terminalStatus);
    assert.equal(result.state.action_journal.length, calls.length);
    assert.equal(result.state.stop_reason.code, `${terminalStatus}_reason`);
    });
  }
}

test('AAD-S-5 explicitly selecting legacy keeps the two-node rollback path', () => {
  const plan = buildSafeActionPlan({ ...state, action_profile: 'autonomous' }, { profile: 'legacy' });
  assert.deepEqual(plan.map(({ id }) => id), ['pr_prepare', 'pr_autopilot_safe']);
  assert.ok(plan.every((action) => action.action_profile === undefined));
});

test('AAD-S-5 disabling autonomous explicitly falls back to the legacy plan', () => {
  const plan = buildSafeActionPlan(state, { profile: 'autonomous', autonomousEnabled: false });
  assert.deepEqual(plan.map(({ id }) => id), ['pr_prepare', 'pr_autopilot_safe']);
});

test('AAD-S-6 dependency-incomplete suffix cannot execute its runner', async () => {
  const autonomousState = { ...state, action_profile: 'autonomous' };
  const [, prepareArtifacts, ...rest] = buildSafeActionPlan(autonomousState);
  let called = false;
  const result = await runSafeActionPlan(autonomousState, {
    plan: [prepareArtifacts, ...rest],
    runners: { prepare_artifacts: async () => { called = true; return { status: 'continue' }; } }
  });
  assert.equal(called, false);
  assert.equal(result.state.stop_reason.code, 'action_forbidden');
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
