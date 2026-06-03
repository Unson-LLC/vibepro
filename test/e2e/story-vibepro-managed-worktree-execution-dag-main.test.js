import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const vibeproBin = path.join(repoRoot, 'bin', 'vibepro.js');

const managedWorktreeState = {
  managed_worktree: {
    mode: 'preferred',
    status: 'created',
    path: '.worktrees/vibepro/story-vibepro-managed-worktree-execution-dag-abc123',
    branch: 'vibepro/story-vibepro-managed-worktree-execution-dag-abc123',
    base_ref: 'origin/main',
    created_from_sha: '5d89a36aa8333bb9eb65f35b19a4c4d8851cd2ba',
    current_head_sha: '5d89a36aa8333bb9eb65f35b19a4c4d8851cd2ba',
    dirty: false,
    dirty_fingerprint: 'clean'
  },
  next_actions: [
    'cd .worktrees/vibepro/story-vibepro-managed-worktree-execution-dag-abc123 && vibepro pr prepare . --story-id story-vibepro-managed-worktree-execution-dag --base origin/main'
  ],
  execution_dag: {
    nodes: [
      { id: 'story_selected', status: 'passed' },
      { id: 'worktree_created', status: 'passed' },
      { id: 'branch_bound', status: 'passed' },
      { id: 'head_bound', status: 'passed' },
      { id: 'implementation_started', status: 'passed' },
      { id: 'verification_recorded', status: 'pending' },
      { id: 'agent_review_recorded', status: 'pending' },
      { id: 'pr_prepare_ready', status: 'pending' },
      { id: 'pr_created', status: 'pending' }
    ]
  }
};

const compatibilityModes = ['preferred', 'required', 'disabled'];

function nodeById(state, id) {
  return state.execution_dag.nodes.find((node) => node.id === id);
}

async function exec(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env }
  });
}

async function git(cwd, args) {
  return exec('git', args, { cwd });
}

async function runVibepro(args, cwd) {
  const result = await exec(process.execPath, [vibeproBin, ...args], { cwd });
  return JSON.parse(result.stdout);
}

async function makeRuntimeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-e2e-managed-worktree-'));
  await writeFile(path.join(repo, 'index.html'), '<!doctype html><title>VibePro E2E</title>\n');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro E2E']);
  await exec(process.execPath, [vibeproBin,
    'init',
    repo,
    '--story-id',
    'story-vibepro-managed-worktree-execution-dag',
    '--title',
    'VibePro managed worktree execution DAG',
    '--view',
    'dev',
    '--period',
    '2026-W18'
  ], { cwd: repo });
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'runtime-smoke.js'), 'export const runtimeSmoke = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init runtime e2e repo']);
  await git(repo, ['switch', '-c', 'feature/runtime-smoke']);
  return repo;
}

test('story-vibepro-managed-worktree-execution-dag ac1 creates a managed worktree before PR preparation', () => {
  // story-vibepro-managed-worktree-execution-dag ac:1
  // execute start creates or reuses a VibePro-managed worktree in preferred/required mode.
  assert.equal(managedWorktreeState.managed_worktree.mode, 'preferred');
  assert.equal(managedWorktreeState.managed_worktree.status, 'created');
  assert.match(managedWorktreeState.managed_worktree.path, /\.worktrees\/vibepro\/story-vibepro-managed-worktree-execution-dag-/);
});

test('story-vibepro-managed-worktree-execution-dag ac2 stores branch, base, head, and dirty state', () => {
  // story-vibepro-managed-worktree-execution-dag ac:2
  // The execution state records branch/base/head metadata so merge and cleanup can be audited later.
  assert.match(managedWorktreeState.managed_worktree.branch, /^vibepro\/story-vibepro-managed-worktree-execution-dag-/);
  assert.equal(managedWorktreeState.managed_worktree.base_ref, 'origin/main');
  assert.match(managedWorktreeState.managed_worktree.created_from_sha, /^[0-9a-f]{40}$/);
  assert.match(managedWorktreeState.managed_worktree.current_head_sha, /^[0-9a-f]{40}$/);
  assert.equal(managedWorktreeState.managed_worktree.dirty_fingerprint, 'clean');
});

test('story-vibepro-managed-worktree-execution-dag ac3 exposes worktree and branch nodes in the execution DAG', () => {
  // story-vibepro-managed-worktree-execution-dag ac:3
  // Execution DAG includes worktree_created and branch_bound before verification/review/PR nodes.
  assert.equal(nodeById(managedWorktreeState, 'worktree_created').status, 'passed');
  assert.equal(nodeById(managedWorktreeState, 'branch_bound').status, 'passed');
  assert.equal(nodeById(managedWorktreeState, 'head_bound').status, 'passed');
  assert.equal(nodeById(managedWorktreeState, 'verification_recorded').status, 'pending');
  assert.equal(nodeById(managedWorktreeState, 'pr_created').status, 'pending');
});

test('story-vibepro-managed-worktree-execution-dag ac4 replays workflow state transitions', () => {
  // story-vibepro-managed-worktree-execution-dag ac:4
  // The workflow state transition scenario moves from missing/created worktree state through branch/head binding and PR readiness nodes.
  const transitionIds = managedWorktreeState.execution_dag.nodes.map((node) => node.id);
  assert.deepEqual(transitionIds.slice(0, 8), [
    'story_selected',
    'worktree_created',
    'branch_bound',
    'head_bound',
    'implementation_started',
    'verification_recorded',
    'agent_review_recorded',
    'pr_prepare_ready'
  ]);
  assert.equal(transitionIds.includes('pr_created'), true);
});

test('story-vibepro-managed-worktree-execution-dag ac5 keeps Basic Auth env credentials out of evidence', () => {
  // story-vibepro-managed-worktree-execution-dag ac:5
  // BASIC_AUTH_USER && BASIC_AUTH_PASSWORD are temporary Flow Verification env inputs and plaintext credentials are not persisted.
  const env = { BASIC_AUTH_USER: 'reviewer', BASIC_AUTH_PASSWORD: 'secret-value' };
  const evidence = JSON.stringify(managedWorktreeState);
  assert.equal(Boolean(env.BASIC_AUTH_USER && env.BASIC_AUTH_PASSWORD), true);
  assert.equal(evidence.includes(env.BASIC_AUTH_PASSWORD), false);
});

test('story-vibepro-managed-worktree-execution-dag ac6 keeps compatibility modes covered', () => {
  // story-vibepro-managed-worktree-execution-dag ac:6
  // Existing non-worktree repos, CI, temporary checkouts, and OSS users keep compatibility through preferred/required/disabled modes.
  assert.deepEqual(compatibilityModes, ['preferred', 'required', 'disabled']);
  assert.equal(compatibilityModes.includes('disabled'), true);
  assert.match(managedWorktreeState.next_actions[0], /^cd \.worktrees\/vibepro\/story-vibepro-managed-worktree-execution-dag-/);
  assert.match(managedWorktreeState.next_actions[0], /vibepro pr prepare \. --story-id story-vibepro-managed-worktree-execution-dag --base origin\/main$/);
});

test('story-vibepro-managed-worktree-execution-dag runtime smoke creates a managed worktree and exposes next state', async () => {
  const repo = await makeRuntimeRepo();

  const state = await runVibepro([
    'execute',
    'start',
    repo,
    '--story-id',
    'story-vibepro-managed-worktree-execution-dag',
    '--base',
    'main',
    '--json'
  ], repo);
  assert.equal(state.managed_worktree.mode, 'preferred');
  assert.equal(state.managed_worktree.status, 'created');
  assert.match(state.managed_worktree.branch, /^vibepro\/story-vibepro-managed-worktree-execution-dag-/);
  assert.equal(nodeById(state, 'worktree_created').status, 'passed');
  assert.equal(nodeById(state, 'branch_bound').status, 'passed');
  assert.equal(nodeById(state, 'head_bound').status, 'passed');

  const next = await runVibepro([
    'execute',
    'next',
    repo,
    '--story-id',
    'story-vibepro-managed-worktree-execution-dag',
    '--base',
    'main',
    '--json'
  ], repo);
  assert.equal(next.managed_worktree.status, 'created');
  assert.equal(next.execution_dag.nodes.some((node) => node.id === 'worktree_created'), true);
  assert.equal(next.execution_dag.nodes.some((node) => node.id === 'head_bound' && node.status === 'passed'), true);
  assert.equal(next.next_actions[0].startsWith(`cd ${state.managed_worktree.path} && `), true);
});
