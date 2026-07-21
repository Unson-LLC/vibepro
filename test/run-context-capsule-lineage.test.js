import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRunLineageEnvelope } from '../src/run-lineage.js';
import {
  RUN_CONTEXT_CAPSULE_MAX_BYTES,
  createRunContextCapsule
} from '../src/run-context-capsule.js';

const STORY_ID = 'story-vibepro-explicit-run-attribution-lineage';
const RUN_ID = 'run-20260721T010203Z-01020304';
const HEAD = 'a'.repeat(40);

test('ERAL-S-9 capsule projects bounded Story to Run to dispatch to provider observation lineage', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-capsule-lineage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = path.join(root, '.vibepro', 'executions', STORY_ID, 'runs', RUN_ID);
  await mkdir(runDir, { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(root, '.vibepro', 'pr', STORY_ID), { recursive: true });

  const authority = {
    story_id: STORY_ID,
    run_id: RUN_ID,
    worktree_root: root,
    branch: 'codex/story-vibepro-explicit-run-attribution-lineage',
    head_sha: HEAD
  };
  const dispatchLineage = createRunLineageEnvelope({
    ...authority,
    dispatch_id: 'dispatch-implementation-1',
    provider_observations: [{
      provider: 'codex',
      provider_run_id: 'provider-run-1',
      provider_session_id: 'provider-session-1',
      thread_id: 'thread-observation-1'
    }]
  });
  await writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    run_id: RUN_ID,
    status: 'running',
    current_head_sha: HEAD,
    branch: authority.branch,
    execution_context: { root_realpath: root },
    runtime_dispatches: [{
      dispatch_id: dispatchLineage.dispatch_id,
      role: 'implementation',
      adapter_id: 'codex',
      task_id: 'task-lineage',
      status: 'running',
      lineage: dispatchLineage,
      result: { summary: 'PROVIDER_TRANSCRIPT_SHOULD_NEVER_BE_COPIED' }
    }]
  }, null, 2)}\n`);
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`),
    `---\nstory_id: ${STORY_ID}\ntitle: lineage handoff\nstatus: active\n---\n\n# Lineage handoff\n\n**So that** a fresh process can recover the Run without transcript content\n`);
  await writeFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-evidence.json'),
    '{"commands":[{"kind":"focused","status":"pass"}]}\n');

  const dependencies = { now: () => new Date('2026-07-21T01:02:03.000Z'), resolveHead: async () => HEAD };
  const first = await createRunContextCapsule(dependencies).refresh(root, { storyId: STORY_ID, runId: RUN_ID });
  const fresh = await createRunContextCapsule(dependencies).read(root, { storyId: STORY_ID, runId: RUN_ID });
  const raw = await readFile(path.join(runDir, 'context-capsule.json'), 'utf8');

  assert.ok(Buffer.byteLength(raw) <= RUN_CONTEXT_CAPSULE_MAX_BYTES);
  assert.equal(first.capsule.lineage.schema_version, '0.1.0');
  assert.deepEqual(fresh.lineage.authority, authority);
  assert.equal(fresh.lineage.summary.validated_dispatch_count, 1);
  assert.equal(fresh.lineage.dispatches[0].dispatch_id, 'dispatch-implementation-1');
  assert.deepEqual(fresh.lineage.dispatches[0].provider_observations, [{
    provider: 'codex',
    provider_run_id: 'provider-run-1',
    provider_session_id: 'provider-session-1',
    thread_id: 'thread-observation-1'
  }]);
  assert.equal(fresh.lineage.source_ref, `.vibepro/executions/${STORY_ID}/runs/${RUN_ID}/state.json`);
  assert.doesNotMatch(raw, /PROVIDER_TRANSCRIPT_SHOULD_NEVER_BE_COPIED/);
});

test('lineage projection remains bounded when the Run owns many dispatches', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-capsule-lineage-many-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runDir = path.join(root, '.vibepro', 'executions', STORY_ID, 'runs', RUN_ID);
  await mkdir(runDir, { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(root, '.vibepro', 'pr', STORY_ID), { recursive: true });
  const authority = { story_id: STORY_ID, run_id: RUN_ID, worktree_root: root, branch: 'codex/lineage', head_sha: HEAD };
  const runtime_dispatches = Array.from({ length: 80 }, (_, index) => {
    const lineage = createRunLineageEnvelope({ ...authority, dispatch_id: `dispatch-${index}` });
    return { dispatch_id: lineage.dispatch_id, role: 'review', status: 'completed', lineage, adapter_id: 'codex', task_id: `task-${index}` };
  });
  await writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({ story_id: STORY_ID, run_id: RUN_ID, status: 'running', current_head_sha: HEAD, branch: authority.branch, execution_context: { root_realpath: root }, runtime_dispatches }, null, 2)}\n`);
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---\nstory_id: ${STORY_ID}\n---\n\n# Handoff\n\n**So that** the Run remains recoverable\n`);
  await writeFile(path.join(root, '.vibepro', 'pr', STORY_ID, 'verification-evidence.json'), '{"commands":[]}\n');

  const manager = createRunContextCapsule({ resolveHead: async () => HEAD });
  const result = await manager.refresh(root, { storyId: STORY_ID, runId: RUN_ID });
  const raw = await readFile(path.join(runDir, 'context-capsule.json'), 'utf8');
  assert.ok(Buffer.byteLength(raw) <= RUN_CONTEXT_CAPSULE_MAX_BYTES);
  assert.equal(result.capsule.lineage.summary.dispatch_count, 80);
  assert.ok(result.capsule.lineage.summary.omitted_dispatch_count > 0);
  assert.ok(result.capsule.truncated_sections.includes('lineage'));
});
