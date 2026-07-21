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
