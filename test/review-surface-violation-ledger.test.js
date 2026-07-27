import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  closeAgentReviewLifecycle,
  getAgentReviewStatus,
  readReviewSurfaceViolationSummary,
  recordAgentReview,
  startAgentReviewLifecycle,
  summarizeAgentReviewsForPr
} from '../src/agent-review.js';
import {
  REVIEW_SURFACE_INTEGRITY_GATE_ID,
  REVIEW_SURFACE_LEDGER_UNREADABLE,
  appendReviewSurfaceViolation,
  detectReviewSurfaceMutation,
  readReviewSurfaceViolations,
  reconcileReviewSurfaceViolationPointers,
  summarizeReviewSurfaceViolations
} from '../src/review-surface-violations.js';
import { recordDecision, readDecisionRecordsIfExists } from '../src/decision-records.js';
import { runCli } from '../src/cli.js';
import { buildReviewSurfaceIntegrityGate, isUnresolvedGateStatus } from '../src/pr-manager.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-test';
const STORY_BODY = [
  '---',
  `story_id: ${STORY_ID}`,
  'title: Review surface violation ledger',
  '---',
  '',
  '# Story',
  '',
  '## Background',
  'Record mid-review review-surface changes as append-only violations.',
  '',
  '## Acceptance Criteria',
  '- review close records the close-time head and surface digest.',
  ''
].join('\n');

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rsv-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', STORY_ID, '--title', 'Review surface violation ledger']);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), STORY_BODY);
  await writeFile(path.join(root, 'README.md'), '# test\n');
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = true;\n');
  await writeFile(path.join(root, 'src', 'unrelated.js'), 'export const unrelated = true;\n');
  await writeFile(path.join(root, 'test', 'foo.test.js'), 'export const fixture = true;\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/review-surface']);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "implemented";\n');
  await git(root, ['add', 'src/foo.js']);
  await git(root, ['commit', '-m', 'feat: implement']);
  return root;
}

function lifecyclePath(root, stage = 'gate') {
  return path.join(root, '.vibepro', 'reviews', STORY_ID, stage, 'lifecycle.json');
}

function violationsPath(root) {
  return path.join(root, '.vibepro', 'reviews', STORY_ID, 'surface-violations.json');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function start(root, { role = 'gate_evidence', agentId = 'task-1' } = {}) {
  return startAgentReviewLifecycle(root, {
    storyId: STORY_ID,
    stage: 'gate',
    role,
    agentSystem: 'claude_code',
    agentId,
    agentThreadId: `thread-${agentId}`,
    agentSessionId: `session-${agentId}`,
    timeoutMs: 600000
  });
}

async function close(root, options = {}) {
  return closeAgentReviewLifecycle(root, {
    storyId: STORY_ID,
    stage: 'gate',
    role: options.role ?? 'gate_evidence',
    agentId: options.agentId ?? 'task-1',
    closeReason: options.closeReason ?? 'completed',
    closeEvidence: options.closeEvidence ?? 'subagent shut down',
    cancellationConfirmed: options.cancellationConfirmed ?? true,
    ...(options.operationIdempotencyKey ? { operationIdempotencyKey: options.operationIdempotencyKey } : {}),
    ...(options.lifecycleId ? { lifecycleId: options.lifecycleId } : {})
  });
}

test('RSV-1 review close records the close-time head and surface digest even when nothing moved', async () => {
  const root = await setupRepo();
  const started = await start(root);
  const closed = await close(root);

  const lifecycle = await readJson(lifecyclePath(root));
  const entry = lifecycle.entries.find((item) => item.lifecycle_id === started.lifecycle.lifecycle_id);
  assert.ok(entry.closed_head_sha, 'closed_head_sha must be recorded');
  assert.ok(entry.closed_surface_digest, 'closed_surface_digest must be recorded');
  assert.equal(entry.closed_head_sha, started.lifecycle.head_sha);
  assert.equal(entry.closed_surface_digest, started.lifecycle.surface_digest);
  assert.equal(closed.surface_violation, null);
  assert.equal(entry.surface_violation_id, undefined);
});

test('RSV-2 a review surface change between start and close is recorded as an append-only violation', async () => {
  const root = await setupRepo();
  const started = await start(root);

  // The round-6 failure mode: the implementing agent edits the tree while the
  // reviewer is still running. Uncommitted, so head_sha never moves.
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "mutated mid-review";\n');

  const closed = await close(root);
  assert.ok(closed.surface_violation, 'close must return the recorded violation');

  const ledger = await readJson(violationsPath(root));
  assert.equal(ledger.append_only, true);
  assert.equal(ledger.entries.length, 1);
  const [violation] = ledger.entries;
  assert.equal(violation.kind, 'review_surface_mutated_during_review');
  assert.equal(violation.evidence_class, 'violation');
  assert.deepEqual(violation.changed_fields, ['surface_digest']);
  assert.equal(violation.lifecycle_id, started.lifecycle.lifecycle_id);
  assert.equal(violation.stage, 'gate');
  assert.equal(violation.role, 'gate_evidence');
  assert.equal(violation.started.surface_digest, started.lifecycle.surface_digest);
  assert.notEqual(violation.closed.surface_digest, started.lifecycle.surface_digest);
  assert.equal(violation.detected_by, 'review close');

  const lifecycle = await readJson(lifecyclePath(root));
  const entry = lifecycle.entries.find((item) => item.lifecycle_id === started.lifecycle.lifecycle_id);
  assert.equal(entry.surface_violation_id, violation.violation_id);
});

test('RSV-2 a commit landed mid-review is recorded with head_sha among the changed fields', async () => {
  const root = await setupRepo();
  await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "committed mid-review";\n');
  await git(root, ['add', 'src/foo.js']);
  await git(root, ['commit', '-m', 'mid-review commit']);

  await close(root);
  const ledger = await readJson(violationsPath(root));
  assert.equal(ledger.entries.length, 1);
  assert.ok(ledger.entries[0].changed_fields.includes('head_sha'));
});

test('RSV-3 a later clean review round never removes or rewrites an earlier violation', async () => {
  const root = await setupRepo();
  const contaminated = await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "mutated mid-review";\n');
  await close(root);

  const before = await readJson(violationsPath(root));
  assert.equal(before.entries.length, 1);
  const original = JSON.parse(JSON.stringify(before.entries[0]));

  // Finalize the tree, then run a full clean second round for the same role.
  await git(root, ['add', 'src/foo.js']);
  await git(root, ['commit', '-m', 'finalize']);
  const rerun = await start(root, { agentId: 'task-2' });
  assert.notEqual(rerun.lifecycle.lifecycle_id, contaminated.lifecycle.lifecycle_id);
  await close(root, { agentId: 'task-2' });
  await recordAgentReview(root, {
    storyId: STORY_ID,
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'clean re-run over the finalized tree',
    reviewerSystem: 'claude_code',
    reviewerId: 'task-2',
    agentClosed: true,
    judgmentDeltas: ['initial: unverified -> final: verified because the fixture export matches the asserted test'],
    inspectionSummary: 'Read src/foo.js and test/foo.test.js in full.',
    inspectionEvidence: 'src/foo.js:1 defines the fixture export asserted by test/foo.test.js.',
    inspectionInputs: ['src/foo.js', 'test/foo.test.js']
  });

  const after = await readJson(violationsPath(root));
  assert.ok(after.entries.length >= before.entries.length, 'entry count must never decrease');
  const survivor = after.entries.find((item) => item.violation_id === original.violation_id);
  assert.deepEqual(survivor, original, 'the earlier violation must survive byte-identical');
});

test('RSV-4 replaying the same close does not duplicate the violation', async () => {
  const root = await setupRepo();
  await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "mutated mid-review";\n');

  const first = await close(root, { operationIdempotencyKey: 'gate:gate_evidence:close' });
  const replay = await close(root, { operationIdempotencyKey: 'gate:gate_evidence:close' });
  assert.equal(replay.lifecycle.lifecycle_id, first.lifecycle.lifecycle_id);

  const ledger = await readJson(violationsPath(root));
  assert.equal(ledger.entries.length, 1);
});

test('RSV-4 violation_id is deterministic, so a direct append of the same fact is a no-op', async () => {
  const root = await setupRepo();
  const storyReviewDir = path.join(root, '.vibepro', 'reviews', STORY_ID);
  const violation = {
    kind: 'review_surface_mutated_during_review',
    evidence_class: 'violation',
    changed_fields: ['surface_digest'],
    stage: 'gate',
    role: 'gate_evidence',
    lifecycle_id: 'lc-1',
    started: { head_sha: 'aaa', surface_digest: 'd1' },
    closed: { head_sha: 'aaa', surface_digest: 'd2' }
  };
  const first = await appendReviewSurfaceViolation(storyReviewDir, STORY_ID, violation);
  const second = await appendReviewSurfaceViolation(storyReviewDir, STORY_ID, {
    ...violation,
    recorded_at: '2030-01-01T00:00:00.000Z'
  });
  assert.equal(first.appended, true);
  assert.equal(second.appended, false);
  assert.equal(second.entry.recorded_at, first.entry.recorded_at);
  const ledger = await readReviewSurfaceViolations(storyReviewDir, STORY_ID);
  assert.equal(ledger.entries.length, 1);
});

test('RSV-5 the gate fails while unacknowledged, is not cleared by a re-run, and clears only by decision record', async () => {
  const root = await setupRepo();
  await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "mutated mid-review";\n');
  await close(root);
  const violationId = (await readJson(violationsPath(root))).entries[0].violation_id;

  const failing = await readReviewSurfaceViolationSummary(root, STORY_ID, {
    decisionRecords: await readDecisionRecordsIfExists(root, STORY_ID)
  });
  assert.equal(failing.unacknowledged_count, 1);

  // A clean re-run of the review does not touch the violation.
  await git(root, ['add', 'src/foo.js']);
  await git(root, ['commit', '-m', 'finalize']);
  await start(root, { agentId: 'task-2' });
  await close(root, { agentId: 'task-2' });
  const afterRerun = await readReviewSurfaceViolationSummary(root, STORY_ID, {
    decisionRecords: await readDecisionRecordsIfExists(root, STORY_ID)
  });
  assert.equal(afterRerun.unacknowledged_count, 1, 'a review re-run must not clear a violation');

  await recordDecision(root, {
    storyId: STORY_ID,
    type: 'needs_review',
    status: 'accepted',
    source: `${REVIEW_SURFACE_INTEGRITY_GATE_ID}:${violationId}`,
    summary: 'Reviewer confirmed the mid-review edit was limited to a comment.',
    reason: 'Owner inspected the diff between the start and close digests.',
    artifact: 'README.md'
  });

  const acknowledged = await readReviewSurfaceViolationSummary(root, STORY_ID, {
    decisionRecords: await readDecisionRecordsIfExists(root, STORY_ID)
  });
  assert.equal(acknowledged.unacknowledged_count, 0);
  assert.equal(acknowledged.total_count, 1, 'acknowledgement must not delete the record');
  assert.equal(acknowledged.entries[0].acknowledged, true);
  assert.equal((await readJson(violationsPath(root))).entries.length, 1);
});

test('RSV-5 pr prepare blocks on gate:review_surface_integrity and keeps it on the DAG path', async () => {
  const root = await setupRepo();
  await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "mutated mid-review";\n');
  await close(root);
  await git(root, ['add', 'src/foo.js']);
  await git(root, ['commit', '-m', 'finalize']);
  const violationId = (await readJson(violationsPath(root))).entries[0].violation_id;

  await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--base', 'main', '--json']);
  const prepare = await readJson(path.join(root, '.vibepro', 'pr', STORY_ID, 'pr-prepare.json'));
  const nodes = prepare.pr_context.gate_dag.nodes;
  const gate = nodes.find((node) => node.id === REVIEW_SURFACE_INTEGRITY_GATE_ID);
  assert.ok(gate, 'pr prepare must expose the gate');
  assert.equal(gate.status, 'failed');
  assert.equal(gate.required, true);
  assert.equal(gate.unacknowledged_violation_count, 1);
  assert.equal(gate.evidence_class, 'violation');
  assert.equal(gate.distinct_from, 'stale_review');
  assert.match(gate.reason, /append-only/);
  assert.ok(gate.required_actions.some((action) => action.includes(violationId)));
  assert.ok(prepare.gate_status.unresolved_gates.some((item) => item.id === REVIEW_SURFACE_INTEGRITY_GATE_ID));
  assert.equal(prepare.gate_status.ready_for_pr_create, false);

  const edges = prepare.pr_context.gate_dag.edges;
  assert.ok(edges.some((edge) => edge.to === REVIEW_SURFACE_INTEGRITY_GATE_ID), 'gate needs an incoming edge');
  assert.ok(edges.some((edge) => edge.from === REVIEW_SURFACE_INTEGRITY_GATE_ID), 'gate must stay on the path to pr');
  const dagConnectivity = nodes.find((node) => node.id === 'gate:dag_connectivity');
  assert.equal(dagConnectivity.status, 'passed', 'the new node must not break dag connectivity');

  // The clearing leg, through the real command rather than the pure function:
  // without decisionRecords wired into pr prepare the gate would be unclearable
  // in the CLI while every unit assertion still passed.
  await recordDecision(root, {
    storyId: STORY_ID,
    type: 'needs_review',
    status: 'accepted',
    source: `${REVIEW_SURFACE_INTEGRITY_GATE_ID}:${violationId}`,
    summary: 'Reviewer confirmed the mid-review edit was limited to a comment.',
    reason: 'Owner inspected the diff between the start and close digests.',
    artifact: 'README.md'
  });
  await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--base', 'main', '--json']);
  const cleared = await readJson(path.join(root, '.vibepro', 'pr', STORY_ID, 'pr-prepare.json'));
  const clearedGate = cleared.pr_context.gate_dag.nodes.find((node) => node.id === REVIEW_SURFACE_INTEGRITY_GATE_ID);
  assert.equal(clearedGate.status, 'passed', 'an accepted decision must clear the gate through pr prepare');
  assert.equal(clearedGate.violation_count, 1, 'and the record must still be there');
  assert.equal(clearedGate.acknowledged_violation_count, 1);
  assert.ok(!cleared.gate_status.unresolved_gates.some((item) => item.id === REVIEW_SURFACE_INTEGRITY_GATE_ID));
});

test('RSV-5 the gate reports zero violations as passed without touching stale review handling', () => {
  const clean = summarizeReviewSurfaceViolations([], { decisionRecords: null });
  assert.equal(clean.total_count, 0);
  assert.equal(clean.unacknowledged_count, 0);

  const acknowledged = summarizeReviewSurfaceViolations([
    { violation_id: 'rsv-abc', stage: 'gate', role: 'gate_evidence', changed_fields: ['surface_digest'] }
  ], {
    decisionRecords: {
      decisions: [{
        decision_id: 'decision-1',
        status: 'accepted',
        source: `${REVIEW_SURFACE_INTEGRITY_GATE_ID}:rsv-abc`,
        reason: 'owner inspected the diff'
      }]
    }
  });
  assert.equal(acknowledged.total_count, 1, 'acknowledgement never deletes the record');
  assert.equal(acknowledged.unacknowledged_count, 0);
  assert.equal(acknowledged.entries[0].acknowledgement.decision_id, 'decision-1');

  const wrongTarget = summarizeReviewSurfaceViolations([
    { violation_id: 'rsv-abc', stage: 'gate', role: 'gate_evidence', changed_fields: ['surface_digest'] }
  ], {
    decisionRecords: {
      decisions: [
        { decision_id: 'd-open', status: 'open', source: `${REVIEW_SURFACE_INTEGRITY_GATE_ID}:rsv-abc` },
        { decision_id: 'd-other', status: 'accepted', source: `${REVIEW_SURFACE_INTEGRITY_GATE_ID}:rsv-other` },
        { decision_id: 'd-generic', status: 'accepted', source: 'gate:agent_review' }
      ]
    }
  });
  assert.equal(wrongTarget.unacknowledged_count, 1, 'only an accepted decision on this violation id acknowledges it');
});

test('RSV-6 stale and violation are typed apart: a later unrelated commit records no violation', async () => {
  const root = await setupRepo();
  await start(root);
  await close(root);
  await recordAgentReview(root, {
    storyId: STORY_ID,
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'clean review',
    reviewerSystem: 'claude_code',
    reviewerId: 'task-1',
    agentClosed: true,
    judgmentDeltas: ['initial: unverified -> final: verified because the fixture export matches the asserted test'],
    inspectionSummary: 'Read src/foo.js and test/foo.test.js in full.',
    inspectionEvidence: 'src/foo.js:1 defines the fixture export asserted by test/foo.test.js.',
    inspectionInputs: ['src/foo.js', 'test/foo.test.js']
  });

  // Staleness territory: the surface moves *after* the review closed.
  await writeFile(path.join(root, 'src', 'unrelated.js'), 'export const unrelated = "changed after review";\n');
  await git(root, ['add', 'src/unrelated.js']);
  await git(root, ['commit', '-m', 'unrelated later commit']);

  const summary = await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null });
  assert.equal(summary.total_count, 0, 'post-close changes are staleness, not a violation');

  const reviews = await summarizeAgentReviewsForPr(root, { storyId: STORY_ID, fileGroups: null });
  assert.equal(reviews.surface_violations.unacknowledged_count, 0);
});

test('RSV-6 a non-completed close is not a violation, and cannot smuggle a review result through', async () => {
  const root = await setupRepo();
  const started = await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "mutated mid-review";\n');
  await close(root, { closeReason: 'replaced' });

  const summary = await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null });
  assert.equal(summary.total_count, 0);

  // The escape hatch costs the review itself: a replaced lifecycle cannot carry a result.
  await assert.rejects(() => recordAgentReview(root, {
    storyId: STORY_ID,
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'attempt to attach a result to a replaced lifecycle',
    reviewerSystem: 'claude_code',
    reviewerId: 'task-1',
    agentClosed: true,
    judgmentDeltas: ['initial: unverified -> final: verified because the fixture export matches the asserted test'],
    inspectionSummary: 'Read src/foo.js and test/foo.test.js in full.',
    inspectionEvidence: 'src/foo.js:1 defines the fixture export asserted by test/foo.test.js.',
    inspectionInputs: ['src/foo.js', 'test/foo.test.js']
  }), /closed as replaced/);
  assert.ok(started.lifecycle.lifecycle_id);
});

test('RSV-7 legacy lifecycle entries and a missing ledger read as zero violations', async () => {
  const root = await setupRepo();
  const stageDir = path.join(root, '.vibepro', 'reviews', STORY_ID, 'gate');
  await mkdir(stageDir, { recursive: true });
  await writeFile(path.join(stageDir, 'lifecycle.json'), JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    stage: 'gate',
    entries: [{
      lifecycle_id: 'legacy-1',
      story_id: STORY_ID,
      stage: 'gate',
      role: 'gate_evidence',
      status: 'closed',
      head_sha: 'legacy-head',
      started_at: '2026-01-01T00:00:00.000Z',
      closed_at: '2026-01-01T01:00:00.000Z',
      close_reason: 'completed'
    }]
  }));

  const summary = await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null });
  assert.equal(summary.total_count, 0);
  assert.equal(summary.unacknowledged_count, 0);

  const reviews = await summarizeAgentReviewsForPr(root, { storyId: STORY_ID, fileGroups: null });
  assert.equal(reviews.surface_violations.unacknowledged_count, 0);
});

test('RSV-6 failure mode timeout: a timed-out review close records no violation and still terminalizes', async () => {
  const root = await setupRepo();
  const started = await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "mutated while the reviewer hung";\n');
  const closed = await close(root, { closeReason: 'timeout' });

  assert.equal(closed.lifecycle.close_reason, 'timeout');
  assert.equal(closed.surface_violation, null);
  const summary = await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null });
  assert.equal(summary.total_count, 0, 'a timeout is a discarded attempt, not a contaminated verdict');

  const lifecycle = await readJson(lifecyclePath(root));
  const entry = lifecycle.entries.find((item) => item.lifecycle_id === started.lifecycle.lifecycle_id);
  assert.equal(entry.status, 'closed');
  assert.ok(entry.closed_surface_digest, 'the close-time surface is still recorded for a timeout');
});

test('RSV-7 failure mode parse_failure: a malformed ledger is rejected and fails closed, never read as empty', async () => {
  const root = await setupRepo();
  const storyReviewDir = path.join(root, '.vibepro', 'reviews', STORY_ID);
  await mkdir(storyReviewDir, { recursive: true });

  // Truncating the ledger is the obvious way to erase append-only records.
  // Malformed input must be rejected, not silently treated as zero violations.
  await writeFile(violationsPath(root), '{ this is not json');
  await assert.rejects(() => readReviewSurfaceViolations(storyReviewDir, STORY_ID), (error) => {
    assert.equal(error.code, REVIEW_SURFACE_LEDGER_UNREADABLE);
    assert.match(error.message, /malformed JSON/);
    return true;
  });

  // Structurally invalid input is rejected on the same terms.
  await writeFile(violationsPath(root), JSON.stringify({ schema_version: '0.1.0', entries: 'gone' }));
  await assert.rejects(() => readReviewSurfaceViolations(storyReviewDir, STORY_ID), (error) => {
    assert.equal(error.code, REVIEW_SURFACE_LEDGER_UNREADABLE);
    return true;
  });

  // pr prepare must not crash, but the gate must block.
  const summary = await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null });
  assert.equal(summary.readable, false);
  assert.equal(summary.unacknowledged_count, 1, 'an unreadable ledger fails closed');
  assert.equal(summary.unacknowledged[0].kind, 'review_surface_ledger_unreadable');
  const reviews = await summarizeAgentReviewsForPr(root, { storyId: STORY_ID, fileGroups: null });
  assert.equal(reviews.surface_violations.readable, false);

  // Appending over a corrupt ledger throws rather than overwriting it.
  await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "mutated mid-review";\n');
  await assert.rejects(() => close(root), (error) => {
    assert.equal(error.code, REVIEW_SURFACE_LEDGER_UNREADABLE);
    return true;
  });
});

test('RSV-7 evidence_lifecycle_regression: recorded review results and lifecycle statuses keep their prior shape', async () => {
  const root = await setupRepo();
  const started = await start(root);
  const closed = await close(root);
  const recorded = await recordAgentReview(root, {
    storyId: STORY_ID,
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'clean review over the finalized tree',
    reviewerSystem: 'claude_code',
    reviewerId: 'task-1',
    agentThreadId: 'thread-task-1',
    agentSessionId: 'session-task-1',
    agentTranscript: 'transcript://task-1',
    agentCloseEvidence: 'subagent shut down',
    agentClosed: true,
    judgmentDeltas: ['initial: unverified -> final: verified because the fixture export matches the asserted test'],
    inspectionSummary: 'Read src/foo.js and test/foo.test.js in full.',
    inspectionEvidence: 'src/foo.js:1 defines the fixture export asserted by test/foo.test.js.',
    inspectionInputs: ['src/foo.js', 'test/foo.test.js']
  });

  assert.equal(started.lifecycle.status, 'running');
  assert.equal(closed.lifecycle.status, 'closed');
  assert.equal(closed.lifecycle.close_reason, 'completed');
  assert.equal(recorded.review.status, 'pass');
  assert.equal(recorded.review.agent_provenance.lifecycle.agent_closed, true);

  // The recorded result keeps its prior shape: the ledger writes to its own file
  // and adds nothing to, and removes nothing from, the review result artifact.
  assert.ok(recorded.review.git_context.head_sha);
  assert.equal(recorded.review.surface_violation_id, undefined);
  assert.equal(recorded.review.evidence_class, undefined);

  const status = await getAgentReviewStatus(root, { storyId: STORY_ID, stage: 'gate' });
  const stage = status.stages.find((item) => item.stage === 'gate');
  const role = stage.roles.find((item) => item.role === 'gate_evidence');
  assert.equal(stage.lifecycle.running_count, 0, 'the closed lifecycle is no longer counted as running');
  assert.equal(stage.stale_count, 0, 'a clean round produces no staleness');
  // This fixture supplies no separate-session provenance, so the pre-existing
  // provenance rule still downgrades the role. That downgrade is the unchanged
  // behaviour under test: the ledger must not alter this path in either direction.
  assert.equal(role.effective_status, 'unverified_agent');
  assert.equal(role.status, 'pass');
});

test('RSV-8 replacing the ledger with a well-formed empty one does not clear the violation', async () => {
  const root = await setupRepo();
  await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "mutated mid-review";\n');
  const closed = await close(root);
  const violationId = closed.surface_violation.violation_id;

  // The erase attempt that corruption-rejection alone would not catch: valid
  // JSON, valid shape, zero entries.
  await writeFile(violationsPath(root), JSON.stringify({ schema_version: '0.1.0', entries: [] }));

  const summary = await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null });
  assert.equal(summary.unacknowledged_count, 1, 'the erased entry must still be reported');
  const [reported] = summary.unacknowledged;
  assert.equal(reported.violation_id, `missing:${violationId}`);
  assert.equal(reported.erased_violation_id, violationId);
  assert.equal(reported.kind, 'review_surface_violation_entry_missing');
  assert.match(reported.detail, /no such entry exists in the ledger/);

  const reviews = await summarizeAgentReviewsForPr(root, { storyId: STORY_ID, fileGroups: null });
  assert.equal(reviews.surface_violations.unacknowledged_count, 1);
});

test('RSV-8 reconciliation reports each orphaned pointer once and stays quiet when the ledger matches', () => {
  const entries = [{ violation_id: 'rsv-1' }];
  const lifecycles = [
    { lifecycle_id: 'lc-1', stage: 'gate', role: 'gate_evidence', surface_violation_id: 'rsv-1' },
    { lifecycle_id: 'lc-2', stage: 'gate', role: 'release_risk', surface_violation_id: 'rsv-2' },
    { lifecycle_id: 'lc-3', stage: 'gate', role: 'release_risk', surface_violation_id: 'rsv-2' },
    { lifecycle_id: 'lc-4', stage: 'gate', role: 'runtime_contract' }
  ];
  const orphans = reconcileReviewSurfaceViolationPointers(entries, lifecycles);
  assert.deepEqual(orphans.map((item) => item.violation_id), ['missing:rsv-2']);
  assert.deepEqual(orphans.map((item) => item.erased_violation_id), ['rsv-2']);
  assert.deepEqual(reconcileReviewSurfaceViolationPointers(entries, [lifecycles[0]]), []);
  assert.deepEqual(reconcileReviewSurfaceViolationPointers([], []), []);
});

test('RSV-8 acknowledging a violation does not also acknowledge erasing it', async () => {
  const root = await setupRepo();
  await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "mutated mid-review";\n');
  const closed = await close(root);
  const violationId = closed.surface_violation.violation_id;

  await recordDecision(root, {
    storyId: STORY_ID,
    type: 'needs_review',
    status: 'accepted',
    source: `${REVIEW_SURFACE_INTEGRITY_GATE_ID}:${violationId}`,
    summary: 'Reviewer confirmed the mid-review edit was limited to a comment.',
    reason: 'Owner inspected the diff between the start and close digests.',
    artifact: 'README.md'
  });
  const decisionRecords = await readDecisionRecordsIfExists(root, STORY_ID);
  assert.equal((await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords })).unacknowledged_count, 0);

  // Now erase the acknowledged entry. The existing acknowledgement must not
  // carry over to the erasure, or deleting an acknowledged record would be free.
  await writeFile(violationsPath(root), JSON.stringify({ schema_version: '0.1.0', entries: [] }));
  const afterErase = await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords });
  assert.equal(afterErase.unacknowledged_count, 1, 'erasing an acknowledged violation must block again');
  const [orphan] = afterErase.unacknowledged;
  assert.equal(orphan.violation_id, `missing:${violationId}`);
  assert.equal(orphan.erased_violation_id, violationId);
  assert.equal(orphan.kind, 'review_surface_violation_entry_missing');
});

test('RSV-8 unreadable lifecycle pointers block instead of reading as "no pointers"', async () => {
  const root = await setupRepo();
  await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "mutated mid-review";\n');
  await close(root);

  // The two-file version of the erase: empty the ledger, then break the pointers
  // that would have caught it. Without the pointers the cross-check cannot run,
  // so it must block rather than report a clean result.
  await writeFile(violationsPath(root), JSON.stringify({ schema_version: '0.1.0', entries: [] }));
  await writeFile(lifecyclePath(root), '{ not json');

  const summary = await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null });
  assert.equal(summary.pointers_readable, false, 'the cross-check must not fail silently');
  assert.equal(summary.unacknowledged_count, 1, 'an unusable cross-check blocks');
  assert.equal(summary.unacknowledged[0].kind, 'review_surface_lifecycle_pointers_unreadable');

  // The wider pr prepare path also refuses to proceed over a malformed
  // lifecycle, so the two failure directions agree rather than one covering for
  // the other.
  await assert.rejects(() => summarizeAgentReviewsForPr(root, { storyId: STORY_ID, fileGroups: null }), SyntaxError);

  // Valid JSON of the wrong shape is the same unusable state, and the ledger
  // reader rejects the identical shape — the two must not disagree. Here nothing
  // else throws, so this branch is the only thing standing between an empty
  // ledger and a clean gate.
  await writeFile(lifecyclePath(root), JSON.stringify({ schema_version: '0.1.0', entries: {} }));
  const wrongType = await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null });
  assert.equal(wrongType.pointers_readable, false);
  assert.equal(wrongType.unacknowledged_count, 1);
  assert.equal(wrongType.unacknowledged[0].kind, 'review_surface_lifecycle_pointers_unreadable');
});

test('RSV-8 the gate names each violation kind in its own words', () => {
  const gate = buildReviewSurfaceIntegrityGate({
    agentReviews: {
      story_id: STORY_ID,
      surface_violations: summarizeReviewSurfaceViolations([
        { violation_id: 'rsv-1', kind: 'review_surface_mutated_during_review', stage: 'gate', role: 'gate_evidence', changed_fields: ['surface_digest'] },
        { violation_id: 'missing:rsv-2', erased_violation_id: 'rsv-2', kind: 'review_surface_violation_entry_missing', stage: 'gate', role: 'release_risk', changed_fields: [] }
      ], { decisionRecords: null })
    }
  });
  assert.equal(gate.status, 'failed');
  const actions = gate.required_actions.join('\n');
  assert.match(actions, /had their review surface change mid-review/);
  assert.match(actions, /missing from the ledger while the lifecycle still points at them/);
  assert.match(actions, /gate:review_surface_integrity:missing:rsv-2/);
});

test('RSV-8 the gate does not claim a clean ledger it never read', () => {
  const gate = buildReviewSurfaceIntegrityGate({ agentReviews: null });
  assert.equal(gate.ledger_read, false);
  assert.equal(gate.required, true);
  assert.ok(isUnresolvedGateStatus(gate.status), 'an unread ledger must block, not read as a pass');
  assert.match(gate.reason, /not a clean result/);
});

test('RSV-9 concurrent appends of distinct violations both survive', async () => {
  const root = await setupRepo();
  const storyReviewDir = path.join(root, '.vibepro', 'reviews', STORY_ID);
  const base = {
    kind: 'review_surface_mutated_during_review',
    evidence_class: 'violation',
    changed_fields: ['surface_digest'],
    stage: 'gate',
    started: { head_sha: 'aaa', surface_digest: 'd1' },
    closed: { head_sha: 'aaa', surface_digest: 'd2' }
  };
  const results = await Promise.all([
    appendReviewSurfaceViolation(storyReviewDir, STORY_ID, { ...base, role: 'gate_evidence', lifecycle_id: 'lc-1' }),
    appendReviewSurfaceViolation(storyReviewDir, STORY_ID, { ...base, role: 'release_risk', lifecycle_id: 'lc-2' })
  ]);
  assert.deepEqual(results.map((item) => item.appended), [true, true]);

  const ledger = await readReviewSurfaceViolations(storyReviewDir, STORY_ID);
  assert.equal(ledger.entries.length, 2, 'a racing append must not drop the other entry');
  assert.deepEqual(
    ledger.entries.map((entry) => entry.lifecycle_id).sort(),
    ['lc-1', 'lc-2']
  );
});

test('RSV-9 an unrecognized close reason is rejected instead of coerced to completed', async () => {
  const root = await setupRepo();
  await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "mutated mid-review";\n');

  await assert.rejects(() => close(root, { closeReason: 'timed_out' }), /--close-reason must be one of/);
  const summary = await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null });
  assert.equal(summary.total_count, 0, 'a rejected close must not mint a violation');

  // The correctly spelled reason still records nothing, per RSV-6.
  await close(root, { closeReason: 'timeout' });
  assert.equal((await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null })).total_count, 0);
});

test('RSV-9 an unreadable ledger is acknowledgeable rather than a dead end', async () => {
  const root = await setupRepo();
  const storyReviewDir = path.join(root, '.vibepro', 'reviews', STORY_ID);
  await mkdir(storyReviewDir, { recursive: true });
  await writeFile(violationsPath(root), '{ this is not json');

  const blocked = await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null });
  assert.equal(blocked.readable, false);
  assert.equal(blocked.unacknowledged_count, 1);
  assert.equal(blocked.unacknowledged[0].violation_id, 'ledger_unreadable');

  await recordDecision(root, {
    storyId: STORY_ID,
    type: 'needs_review',
    status: 'accepted',
    source: `${REVIEW_SURFACE_INTEGRITY_GATE_ID}:ledger_unreadable`,
    summary: 'Ledger lost to a disk error; the affected review was re-run from scratch.',
    reason: 'Owner confirmed no violation had been recorded before the corruption.',
    artifact: 'README.md'
  });

  const acknowledged = await readReviewSurfaceViolationSummary(root, STORY_ID, {
    decisionRecords: await readDecisionRecordsIfExists(root, STORY_ID)
  });
  assert.equal(acknowledged.readable, false, 'the unreadable state is still reported');
  assert.equal(acknowledged.unacknowledged_count, 0, 'but it is no longer blocking');
});

test('RSV-9 review violations CLI reports the unreadable reason and exits non-zero', async () => {
  const root = await setupRepo();
  const storyReviewDir = path.join(root, '.vibepro', 'reviews', STORY_ID);
  await mkdir(storyReviewDir, { recursive: true });
  await writeFile(violationsPath(root), '{ this is not json');

  let out = '';
  const stdout = { write: (chunk) => { out += chunk; } };
  const blocked = await runCli(['review', 'violations', root, '--id', STORY_ID], { stdout });
  assert.equal(blocked.exitCode, 2);
  assert.match(out, /ledger_readable: no/);
  assert.match(out, /Ledger Unreadable/);
  assert.match(out, /malformed JSON/);
  assert.match(out, /ledger_unreadable/);

  out = '';
  await writeFile(violationsPath(root), JSON.stringify({ schema_version: '0.1.0', entries: [] }));
  const clean = await runCli(['review', 'violations', root, '--id', STORY_ID], { stdout });
  assert.equal(clean.exitCode, 0);
  assert.match(out, /ledger_readable: yes/);
  assert.match(out, /total: 0/);
});

test('RSV-2 the default close path, without --cancellation-confirmed, still records the violation', async () => {
  const root = await setupRepo();
  const started = await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "committed mid-review";\n');
  await git(root, ['add', 'src/foo.js']);
  await git(root, ['commit', '-m', 'mid-review commit']);

  // The CLI never passes --cancellation-confirmed, so this is the common path.
  // The lifecycle terminalizes as orphaned_agent and keeps closed_at unset, which
  // means `review record --agent-closed` can still complete it — so exempting
  // this path from detection would have left the default flow unwatched.
  const closed = await close(root, { cancellationConfirmed: false });
  assert.equal(closed.lifecycle.terminal_status, 'orphaned_agent');
  assert.ok(closed.surface_violation, 'the default close path must record the violation');
  assert.ok(closed.surface_violation.changed_fields.includes('head_sha'));
  assert.equal((await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null })).total_count, 1);

  const lifecycle = await readJson(lifecyclePath(root));
  const entry = lifecycle.entries.find((item) => item.lifecycle_id === started.lifecycle.lifecycle_id);
  assert.equal(entry.surface_detection, 'evaluated');
  assert.equal(entry.surface_violation_id, closed.surface_violation.violation_id);
});

test('RSV-1 review record closing a lifecycle itself also records the close-time surface', async () => {
  const root = await setupRepo();
  const started = await start(root);
  await writeFile(path.join(root, 'src', 'foo.js'), 'export const fixture = "committed mid-review";\n');
  await git(root, ['add', 'src/foo.js']);
  await git(root, ['commit', '-m', 'mid-review commit']);

  // Skipping `review close` entirely: review record --agent-closed completes the
  // lifecycle by itself. Detection must not be opt-out by taking this route.
  await recordAgentReview(root, {
    storyId: STORY_ID,
    stage: 'gate',
    role: 'gate_evidence',
    status: 'pass',
    summary: 'review recorded without an explicit close',
    reviewerSystem: 'claude_code',
    reviewerId: 'task-1',
    agentThreadId: 'thread-task-1',
    agentSessionId: 'session-task-1',
    agentTranscript: 'transcript://task-1',
    agentCloseEvidence: 'subagent shut down',
    agentClosed: true,
    judgmentDeltas: ['initial: unverified -> final: verified because the fixture export matches the asserted test'],
    inspectionSummary: 'Read src/foo.js and test/foo.test.js in full.',
    inspectionEvidence: 'src/foo.js:1 defines the fixture export asserted by test/foo.test.js.',
    inspectionInputs: ['src/foo.js', 'test/foo.test.js']
  });

  const lifecycle = await readJson(lifecyclePath(root));
  const entry = lifecycle.entries.find((item) => item.lifecycle_id === started.lifecycle.lifecycle_id);
  assert.equal(entry.close_reason, 'completed');
  assert.ok(entry.closed_head_sha, 'the record-side close records the close-time head');
  assert.ok(entry.closed_surface_digest, 'the record-side close records the close-time digest');
  assert.equal(entry.surface_detection, 'evaluated');

  const summary = await readReviewSurfaceViolationSummary(root, STORY_ID, { decisionRecords: null });
  assert.equal(summary.total_count, 1, 'skipping review close must not skip detection');
  assert.equal(summary.entries[0].detected_by, 'review record');
  assert.equal(entry.surface_violation_id, summary.entries[0].violation_id);
});

test('RSV-7 detectReviewSurfaceMutation ignores entries with no recorded start surface', () => {
  assert.equal(detectReviewSurfaceMutation(null, { closeReason: 'completed' }), null);
  assert.equal(detectReviewSurfaceMutation({}, {
    closeHeadSha: 'b', closeSurfaceDigest: 'd2', closeReason: 'completed'
  }), null);
  assert.equal(detectReviewSurfaceMutation({ head_sha: 'a', surface_digest: 'd1' }, {
    closeHeadSha: 'b', closeSurfaceDigest: 'd2', closeReason: 'timeout'
  }), null);
  const mutation = detectReviewSurfaceMutation({ head_sha: 'a', surface_digest: 'd1' }, {
    closeHeadSha: 'b', closeSurfaceDigest: 'd2', closeReason: 'completed'
  });
  assert.deepEqual(mutation.changed_fields, ['head_sha', 'surface_digest']);
});
