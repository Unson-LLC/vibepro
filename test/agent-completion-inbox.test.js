import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAgentCompletionInbox } from '../src/agent-completion-inbox.js';

test('CDI-S-2 CDI-S-3 persistent inbox survives producer loss and deduplicates delivery', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-runtime-inbox-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const event = {
    event_id: 'completion-1', dispatch_id: 'dispatch-1', provider_run_id: 'provider-1', kind: 'completed',
    observed_at: '2026-07-22T01:00:00.000Z', surface_hash: 'surface-a', payload: { summary: 'done' }
  };
  const first = await createAgentCompletionInbox({ repoRoot }).append(event);
  const duplicate = await createAgentCompletionInbox({ repoRoot }).append(event);
  const recovered = await createAgentCompletionInbox({ repoRoot }).reconcile('dispatch-1');
  assert.equal(first.reused, false);
  assert.equal(duplicate.reused, true);
  assert.equal(recovered.events.length, 1);
  assert.equal(recovered.completion.payload.summary, 'done');
});

test('CDI-S-6 persistent inbox retains partial judgments before completion', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-runtime-partials-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const inbox = createAgentCompletionInbox({ repoRoot });
  await inbox.append({ event_id: 'partial-a', dispatch_id: 'dispatch-p', kind: 'partial_result', observed_at: '2026-07-22T01:00:00.000Z', checkpoint_id: 'security', payload: { judgment_id: 'security', verdict: 'pass' } });
  await inbox.append({ event_id: 'complete-p', dispatch_id: 'dispatch-p', kind: 'completed', observed_at: '2026-07-22T01:01:00.000Z', payload: { summary: 'done' } });
  const recovered = await inbox.reconcile('dispatch-p');
  assert.deepEqual(recovered.partial_results, [{ judgment_id: 'security', verdict: 'pass' }]);
  assert.equal(recovered.completion.event_id, 'complete-p');
});

test('CDI-S-2 concurrent conflicting delivery cannot overwrite an immutable event', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-runtime-inbox-race-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const inbox = createAgentCompletionInbox({ repoRoot });
  const common = {
    event_id: 'completion-race', dispatch_id: 'dispatch-race', provider_run_id: 'provider-race', kind: 'completed',
    observed_at: '2026-07-22T01:00:00.000Z', surface_hash: 'surface-a'
  };
  const settled = await Promise.allSettled([
    inbox.append({ ...common, payload: { summary: 'first' } }),
    inbox.append({ ...common, payload: { summary: 'second' } })
  ]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((item) => item.status === 'rejected').length, 1);
  assert.match(settled.find((item) => item.status === 'rejected').reason.message, /event conflict/);
  const recovered = await inbox.reconcile('dispatch-race');
  assert.equal(recovered.events.length, 1);
  assert.ok(['first', 'second'].includes(recovered.completion.payload.summary));
});

test('CDI-S-2 Inbox rejects provider payload fields outside the VibePro-owned schema', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-runtime-inbox-schema-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const inbox = createAgentCompletionInbox({ repoRoot });
  await assert.rejects(inbox.append({
    event_id: 'completion-secret', dispatch_id: 'dispatch-secret', kind: 'completed',
    payload: { summary: 'done', raw_transcript: 'must never be persisted' }
  }), /unsupported fields: raw_transcript/);
  await assert.rejects(inbox.append({
    event_id: 'completion-credential', dispatch_id: 'dispatch-secret', kind: 'completed',
    payload: { summary: 'done', review_record: { status: 'pass', provider_token: 'secret' } }
  }), /unsupported fields: provider_token/);
  assert.equal((await inbox.reconcile('dispatch-secret')).events.length, 0);
});
