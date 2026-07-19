import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createHumanDecision, resolveHumanDecision } from '../src/human-decision-checkpoint.js';

const state = {
  story_id: 'story-human-checkpoint',
  run_id: 'run-20260719T010203Z-01020304',
  current_head_sha: 'abc123',
  status: 'waiting_for_human'
};
const input = {
  type: 'scope_split',
  question: 'Split the external side effect?',
  material_reason: 'The answer changes authorization and rollback scope.',
  impact_scope: ['spec', 'execution'],
  source_refs: ['docs/specs/example.md'],
  brainbase_handoff_ref: 'brainbase://handoffs/42'
};

test('HDC-S-1 HDC-S-2 duplicate material questions reuse one typed pending artifact', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-decision-'));
  const first = await createHumanDecision(repo, state, input, { now: () => new Date('2026-07-19T01:02:03Z') });
  const duplicate = await createHumanDecision(repo, state, { ...input, question: 'Different wording?' });
  assert.equal(duplicate.decision_id, first.decision_id);
  assert.equal(duplicate.brainbase_handoff_ref, 'brainbase://handoffs/42');
  const index = JSON.parse(await readFile(path.join(repo, '.vibepro/executions', state.story_id, 'runs', state.run_id, 'decisions/index.json')));
  assert.equal(index.decisions.length, 1);
});

test('HDC-S-2 every supported material decision type persists and resolves through one contract', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-decision-'));
  for (const type of ['clarification', 'scope_split', 'waiver_request', 'external_side_effect', 'security_boundary']) {
    const decision = await createHumanDecision(repo, state, {
      ...input,
      type,
      material_reason: `The ${type} answer changes the execution boundary.`
    });
    const resolved = await resolveHumanDecision(repo, state, {
      decisionId: decision.decision_id,
      answer: `approved ${type}`
    });
    assert.equal(resolved.type, type);
    assert.equal(resolved.status, 'resolved');
  }
});

test('HDC-S-2 duplicate creation repairs a missing decision index entry', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-decision-'));
  const decision = await createHumanDecision(repo, state, input);
  const indexFile = path.join(repo, '.vibepro/executions', state.story_id, 'runs', state.run_id, 'decisions/index.json');
  await writeFile(indexFile, `${JSON.stringify({ schema_version: '0.1.0', decisions: [] }, null, 2)}\n`);

  const duplicate = await createHumanDecision(repo, state, input);
  const repaired = JSON.parse(await readFile(indexFile, 'utf8'));

  assert.equal(duplicate.decision_id, decision.decision_id);
  assert.deepEqual(repaired.decisions.map((item) => item.decision_id), [decision.decision_id]);
});

test('HDC-S-1 HDC-S-6 duplicate creation preserves an immutable resolved decision', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-decision-'));
  const decision = await createHumanDecision(repo, state, input);
  const resolved = await resolveHumanDecision(repo, state, {
    decisionId: decision.decision_id,
    answer: 'split',
    answeredBy: 'ksato',
    reflectedIn: ['docs/specs/example.md']
  }, { now: () => new Date('2026-07-19T02:03:04Z') });

  const duplicate = await createHumanDecision(repo, state, {
    ...input,
    question: 'Should this material boundary still be split?'
  });
  const persisted = JSON.parse(await readFile(path.join(
    repo,
    '.vibepro/executions',
    state.story_id,
    'runs',
    state.run_id,
    'decisions',
    `${decision.decision_id}.json`
  ), 'utf8'));

  assert.deepEqual(duplicate, resolved);
  assert.deepEqual(persisted, resolved);
});

test('HDC-S-1 HDC-S-6 duplicate material reason on a new HEAD creates a new decision', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-decision-'));
  const decision = await createHumanDecision(repo, state, input);
  const resolved = await resolveHumanDecision(repo, state, {
    decisionId: decision.decision_id,
    answer: 'split'
  });
  const reboundState = { ...state, current_head_sha: 'def456' };

  const rebound = await createHumanDecision(repo, reboundState, input);
  const reboundResolved = await resolveHumanDecision(repo, reboundState, {
    decisionId: rebound.decision_id,
    answer: 'split on the rebound HEAD'
  });

  assert.notEqual(rebound.decision_id, resolved.decision_id);
  assert.equal(rebound.head_sha, reboundState.current_head_sha);
  assert.equal(reboundResolved.status, 'resolved');
  const original = JSON.parse(await readFile(path.join(
    repo,
    '.vibepro/executions',
    state.story_id,
    'runs',
    state.run_id,
    'decisions',
    `${decision.decision_id}.json`
  ), 'utf8'));
  assert.deepEqual(original, resolved);
});

test('HDC-S-6 resolved replay repairs the decision index before Run resume continues', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-decision-'));
  const decision = await createHumanDecision(repo, state, input);
  const resolved = await resolveHumanDecision(repo, state, {
    decisionId: decision.decision_id,
    answer: 'split'
  });
  const indexFile = path.join(repo, '.vibepro/executions', state.story_id, 'runs', state.run_id, 'decisions/index.json');
  await writeFile(indexFile, `${JSON.stringify({ schema_version: '0.1.0', decisions: [] }, null, 2)}\n`);

  const replayed = await resolveHumanDecision(repo, {
    ...state,
    pending_decision: { decision_id: decision.decision_id }
  }, {
    decisionId: decision.decision_id,
    answer: 'split'
  }, { allowResolvedReplay: true });
  const repaired = JSON.parse(await readFile(indexFile, 'utf8'));

  assert.deepEqual(replayed, resolved);
  assert.deepEqual(repaired.decisions, [{
    decision_id: decision.decision_id,
    type: decision.type,
    status: 'resolved',
    head_sha: state.current_head_sha,
    reflected_in: []
  }]);
});

test('HDC-S-2 malformed decision JSON fails with a typed error and remains inspectable', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-decision-'));
  const decision = await createHumanDecision(repo, state, input);
  const file = path.join(repo, '.vibepro/executions', state.story_id, 'runs', state.run_id, 'decisions', `${decision.decision_id}.json`);
  await writeFile(file, '{ malformed', 'utf8');

  await assert.rejects(createHumanDecision(repo, state, input), { code: 'invalid_decision_artifact' });
  await assert.rejects(resolveHumanDecision(repo, state, {
    decisionId: decision.decision_id,
    answer: 'split'
  }), { code: 'invalid_decision_artifact' });
  assert.equal(await readFile(file, 'utf8'), '{ malformed');
});

test('HDC-S-4 critical gate waiver is rejected without resolving the artifact', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-decision-'));
  const decision = await createHumanDecision(repo, state, { ...input, type: 'waiver_request', critical_gate: true });
  await assert.rejects(resolveHumanDecision(repo, state, {
    decisionId: decision.decision_id,
    answer: 'waive'
  }), { code: 'critical_gate_waiver_forbidden' });
});

test('HDC-S-5 Brainbase handoff reference is preserved as an opaque value', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-decision-'));
  const decision = await createHumanDecision(repo, state, input);
  assert.equal(decision.brainbase_handoff_ref, input.brainbase_handoff_ref);

  const persisted = JSON.parse(await readFile(path.join(
    repo,
    '.vibepro/executions',
    state.story_id,
    'runs',
    state.run_id,
    'decisions',
    `${decision.decision_id}.json`
  )));
  assert.equal(persisted.brainbase_handoff_ref, input.brainbase_handoff_ref);
});

test('HDC-S-6 HDC-S-7 answer binds to Run and HEAD and records reflection targets', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-decision-'));
  const decision = await createHumanDecision(repo, state, input);
  await assert.rejects(resolveHumanDecision(repo, { ...state, current_head_sha: 'new-head' }, {
    decisionId: decision.decision_id,
    answer: 'split'
  }), { code: 'stale_decision_head' });
  const resolved = await resolveHumanDecision(repo, state, {
    decisionId: decision.decision_id,
    answer: 'split',
    answeredBy: 'ksato',
    reflectedIn: ['docs/specs/example.md']
  });
  assert.equal(resolved.status, 'resolved');
  assert.deepEqual(resolved.reflected_in, ['docs/specs/example.md']);
  await assert.rejects(resolveHumanDecision(repo, state, {
    decisionId: decision.decision_id,
    answer: 'split again'
  }), { code: 'decision_already_resolved' });
});

test('HDC-S-7 invalid type and cancelled Run are rejected', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-decision-'));
  await assert.rejects(createHumanDecision(repo, state, { ...input, type: 'merge_approval' }), { code: 'invalid_decision_type' });
  const decision = await createHumanDecision(repo, state, input);
  await assert.rejects(resolveHumanDecision(repo, { ...state, status: 'cancelled' }, {
    decisionId: decision.decision_id,
    answer: 'split'
  }), { code: 'cancelled_run' });
  await assert.rejects(resolveHumanDecision(repo, state, {
    decisionId: '../decision-escape',
    answer: 'split'
  }), { code: 'decision_answer_required' });
});

test('HDC-S-2 HDC-S-7 persisted unknown type is rejected without mutation', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-human-decision-'));
  const decision = await createHumanDecision(repo, state, input);
  const file = path.join(repo, '.vibepro/executions', state.story_id, 'runs', state.run_id, 'decisions', `${decision.decision_id}.json`);
  const tampered = { ...decision, type: 'merge_approval' };
  await writeFile(file, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');

  await assert.rejects(resolveHumanDecision(repo, state, {
    decisionId: decision.decision_id,
    answer: 'approve merge'
  }), { code: 'invalid_decision_type' });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), tampered);
});
