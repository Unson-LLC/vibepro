import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createAgentRuntimeCoordinator } from '../../src/agent-runtime-adapter.js';
import { createGuardedRunSession } from '../../src/guarded-run-session.js';
import { readRunContextCapsule } from '../../src/run-context-capsule.js';
import { collectSessionEfficiencyAudit } from '../../src/session-efficiency-audit.js';
import { createRunLineageEnvelope } from '../../src/run-lineage.js';
import { recordVerificationEvidence } from '../../src/verification-evidence.js';

const execFileAsync = promisify(execFile);
const CLI_BIN = fileURLToPath(new URL('../../bin/vibepro.js', import.meta.url));
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
  await writeFile(statePath, `${JSON.stringify({ ...created, worktree_root: authorityRoot, branch: 'main' }, null, 2)}\n`);

  const dispatched = await guardedRun.dispatchRuntime(repo, {
    storyId: STORY_ID,
    runId: created.run_id,
    request: {
      adapter_id: 'fixture-provider',
      task_id: 'eral-lineage-e2e',
      role: 'implementation',
      branch: 'caller-observed-branch',
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
  assert.equal(dispatchLineage.worktree_root, authorityRoot);
  assert.equal(dispatchLineage.branch, 'main');
  assert.equal(dispatchLineage.thread_id, providerThreadId);
  assert.equal(dispatchLineage.provider_observations[0].thread_id, providerThreadId);

  const canonicalState = JSON.parse(await readFile(statePath, 'utf8'));
  await writeFile(statePath, `${JSON.stringify({
    ...canonicalState,
    worktree_root: dispatchLineage.worktree_root,
    branch: dispatchLineage.branch,
    current_head_sha: dispatchLineage.head_sha,
    execution_context: {
      ...canonicalState.execution_context,
      root_realpath: dispatchLineage.worktree_root
    }
  }, null, 2)}\n`);

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
    { timestamp, type: 'session_meta', payload: { session_id: SESSION_ID, cwd: authorityRoot } },
    { timestamp, type: 'event_msg', thread_id: providerThreadId, payload: { type: 'assistant_message', content: 'provider observation only' } },
    { timestamp, type: 'event_msg', thread_id: 'shared-parent-thread', shared_parent: true, run_ids: [created.run_id, 'run-parent'], payload: { type: 'assistant_message', content: 'shared parent observation' } },
    { timestamp, type: 'event_msg', lineage: otherLineage, payload: { type: 'assistant_message', content: 'other Story observation' } },
    {
      timestamp,
      type: 'compacted',
      replayed_context: true,
      payload: {
        content: `Replayed .vibepro/pr/${STORY_ID}/pr-prepare.json`,
        replacement_history: 'replayed prior context'
      }
    }
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
  assert.equal(attribution.buckets.replayed_context.time_ms, 0);
  assert.equal(attribution.buckets.replayed_context.value, 0);
  assert.equal(attribution.buckets.story_attributed.time_ms, 0);
  assert.equal(attribution.buckets.story_attributed.value, 0);
  assert.equal(audit.session.artifact_token_accounting.buckets.replayed_context.event_count, 1);
  assert.ok(audit.session.artifact_token_accounting.buckets.replayed_context.estimated_tokens > 0);
  for (const event of attribution.events) {
    assert.equal(typeof event.method, 'string');
    assert.ok(Object.hasOwn(event, 'source_artifact'));
    assert.equal(typeof event.confidence, 'string');
    assert.ok(Object.hasOwn(event, 'run_id'));
  }
  const providerOnly = attribution.events.find((event) => event.thread_id === providerThreadId && !event.lineage);
  assert.equal(providerOnly.bucket, 'unattributed');
  assert.equal(providerOnly.run_id, null);
  assert.equal(attribution.events.reduce((sum, event) => sum + event.tokens, 0), attribution.total_tokens);
  assert.equal(
    Object.values(attribution.buckets).reduce((sum, bucket) => sum + bucket.event_count, 0),
    attribution.total_event_count
  );

  const cliAvailable = await runAuditCli(authorityRoot, [
    '--story-id', STORY_ID,
    '--run-id', created.run_id,
    '--session-id', SESSION_ID,
    '--codex-home', codexHome,
    '--window-start', '2026-07-21T01:02:00.000Z',
    '--window-end', '2026-07-21T01:04:00.000Z',
    '--no-worktree-diff',
    '--json'
  ]);
  assert.ok([0, 2].includes(cliAvailable.exitCode));
  const cliAvailableResult = JSON.parse(cliAvailable.stdout);
  assert.equal(cliAvailableResult.artifact_kind, 'vibepro_session_efficiency_audit');
  assert.equal(cliAvailableResult.lineage_attribution.mode, 'canonical_run_artifact_preferred');
  assert.equal(cliAvailableResult.lineage_attribution.canonical_run.status, 'available');
  assert.equal(cliAvailableResult.lineage_attribution.buckets.replayed_context.time_ms, 0);
  assert.equal(cliAvailableResult.lineage_attribution.buckets.replayed_context.value, 0);
  assert.equal(cliAvailableResult.session.artifact_token_accounting.buckets.replayed_context.event_count, 1);
  for (const event of cliAvailableResult.lineage_attribution.events) {
    assert.equal(typeof event.method, 'string');
    assert.equal(typeof event.confidence, 'string');
    assert.ok(Object.hasOwn(event, 'source_artifact'));
  }

  const cliAvailableHuman = await runAuditCli(authorityRoot, [
    '--story-id', STORY_ID,
    '--run-id', created.run_id,
    '--session-id', SESSION_ID,
    '--codex-home', codexHome,
    '--window-start', '2026-07-21T01:02:00.000Z',
    '--window-end', '2026-07-21T01:04:00.000Z',
    '--no-worktree-diff'
  ]);
  assert.ok([0, 2].includes(cliAvailableHuman.exitCode));
  assert.match(
    cliAvailableHuman.stdout,
    new RegExp(`- lineage_attribution: status=available method=canonical_run_artifact_preferred run_id=${created.run_id} source=guarded-run-authority-artifact\\+codex-session-jsonl confidence=\\S+`)
  );

  const cliUnavailable = await runAuditCli(authorityRoot, [
    '--story-id', STORY_ID,
    '--run-id', 'run-missing-from-canonical-state',
    '--session-id', SESSION_ID,
    '--codex-home', codexHome,
    '--window-start', '2026-07-21T01:02:00.000Z',
    '--window-end', '2026-07-21T01:04:00.000Z',
    '--no-worktree-diff',
    '--json'
  ]);
  assert.equal(cliUnavailable.exitCode, 2);
  const cliUnavailableResult = JSON.parse(cliUnavailable.stdout);
  assert.equal(cliUnavailableResult.lineage_attribution.status, 'unavailable');
  assert.equal(cliUnavailableResult.lineage_attribution.canonical_run.status, 'unavailable');
  assert.match(cliUnavailableResult.lineage_attribution.canonical_run.reason, /not found/);

  const cliUnavailableHuman = await runAuditCli(authorityRoot, [
    '--story-id', STORY_ID,
    '--run-id', 'run-missing-from-canonical-state',
    '--session-id', SESSION_ID,
    '--codex-home', codexHome,
    '--window-start', '2026-07-21T01:02:00.000Z',
    '--window-end', '2026-07-21T01:04:00.000Z',
    '--no-worktree-diff'
  ]);
  assert.equal(cliUnavailableHuman.exitCode, 2);
  assert.match(
    cliUnavailableHuman.stdout,
    /- lineage_attribution: status=unavailable method=canonical_run_authority_required run_id=run-missing-from-canonical-state source=guarded-run-authority-artifact confidence=\S+ reason=canonical Guarded Run state artifact was not found/
  );

  const ambiguousSessionId = '019f-eral-e2e-ambiguous-session';
  await writeSessionFile(codexHome, ambiguousSessionId, [
    { timestamp, type: 'session_meta', payload: { session_id: ambiguousSessionId, cwd: authorityRoot } },
    { timestamp, type: 'event_msg', payload: { type: 'assistant_message', content: `Working on ${STORY_ID}` } }
  ]);
  const cliAmbiguous = await runAuditCli(authorityRoot, [
    '--story-id', STORY_ID,
    '--session-id', 'auto',
    '--infer-session',
    '--codex-home', codexHome,
    '--window-start', '2026-07-21T01:02:00.000Z',
    '--window-end', '2026-07-21T01:04:00.000Z',
    '--no-worktree-diff',
    '--json'
  ]);
  assert.equal(cliAmbiguous.exitCode, 2);
  const cliAmbiguousResult = JSON.parse(cliAmbiguous.stdout);
  assert.equal(cliAmbiguousResult.session_selection.status, 'ambiguous', JSON.stringify(cliAmbiguousResult.session_selection));
  assert.equal(cliAmbiguousResult.session_id, null);
  assert.equal(cliAmbiguousResult.lineage_attribution.status, 'unavailable');
  assert.match(cliAmbiguousResult.session_selection.reason, /same top score|ambiguous|confidence/i);

  const cliAmbiguousHuman = await runAuditCli(authorityRoot, [
    '--story-id', STORY_ID,
    '--session-id', 'auto',
    '--infer-session',
    '--codex-home', codexHome,
    '--window-start', '2026-07-21T01:02:00.000Z',
    '--window-end', '2026-07-21T01:04:00.000Z',
    '--no-worktree-diff'
  ]);
  assert.equal(cliAmbiguousHuman.exitCode, 2);
  assert.match(
    cliAmbiguousHuman.stdout,
    /- lineage_attribution: status=ambiguous method=session_selection run_id=- source=codex-session-jsonl confidence=ambiguous reason=multiple session candidates had the same top score/
  );
});

async function runAuditCli(repoRoot, args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_BIN, 'audit', 'session-cost', repoRoot, ...args], {
      cwd: path.dirname(CLI_BIN),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    return {
      exitCode: error.code,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? ''
    };
  }
}

async function writeSessionFile(codexHome, sessionId, entries) {
  const sessionPath = path.join(codexHome, 'sessions', '2026', '07', '21', `${sessionId}.jsonl`);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
}

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}
