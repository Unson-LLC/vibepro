import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBrainbaseDevelopmentTransport,
  createDevelopmentProgressEnvelope,
  createDevelopmentProgressSender,
  verifyDevelopmentProgressReadback,
} from '../src/brainbase-development-progress.js';

function envelope(overrides = {}) {
  return createDevelopmentProgressEnvelope({
    event_id: 'progress-event-1',
    source: 'per_test',
    sequence: 7,
    observed_at: '2026-10-09T00:00:00.000Z',
    canonical_task_id: 'canonical-task-1',
    task_ref: {
      repository: 'unson/organization',
      story_id: 'story-development-sync',
      task_id: 'local-task-projection',
    },
    plan_version: 'plan-2',
    execution: {
      dispatch_id: 'dispatch-2',
      attempt: 2,
      owner: 'codex-child',
      session_ref: 'session-2',
      status: 'running',
      worktree: '/worktree',
      base_sha: 'base-1',
      head_sha: 'head-1',
    },
    evidence: { artifacts: [] },
    ...overrides,
  });
}

function confirmedReadback(value) {
  return {
    schema_version: 'development-progress.v1',
    canonical_task_id: value.canonical_task_id,
    task_ref: value.task_ref,
    plan_version: value.plan_version,
    session_ref: value.execution.session_ref,
    projection_status: 'confirmed',
    latest_sequence: value.sequence,
    latest_event_id: value.event_id,
    execution: value.execution,
  };
}

test('canonical and local task ids are sent separately and readback is exact', async () => {
  const value = envelope();
  const calls = [];
  const transport = createBrainbaseDevelopmentTransport({
    BRAINBASE_DEVELOPMENT_API_URL: 'https://brainbase.example',
    BRAINBASE_DEVELOPMENT_API_TOKEN: 'fixture-token',
  }, {
    fetch: async (url, options) => {
      const parsed = new URL(url);
      calls.push({ parsed, options });
      if (options.method === 'POST') return Response.json({ ...confirmedReadback(value), accepted: true }, { status: 202 });
      return Response.json(confirmedReadback(value), { status: 200 });
    },
  });
  const sender = createDevelopmentProgressSender({ transport });
  await sender.send(value);
  const readback = await sender.readback(value);
  assert.equal(calls[0].parsed.pathname, '/api/tasks/canonical-task-1/development-progress');
  assert.equal(calls[1].parsed.pathname, '/api/tasks/canonical-task-1/development-progress');
  assert.equal(calls[1].parsed.searchParams.get('task_id'), 'local-task-projection');
  assert.equal(calls[1].parsed.searchParams.get('session_ref'), 'session-2');
  assert.equal(readback.latest_event_id, value.event_id);
  assert.equal(JSON.parse(calls[0].options.body).task_ref.task_id, 'local-task-projection');
});

test('readback mismatch is a failed confirmation', () => {
  const value = envelope();
  assert.throws(() => verifyDevelopmentProgressReadback({
    ...confirmedReadback(value),
    latest_sequence: value.sequence - 1,
  }, value), (error) => error.code === 'BRAINBASE_DEVELOPMENT_READBACK_MISMATCH'
    && error.field === 'latest_sequence');
});

test('readback must match every execution identity field', () => {
  const value = envelope();
  for (const field of ['dispatch_id', 'attempt', 'owner', 'session_ref', 'status', 'worktree', 'base_sha', 'head_sha']) {
    const mismatched = structuredClone(confirmedReadback(value));
    mismatched.execution[field] = field === 'attempt' ? value.execution.attempt + 1 : `${value.execution[field] ?? 'missing'}-other`;
    assert.throws(
      () => verifyDevelopmentProgressReadback(mismatched, value),
      (error) => error.code === 'BRAINBASE_DEVELOPMENT_READBACK_MISMATCH'
        && error.field === `execution.${field}`,
      `expected execution.${field} mismatch to fail closed`,
    );
  }
});

test('sender validates readback from custom transports too', async () => {
  const value = envelope();
  const sender = createDevelopmentProgressSender({
    transport: {
      send: async () => ({ accepted: true }),
      readback: async () => ({ ...confirmedReadback(value), latest_event_id: 'other-event' }),
    },
  });
  await assert.rejects(sender.readback(value), (error) => error.code === 'BRAINBASE_DEVELOPMENT_READBACK_MISMATCH');
});
