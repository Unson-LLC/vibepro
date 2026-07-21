import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createAgentRuntimeCoordinator } from '../../src/agent-runtime-adapter.js';
import { createGuardedRunSession } from '../../src/guarded-run-session.js';
import { readRunContextCapsule } from '../../src/run-context-capsule.js';
import { collectSessionEfficiencyAudit } from '../../src/session-efficiency-audit.js';
import { createRunLineageEnvelope } from '../../src/run-lineage.js';
import { recordVerificationEvidence } from '../../src/verification-evidence.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-explicit-run-attribution-lineage';
const SESSION_ID = '019f-eral-e2e-session';
const OTHER_STORY_ID = 'story-other-lineage';

test('ERAL-S-10 guarded Run lineage reaches evidence, session-cost, and transcript-free handoff reconstruction', async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-eral-e2e-repo-'));
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'vibepro-eral-e2e-codex-'));
  t.after(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(codexHome, { recursive: true, force: true });
  });

  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.test']);
  await git(repo, ['config', 'user.name', 'VibePro ERAL E2E']);
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    brainbase: { stories: [{ story_id: STORY_ID, title: 'Explicit Run attribution lineage' }] },
    execution: { managed_worktree: 'disabled' }
  }, null, 2)}\n`);
  await writeFile(path.join(repo, '.vibepro', 'vibepro-manifest.json'), `${JSON.stringify({
    schema_version: '0.1.0', tool: 'vibepro', repo: { root: '.', git_remote: null, commit: null }, runs: []
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', `${STORY_ID}.md`), `---\nstory_id: ${STORY_ID}\ntitle: Explicit Run attribution lineage\nstatus: active\n---\n`);
  await writeFile(path.join(repo, 'README.md'), '# ERAL E2E\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'test: initialize ERAL E2E fixture']);

  const providerThreadId = 'provider-thread-eral-e2e';
  const coordinator = createAgentRuntimeCoordinator({
    now: () => new Date('2026-07-21T01:02:04.000Z'),
    adapters: [{
      id: 'fixture-provider',
      async probe() {
        return { available: true, capabilities: ['workspace_write'], sandbox: 'workspace-write', approval_policy: 'managed' };
      },
      async start() {
        return {
          provider: 'fixture-provider',
          provider_run_id: 'provider-run-eral-e2e',
          agent_identity: 'fixture-agent',
          session_id: 'provider-session-eral-e2e',
          thread_id: providerThreadId
        };
      },
      async status() {
        return { status: 'running' };
      },
      async cancel() {
        return { status: 'cancelled' };
      },
      async collect_result() {
        return { completion_status: 'completed', summary: 'fixture result' };
      }
    }]
  });
  const guardedRun = createGuardedRunSession({ agentRuntimeCoordinator: coordinator });
  const created = await guardedRun.run(repo, { storyId: STORY_ID });
  const authorityRoot = created.execution_context.root_realpath;
  const statePath = path.join(repo, '.vibepro', 'executions', STORY_ID, 'runs', created.run_id, 'state.json');
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), created);

  const dispatched = await guardedRun.dispatchRuntime(repo, {
    storyId: STORY_ID,
    runId: created.run_id,
    request: {
      adapter_id: 'fixture-provider',
      task_id: 'eral-lineage-e2e',
      role: 'implementation',
      branch: 'main',
      requirements: {
        capabilities: ['workspace_write'],
        timeout_ms: 1000,
        managed_worktree: created.execution_context.root_realpath
      }
    }
  });
  const dispatchLineage = dispatched.dispatch.lineage;
  assert.equal(dispatchLineage.story_id, STORY_ID);
  assert.equal(dispatchLineage.run_id, created.run_id);
  assert.equal(dispatchLineage.thread_id, providerThreadId);
  assert.equal(dispatchLineage.provider_observations[0].thread_id, providerThreadId);

  await recordVerificationEvidence(authorityRoot, {
    storyId: STORY_ID,
    kind: 'e2e',
    status: 'pass',
    command: 'node --test test/e2e/story-vibepro-explicit-run-attribution-lineage-main.test.js',
    summary: 'guarded Run lineage E2E passed',
    targets: ['canonical Run state', 'verification evidence', 'session-cost attribution'],
    scenarios: ['provider thread remains an observation'],
    runLineage: dispatchLineage
  });
  const evidence = JSON.parse(await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'verification-evidence.json'), 'utf8'));
  assert.deepEqual(evidence.commands[0].lineage, dispatchLineage);

  const capsule = await readRunContextCapsule(authorityRoot, { storyId: STORY_ID, runId: created.run_id });
  assert.equal(capsule.lineage.authority.story_id, STORY_ID);
  assert.equal(capsule.lineage.authority.run_id, created.run_id);
  assert.equal(capsule.lineage.summary.validated_dispatch_count, 1);
  assert.equal(capsule.lineage.dispatches[0].dispatch_id, dispatched.dispatch.dispatch_id);
  assert.equal(capsule.lineage.dispatches[0].provider_observations[0].thread_id, providerThreadId);
  assert.equal(Object.hasOwn(capsule.lineage.dispatches[0], 'result'), false);

  const otherLineage = createRunLineageEnvelope({
    story_id: OTHER_STORY_ID,
    run_id: 'run-other-story',
    dispatch_id: 'dispatch-other-story',
    worktree_root: authorityRoot,
    branch: 'main',
    head_sha: created.current_head_sha
  });
  const sessionPath = path.join(codexHome, 'sessions', '2026', '07', '21', `${SESSION_ID}.jsonl`);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const timestamp = '2026-07-21T01:03:00.000Z';
  await writeFile(sessionPath, `${[
    { timestamp, type: 'session_meta', payload: { cwd: authorityRoot } },
    { timestamp, type: 'event_msg', thread_id: providerThreadId, payload: { type: 'assistant_message', content: 'provider observation only' } },
    { timestamp, type: 'event_msg', thread_id: 'shared-parent-thread', shared_parent: true, run_ids: [created.run_id, 'run-parent'], payload: { type: 'assistant_message', content: 'shared parent observation' } },
    { timestamp, type: 'event_msg', lineage: otherLineage, payload: { type: 'assistant_message', content: 'other Story observation' } }
  ].map((entry) => JSON.stringify(entry)).join('\n')}\n`);

  const audit = await collectSessionEfficiencyAudit(authorityRoot, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    runId: created.run_id,
    codexHome,
    windowStart: '2026-07-21T01:02:00.000Z',
    windowEnd: '2026-07-21T01:04:00.000Z',
    includeWorktreeDiff: false
  });
  const attribution = audit.lineage_attribution;
  assert.equal(attribution.mode, 'canonical_run_artifact_preferred');
  assert.equal(attribution.canonical_run.authority.run_id, created.run_id);
  assert.equal(attribution.canonical_run.provider_observation_count, 1);
  assert.equal(attribution.buckets.story_attributed.event_count, 1);
  assert.equal(attribution.buckets.shared_parent.event_count, 1);
  assert.equal(attribution.buckets.other_story.event_count, 1);
  assert.equal(attribution.buckets.unattributed.event_count, 1);
  const providerOnly = attribution.events.find((event) => event.thread_id === providerThreadId && !event.lineage);
  assert.equal(providerOnly.bucket, 'unattributed');
  assert.equal(providerOnly.run_id, null);
  assert.equal(attribution.events.reduce((sum, event) => sum + event.tokens, 0), attribution.total_tokens);
  assert.equal(
    Object.values(attribution.buckets).reduce((sum, bucket) => sum + bucket.event_count, 0),
    attribution.total_event_count
  );
});

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}
