import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { buildBootstrapBindingFingerprint } from '../../src/guarded-run-session.js';
import { resolveGitIdentity } from '../../src/git-identity.js';

const execFileAsync = promisify(execFile);
const CLI_BIN = fileURLToPath(new URL('../../bin/vibepro.js', import.meta.url));
const STORY_ID = 'story-guarded-run-e2e';

test('GRS-S-1 GRS-S-3 GRS-S-4 GRS-S-6 GRS-S-7 guarded Run survives fresh CLI processes and replays its canonical artifact', async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guarded-run-e2e-'));
  t.after(() => rm(repo, { recursive: true, force: true }));

  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro E2E']);
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    brainbase: {
      stories: [{ story_id: STORY_ID, title: 'Guarded Run E2E' }]
    },
    execution: { managed_worktree: 'disabled' }
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'README.md'), '# Guarded Run E2E\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'test: initialize guarded Run E2E fixture']);

  const created = await runJson(repo, [
    'execute', 'run', repo, '--story-id', STORY_ID, '--target', 'pr_ready', '--json'
  ]);
  assert.equal(created.status, 'running');
  assert.equal(created.execution_context.authority_kind, 'repository');

  const stateFile = path.join(
    repo,
    '.vibepro',
    'executions',
    STORY_ID,
    'runs',
    created.run_id,
    'state.json'
  );
  const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.deepEqual(persisted, created);

  const statusFromFreshProcess = await runJson(repo, [
    'execute', 'status', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
  ]);
  assert.deepEqual(statusFromFreshProcess, persisted);

  const watchFromFreshProcess = await runJson(repo, [
    'execute', 'watch', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
  ]);
  assert.deepEqual(watchFromFreshProcess, persisted);

  const cancelled = await runJson(repo, [
    'execute', 'cancel', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
  ]);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.transitions.at(-1).reason, 'operator_cancelled');

  const terminalReplay = await runJson(repo, [
    'execute', 'status', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
  ]);
  assert.deepEqual(terminalReplay, JSON.parse(await readFile(stateFile, 'utf8')));
  assert.deepEqual(terminalReplay, cancelled);
});

test('GRS-S-3 preferred source-fallback Run resumes from its canonical artifact in fresh CLI processes', async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-source-fallback-e2e-'));
  t.after(() => rm(repo, { recursive: true, force: true }));

  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro E2E']);
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    brainbase: { stories: [{ story_id: STORY_ID, title: 'Guarded Run source fallback E2E' }] },
    execution: { managed_worktree: 'preferred' }
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'README.md'), '# Guarded Run source fallback E2E\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'test: initialize source fallback E2E fixture']);

  const identity = await resolveGitIdentity(repo);
  const unavailableBinding = {
    status: 'unavailable',
    required: false,
    mode: 'preferred',
    source_repo: identity.root_realpath,
    source_relative_path: null,
    path: null,
    relative_path: `.worktrees/vibepro/${STORY_ID}`,
    branch: `codex/${STORY_ID}`,
    actual_branch: null,
    branch_match: null,
    base_ref: 'main',
    created_from_sha: identity.head_sha,
    current_head_sha: null,
    dirty: null,
    dirty_paths: [],
    dirty_check_error: null,
    failure_reason: 'fixture_managed_runtime_unavailable'
  };
  const managedWorktree = {
    ...unavailableBinding,
    bootstrap_binding_fingerprint: buildBootstrapBindingFingerprint(unavailableBinding)
  };
  const runId = 'run-20260715T010203Z-a1b2c3d4';
  const createdAt = '2026-07-15T01:02:03.000Z';
  const state = {
    schema_version: '0.1.0',
    run_id: runId,
    story_id: STORY_ID,
    target: 'pr_ready',
    autonomy_mode: 'guarded',
    created_at: createdAt,
    updated_at: createdAt,
    status: 'blocked',
    stop_reason: { code: 'fixture_blocked', message: 'fixture blocked', details: {} },
    attempt: 1,
    iteration: 0,
    budget: { max_attempts: 2, max_iterations: 1 },
    deadline: null,
    last_progress_at: createdAt,
    pending_decision: null,
    current_head_sha: identity.head_sha,
    execution_context: {
      authority_kind: 'source_fallback',
      root_realpath: identity.root_realpath,
      git_dir_realpath: identity.git_dir_realpath
    },
    managed_worktree: managedWorktree,
    transitions: [
      { sequence: 1, from: null, to: 'running', reason: 'run_created', timestamp: createdAt },
      { sequence: 2, from: 'running', to: 'blocked', reason: 'fixture_blocked', timestamp: createdAt }
    ]
  };
  const executionDir = path.join(repo, '.vibepro', 'executions', STORY_ID);
  const stateFile = path.join(executionDir, 'runs', runId, 'state.json');
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(path.join(executionDir, 'state.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: STORY_ID,
    target: 'pr_create',
    managed_worktree: unavailableBinding
  }, null, 2)}\n`);
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const migratedState = {
    ...state,
    schema_version: '0.2.0',
    action_journal: [],
    next_best_action_decisions: [],
    human_decision_journal: [],
    retry_journal: [],
    resume_from_node_id: null,
    retry_policy: {
      retryable_stop_codes: ['action_failed'],
      backoff_ms: 0
    },
    provider_fallbacks: [],
    usage_accounting: {
      total_tokens: null,
      cost_usd: null,
      status: 'unknown',
      source: null,
      updated_at: null
    },
    migration_compatibility: {
      retry_policy_enforcement: 'legacy_advisory'
    }
  };
  assert.deepEqual(await runJson(repo, [
    'execute', 'status', repo, '--story-id', STORY_ID, '--run-id', runId, '--json'
  ]), migratedState);
  assert.deepEqual(await runJson(repo, [
    'execute', 'watch', repo, '--story-id', STORY_ID, '--run-id', runId, '--json'
  ]), migratedState);
  const resumed = await runJson(repo, [
    'execute', 'resume', repo, '--story-id', STORY_ID, '--run-id', runId, '--json'
  ]);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.attempt, 2);
  const cancelled = await runJson(repo, [
    'execute', 'cancel', repo, '--story-id', STORY_ID, '--run-id', runId, '--json'
  ]);
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(await runJson(repo, [
    'execute', 'status', repo, '--story-id', STORY_ID, '--run-id', runId, '--json'
  ]), JSON.parse(await readFile(stateFile, 'utf8')));
});

test('GAH-S-2 fresh CLI recovers quota, timeout, CI pending, and review timeout under persisted policy', async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-guarded-retry-e2e-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro E2E']);
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    brainbase: { stories: [{ story_id: STORY_ID, title: 'Guarded retry E2E' }] },
    execution: { managed_worktree: 'disabled' }
  }, null, 2)}\n`);
  await writeFile(path.join(repo, 'README.md'), '# Guarded retry E2E\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'test: initialize guarded retry E2E fixture']);

  for (const code of ['runtime_quota', 'runtime_timeout', 'ci_pending', 'review_timeout']) {
    const created = await runJson(repo, [
      'execute', 'run', repo, '--story-id', STORY_ID, '--target', 'pr_ready', '--retry-code', code, '--json'
    ]);
    const stateFile = path.join(repo, '.vibepro', 'executions', STORY_ID, 'runs', created.run_id, 'state.json');
    const blocked = {
      ...created,
      status: 'blocked',
      stop_reason: { code, message: `${code} fixture`, details: {} },
      transitions: [...created.transitions, {
        sequence: 2,
        from: 'running',
        to: 'blocked',
        reason: `${code}_fixture`,
        timestamp: created.updated_at
      }]
    };
    await writeFile(stateFile, `${JSON.stringify(blocked, null, 2)}\n`);
    const resumed = await runJson(repo, [
      'execute', 'resume', repo, '--story-id', STORY_ID, '--run-id', created.run_id, '--json'
    ]);
    assert.equal(resumed.status, 'running', code);
    assert.equal(resumed.retry_journal.at(-1).stop_code, code);
    assert.equal(resumed.retry_journal.at(-1).retryable, true);
  }
});

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}

async function runJson(cwd, args) {
  const result = await execFileAsync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8'
  });
  return JSON.parse(result.stdout);
}
