import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStoryRunPortfolioController, renderStoryRunPortfolioSummary } from '../src/story-run-portfolio.js';
import { runCli } from '../src/cli.js';

const STORIES = Array.from({ length: 6 }, (_, index) => `story-portfolio-${index + 1}`);

test('SRP-S-1 SRP-S-2 creates closed one-Story entries with explicit attribution fields', async (t) => {
  const fixture = await createFixture(t);
  const state = await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-six', storyIds: STORIES });
  assert.equal(state.entries.length, 6);
  assert.equal(state.status, 'queued');
  assert.deepEqual(Object.keys(state.entries[0]), ['story_id', 'order', 'run_id', 'status', 'worktree', 'head_sha', 'cost_attribution', 'stop_reason']);
  assert.equal(state.entries[0].cost_attribution.total_tokens, null);
  assert.equal(state.entries[0].cost_attribution.full_suite_count, null);
  assert.match(renderStoryRunPortfolioSummary(state), /full_suite=unknown evidence_reuse=unknown evidence_invalidations=unknown human_interruptions=unknown accepted_defects=unknown risk_reductions=unknown/);
  await assert.rejects(
    fixture.controller.create(fixture.root, { portfolioId: 'portfolio-duplicate', storyIds: [STORIES[0], STORIES[0]] }),
    errorCode('duplicate_story')
  );
});

test('SRP-S-3 six-Story sequential run never starts the next Story before pr_ready', async (t) => {
  const fixture = await createFixture(t);
  await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-sequential', storyIds: STORIES });
  let state = await fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-sequential' });
  assert.deepEqual(fixture.started, [STORIES[0]]);
  state = await fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-sequential' });
  assert.deepEqual(fixture.started, [STORIES[0]]);
  fixture.setStatus(STORIES[0], 'pr_ready');
  state = await fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-sequential' });
  assert.deepEqual(fixture.started, [STORIES[0], STORIES[1]]);
  for (let index = 1; index < STORIES.length; index += 1) {
    fixture.setStatus(STORIES[index], 'pr_ready');
    state = await fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-sequential' });
  }
  assert.equal(state.status, 'completed');
  assert.equal(state.entries.every((entry) => entry.status === 'pr_ready'), true);
});

test('SRP-S-4 blocker is not success and explicit typed skip survives restart', async (t) => {
  const fixture = await createFixture(t);
  await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-blocked', storyIds: STORIES.slice(0, 2) });
  await fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-blocked' });
  fixture.setStatus(STORIES[0], 'blocked', { code: 'gate_blocked', message: 'Evidence missing' });
  let state = await fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-blocked' });
  assert.equal(state.status, 'blocked');
  assert.deepEqual(fixture.started, [STORIES[0]]);
  await assert.rejects(
    fixture.controller.decide(fixture.root, { portfolioId: 'portfolio-blocked', storyId: STORIES[0], decision: 'skip' }),
    errorCode('typed_policy_required')
  );
  const restarted = fixture.restart();
  state = await restarted.decide(fixture.root, {
    portfolioId: 'portfolio-blocked', storyId: STORIES[0], decision: 'skip', policyType: 'operator_exception', reason: 'Defer to another portfolio'
  });
  assert.equal(state.entries[0].status, 'skipped');
  state = await restarted.advance(fixture.root, { portfolioId: 'portfolio-blocked' });
  assert.equal(state.entries[1].status, 'running');
});

test('SRP-S-4 every stopped status requires a typed decision and continue or retry resumes only that Run', async (t) => {
  for (const status of ['waiting_for_human', 'waiting_for_runtime', 'blocked', 'failed', 'cancelled']) {
    const fixture = await createFixture(t);
    const portfolioId = `portfolio-stop-${status.replaceAll('_', '-')}`;
    await fixture.controller.create(fixture.root, { portfolioId, storyIds: STORIES.slice(0, 2) });
    await fixture.controller.advance(fixture.root, { portfolioId });
    fixture.setStatus(STORIES[0], status, { code: `${status}_reason`, message: status });
    let state = await fixture.controller.advance(fixture.root, { portfolioId });
    assert.equal(state.status, status);
    assert.deepEqual(fixture.started, [STORIES[0]]);
    const decision = status === 'failed' ? 'retry' : 'continue';
    await assert.rejects(
      fixture.controller.decide(fixture.root, { portfolioId, storyId: STORIES[0], decision }),
      errorCode('typed_policy_required')
    );
    state = await fixture.controller.decide(fixture.root, {
      portfolioId, storyId: STORIES[0], decision, policyType: 'human_decision', reason: `operator accepted ${decision}`,
      decisionId: `decision-${status}`, answer: decision, answeredBy: 'operator'
    });
    assert.equal(state.entries[0].status, 'running');
    assert.equal(state.entries[1].status, 'queued');
    assert.deepEqual(fixture.resumed.at(-1), {
      storyId: STORIES[0], runId: state.entries[0].run_id, decisionId: `decision-${status}`,
      answer: decision, answeredBy: 'operator', reflectedIn: []
    });
  }
});

test('SRP-S-5 promotes digest-bound artifact context and rejects raw transcripts', async (t) => {
  const fixture = await createFixture(t);
  await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-context', storyIds: STORIES.slice(0, 2) });
  await mkdir(path.join(fixture.root, 'docs/decisions'), { recursive: true });
  const content = 'approved boundary\n';
  await writeFile(path.join(fixture.root, 'docs/decisions/boundary.md'), content);
  const digest = createHash('sha256').update(content).digest('hex');
  const state = await fixture.controller.promote(fixture.root, {
    portfolioId: 'portfolio-context', sourceStoryId: STORIES[0], consumerStoryId: STORIES[1],
    artifactPath: 'docs/decisions/boundary.md', digest, reason: 'Reuse approved boundary'
  });
  assert.deepEqual(state.promoted_context[0], {
    source_story_id: STORIES[0], artifact_path: 'docs/decisions/boundary.md', digest,
    consumer_story_id: STORIES[1], reason: 'Reuse approved boundary', promoted_at: '2026-07-20T00:00:00.000Z'
  });
  await assert.rejects(fixture.controller.promote(fixture.root, {
    portfolioId: 'portfolio-context', sourceStoryId: STORIES[0], consumerStoryId: STORIES[1],
    artifactPath: 'docs/decisions/boundary.md', digest: 'a'.repeat(64), reason: 'Tampered digest'
  }), errorCode('digest_mismatch'));
  await assert.rejects(fixture.controller.promote(fixture.root, {
    portfolioId: 'portfolio-context', sourceStoryId: STORIES[0], consumerStoryId: STORIES[1],
    artifactPath: 'docs/decisions/missing.md', reason: 'Missing artifact'
  }), errorCode('artifact_unavailable'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'vibepro-portfolio-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'secret.md'), 'outside');
  await symlink(path.join(outside, 'secret.md'), path.join(fixture.root, 'docs/decisions/outside.md'));
  await assert.rejects(fixture.controller.promote(fixture.root, {
    portfolioId: 'portfolio-context', sourceStoryId: STORIES[0], consumerStoryId: STORIES[1],
    artifactPath: 'docs/decisions/outside.md', reason: 'Symlink escape'
  }), errorCode('artifact_outside_repository'));
  await assert.rejects(fixture.controller.promote(fixture.root, {
    portfolioId: 'portfolio-context', sourceStoryId: STORIES[0], consumerStoryId: STORIES[1],
    artifactPath: '.codex/session-transcript.jsonl', reason: 'copy session'
  }), errorCode('raw_transcript_forbidden'));
  await mkdir(path.join(fixture.root, '.codex'), { recursive: true });
  await writeFile(path.join(fixture.root, '.codex/session-transcript.jsonl'), '{"secret":true}\n');
  await symlink(path.join(fixture.root, '.codex/session-transcript.jsonl'), path.join(fixture.root, 'docs/decisions/context.md'));
  await assert.rejects(fixture.controller.promote(fixture.root, {
    portfolioId: 'portfolio-context', sourceStoryId: STORIES[0], consumerStoryId: STORIES[1],
    artifactPath: 'docs/decisions/context.md', reason: 'Internal transcript symlink'
  }), errorCode('raw_transcript_forbidden'));
});

test('SRP-S-6 GAH-S-10 summary reports per-Story time cost suite reuse and interruptions without converting unknown to zero', async (t) => {
  const fixture = await createFixture(t);
  await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-cost', storyIds: STORIES.slice(0, 1) });
  await fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-cost' });
  fixture.contaminate(STORIES[0], {
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:02.000Z',
    transitions: [
      { sequence: 1, from: null, to: 'running', timestamp: '2026-07-20T00:00:00.000Z' },
      { sequence: 2, from: 'running', to: 'blocked', timestamp: '2026-07-20T00:00:01.200Z' },
      { sequence: 3, from: 'blocked', to: 'running', timestamp: '2026-07-20T00:00:01.500Z' }
    ],
    usage_accounting: { total_tokens: 42, cost_usd: null, status: 'partial' },
    action_journal: [
      { action_id: 'full_suite', status: 'completed', measurements: { full_suite_count: 1, evidence_invalidation_count: 0, accepted_defect_count: 2, risk_reduction_count: 3 }, result_summary: 'full suite passed with accepted defect and risk reduction evidence' },
      { action_id: 'evidence_reuse', status: 'completed', measurements: { evidence_reuse_count: 1 }, result_summary: 'evidence reuse hit' },
      { action_id: 'evidence_reuse', status: 'completed', measurements: { evidence_reuse_count: 1 }, result_summary: 'evidence reuse hit' }
    ],
    human_decision_journal: [{ decision_id: 'decision-1' }]
  });
  const state = await fixture.controller.advance(fixture.root, {
    portfolioId: 'portfolio-cost', costAttribution: {
      story_id: STORIES[0], run_id: fixture.runs.get(STORIES[0]).run_id,
      observed_work_ms: 1500, tool_wait_ms: 300,
      review_wait_ms: 700, subagent_wall_clock_ms: 700, agent_consumption_ms: 1000,
      subagent_count: 2, review_dispatch_count: 2, accepted_finding_count: 2, repair_batch_count: 1,
      fresh_input_tokens: 12, expensive_verification_count: 1,
      efficiency_debt_count: 0
    }
  });
  const output = renderStoryRunPortfolioSummary(state);
  assert.match(output, /trusted_pr_ready_ms=unknown active_ms=1700 wait_ms=300 tokens=42/);
  assert.match(output, /full_suite=1 evidence_reuse=2 evidence_invalidations=0 human_interruptions=1 accepted_defects=2 risk_reductions=3/);
  assert.match(output, /observed_work_ms=1500 tool_wait_ms=300 review_wait_ms=700 subagent_wall_clock_ms=700 agent_consumption_ms=1000/);
  assert.match(output, /subagents=2 review_dispatches=2 accepted_findings=2 repair_batches=1 expensive_verification=1 fresh_input_tokens=12 evidence_invalidation=0 efficiency_debt=0/);
  await assert.rejects(fixture.controller.advance(fixture.root, {
    portfolioId: 'portfolio-cost', costAttribution: {
      story_id: STORIES[1], run_id: fixture.runs.get(STORIES[0]).run_id, total_tokens: 999
    }
  }), errorCode('scope_contamination'));
  const unchanged = await fixture.controller.status(fixture.root, { portfolioId: 'portfolio-cost' });
  assert.equal(unchanged.entries[0].cost_attribution.total_tokens, 42);
  assert.equal(unchanged.status, 'blocked');
  assert.equal(unchanged.entries[0].stop_reason.code, 'scope_contamination');
});

test('SRP-S-7 stops scope contamination and SRP-S-8 rejects unproved parallel mode', async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(fixture.controller.create(fixture.root, {
    portfolioId: 'portfolio-parallel', storyIds: STORIES, mode: 'parallel'
  }), errorCode('parallel_isolation_unproven'));
  await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-contamination', storyIds: STORIES.slice(0, 2) });
  await fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-contamination' });
  fixture.contaminate(STORIES[0], { story_id: STORIES[1] });
  await assert.rejects(fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-contamination' }), errorCode('scope_contamination'));
  const stopped = await fixture.controller.status(fixture.root, { portfolioId: 'portfolio-contamination' });
  assert.equal(stopped.status, 'blocked');
  assert.equal(stopped.entries[0].stop_reason.code, 'scope_contamination');
  assert.match(renderStoryRunPortfolioSummary(stopped), /stop_reason=scope_contamination/);
  assert.match(renderStoryRunPortfolioSummary(stopped), /next_action=vibepro execute portfolio-decide/);

  const cases = [
    ['run', { run_id: 'foreign-run' }],
    ['creation-request', { creation_request_id: 'portfolio-foreign-request' }],
    ['worktree', { execution_context: { root_realpath: '/worktrees/foreign-story', branch_name: `codex/${STORIES[0]}` } }],
    ['branch', { execution_context: { root_realpath: `/worktrees/${STORIES[0]}`, branch_name: 'foreign-branch' } }],
    ['mutation-story', { mutation_artifacts: [{ story_id: STORIES[1], run_id: fixture.runs.get(STORIES[0]).run_id }] }],
    ['mutation-run', { mutation_artifacts: [{ story_id: STORIES[0], run_id: 'foreign-run' }] }],
    ['mutation-missing', { mutation_artifacts: [{}] }],
    ['evidence-story', { evidence_artifacts: [{ story_id: STORIES[1], run_id: fixture.runs.get(STORIES[0]).run_id }] }],
    ['evidence-run', { evidence_artifacts: [{ story_id: STORIES[0], run_id: 'foreign-run' }] }],
    ['evidence-missing', { evidence_artifacts: [{}] }],
    ['review', { review_artifacts: [{ story_id: STORIES[1], run_id: 'foreign-run' }] }],
    ['review-missing-run', { review_artifacts: [{ story_id: STORIES[0] }] }],
    ['session', { session_attribution: [{ story_id: STORIES[1], run_id: 'foreign-run' }] }],
    ['session-missing-run', { session_attribution: [{ story_id: STORIES[0] }] }]
  ];
  for (const [kind, contamination] of cases) {
    const portfolioId = `portfolio-contamination-${kind}`;
    await fixture.controller.create(fixture.root, { portfolioId, storyIds: STORIES.slice(0, 2) });
    await fixture.controller.advance(fixture.root, { portfolioId });
    fixture.contaminate(STORIES[0], contamination);
    await assert.rejects(fixture.controller.advance(fixture.root, { portfolioId }), errorCode('scope_contamination'));
    const contaminated = await fixture.controller.status(fixture.root, { portfolioId });
    assert.equal(contaminated.status, 'blocked');
    assert.equal(contaminated.entries[0].stop_reason.code, 'scope_contamination');
    assert.equal(contaminated.entries[1].status, 'queued');
    assert.deepEqual(fixture.started.slice(-1), [STORIES[0]]);
  }
});

test('SRP-S-2 SRP-S-7 rejects a foreign initial Run before adopting its identity', async (t) => {
  const cases = [
    ['story', { story_id: STORIES[1] }],
    ['run', { creation_request_id: 'portfolio-foreign-request' }],
    ['missing-run', { run_id: null }]
  ];
  for (const [kind, initialRunPatch] of cases) {
    const fixture = await createFixture(t, { initialRunPatch });
    const portfolioId = `portfolio-initial-${kind}`;
    await fixture.controller.create(fixture.root, { portfolioId, storyIds: STORIES.slice(0, 2) });
    await assert.rejects(fixture.controller.advance(fixture.root, { portfolioId }), errorCode('scope_contamination'));
    const stopped = await fixture.controller.status(fixture.root, { portfolioId });
    assert.equal(stopped.status, 'blocked');
    assert.equal(stopped.entries[0].run_id, null);
    assert.equal(stopped.entries[0].stop_reason.code, 'scope_contamination');
    assert.equal(stopped.entries[1].status, 'queued');
    assert.deepEqual(fixture.started, [STORIES[0]]);
  }
});

test('initial Run contamination can be explicitly skipped and remains valid after restart', async (t) => {
  const fixture = await createFixture(t, { initialRunPatch: { creation_request_id: 'portfolio-foreign-request' } });
  const portfolioId = 'portfolio-contamination-skip';
  await fixture.controller.create(fixture.root, { portfolioId, storyIds: STORIES.slice(0, 2) });
  await assert.rejects(fixture.controller.advance(fixture.root, { portfolioId }), errorCode('scope_contamination'));
  fixture.clearInitialRunPatch();
  const state = await fixture.controller.decide(fixture.root, {
    portfolioId, storyId: STORIES[0], decision: 'skip', policyType: 'operator_exception', reason: 'reject foreign child Run'
  });
  assert.equal(state.entries[0].status, 'skipped');
  assert.equal((await fixture.restart().status(fixture.root, { portfolioId })).entries[0].status, 'skipped');
  const advanced = await fixture.restart().advance(fixture.root, { portfolioId });
  assert.equal(advanced.entries[1].status, 'running');
});

test('SRP-S-3 concurrent mutation is rejected before a duplicate child Run starts', async (t) => {
  let release;
  const entered = new Promise((resolve) => { release = resolve; });
  const fixture = await createFixture(t, { runEntered: entered });
  await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-lock', storyIds: STORIES.slice(0, 2) });
  const first = fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-lock' });
  await fixture.waitForRunStart();
  await assert.rejects(fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-lock' }), errorCode('portfolio_busy'));
  release();
  await first;
  assert.deepEqual(fixture.started, [STORIES[0]]);
});

test('Portfolio lock serializes create, recovers a dead owner, and releases after operation failure', async (t) => {
  const fixture = await createFixture(t, { runErrorOnce: true });
  const creates = await Promise.allSettled([
    fixture.controller.create(fixture.root, { portfolioId: 'portfolio-create-lock', storyIds: STORIES.slice(0, 2) }),
    fixture.controller.create(fixture.root, { portfolioId: 'portfolio-create-lock', storyIds: STORIES.slice(0, 2) })
  ]);
  assert.equal(creates.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(creates.filter((result) => result.status === 'rejected').length, 1);
  assert.match(creates.find((result) => result.status === 'rejected').reason.code, /portfolio_(?:busy|exists)/);

  const lock = path.join(fixture.root, '.vibepro/portfolios/portfolio-create-lock/state.json.lock');
  await mkdir(lock);
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ schema_version: 1, pid: 99999999, token: 'dead', acquired_at: '2026-07-19T00:00:00.000Z' }));
  await assert.rejects(
    fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-create-lock' }),
    /injected run failure/
  );
  const state = await fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-create-lock' });
  assert.equal(state.entries[0].status, 'running');
});

test('malformed Portfolio state fails closed as invalid_portfolio_state', async (t) => {
  const fixture = await createFixture(t);
  const portfolioId = 'portfolio-malformed-state';
  await fixture.controller.create(fixture.root, { portfolioId, storyIds: STORIES.slice(0, 1) });
  await writeFile(path.join(fixture.root, `.vibepro/portfolios/${portfolioId}/state.json`), '{malformed');
  await assert.rejects(
    fixture.controller.status(fixture.root, { portfolioId }),
    errorCode('invalid_portfolio_state')
  );
});

test('parseable semantic corruption in Portfolio state fails the closed schema', async (t) => {
  const cases = [
    ['duplicate-story', (state) => { state.entries[1].story_id = state.entries[0].story_id; }],
    ['unknown-entry-status', (state) => { state.entries[0].status = 'succeeded'; }],
    ['unknown-portfolio-status', (state) => { state.status = 'succeeded'; }],
    ['foreign-scope-binding', (state) => { state.scope_bindings['story-foreign'] = { creation_request_id: 'portfolio-foreign' }; }],
    ['invalid-cost', (state) => { state.entries[0].cost_attribution.full_suite_count = -1; }],
    ['fractional-count', (state) => { state.entries[0].cost_attribution.full_suite_count = 0.5; }],
    ['extra-entry-field', (state) => { state.entries[0].unexpected = true; }],
    ['invalid-promoted-context', (state) => { state.promoted_context.push({ source_story_id: STORIES[0] }); }],
    ['invalid-decision-journal', (state) => { state.decision_journal.push({ story_id: STORIES[0], decision: 'continue' }); }],
    ['starting-without-identity', (state) => { state.status = 'starting'; state.entries[0].status = 'starting'; }],
    ['stopped-without-reason', (state) => {
      state.status = 'blocked';
      state.entries[0].status = 'blocked';
      state.entries[0].run_id = 'run-corrupt';
      state.scope_bindings[state.entries[0].story_id] = { creation_request_id: 'request-corrupt', branch: null, worktree: null };
    }],
    ['completed-with-queued-entry', (state) => { state.status = 'completed'; }],
    ['running-with-all-queued', (state) => { state.status = 'running'; }],
    ['running-with-stopped-entry', (state) => {
      state.status = 'running';
      state.entries[0].status = 'blocked';
      state.entries[0].run_id = 'run-corrupt';
      state.entries[0].stop_reason = { code: 'blocked', message: 'blocked' };
      state.scope_bindings[state.entries[0].story_id] = { creation_request_id: 'request-corrupt', branch: null, worktree: null };
    }],
    ['incoherent-generic-stopped', (state) => { state.status = 'stopped'; }],
    ['skipped-without-decision', (state) => {
      state.status = 'skipped';
      state.entries[0].status = 'skipped';
      state.entries[0].run_id = 'run-corrupt';
      state.entries[0].stop_reason = { code: 'explicit_skip', message: 'tampered', details: { policy_type: 'operator' } };
      state.scope_bindings[state.entries[0].story_id] = { creation_request_id: 'request-corrupt', branch: null, worktree: null };
    }],
    ['pr-ready-without-run-binding', (state) => { state.entries[0].status = 'pr_ready'; }]
  ];
  for (const [kind, corrupt] of cases) {
    const fixture = await createFixture(t);
    const portfolioId = `portfolio-semantic-${kind}`;
    const state = await fixture.controller.create(fixture.root, { portfolioId, storyIds: STORIES.slice(0, 2) });
    corrupt(state);
    await writeFile(path.join(fixture.root, `.vibepro/portfolios/${portfolioId}/state.json`), JSON.stringify(state));
    await assert.rejects(fixture.controller.status(fixture.root, { portfolioId }), errorCode('invalid_portfolio_state'));
  }
});

test('malformed Portfolio lock owner fails closed with recovery_required', async (t) => {
  const fixture = await createFixture(t);
  const portfolioId = 'portfolio-malformed-owner';
  await fixture.controller.create(fixture.root, { portfolioId, storyIds: STORIES.slice(0, 1) });
  const lock = path.join(fixture.root, `.vibepro/portfolios/${portfolioId}/state.json.lock`);
  await mkdir(lock);
  await writeFile(path.join(lock, 'owner.json'), '{malformed');
  await assert.rejects(
    fixture.controller.advance(fixture.root, { portfolioId }),
    errorCode('portfolio_lock_recovery_required')
  );
});

test('malformed Portfolio recovery owner fails closed with operator repair evidence', async (t) => {
  const fixture = await createFixture(t);
  const portfolioId = 'portfolio-malformed-recovery-owner';
  await fixture.controller.create(fixture.root, { portfolioId, storyIds: STORIES.slice(0, 1) });
  const lock = path.join(fixture.root, `.vibepro/portfolios/${portfolioId}/state.json.lock`);
  await mkdir(lock);
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ schema_version: 1, pid: 99999998, token: 'dead-main', acquired_at: '2026-07-19T00:00:00.000Z' }));
  await mkdir(`${lock}.recovery`);
  await writeFile(path.join(`${lock}.recovery`, 'owner.json'), '{malformed');
  await assert.rejects(
    fixture.controller.advance(fixture.root, { portfolioId }),
    (cause) => cause.code === 'portfolio_lock_recovery_required'
      && cause.details.recovery_lock === `${lock}.recovery`
      && /remove the recovery lock/.test(cause.details.required_action)
  );
});

test('orphaned Portfolio recovery mutex fails closed with an operator repair handle', async (t) => {
  const fixture = await createFixture(t);
  await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-recovery-orphan', storyIds: STORIES.slice(0, 1) });
  const lock = path.join(fixture.root, '.vibepro/portfolios/portfolio-recovery-orphan/state.json.lock');
  await mkdir(lock);
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ schema_version: 1, pid: 99999998, token: 'dead-main', acquired_at: '2026-07-19T00:00:00.000Z' }));
  await mkdir(`${lock}.recovery`);
  await writeFile(path.join(`${lock}.recovery`, 'owner.json'), JSON.stringify({ schema_version: 1, pid: 99999999, token: 'dead-recovery', acquired_at: '2026-07-19T00:00:00.000Z' }));
  await assert.rejects(
    fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-recovery-orphan' }),
    (cause) => cause.code === 'portfolio_lock_recovery_required'
      && cause.details.recovery_lock === `${lock}.recovery`
      && /remove the recovery lock/.test(cause.details.required_action)
  );

  const humanError = capture();
  const human = await runCli(['execute', 'portfolio-advance', fixture.root, '--portfolio-id', 'portfolio-recovery-orphan'], {
    stdout: capture(), stderr: humanError, storyRunPortfolioDependencies: fixture.dependencies
  });
  assert.equal(human.exitCode, 2);
  assert.equal(humanError.text().includes(`recovery_lock=${lock}.recovery`), true);
  assert.match(humanError.text(), /required_action=Inspect and remove the recovery lock only after proving no recovery process is active\./);

  const jsonError = capture();
  const json = await runCli(['execute', 'portfolio-advance', fixture.root, '--portfolio-id', 'portfolio-recovery-orphan', '--json'], {
    stdout: capture(), stderr: jsonError, storyRunPortfolioDependencies: fixture.dependencies
  });
  assert.equal(json.exitCode, 2);
  const payload = JSON.parse(jsonError.text());
  assert.equal(payload.stop_reason.details.recovery_lock, `${lock}.recovery`);
  assert.match(payload.stop_reason.details.required_action, /remove the recovery lock/);
});

test('Portfolio restart reconciles a child Run created before Portfolio publish', async (t) => {
  const fixture = await createFixture(t);
  await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-publish-gap', storyIds: STORIES.slice(0, 2) });
  let stateWrites = 0;
  const failing = createStoryRunPortfolioController({
    ...fixture.dependencies,
    async writeFile(file, content, options) {
      if (String(file).includes('state.json.tmp-') && (stateWrites += 1) === 2) {
        const failure = new Error('injected Portfolio publish failure');
        failure.code = 'EIO';
        throw failure;
      }
      return writeFile(file, content, options);
    }
  });
  await assert.rejects(failing.advance(fixture.root, { portfolioId: 'portfolio-publish-gap' }), /injected Portfolio publish failure/);
  const interrupted = await fixture.controller.status(fixture.root, { portfolioId: 'portfolio-publish-gap' });
  assert.equal(interrupted.entries[0].status, 'starting');
  assert.equal(interrupted.entries[0].run_id, null);
  const recovered = await fixture.restart().advance(fixture.root, { portfolioId: 'portfolio-publish-gap' });
  assert.equal(recovered.entries[0].run_id, `run-20260720T000000Z-${STORIES[0].slice(-1).padStart(8, '0')}`);
  assert.equal(fixture.started.filter((storyId) => storyId === STORIES[0]).length, 1);
});

test('SRP-S-2 SRP-S-7 restart never adopts a Run outside the persisted creation request', async (t) => {
  const cases = [
    ['foreign-request', { creation_request_id: 'portfolio-foreign-request' }],
    ['missing-request', { creation_request_id: null }],
    ['missing-run', { run_id: null }]
  ];
  for (const [kind, patch] of cases) {
    const fixture = await createFixture(t);
    const portfolioId = `portfolio-publish-gap-${kind}`;
    await fixture.controller.create(fixture.root, { portfolioId, storyIds: STORIES.slice(0, 2) });
    let stateWrites = 0;
    const failing = createStoryRunPortfolioController({
      ...fixture.dependencies,
      async writeFile(file, content, options) {
        if (String(file).includes('state.json.tmp-') && (stateWrites += 1) === 2) {
          const failure = new Error('injected Portfolio publish failure');
          failure.code = 'EIO';
          throw failure;
        }
        return writeFile(file, content, options);
      }
    });
    await assert.rejects(failing.advance(fixture.root, { portfolioId }), /injected Portfolio publish failure/);
    fixture.contaminate(STORIES[0], patch);
    await assert.rejects(fixture.restart().advance(fixture.root, { portfolioId }), errorCode('scope_contamination'));
    const stopped = await fixture.controller.status(fixture.root, { portfolioId });
    assert.equal(stopped.status, 'blocked');
    assert.equal(stopped.entries[0].run_id, null);
    assert.equal(stopped.entries[0].stop_reason.code, 'scope_contamination');
    assert.equal(stopped.entries[1].status, 'queued');
    assert.equal(fixture.started.filter((storyId) => storyId === STORIES[0]).length, 1);
  }
});

test('Portfolio restart never adopts a historical Run when creation did not begin', async (t) => {
  const fixture = await createFixture(t, { runErrorOnce: true });
  fixture.seedHistorical(STORIES[0], 'run-20260719T000000Z-deadbeef');
  await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-precreate-gap', storyIds: STORIES.slice(0, 1) });
  await assert.rejects(
    fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-precreate-gap' }),
    /injected run failure/
  );
  const recovered = await fixture.restart().advance(fixture.root, { portfolioId: 'portfolio-precreate-gap' });
  assert.notEqual(recovered.entries[0].run_id, 'run-20260719T000000Z-deadbeef');
  assert.equal(fixture.started.filter((storyId) => storyId === STORIES[0]).length, 1);
});

test('Portfolio release refuses to delete a lock whose owner token changed', async (t) => {
  let release;
  const entered = new Promise((resolve) => { release = resolve; });
  const fixture = await createFixture(t, { runEntered: entered });
  await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-owner-token', storyIds: STORIES.slice(0, 1) });
  const advancing = fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-owner-token' });
  await fixture.waitForRunStart();
  const lock = path.join(fixture.root, '.vibepro/portfolios/portfolio-owner-token/state.json.lock');
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ schema_version: 1, pid: process.pid, token: 'foreign-owner', acquired_at: '2026-07-20T00:00:00.000Z' }));
  release();
  await assert.rejects(advancing, errorCode('portfolio_lock_ownership_lost'));
  assert.equal(JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8')).token, 'foreign-owner');
});

test('Portfolio CLI creates and reads a JSON portfolio', async (t) => {
  const fixture = await createFixture(t);
  const stdout = capture();
  const result = await runCli(['execute', 'portfolio-create', fixture.root, '--portfolio-id', 'portfolio-cli', '--stories', STORIES.slice(0, 2).join(','), '--json'], {
    stdout, stderr: capture(), storyRunPortfolioDependencies: fixture.dependencies
  });
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(stdout.text()).entries.length, 2);
  const status = await runCli(['execute', 'portfolio-status', fixture.root, '--portfolio-id', 'portfolio-cli', '--json'], {
    stdout: capture(), stderr: capture(), storyRunPortfolioDependencies: fixture.dependencies
  });
  assert.equal(status.result.portfolio_id, 'portfolio-cli');
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, '.vibepro/portfolios/portfolio-cli/state.json'), 'utf8')).mode, 'sequential');
});

test('Portfolio CLI covers advance decide promote and typed JSON and human errors', async (t) => {
  const fixture = await createFixture(t);
  const invoke = (args, stdout = capture(), stderr = capture()) => runCli(args, {
    stdout, stderr, storyRunPortfolioDependencies: fixture.dependencies
  });
  await invoke(['execute', 'portfolio-create', fixture.root, '--portfolio-id', 'portfolio-cli-all', '--stories', STORIES.slice(0, 2).join(','), '--json']);
  const human = capture();
  const advanced = await invoke(['execute', 'portfolio-advance', fixture.root, '--portfolio-id', 'portfolio-cli-all'], human);
  assert.equal(advanced.exitCode, 0);
  assert.match(human.text(), /Portfolio portfolio-cli-all: running/);
  fixture.setStatus(STORIES[0], 'blocked', { code: 'gate_blocked', message: 'Evidence missing' });
  await invoke(['execute', 'portfolio-advance', fixture.root, '--portfolio-id', 'portfolio-cli-all', '--json']);
  const typedError = capture();
  const rejected = await invoke(['execute', 'portfolio-decide', fixture.root, '--portfolio-id', 'portfolio-cli-all', '--story-id', STORIES[0], '--decision', 'skip', '--json'], capture(), typedError);
  assert.equal(rejected.exitCode, 2);
  assert.equal(JSON.parse(typedError.text()).stop_reason.code, 'typed_policy_required');
  const decided = await invoke(['execute', 'portfolio-decide', fixture.root, '--portfolio-id', 'portfolio-cli-all', '--story-id', STORIES[0], '--decision', 'skip', '--policy-type', 'operator_exception', '--reason', 'defer', '--json']);
  assert.equal(decided.result.entries[0].status, 'skipped');
  await mkdir(path.join(fixture.root, 'docs'), { recursive: true });
  await writeFile(path.join(fixture.root, 'docs/context.md'), 'context');
  const promoted = await invoke(['execute', 'portfolio-promote', fixture.root, '--portfolio-id', 'portfolio-cli-all', '--source-story-id', STORIES[0], '--consumer-story-id', STORIES[1], '--artifact', 'docs/context.md', '--reason', 'reuse', '--json']);
  assert.equal(promoted.result.promoted_context.length, 1);
  const humanError = capture();
  const missing = await invoke(['execute', 'portfolio-promote', fixture.root, '--portfolio-id', 'portfolio-cli-all', '--source-story-id', STORIES[0], '--consumer-story-id', STORIES[1], '--artifact', 'docs/missing.md', '--reason', 'reuse'], capture(), humanError);
  assert.equal(missing.exitCode, 2);
  assert.match(humanError.text(), /^artifact_unavailable:/);
});

async function createFixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-portfolio-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runs = new Map();
  const requestRuns = new Map();
  const started = [];
  const resumed = [];
  let runStarted;
  const runStart = new Promise((resolve) => { runStarted = resolve; });
  const guardedRun = {
    async run(_root, { storyId, creationRequestId }) {
      runStarted();
      if (options.runEntered) await options.runEntered;
      if (options.runErrorOnce) {
        options.runErrorOnce = false;
        throw new Error('injected run failure');
      }
      if (creationRequestId && requestRuns.has(creationRequestId)) return structuredClone(requestRuns.get(creationRequestId));
      started.push(storyId);
      const run = runState(storyId);
      run.creation_request_id = creationRequestId ?? null;
      runs.set(storyId, run);
      if (creationRequestId) requestRuns.set(creationRequestId, run);
      return { ...structuredClone(run), ...(options.initialRunPatch ?? {}) };
    },
    async status(_root, { storyId }) {
      const run = runs.get(storyId);
      if (!run) {
        const failure = new Error('No guarded Runs exist for this Story.');
        failure.code = 'run_not_found';
        throw failure;
      }
      return structuredClone(run);
    },
    async resume(_root, options) {
      const { storyId } = options;
      resumed.push(structuredClone(options));
      const run = runs.get(storyId);
      run.status = 'running';
      run.stop_reason = null;
      return structuredClone(run);
    }
  };
  const dependencies = { guardedRun, now: () => new Date('2026-07-20T00:00:00.000Z'), randomBytes: () => Buffer.from('01020304', 'hex') };
  return {
    root, runs, started, resumed, dependencies,
    waitForRunStart: () => runStart,
    controller: createStoryRunPortfolioController(dependencies),
    restart: () => createStoryRunPortfolioController(dependencies),
    clearInitialRunPatch() { delete options.initialRunPatch; },
    seedHistorical(storyId, runId) { runs.set(storyId, { ...runState(storyId), run_id: runId, creation_request_id: null }); },
    setStatus(storyId, status, stopReason = null) { Object.assign(runs.get(storyId), { status, stop_reason: stopReason }); },
    contaminate(storyId, values) { Object.assign(runs.get(storyId), values); }
  };
}

function runState(storyId) {
  return {
    story_id: storyId, run_id: `run-20260720T000000Z-${storyId.slice(-1).padStart(8, '0')}`, status: 'running',
    current_head_sha: storyId.slice(-1).repeat(40), stop_reason: null,
    execution_context: { root_realpath: `/worktrees/${storyId}`, branch_name: `codex/${storyId}` },
    mutation_artifacts: [], evidence_artifacts: []
  };
}

function errorCode(code) {
  return (error) => error?.code === code;
}

function capture() {
  let value = '';
  return { write(chunk) { value += chunk; }, text() { return value; } };
}
