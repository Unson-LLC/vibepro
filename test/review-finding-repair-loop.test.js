import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli.js';

import {
  createFindingRepairPlan,
  dispatchFindingRepair,
  dispatchFindingRepairFromRepo,
  getFindingRepairStatus,
  pollFindingRepairFromRepo,
  recordFindingRepair,
  recordFindingRepairAttempt,
  summarizeFindingRepairState
} from '../src/review-finding-repair-loop.js';

const review = (status = 'needs_changes', findings = [{
  id: 'missing-regression', severity: 'high', detail: 'src/api.js lacks a regression test',
  acceptance_clause: 'RFR-S-4', code_scope: ['src/api.js'], test_scope: ['test/api.test.js']
}]) => ({ status, head_commit: 'head-1', stage: 'runtime', role: 'runtime', recorded_at: '2026-07-20T00:00:00Z', findings });

const rereview = (overrides = {}) => ({ status: 'pass', head_sha: 'head-2', stage: 'runtime', role: 'runtime',
  agent_identity: 'reviewer', session_id: 'review-session', lifecycle: 'closed', findings: [], ...overrides });

test('RFR-S-1 RFR-S-2 one-fix plan preserves verdict and creates a bounded task', () => {
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review(), maxAttempts: 3 });
  assert.equal(state.original_review.status, 'needs_changes');
  assert.equal(state.attempts[0].disposition, 'repairable');
  assert.deepEqual(state.attempts[0].task.code_scope, ['src/api.js']);
  assert.deepEqual(state.attempts[0].task.test_scope, ['test/api.test.js']);
  assert.equal(state.next_action.type, 'dispatch_implementation');
});

test('RFR-S-2 repair task delegates only through the Agent Runtime coordinator', async () => {
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() });
  let received;
  const next = await dispatchFindingRepair(state, {
    adapterId: 'codex', requirements: { capabilities: ['code'], timeout_ms: 1000, managed_worktree: '/tmp/work' },
    runState: { story_id: 'story-1' }, runtimeCoordinator: { dispatch: async (runState, request) => {
      received = { runState, request };
      return { state: { ...runState, status: 'running' }, dispatch: { dispatch_id: 'dispatch-1', status: 'running' } };
    } }
  });
  assert.equal(received.request.role, 'implementation');
  assert.equal(received.request.task_id, state.attempts[0].task.task_id);
  assert.equal(next.status, 'repairing');
});

test('RFR-S-3 unrepairable block creates a Human Checkpoint', () => {
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'security', role: 'security', review: review('block', [{
    id: 'security-boundary', severity: 'critical', detail: 'security architecture boundary requires owner decision'
  }]) });
  assert.equal(state.status, 'human_checkpoint');
  assert.equal(state.attempts[0].disposition, 'human_decision');
  assert.equal(state.next_action.type, 'human_checkpoint');
});

test('RFR-S-4 RFR-S-5 repaired attempt requires current-head verification and independent fresh re-review', () => {
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() });
  const next = recordFindingRepairAttempt(state, {
    headSha: 'head-2', implementationIdentity: 'impl', implementationSessionId: 'impl-session',
    verification: { status: 'pass', head_sha: 'head-2' }, prPrepare: { status: 'ready', head_sha: 'head-2' },
    rereview: rereview()
  });
  assert.equal(next.status, 'converged');
  assert.equal(next.original_review.status, 'needs_changes');
  assert.equal(next.attempts[0].rereview.fresh_independent, true);
});

test('RFR-S-7 stale evidence cannot converge', () => {
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() });
  assert.throws(() => recordFindingRepairAttempt(state, {
    headSha: 'head-2', implementationIdentity: 'impl', implementationSessionId: 'same',
    verification: { status: 'pass', head_sha: 'head-1' }, prPrepare: { status: 'ready', head_sha: 'head-2' },
    rereview: rereview({ session_id: 'same' })
  }), /current HEAD|independent/);
});

test('RFR-S-6 multi-attempt repeated fingerprint without HEAD progress stops no_progress', () => {
  let state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review(), maxAttempts: 3 });
  state = recordFindingRepairAttempt(state, {
    headSha: 'head-1', implementationIdentity: 'impl', implementationSessionId: 'impl-1',
    verification: { status: 'pass', head_sha: 'head-1' }, prPrepare: { status: 'ready', head_sha: 'head-1' },
    rereview: rereview({ status: 'needs_changes', head_sha: 'head-1', session_id: 'review-1', findings: review().findings })
  });
  assert.equal(state.status, 'no_progress');
  assert.equal(summarizeFindingRepairState(state).stop_reason, 'repeated_finding_without_head_progress');
});

test('RFR-S-7 changed finding advances to attempt 2 and converges after a fresh pass', () => {
  let state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review(), maxAttempts: 3 });
  const firstFingerprint = state.attempts[0].finding_fingerprint;

  state = recordFindingRepairAttempt(state, {
    headSha: 'head-2', implementationIdentity: 'impl', implementationSessionId: 'impl-1',
    verification: { status: 'pass', head_sha: 'head-2' }, prPrepare: { status: 'ready', head_sha: 'head-2' },
    rereview: rereview({ status: 'needs_changes', session_id: 'review-1', findings: [{
      id: 'changed-finding', severity: 'high', detail: 'src/next.js needs a changed regression fixture',
      acceptance_clause: 'RFR-S-7', code_scope: ['src/next.js'], test_scope: ['test/next.test.js']
    }] })
  });

  assert.equal(state.status, 'planned');
  assert.deepEqual(state.attempts.map((attempt) => attempt.attempt_number), [1, 2]);
  assert.notEqual(state.attempts[1].finding_fingerprint, firstFingerprint);
  assert.equal(state.attempts[1].input_head_sha, 'head-2');
  assert.equal(state.next_action.task.task_id, state.attempts[1].task.task_id);

  state = recordFindingRepairAttempt(state, {
    headSha: 'head-3', implementationIdentity: 'impl', implementationSessionId: 'impl-2',
    verification: { status: 'pass', head_sha: 'head-3' }, prPrepare: { status: 'ready', head_sha: 'head-3' },
    rereview: rereview({ head_sha: 'head-3', session_id: 'review-2' })
  });

  assert.equal(state.status, 'converged');
  assert.equal(state.attempts[1].outcome.implementation.head_sha, 'head-3');
  assert.equal(state.attempts[1].rereview.status, 'pass');
  assert.deepEqual(state.next_action, { type: 'complete', head_sha: 'head-3' });
});

test('RFR-S-6 maximum attempt budget stops a changing finding loop', () => {
  let state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review(), maxAttempts: 1 });
  state = recordFindingRepairAttempt(state, {
    headSha: 'head-2', implementationIdentity: 'impl', implementationSessionId: 'impl-1',
    verification: { status: 'pass', head_sha: 'head-2' }, prPrepare: { status: 'ready', head_sha: 'head-2' },
    rereview: rereview({ status: 'needs_changes', session_id: 'review-1', findings: [{
      id: 'new-finding', severity: 'high', detail: 'src/next.js lacks coverage', acceptance_clause: 'RFR-S-4',
      code_scope: ['src/next.js'], test_scope: ['test/next.test.js']
    }] })
  });
  assert.equal(state.status, 'no_progress');
  assert.equal(state.stop_reason, 'max_attempts_reached');
});

test('RFR-S-5 rejects missing provenance and a different review role', () => {
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() });
  const base = { headSha: 'head-2', implementationIdentity: 'impl', implementationSessionId: 'impl-session',
    verification: { status: 'pass', head_sha: 'head-2' }, prPrepare: { status: 'ready', head_sha: 'head-2' } };
  assert.throws(() => recordFindingRepairAttempt(state, { ...base, rereview: rereview({ agent_identity: null, session_id: null }) }), /provenance/);
  assert.throws(() => recordFindingRepairAttempt(state, { ...base, rereview: rereview({ role: 'security' }) }), /same stage and role/);
});

test('TDEG-S-5 compatible repairable findings share one dispatch, verification, and re-review batch', () => {
  let state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review('needs_changes', [
    review().findings[0], { ...review().findings[0], id: 'second', detail: 'second repair' }
  ]) });
  assert.equal(state.repair_batches.length, 1);
  assert.deepEqual(state.repair_batches[0].finding_ids, ['missing-regression', 'second']);
  assert.equal(state.next_action.task.runtime_request.finding_fingerprints.length, 2);
  const evidence = { headSha: 'head-2', implementationIdentity: 'impl', implementationSessionId: 'impl-session',
    verification: { status: 'pass', head_sha: 'head-2' }, prPrepare: { status: 'ready', head_sha: 'head-2' }, rereview: rereview() };
  state = recordFindingRepairAttempt(state, evidence);
  assert.equal(state.status, 'converged');
  assert.equal(state.attempts.every((attempt) => attempt.outcome.implementation.session_id === 'impl-session'), true);
  assert.equal(summarizeFindingRepairState(state).repair_batch_count, 1);
});

test('TDEG-S-5 legacy repair artifacts keep separate finding dispatches when no batch metadata exists', () => {
  let state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review('needs_changes', [
    review().findings[0], { ...review().findings[0], id: 'second', detail: 'second legacy repair' }
  ]) });
  delete state.repair_batches;
  for (const attempt of state.attempts) delete attempt.batch_id;

  const evidence = { headSha: 'head-2', implementationIdentity: 'impl', implementationSessionId: 'impl-session',
    verification: { status: 'pass', head_sha: 'head-2' }, prPrepare: { status: 'ready', head_sha: 'head-2' }, rereview: rereview() };
  state = recordFindingRepairAttempt(state, evidence);

  assert.equal(state.status, 'planned');
  assert.equal(state.attempts[0].outcome.implementation.session_id, 'impl-session');
  assert.equal(state.attempts[1].outcome, null);
  assert.equal(state.repair_batches.length, 2);
  assert.equal(state.repair_batches.every((batch) => batch.migrated_from_legacy), true);
});

test('RFR-S-2 public persisted dispatch path records runtime state atomically', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-repair-'));
  const dir = path.join(root, '.vibepro', 'review-finding-repair', 'story-1', 'runtime', 'runtime');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'state.json'), JSON.stringify(createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() })));
  const result = await dispatchFindingRepairFromRepo(root, { storyId: 'story-1', stage: 'runtime', role: 'runtime', adapterId: 'codex',
    requirements: { capabilities: ['code'], timeout_ms: 1000, managed_worktree: root }, runState: { story_id: 'story-1' },
    runtimeCoordinator: { dispatch: async (state) => ({ state: { ...state, marker: true }, dispatch: { dispatch_id: 'd1', status: 'running' } }) } });
  assert.equal(result.summary.status, 'repairing');
  assert.equal(JSON.parse(await readFile(result.artifact)).runtime_state.marker, true);
});

test('dispatch normalizes synchronous completed and terminal runtime outcomes', async () => {
  for (const terminalStatus of ['completed', 'failed', 'cancelled', 'timed_out']) {
    const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() });
    const next = await dispatchFindingRepair(state, {
      adapterId: 'codex', runState: { story_id: 'story-1' },
      runtimeCoordinator: { dispatch: async (runtimeState) => ({
        state: runtimeState, dispatch: { dispatch_id: 'd1', status: terminalStatus }
      }) }
    });
    assert.equal(next.status, terminalStatus === 'completed' ? 'awaiting_rereview' : 'no_progress');
    assert.equal(next.next_action.type, terminalStatus === 'completed' ? 'record_rereview' : 'stop');
  }
});

test('persisted dispatch intent prevents duplicate work when coordinator result is uncertain', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-repair-dispatch-error-'));
  const dir = path.join(root, '.vibepro', 'review-finding-repair', 'story-1', 'runtime', 'runtime');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'state.json'), JSON.stringify(createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() })));
  const result = await dispatchFindingRepairFromRepo(root, {
    storyId: 'story-1', stage: 'runtime', role: 'runtime', adapterId: 'codex', runState: { story_id: 'story-1' },
    runtimeCoordinator: { dispatch: async () => { throw new Error('receipt lost'); } }
  });
  assert.equal(result.state.status, 'no_progress');
  assert.equal(result.state.stop_reason, 'runtime_dispatch_uncertain');
  await assert.rejects(() => dispatchFindingRepairFromRepo(root, {
    storyId: 'story-1', stage: 'runtime', role: 'runtime', adapterId: 'codex', runState: {}, runtimeCoordinator: { dispatch: async () => ({}) }
  }), /not ready/);
});

test('persisted state rejects unsupported or structurally partial schemas', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-repair-schema-'));
  const dir = path.join(root, '.vibepro', 'review-finding-repair', 'story-1', 'runtime', 'runtime');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'state.json'), JSON.stringify({ schema_version: '9.9.9' }));
  await assert.rejects(() => getFindingRepairStatus(root, { storyId: 'story-1', stage: 'runtime', role: 'runtime' }), /schema_version/);
  await writeFile(path.join(dir, 'state.json'), JSON.stringify({ schema_version: '0.1.0', story_id: 'story-1' }));
  await assert.rejects(() => getFindingRepairStatus(root, { storyId: 'story-1', stage: 'runtime', role: 'runtime' }), /state\.stage/);
});

test('CLI dispatch reaches the injected Agent Runtime coordinator', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-repair-cli-'));
  const dir = path.join(root, '.vibepro', 'review-finding-repair', 'story-1', 'runtime', 'runtime');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'state.json'), JSON.stringify(createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() })));
  let called = false;
  const result = await runCli(['review', 'finding-repair', 'dispatch', root, '--id', 'story-1', '--stage', 'runtime', '--role', 'runtime', '--adapter', 'codex'], {
    stdout: { write() {} }, stderr: { write() {} },
    findingRepairRuntimeCoordinator: { dispatch: async (state) => { called = true; return { state, dispatch: { dispatch_id: 'd1', status: 'running' } }; } }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(called, true);
});

test('CLI poll persists completed runtime output and exposes the rereview command', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-repair-cli-poll-'));
  const dir = path.join(root, '.vibepro', 'review-finding-repair', 'story-1', 'runtime', 'runtime');
  await mkdir(dir, { recursive: true });
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() });
  state.status = 'repairing';
  state.runtime_dispatch = { dispatch_id: 'd1', status: 'running' };
  state.runtime_state = { story_id: 'story-1' };
  await writeFile(path.join(dir, 'state.json'), JSON.stringify(state));
  let output = '';
  const result = await runCli(['review', 'finding-repair', 'poll', root, '--id', 'story-1', '--stage', 'runtime', '--role', 'runtime', '--json'], {
    stdout: { write(value) { output += value; } }, stderr: { write() {} },
    findingRepairRuntimeCoordinator: { poll: async (runtimeState, dispatchId) => ({
      state: { ...runtimeState, observed_dispatch: dispatchId }, dispatch: { dispatch_id: dispatchId, status: 'completed' }
    }) }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.state.status, 'awaiting_rereview');
  assert.match(result.result.state.next_action.command, /finding-repair record/);
  assert.match(output, /awaiting_rereview/);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'state.json'))).runtime_state.observed_dispatch, 'd1');
});

test('poll terminal failures stop with visible human recovery actions', async () => {
  for (const terminalStatus of ['failed', 'cancelled', 'timed_out']) {
    const root = await mkdtemp(path.join(os.tmpdir(), `vibepro-repair-${terminalStatus}-`));
    const dir = path.join(root, '.vibepro', 'review-finding-repair', 'story-1', 'runtime', 'runtime');
    await mkdir(dir, { recursive: true });
    const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() });
    state.status = 'repairing';
    state.runtime_dispatch = { dispatch_id: 'd1', status: 'running' };
    state.runtime_state = { story_id: 'story-1' };
    await writeFile(path.join(dir, 'state.json'), JSON.stringify(state));
    const result = await pollFindingRepairFromRepo(root, {
      storyId: 'story-1', stage: 'runtime', role: 'runtime',
      runtimeCoordinator: { poll: async (runtimeState, dispatchId) => ({
        state: runtimeState, dispatch: { dispatch_id: dispatchId, status: terminalStatus }
      }) }
    });
    assert.equal(result.state.status, 'no_progress');
    assert.equal(result.state.stop_reason, `runtime_${terminalStatus}`);
    assert.equal(result.state.next_action.authority, 'human_owner');
    assert.match(result.state.next_action.decision_required, /retry|split|stop/);
    assert.ok(result.state.next_action.next_commands.some((command) => command.includes('finding-repair dispatch')));
  }
});

test('CLI status returns persisted state and its next action', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-repair-cli-status-'));
  const dir = path.join(root, '.vibepro', 'review-finding-repair', 'story-1', 'runtime', 'runtime');
  await mkdir(dir, { recursive: true });
  const state = createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() });
  await writeFile(path.join(dir, 'state.json'), JSON.stringify(state));
  let output = '';
  const result = await runCli(['review', 'finding-repair', 'status', root, '--id', 'story-1', '--stage', 'runtime', '--role', 'runtime'], {
    stdout: { write(value) { output += value; } }, stderr: { write() {} }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.summary.status, 'planned');
  assert.equal(result.result.summary.next_action.type, 'dispatch_implementation');
  assert.match(output, /dispatch_implementation/);
});

test('artifact path traversal is rejected and missing status gives the plan command', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-repair-'));
  await assert.rejects(() => getFindingRepairStatus(root, { storyId: '../escape', stage: 'runtime', role: 'runtime' }), /path-safe/);
  await assert.rejects(() => getFindingRepairStatus(root, { storyId: 'story-1', stage: 'runtime', role: 'runtime' }), /no finding repair plan exists; run:/);
});

test('record rejects caller-asserted evidence when canonical artifacts are absent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-repair-record-'));
  const dir = path.join(root, '.vibepro', 'review-finding-repair', 'story-1', 'runtime', 'runtime');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'state.json'), JSON.stringify(createFindingRepairPlan({ storyId: 'story-1', stage: 'runtime', role: 'runtime', review: review() })));
  const resultPath = path.join(root, 'result.json');
  await writeFile(resultPath, JSON.stringify({ headSha: 'head-2', implementationIdentity: 'impl', implementationSessionId: 'impl-session',
    verification: { status: 'pass', head_sha: 'head-2' }, prPrepare: { status: 'ready', head_sha: 'head-2' }, rereview: rereview() }));
  await assert.rejects(() => recordFindingRepair(root, { storyId: 'story-1', stage: 'runtime', role: 'runtime', resultPath }), /verification-evidence\.json|ENOENT/);
});
