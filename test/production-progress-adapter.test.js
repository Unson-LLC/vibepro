import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createProductionProgressAdapter,
  PRODUCTION_PROGRESS_MAPPING_UNCONFIRMED,
} from '../src/production-progress-adapter.js';

const STORY_ID = 'story-progress-adapter';
const TASK_ID = 'progress-task-1';
const REPOSITORY = 'Unson-LLC/vibepro';
const PLAN_VERSION = 'plan-progress-adapter-v1';

test('accepted 0.2.0 mapping subscribes before spawn and waits for confirmed progress', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-progress-adapter-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const calls = [];
  let receipt;
  let deliver;
  const host = {
    async subscribeCompletion(options) {
      calls.push('subscribe');
      deliver = options.onEvent;
      return { subscription_id: 'subscription-1' };
    },
    async spawn(request) {
      calls.push('spawn');
      assert.equal(request.dispatch_id, 'dispatch-1');
      assert.equal(request.idempotency_key, 'idempotency-1');
      assert.equal(request.development_progress.owner, 'person-1');
      assert.equal(request.development_progress.source, 'vibepro_development_task');
      assert.deepEqual(request.task_ref, {
        repository: REPOSITORY, story_id: STORY_ID, task_id: TASK_ID,
      });
      receipt = { status: 'awaiting_integration', reason: 'development_progress_pending' };
      queueMicrotask(() => deliver({
        kind: 'completed', event_id: 'event-1', dispatch_id: 'dispatch-1',
        development_progress: receipt,
      }));
      setTimeout(() => { receipt.status = 'confirmed'; }, 10);
      return { provider_run_id: 'provider-1', dispatch_id: 'dispatch-1' };
    },
    async drainCompletion() {
      calls.push('drain');
      return [{
        kind: 'completed', event_id: 'event-1', dispatch_id: 'dispatch-1',
        development_progress: { status: 'confirmed' },
      }];
    },
  };
  const readCalls = [];
  const adapter = createProductionProgressAdapter({
    host,
    confirmationTimeoutMs: 500,
    confirmationPollMs: 2,
    readAcceptedAuthority: async (root, storyId) => {
      readCalls.push({ root, storyId });
      return acceptedAuthority();
    },
  });

  const result = await adapter.dispatch({
    repo_root: repoRoot,
    story_id: STORY_ID,
    task_id: TASK_ID,
    mapping: acceptedMapping(),
    request: { role: 'review', requirements: { managed_worktree: repoRoot } },
  });

  assert.equal(result.status, 'confirmed');
  assert.deepEqual(calls, ['subscribe', 'spawn']);
  assert.deepEqual(readCalls, [{ root: repoRoot, storyId: STORY_ID }]);
  assert.equal(result.event.event_id, 'event-1');
});

test('mapping failures are fail-closed and never reach the host', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-progress-adapter-invalid-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const calls = [];
  const host = {
    async subscribeCompletion() { calls.push('subscribe'); },
    async spawn() { calls.push('spawn'); },
    async drainCompletion() { calls.push('drain'); return []; },
  };
  const adapter = createProductionProgressAdapter({
    host,
    readAcceptedAuthority: async () => acceptedAuthority(),
  });

  const invalidSource = await adapter.dispatch({
    repo_root: repoRoot, story_id: STORY_ID, task_id: TASK_ID,
    mapping: { ...acceptedMapping(), source: 'agent-name' },
    request: { requirements: { managed_worktree: repoRoot } },
  });
  assert.deepEqual(invalidSource, {
    status: PRODUCTION_PROGRESS_MAPPING_UNCONFIRMED,
    reason: 'source_unverified',
  });
  assert.deepEqual(calls, []);

  const mismatchedTask = await adapter.dispatch({
    repo_root: repoRoot, story_id: STORY_ID, task_id: TASK_ID,
    mapping: {
      ...acceptedMapping(),
      task_ref: { repository: REPOSITORY, story_id: STORY_ID, task_id: 'other-task' },
      source_refs: [{
        type: 'vibepro_development_task', repository: REPOSITORY, story_id: STORY_ID, task_id: 'other-task',
      }],
    },
    request: { requirements: { managed_worktree: repoRoot } },
  });
  assert.deepEqual(mismatchedTask, {
    status: PRODUCTION_PROGRESS_MAPPING_UNCONFIRMED,
    reason: 'accepted_task_mapping_mismatch',
  });
  assert.deepEqual(calls, []);

  const missingSourceRefs = await adapter.dispatch({
    repo_root: repoRoot, story_id: STORY_ID, task_id: TASK_ID,
    mapping: { ...acceptedMapping(), source_refs: [] },
    request: { requirements: { managed_worktree: repoRoot } },
  });
  assert.deepEqual(missingSourceRefs, {
    status: PRODUCTION_PROGRESS_MAPPING_UNCONFIRMED,
    reason: 'canonical_source_refs_unverified',
  });

  const ambiguousSourceRefs = await adapter.dispatch({
    repo_root: repoRoot, story_id: STORY_ID, task_id: TASK_ID,
    mapping: {
      ...acceptedMapping(),
      source_refs: [
        acceptedMapping().source_refs[0],
        { ...acceptedMapping().source_refs[0], type: 'vibepro_task' },
      ],
    },
    request: { requirements: { managed_worktree: repoRoot } },
  });
  assert.deepEqual(ambiguousSourceRefs, {
    status: PRODUCTION_PROGRESS_MAPPING_UNCONFIRMED,
    reason: 'canonical_source_ref_ambiguous',
  });
  assert.deepEqual(calls, []);

  const mismatchedRequestTaskRef = await adapter.dispatch({
    repo_root: repoRoot, story_id: STORY_ID, task_id: TASK_ID,
    mapping: acceptedMapping(),
    request: {
      requirements: { managed_worktree: repoRoot },
      task_ref: { repository: REPOSITORY, story_id: STORY_ID, task_id: 'other-task' },
    },
  });
  assert.deepEqual(mismatchedRequestTaskRef, {
    status: PRODUCTION_PROGRESS_MAPPING_UNCONFIRMED,
    reason: 'task_ref_mismatch',
  });
  assert.deepEqual(calls, []);
});

test('unreadable accepted plan becomes mapping_unconfirmed', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-progress-adapter-missing-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  let spawnCalls = 0;
  const adapter = createProductionProgressAdapter({
    host: {
      async subscribeCompletion() { throw new Error('must not subscribe'); },
      async spawn() { spawnCalls += 1; },
      async drainCompletion() { throw new Error('must not drain'); },
    },
    readAcceptedAuthority: async () => { throw new Error('accepted task plan not found'); },
  });

  const result = await adapter.dispatch({
    repo_root: repoRoot, story_id: STORY_ID, task_id: TASK_ID,
    mapping: acceptedMapping(), request: { requirements: { managed_worktree: repoRoot } },
  });
  assert.deepEqual(result, {
    status: PRODUCTION_PROGRESS_MAPPING_UNCONFIRMED,
    reason: 'accepted_plan_unreadable',
  });
  assert.equal(spawnCalls, 0);
});

test('restart drain reuses the dispatch without spawning again', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-progress-adapter-drain-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const calls = [];
  const host = {
    async subscribeCompletion() { calls.push('subscribe'); return { subscription_id: 's' }; },
    async spawn() { calls.push('spawn'); return { provider_run_id: 'provider-1' }; },
    async drainCompletion(input) {
      calls.push(['drain', input.dispatch_id]);
      return [{ development_progress: { status: 'confirmed' }, event_id: 'event-1' }];
    },
  };
  const adapter = createProductionProgressAdapter({
    host,
    readAcceptedAuthority: async () => acceptedAuthority(),
    confirmationTimeoutMs: 100,
    confirmationPollMs: 2,
  });
  const result = await adapter.drain({
    repo_root: repoRoot, story_id: STORY_ID, task_id: TASK_ID,
    mapping: acceptedMapping(), request: { requirements: { managed_worktree: repoRoot } },
  });
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(calls, [['drain', 'dispatch-1']]);
});

test('unconfigured Brainbase leaves standalone host use available', async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-progress-adapter-local-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  let request;
  const adapter = createProductionProgressAdapter({
    integrationEnabled: false,
    host: {
      async subscribeCompletion() { throw new Error('standalone path must not subscribe'); },
      async spawn(value) {
        request = value;
        return { provider_run_id: 'provider-local' };
      },
      async drainCompletion() { throw new Error('standalone path does not need drain'); },
    },
  });
  const result = await adapter.dispatch({
    dispatch_id: 'standalone-dispatch',
    idempotency_key: 'standalone-idempotency',
    requirements: { managed_worktree: repoRoot },
  });
  assert.deepEqual(result, { provider_run_id: 'provider-local' });
  assert.equal(request.dispatch_id, 'standalone-dispatch');
});

function acceptedAuthority() {
  return {
    authority: 'accepted',
    present: true,
    schema_version: '0.2.0',
    repository: REPOSITORY,
    story_id: STORY_ID,
    plan_version: PLAN_VERSION,
    tasks: [{ id: TASK_ID, story_id: STORY_ID }],
  };
}

function acceptedMapping() {
  return {
    canonical_task_id: 'canonical-task-1',
    task_version: 5,
    source: 'vibepro_development_task',
    person: { id: 'person-1' },
    task_ref: { repository: REPOSITORY, story_id: STORY_ID, task_id: TASK_ID },
    source_refs: [{
      type: 'vibepro_development_task', repository: REPOSITORY, story_id: STORY_ID, task_id: TASK_ID,
    }, { type: 'github_issue', id: 'issue-1' }],
    plan_version: PLAN_VERSION,
    dispatch_id: 'dispatch-1',
    idempotency_key: 'idempotency-1',
  };
}
