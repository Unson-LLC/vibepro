import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LINEAGE_SCHEMA_VERSION,
  RunLineageError,
  appendProviderObservation,
  assertProviderIdentityUniqueness,
  createRunLineageEnvelope,
  resolveRunAttribution,
  validateRunLineageEnvelope
} from '../src/run-lineage.js';

const authority = {
  story_id: 'story-alpha',
  run_id: 'run-alpha',
  worktree_root: '/work/alpha',
  branch: 'codex/story-alpha',
  head_sha: 'a'.repeat(40)
};

function envelope(overrides = {}) {
  return createRunLineageEnvelope({ ...authority, dispatch_id: 'dispatch-1', ...overrides });
}

function errorCode(code) {
  return (error) => error instanceof RunLineageError && error.code === code;
}

test('creates and validates a version 0.1.0 envelope from Run authority', () => {
  const value = envelope({ provider_session_id: 'session-observation' });
  assert.equal(LINEAGE_SCHEMA_VERSION, '0.1.0');
  assert.equal(value.schema_version, '0.1.0');
  assert.equal(value.story_id, authority.story_id);
  assert.equal(value.run_id, authority.run_id);
  assert.equal(value.provider_session_id, 'session-observation');
  assert.deepEqual(validateRunLineageEnvelope(value, authority), value);
});

test('rejects malformed and mismatched bindings with typed errors', () => {
  assert.throws(() => validateRunLineageEnvelope({ story_id: 'story-alpha' }), errorCode('invalid_run_lineage'));
  assert.throws(() => validateRunLineageEnvelope(envelope({ story_id: 'story-other' }), authority), errorCode('run_lineage_mismatch'));
  assert.throws(() => validateRunLineageEnvelope(envelope({ head_sha: 'b'.repeat(40) }), authority), errorCode('stale_run_lineage_head'));
});

test('provider observations merge append-only, deduplicate, and reject rebind/conflict', () => {
  const initial = envelope();
  const observed = appendProviderObservation(initial, {
    provider: 'codex', provider_run_id: 'provider-run-1', provider_session_id: 'provider-session-1', thread_id: 'thread-1'
  });
  assert.equal(initial.provider_observations, undefined);
  assert.equal(observed.provider_observations.length, 1);
  assert.equal(observed.provider_run_id, 'provider-run-1');
  const duplicate = appendProviderObservation(observed, {
    provider: 'codex', provider_run_id: 'provider-run-1', provider_session_id: 'provider-session-1', thread_id: 'thread-1'
  });
  assert.equal(duplicate.provider_observations.length, 1);
  assert.throws(() => appendProviderObservation(observed, {
    provider: 'other', provider_run_id: 'provider-run-1', provider_session_id: 'other-session'
  }), errorCode('provider_observation_conflict'));
  assert.throws(() => appendProviderObservation(observed, {
    provider: 'codex', provider_run_id: 'provider-run-2', run_id: 'run-other', story_id: 'story-other'
  }), errorCode('provider_observation_conflict'));
});

test('provider identities cannot be rebound across persisted dispatch or Run envelopes', () => {
  const first = appendProviderObservation(envelope({ dispatch_id: 'dispatch-a' }), {
    provider: 'codex', provider_run_id: 'provider-run-1', provider_session_id: 'session-1', thread_id: 'thread-1'
  });
  const second = appendProviderObservation(envelope({ run_id: 'run-beta', dispatch_id: 'dispatch-b' }), {
    provider: 'codex', provider_run_id: 'provider-run-1', provider_session_id: 'session-2'
  });

  assert.throws(() => assertProviderIdentityUniqueness([
    { adapter_id: 'codex', lineage: first },
    { adapter_id: 'codex', lineage: second }
  ]), errorCode('provider_identity_conflict'));
  assert.equal(assertProviderIdentityUniqueness([
    { adapter_id: 'codex', lineage: first },
    { adapter_id: 'codex', lineage: { ...first } }
  ]), true);
});

test('resolves five attribution buckets with bounded provenance and reconciled totals', () => {
  const events = [
    { id: 'a', run_id: 'run-alpha', story_id: 'story-alpha', tokens: 10, source_artifact: '.vibepro/run/a.json' },
    { id: 'shared', run_ids: ['run-alpha', 'run-beta'], tokens: 20 },
    { id: 'other', run_id: 'run-beta', story_id: 'story-beta', tokens: 30 },
    { id: 'unknown', tokens: 40 },
    { id: 'replay', type: 'compacted', tokens: 50 }
  ];
  const result = resolveRunAttribution(events, { story_id: 'story-alpha', run_id: 'run-alpha' });
  assert.deepEqual(result.events.map((event) => event.bucket), [
    'story_attributed', 'shared_parent', 'other_story', 'unattributed', 'replayed_context'
  ]);
  assert.equal(result.buckets.story_attributed.event_count, 1);
  assert.equal(result.buckets.story_attributed.tokens, 10);
  assert.equal(result.buckets.shared_parent.tokens, 20);
  assert.equal(result.buckets.other_story.tokens, 30);
  assert.equal(result.buckets.unattributed.tokens, 40);
  assert.equal(result.buckets.replayed_context.tokens, 50);
  assert.equal(result.total_event_count, events.length);
  assert.equal(result.total_tokens, 150);
  assert.equal(Object.values(result.buckets).reduce((sum, bucket) => sum + bucket.event_count, 0), events.length);
  for (const item of result.events) {
    assert.equal(typeof item.method, 'string');
    assert.ok(Object.hasOwn(item, 'source_artifact'));
    assert.equal(typeof item.confidence, 'string');
  }
});

test('thread-only observations never become authoritative story attribution', () => {
  const [event] = resolveRunAttribution([{ thread_id: 'thread-only', tokens: 1 }], {
    story_id: 'story-alpha', run_id: 'run-alpha'
  }).events;
  assert.equal(event.bucket, 'unattributed');
  assert.equal(event.method, 'unavailable');
  assert.equal(event.confidence, 'unavailable');
  assert.equal(event.run_id, null);
});
