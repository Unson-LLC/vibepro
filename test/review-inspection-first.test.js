import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildReviewRecordCommandTemplate } from '../src/pr-manager.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  AGENT_SKILL_DISCIPLINE_BLOCK,
  AGENT_SKILL_DISCIPLINE_BLOCK_JA,
  INVESTIGATION_GUIDELINES_BLOCK,
  authorizeAgentReviewDispatch,
  prepareAgentReview,
  recordAgentReview,
  getAgentReviewStatus,
  startAgentReviewLifecycle,
  closeAgentReviewLifecycle
} from '../src/agent-review.js';
import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-inspection-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await writeFile(path.join(root, 'README.md'), '# test');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'src', 'agent-review.js'), 'export const fixture = true;\n');
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = true;\n');
  await writeFile(path.join(root, 'test', 'foo.test.js'), 'export const fixture = true;\n');
  await writeFile(path.join(root, 'test', 'review-inspection-first.test.js'), 'export const fixture = true;\n');
  await git(root, ['add', 'README.md', 'src', 'test']);
  await git(root, ['commit', '-m', 'init']);
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', selected_story_id: 'story-test' })
  );
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(
    path.join(root, 'docs', 'management', 'stories', 'active', 'story-test.md'),
    '---\nstory_id: story-test\ntitle: Test\n---\n\n# Story\n\n## Background\nTest.\n\n## Acceptance Criteria\n- Test.\n'
  );
  return root;
}

async function startCloseable(root) {
  return startAgentReviewLifecycle(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    agentSystem: 'claude_code',
    agentId: 'task-test-1',
    timeoutMs: 600000
  });
}

test('review authorize prevents spawn before evidence, freeze, Story-wide budget, and idempotency checks', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    budgets: { delivery_efficiency: { max_subagent_count: 1 } }
  }));
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence', 'release_risk'], language: 'en' });

  await assert.rejects(() => authorizeAgentReviewDispatch(root, {
    storyId: 'story-test', stage: 'gate', role: 'gate_evidence'
  }), /closes_risks must not be empty/);

  await assert.rejects(() => authorizeAgentReviewDispatch(root, {
    storyId: 'story-test', stage: 'gate', role: 'gate_evidence',
    reviewKind: 'final', closesRisks: ['release confidence'], expectedJudgmentDelta: 'Confirm current release evidence.',
    freeze: ['source', 'spec', 'review_surface']
  }), /review dispatch stop: finalization_incomplete/);

  const authorized = await authorizeAgentReviewDispatch(root, {
    storyId: 'story-test', stage: 'gate', role: 'gate_evidence',
    reviewKind: 'preflight', closesRisks: ['release confidence'], expectedJudgmentDelta: 'Identify evidence gaps before freeze.',
    reusableEvidence: ['targeted:test'], operationIdempotencyKey: 'gate:gate_evidence:authorize'
  });
  assert.equal(authorized.dispatch_decision.action, 'dispatch');
  const replayedAuthorization = await authorizeAgentReviewDispatch(root, {
    storyId: 'story-test', stage: 'gate', role: 'gate_evidence',
    reviewKind: 'preflight', closesRisks: ['release confidence'], expectedJudgmentDelta: 'Identify evidence gaps before freeze.',
    reusableEvidence: ['targeted:test'], operationIdempotencyKey: 'gate:gate_evidence:authorize'
  });
  assert.equal(replayedAuthorization.authorization.authorization_id, authorized.authorization.authorization_id);
  await assert.rejects(() => startAgentReviewLifecycle(root, {
    storyId: 'story-test', stage: 'gate', role: 'gate_evidence', agentSystem: 'codex', agentId: 'missing-authorization'
  }), /requires --dispatch-authorization/);
  const started = await startAgentReviewLifecycle(root, {
    storyId: 'story-test', stage: 'gate', role: 'gate_evidence', agentSystem: 'codex', agentId: 'preflight-1',
    dispatchAuthorization: authorized.authorization.authorization_id
  });
  assert.equal(started.dispatch_decision.action, 'dispatch');
  assert.equal(started.lifecycle.dispatch_authorization_id, authorized.authorization.authorization_id);
  assert.equal(started.lifecycle.dispatch_decision.idempotency_key, started.dispatch_decision.idempotency_key);

  await assert.rejects(() => authorizeAgentReviewDispatch(root, {
    storyId: 'story-test', stage: 'gate', role: 'gate_evidence',
    reviewKind: 'preflight', closesRisks: ['release confidence'], expectedJudgmentDelta: 'Identify evidence gaps before freeze.',
    reusableEvidence: ['targeted:test']
  }), /review dispatch await_result: running/);

  await assert.rejects(() => authorizeAgentReviewDispatch(root, {
    storyId: 'story-test', stage: 'gate', role: 'release_risk',
    reviewKind: 'preflight', closesRisks: ['release risk'], expectedJudgmentDelta: 'Confirm no remaining release blocker.'
  }), /review dispatch stop: budget_exceeded/);

  await prepareAgentReview(root, { storyId: 'story-test', stage: 'implementation', roles: ['runtime_contract'], language: 'en' });
  await assert.rejects(() => authorizeAgentReviewDispatch(root, {
    storyId: 'story-test', stage: 'implementation', role: 'runtime_contract',
    reviewKind: 'preflight', closesRisks: ['runtime contract'], expectedJudgmentDelta: 'Check another stage.'
  }), /review dispatch stop: budget_exceeded/);

  await assert.rejects(() => startAgentReviewLifecycle(root, {
    storyId: 'story-test', stage: 'gate', role: 'gate_evidence', agentSystem: 'codex', agentId: 'reuse-auth',
    dispatchAuthorization: authorized.authorization.authorization_id
  }), /is consumed/);
});

test('review authorize CLI returns a consumable pre-spawn authorization', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    budgets: { delivery_efficiency: { max_subagent_count: 1 } }
  }));
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  let output = '';
  const authorized = await runCli([
    'review', 'authorize', root, '--id', 'story-test', '--stage', 'gate', '--role', 'gate_evidence',
    '--review-kind', 'preflight', '--closes-risk', 'release confidence',
    '--expected-judgment-delta', 'find missing evidence', '--agent-model', 'gpt-5.6-luna',
    '--agent-reasoning-effort', 'low', '--agent-cost-tier', 'low', '--json'
  ], { stdout: { write: (chunk) => { output += chunk; } } });
  assert.equal(authorized.exitCode, 0);
  const authorization = JSON.parse(output).authorization;
  assert.equal(authorization.status, 'authorized');
  assert.equal(authorization.agent_model, 'gpt-5.6-luna');

  const started = await startAgentReviewLifecycle(root, {
    storyId: 'story-test', stage: 'gate', role: 'gate_evidence', agentSystem: 'codex', agentId: 'agent-luna',
    dispatchAuthorization: authorization.authorization_id, agentModel: 'gpt-5.6-luna',
    agentReasoningEffort: 'low', agentCostTier: 'low'
  });
  assert.equal(started.lifecycle.dispatch_authorization_id, authorization.authorization_id);
});

test('HEAD mutation remains orphaned until explicit cancellation confirmation persists obsolete', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  const started = await startCloseable(root);
  assert.ok(started.lifecycle.head_sha);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = false;\n');
  await git(root, ['add', 'src/foo.js']);
  await git(root, ['commit', '-m', 'mutate reviewed head']);

  const stale = await getAgentReviewStatus(root, { storyId: 'story-test', stage: 'gate' });
  const staleRole = stale.stages[0].roles.find((role) => role.role === 'gate_evidence');
  assert.equal(staleRole.lifecycle.effective_status, 'orphaned_agent');
  assert.match(staleRole.lifecycle.latest.head_sha, /^[a-f0-9]{40}$/);
  assert.match(stale.stages[0].next_actions.join('\n'), /Fail closed and confirm cancellation/);

  const unconfirmed = await closeAgentReviewLifecycle(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    agentId: 'task-test-1',
    closeReason: 'replaced',
    closeEvidence: 'provider-cancellation-requested'
  });
  assert.equal(unconfirmed.lifecycle.effective_status, 'orphaned_agent');
  assert.equal(unconfirmed.lifecycle.status, 'running');
  assert.equal(unconfirmed.lifecycle.cancel_confirmed, false);
  assert.equal(unconfirmed.lifecycle.closed_at, null);
  assert.equal(unconfirmed.lifecycle.terminal_reason, 'head_mutated_cancellation_unconfirmed');

  const closed = await closeAgentReviewLifecycle(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    agentId: 'task-test-1',
    closeReason: 'replaced',
    closeEvidence: 'provider-cancellation-confirmed',
    cancellationConfirmed: true
  });
  assert.equal(closed.lifecycle.effective_status, 'obsolete');
  assert.equal(closed.lifecycle.status, 'replaced');
  assert.equal(closed.lifecycle.cancel_confirmed, true);
  assert.equal(closed.lifecycle.terminal_reason, 'head_mutated_after_dispatch');
});

test('INVESTIGATION_GUIDELINES_BLOCK exports a non-empty string mentioning read-only checks', () => {
  assert.equal(typeof INVESTIGATION_GUIDELINES_BLOCK, 'string');
  assert.ok(INVESTIGATION_GUIDELINES_BLOCK.length > 0);
  assert.match(INVESTIGATION_GUIDELINES_BLOCK, /read-only/i);
  assert.match(INVESTIGATION_GUIDELINES_BLOCK, /inspection/i);
  assert.match(INVESTIGATION_GUIDELINES_BLOCK, /--inspection-summary/);
});

test('generated review discipline follows effective freshness policy instead of requiring HEAD globally', () => {
  assert.match(AGENT_SKILL_DISCIPLINE_BLOCK, /inspected content surface by default/);
  assert.match(AGENT_SKILL_DISCIPLINE_BLOCK, /current git head only for strict HEAD roles/);
  assert.doesNotMatch(AGENT_SKILL_DISCIPLINE_BLOCK, /not bound to the current git head or artifact path/);
  assert.match(AGENT_SKILL_DISCIPLINE_BLOCK_JA, /既定はinspectionしたcontent surface/);
  assert.match(AGENT_SKILL_DISCIPLINE_BLOCK_JA, /strict HEAD roleだけはcurrent git head/);
  assert.doesNotMatch(AGENT_SKILL_DISCIPLINE_BLOCK_JA, /current git headまたはartifact pathに紐づいていない/);
});

test('Japanese agent review guide keeps executable pass arguments and freshness semantics current', async () => {
  const guide = await readFile(new URL('../docs/ja/guide/agent-review.md', import.meta.url), 'utf8');
  assert.match(guide, /--inspection-summary/);
  assert.match(guide, /--inspection-input <source-test-story-spec-contract-or-config>/);
  assert.match(guide, /--judgment-delta/);
  assert.match(guide, /content-surface-bound/);
  assert.match(guide, /strict HEAD-bound/);
  assert.match(guide, /\.vibepro.*だけではinspection surfaceになりません/);
  assert.doesNotMatch(guide, /--inspection-input <diff-or-artifact>/);
  assert.doesNotMatch(guide, /record後のcommitはhead-bound evidenceをstaleにします/);
});

test('review request markdown emits Investigation Guidelines between Mandatory Review Lenses and Instructions (INV-RIF-1)', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  const requestPath = path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'review-request-gate_evidence.md');
  const content = await readFile(requestPath, 'utf8');
  const lensesIdx = content.indexOf('## Mandatory Review Lenses');
  const guidelinesIdx = content.indexOf('## Investigation Guidelines');
  const instructionsIdx = content.indexOf('## Instructions');
  assert.ok(lensesIdx >= 0);
  assert.ok(guidelinesIdx >= 0, 'Investigation Guidelines section must be present');
  assert.ok(instructionsIdx >= 0);
  assert.ok(guidelinesIdx > lensesIdx, 'Investigation Guidelines must come after Mandatory Review Lenses');
  assert.ok(guidelinesIdx < instructionsIdx, 'Investigation Guidelines must come before Instructions');
  assert.ok(content.includes(INVESTIGATION_GUIDELINES_BLOCK), 'block must be interpolated verbatim');
  assert.match(content, /--inspection-summary "<inspection-summary>"/);
  assert.match(content, /--inspection-evidence "<inspection-evidence>"/);
  assert.match(content, /--inspection-input "<ref>"/);
  assert.match(content, /--judgment-delta/);
  assert.match(content, /inspection_summary/);
  assert.match(content, /inspection_evidence/);
  assert.match(content, /inspection_inputs/);
  assert.match(content, /judgment_delta/);
  assert.match(content, /effective freshness policy/);
  assert.match(content, /inspected content surface by default/);
  assert.doesNotMatch(content, /adequately covered for the current head\./);
});

test('parallel dispatch record command and prompt include inspection fields', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  const dispatchPath = path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'parallel-dispatch.md');
  const content = await readFile(dispatchPath, 'utf8');
  assert.match(content, /--inspection-summary "<inspection-summary>"/);
  assert.match(content, /--inspection-evidence "<inspection-evidence>"/);
  assert.match(content, /--inspection-input "<ref>"/);
  assert.match(content, /--judgment-delta/);
  assert.match(content, /inspection_summary/);
  assert.match(content, /inspection_evidence/);
  assert.match(content, /inspection_inputs/);
  assert.match(content, /judgment_delta/);
  assert.match(content, /actual source, test, Story, Spec, contract, or config files/i);
  assert.match(content, /generated `.vibepro` artifact alone is not a content surface/i);
  assert.match(content, /Do not add `--strict-head-binding` unless making a deliberate CLI override/i);
  assert.match(content, /`--strict-head-reason` is required/i);
});

test('architecture boundary request and dispatch emit the complete aggregate inspection surface', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, {
    storyId: 'story-test',
    stage: 'architecture_spec',
    roles: ['architecture_boundary'],
    language: 'en'
  });
  for (const fileName of ['review-request-architecture_boundary.md', 'parallel-dispatch.md']) {
    const content = await readFile(path.join(root, '.vibepro', 'reviews', 'story-test', 'architecture_spec', fileName), 'utf8');
    assert.match(content, /--inspection-input "<design-story-spec-path>"/);
    assert.match(content, /--inspection-input "<runtime-source-path>"/);
    assert.match(content, /--inspection-input "<test-path>"/);
  }
});

test('PR readiness recovery emits the complete aggregate inspection surface', () => {
  const command = buildReviewRecordCommandTemplate(
    'story-test',
    'architecture_spec',
    'architecture_boundary'
  );
  assert.match(command, /--inspection-input '<design-story-spec-path>'/);
  assert.match(command, /--inspection-input '<runtime-source-path>'/);
  assert.match(command, /--inspection-input '<test-path>'/);
});

test('recordAgentReview without inspection flags rejects gate_evidence pass (INV-RIF-2)', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  await startCloseable(root);
  const before = await getAgentReviewStatus(root, { storyId: 'story-test', stage: 'gate' });
  const beforeRole = before.stages[0].roles.find((role) => role.role === 'gate_evidence');
  assert.equal(beforeRole.lifecycle.effective_status, 'running');
  await assert.rejects(recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'no findings',
    agentSystem: 'claude_code',
    executionMode: 'parallel_subagent',
    agentId: 'task-test-1',
    agentClosed: true
  }), /requires --inspection-summary/);
  const after = await getAgentReviewStatus(root, { storyId: 'story-test', stage: 'gate' });
  const afterRole = after.stages[0].roles.find((role) => role.role === 'gate_evidence');
  assert.equal(afterRole.effective_status, 'missing');
  assert.equal(afterRole.lifecycle.effective_status, 'running');
  assert.equal(after.stages[0].lifecycle.closed_count, 0);
  const reviewDirFiles = await readdir(path.join(root, '.vibepro', 'reviews', 'story-test', 'gate'));
  assert.equal(reviewDirFiles.some((file) => file.startsWith('review-result-gate_evidence')), false);
});

test('recordAgentReview persists inspection.summary verbatim (INV-RIF-3)', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  await startCloseable(root);
  const summaryText = 'ran node --test test/foo.test.js, read src/foo.js:1-100; no destructive paths touched';
  const { review } = await recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'ok',
    inspectionSummary: summaryText,
    inspectionEvidence: 'test/foo.test.js',
    inspectionInputs: ['src/foo.js', 'test/foo.test.js'],
    judgmentDeltas: ['generic gate pass -> accepted after source and focused test inspection'],
    agentSystem: 'claude_code',
    executionMode: 'parallel_subagent',
    agentId: 'task-test-1',
    agentClosed: true
  });
  assert.equal(review.inspection.summary, summaryText);
  assert.equal(review.inspection.evidence, 'test/foo.test.js');
  assert.deepEqual(review.inspection.inputs, ['src/foo.js', 'test/foo.test.js']);
  assert.deepEqual(review.judgment_delta, ['generic gate pass -> accepted after source and focused test inspection']);
});

test('recordAgentReview persists inspection inputs and judgment delta for handoff', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  await startCloseable(root);
  const { review, summary } = await recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'ok',
    inspectionSummary: 'read review request, PR artifacts, and focused tests',
    inspectionEvidence: 'test/review-inspection-first.test.js',
    inspectionInputs: [
      'src/agent-review.js',
      ' .vibepro/reviews/story-test/gate/review-request-gate_evidence.md ',
      'src/agent-review.js'
    ],
    judgmentDeltas: [
      'generic pass concern -> acceptable because concrete inspection inputs are listed',
      'handoff unclear -> clear because judgment delta is recorded'
    ],
    agentSystem: 'claude_code',
    executionMode: 'parallel_subagent',
    agentId: 'task-test-1',
    agentClosed: true
  });
  assert.deepEqual(review.inspection.inputs, [
    'src/agent-review.js',
    '.vibepro/reviews/story-test/gate/review-request-gate_evidence.md'
  ]);
  assert.deepEqual(review.judgment_delta, [
    'generic pass concern -> acceptable because concrete inspection inputs are listed',
    'handoff unclear -> clear because judgment delta is recorded'
  ]);
  const role = summary.roles.find((item) => item.role === 'gate_evidence');
  assert.deepEqual(role.inspection.inputs, review.inspection.inputs);
  assert.deepEqual(role.judgment_delta, review.judgment_delta);
  const markdown = await readFile(path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'review-summary.md'), 'utf8');
  assert.match(markdown, /inputs=src\/agent-review\.js/);
  assert.match(markdown, /judgment_delta=generic pass concern -> acceptable/);
});

test('recordAgentReview rejects whitespace-only inspection for gate_evidence pass', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  await startCloseable(root);
  await assert.rejects(recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'ok',
    inspectionSummary: '   ',
    inspectionEvidence: '',
    agentSystem: 'claude_code',
    executionMode: 'parallel_subagent',
    agentId: 'task-test-1',
    agentClosed: true
  }), /requires --inspection-summary/);
});

test('recordAgentReview rejects gate_evidence pass without handoff inputs and judgment delta', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  await startCloseable(root);
  await assert.rejects(recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'ok',
    inspectionSummary: 'read gate evidence',
    agentSystem: 'claude_code',
    executionMode: 'parallel_subagent',
    agentId: 'task-test-1',
    agentClosed: true
  }), /requires --inspection-input/);

  await assert.rejects(recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'ok',
    inspectionSummary: 'read gate evidence',
    inspectionInputs: ['src/agent-review.js'],
    agentSystem: 'claude_code',
    executionMode: 'parallel_subagent',
    agentId: 'task-test-1',
    agentClosed: true
  }), /requires --judgment-delta/);
});

test('getAgentReviewStatus surfaces the inspection block per role', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  await startCloseable(root);
  await recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'ok',
    inspectionSummary: 'verified contract via test suite',
    inspectionInputs: ['src/agent-review.js', 'test/review-inspection-first.test.js'],
    judgmentDeltas: ['missing handoff detail -> pass because concrete inputs and delta are recorded'],
    agentSystem: 'claude_code',
    executionMode: 'parallel_subagent',
    agentId: 'task-test-1',
    agentClosed: true
  });
  const status = await getAgentReviewStatus(root, { storyId: 'story-test', stage: 'gate' });
  const role = status.stages[0].roles.find((r) => r.role === 'gate_evidence');
  assert.ok(role, 'gate_evidence role missing from status');
  assert.deepEqual(role.inspection, {
    summary: 'verified contract via test suite',
    evidence: null,
    inputs: ['src/agent-review.js', 'test/review-inspection-first.test.js']
  });
  assert.deepEqual(role.judgment_delta, ['missing handoff detail -> pass because concrete inputs and delta are recorded']);
});

test('recordAgentReview synthesizes a closed lifecycle entry from closed provenance when no start record exists', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  const { summary } = await recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'ok',
    inspectionSummary: 'read review request and source files',
    inspectionInputs: ['.vibepro/reviews/story-test/gate/review-request-gate_evidence.md', 'src/agent-review.js'],
    judgmentDeltas: ['no lifecycle start -> synthesized closure accepted because transcript artifact is present'],
    agentSystem: 'codex',
    executionMode: 'parallel_subagent',
    agentId: 'synthetic-agent-1',
    agentClosed: true,
    agentTranscript: '.vibepro/reviews/story-test/gate/transcript-synthetic.json'
  });
  const role = summary.roles.find((item) => item.role === 'gate_evidence');
  assert.equal(summary.lifecycle.closed_count, 1);
  assert.equal(role.lifecycle.effective_status, 'closed');
  assert.equal(role.lifecycle.latest.synthesized_from_result, true);
  assert.equal(role.lifecycle.latest.agent_id, 'synthetic-agent-1');
});

test('delivery efficiency policy rejects synthetic lifecycle evidence that bypasses pre-spawn authorization', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    budgets: { delivery_efficiency: { max_subagent_count: 1 } }
  }));
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  await assert.rejects(() => recordAgentReview(root, {
    storyId: 'story-test', stage: 'gate', role: 'gate_evidence', status: 'pass', summary: 'ok',
    inspectionSummary: 'read source', inspectionInputs: ['src/agent-review.js'],
    judgmentDeltas: ['uncertain -> pass'], agentSystem: 'codex', executionMode: 'parallel_subagent',
    agentId: 'unauthorized-agent', agentClosed: true,
    agentTranscript: '.vibepro/reviews/story-test/gate/unauthorized-transcript.json'
  }), /requires a lifecycle started from a consumed dispatch authorization/);
});

test('delivery efficiency lifecycle collects a completed result after explicit close', async () => {
  const root = await setupRepo();
  await writeFile(path.join(root, '.vibepro', 'config.json'), JSON.stringify({
    budgets: { delivery_efficiency: { max_subagent_count: 2 } }
  }));
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  const authorized = await authorizeAgentReviewDispatch(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    reviewKind: 'final',
    closesRisks: ['release evidence'],
    expectedJudgmentDelta: 'Confirm the frozen review surface.',
    freeze: ['source', 'spec', 'test', 'review_surface']
  });
  const started = await startAgentReviewLifecycle(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    agentSystem: 'codex',
    agentId: 'authorized-agent',
    dispatchAuthorization: authorized.authorization.authorization_id
  });
  await closeAgentReviewLifecycle(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    lifecycleId: started.lifecycle.lifecycle_id,
    closeReason: 'completed',
    closeEvidence: 'agent completion notification'
  });
  await recordAgentReview(root, {
    storyId: 'story-test',
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'authorized review completed',
    inspectionSummary: 'inspected the frozen source surface',
    inspectionInputs: ['src/agent-review.js'],
    judgmentDeltas: ['pending review -> pass after source inspection'],
    agentSystem: 'codex',
    executionMode: 'parallel_subagent',
    agentId: 'authorized-agent',
    agentClosed: true,
    agentTranscript: '.vibepro/reviews/story-test/gate/authorized-agent.json'
  });
  const lifecycle = JSON.parse(await readFile(
    path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'lifecycle.json'),
    'utf8'
  ));
  assert.match(lifecycle.entries[0].result_artifact, /review-result-gate_evidence\.json$/);
  assert.equal(lifecycle.entries[0].result_status, 'pass');
});

test('review record persists no result after timeout, replacement, or manual shutdown', async () => {
  for (const closeReason of ['timeout', 'replaced', 'manual_shutdown']) {
    const root = await setupRepo();
    await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
    const started = await startCloseable(root);
    await closeAgentReviewLifecycle(root, {
      storyId: 'story-test',
      stage: 'gate',
      role: 'gate_evidence',
      lifecycleId: started.lifecycle.lifecycle_id,
      closeReason,
      closeEvidence: `${closeReason} fixture`,
      cancellationConfirmed: closeReason !== 'timeout'
    });
    await assert.rejects(() => recordAgentReview(root, {
      storyId: 'story-test',
      stage: 'gate',
      role: 'gate_evidence',
      status: 'pass',
      summary: 'must not persist',
      inspectionSummary: 'inspected rejected lifecycle',
      inspectionInputs: ['src/agent-review.js'],
      judgmentDeltas: ['pending -> rejected'],
      agentSystem: 'claude_code',
      executionMode: 'parallel_subagent',
      agentId: 'task-test-1',
      agentClosed: true
    }), new RegExp(`closed as ${closeReason}`));
    const reviewDir = path.join(root, '.vibepro', 'reviews', 'story-test', 'gate');
    assert.equal(
      (await readdir(reviewDir)).includes('review-result-gate_evidence.json'),
      false,
      `${closeReason} must not leave a current result`
    );
    const history = await readdir(path.join(reviewDir, 'history')).catch(() => []);
    assert.equal(
      history.some((file) => file.startsWith('review-result-gate_evidence-')),
      false,
      `${closeReason} must not leave review history`
    );
  }
});

test('getAgentReviewStatus surfaces empty handoff arrays for missing roles', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  const status = await getAgentReviewStatus(root, { storyId: 'story-test', stage: 'gate' });
  const role = status.stages[0].roles.find((r) => r.role === 'gate_evidence');
  assert.ok(role, 'gate_evidence role missing from status');
  assert.equal(role.effective_status, 'missing');
  assert.deepEqual(role.inspection, { summary: null, evidence: null, inputs: [] });
  assert.deepEqual(role.judgment_delta, []);
  const summary = JSON.parse(await readFile(
    path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'review-summary.json'),
    'utf8'
  ));
  assert.deepEqual(summary.roles[0].inspection, { summary: null, evidence: null, inputs: [] });
  assert.deepEqual(summary.roles[0].judgment_delta, []);
});

test('review record CLI persists inspection summary and evidence', async () => {
  const root = await setupRepo();
  await prepareAgentReview(root, { storyId: 'story-test', stage: 'gate', roles: ['gate_evidence'], language: 'en' });
  await startCloseable(root);
  await runCli([
    'review',
    'record',
    root,
    '--id',
    'story-test',
    '--stage',
    'gate',
    '--role',
    'gate_evidence',
    '--status',
    'pass',
    '--summary',
    'ok',
    '--inspection-summary',
    'read src/agent-review.js and ran focused review tests',
    '--inspection-evidence',
    'test/review-inspection-first.test.js',
    '--inspection-input',
    'src/agent-review.js',
    '--inspection-input',
    '.vibepro/reviews/story-test/gate/review-request-gate_evidence.md',
    '--judgment-delta',
    'initial uncertainty -> pass because focused inspection was recorded',
    '--agent-system',
    'claude_code',
    '--execution-mode',
    'parallel_subagent',
    '--agent-id',
    'task-test-1',
    '--agent-closed'
  ]);
  const review = JSON.parse(await readFile(
    path.join(root, '.vibepro', 'reviews', 'story-test', 'gate', 'review-result-gate_evidence.json'),
    'utf8'
  ));
  assert.deepEqual(review.inspection, {
    summary: 'read src/agent-review.js and ran focused review tests',
    evidence: 'test/review-inspection-first.test.js',
    inputs: [
      'src/agent-review.js',
      '.vibepro/reviews/story-test/gate/review-request-gate_evidence.md'
    ]
  });
  assert.deepEqual(review.judgment_delta, [
    'initial uncertainty -> pass because focused inspection was recorded'
  ]);
});
