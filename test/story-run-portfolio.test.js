import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  assert.deepEqual(Object.keys(state.entries[0]), ['story_id', 'order', 'run_id', 'status', 'worktree', 'head_sha', 'cost_attribution', 'stop_reason']);
  assert.equal(state.entries[0].cost_attribution.total_tokens, null);
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

test('SRP-S-5 promotes digest-bound artifact context and rejects raw transcripts', async (t) => {
  const fixture = await createFixture(t);
  await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-context', storyIds: STORIES.slice(0, 2) });
  const state = await fixture.controller.promote(fixture.root, {
    portfolioId: 'portfolio-context', sourceStoryId: STORIES[0], consumerStoryId: STORIES[1],
    artifactPath: 'docs/decisions/boundary.md', digest: 'a'.repeat(64), reason: 'Reuse approved boundary'
  });
  assert.deepEqual(state.promoted_context[0], {
    source_story_id: STORIES[0], artifact_path: 'docs/decisions/boundary.md', digest: 'a'.repeat(64),
    consumer_story_id: STORIES[1], reason: 'Reuse approved boundary', promoted_at: '2026-07-20T00:00:00.000Z'
  });
  await assert.rejects(fixture.controller.promote(fixture.root, {
    portfolioId: 'portfolio-context', sourceStoryId: STORIES[0], consumerStoryId: STORIES[1],
    artifactPath: '.codex/session-transcript.jsonl', reason: 'copy session'
  }), errorCode('raw_transcript_forbidden'));
});

test('SRP-S-6 summary reports per-Story time cost suite reuse and interruptions without converting unknown to zero', async (t) => {
  const fixture = await createFixture(t);
  await fixture.controller.create(fixture.root, { portfolioId: 'portfolio-cost', storyIds: STORIES.slice(0, 1) });
  await fixture.controller.advance(fixture.root, { portfolioId: 'portfolio-cost' });
  const state = await fixture.controller.advance(fixture.root, {
    portfolioId: 'portfolio-cost', costAttribution: { active_ms: 1200, wait_ms: 300, total_tokens: 42, full_suite_count: 1, evidence_reuse_count: 2, human_interruption_count: 1 }
  });
  const output = renderStoryRunPortfolioSummary(state);
  assert.match(output, /trusted_pr_ready_ms=unknown active_ms=1200 wait_ms=300 tokens=42/);
  assert.match(output, /full_suite=1 evidence_reuse=2 human_interruptions=1/);
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

  const cases = [
    ['branch', { execution_context: { root_realpath: `/worktrees/${STORIES[0]}`, branch_name: 'foreign-branch' } }],
    ['review', { review_artifacts: [{ story_id: STORIES[1], run_id: 'foreign-run' }] }],
    ['session', { session_attribution: [{ story_id: STORIES[1], run_id: 'foreign-run' }] }]
  ];
  for (const [kind, contamination] of cases) {
    const portfolioId = `portfolio-contamination-${kind}`;
    await fixture.controller.create(fixture.root, { portfolioId, storyIds: STORIES.slice(0, 2) });
    await fixture.controller.advance(fixture.root, { portfolioId });
    fixture.contaminate(STORIES[0], contamination);
    await assert.rejects(fixture.controller.advance(fixture.root, { portfolioId }), errorCode('scope_contamination'));
  }
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

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-portfolio-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runs = new Map();
  const started = [];
  const guardedRun = {
    async run(_root, { storyId }) {
      started.push(storyId);
      const run = runState(storyId);
      runs.set(storyId, run);
      return structuredClone(run);
    },
    async status(_root, { storyId }) { return structuredClone(runs.get(storyId)); },
    async resume(_root, { storyId }) {
      const run = runs.get(storyId);
      run.status = 'running';
      run.stop_reason = null;
      return structuredClone(run);
    }
  };
  const dependencies = { guardedRun, now: () => new Date('2026-07-20T00:00:00.000Z'), randomBytes: () => Buffer.from('01020304', 'hex') };
  return {
    root, runs, started, dependencies,
    controller: createStoryRunPortfolioController(dependencies),
    restart: () => createStoryRunPortfolioController(dependencies),
    setStatus(storyId, status, stopReason = null) { Object.assign(runs.get(storyId), { status, stop_reason: stopReason }); },
    contaminate(storyId, values) { Object.assign(runs.get(storyId), values); }
  };
}

function runState(storyId) {
  return {
    story_id: storyId, run_id: `run-20260720T000000Z-${storyId.slice(-1).padStart(8, '0')}`, status: 'running',
    current_head_sha: storyId.slice(-1).repeat(40), stop_reason: null,
    execution_context: { root_realpath: `/worktrees/${storyId}`, branch_name: `codex/${storyId}` }
  };
}

function errorCode(code) {
  return (error) => error?.code === code;
}

function capture() {
  let value = '';
  return { write(chunk) { value += chunk; }, text() { return value; } };
}
