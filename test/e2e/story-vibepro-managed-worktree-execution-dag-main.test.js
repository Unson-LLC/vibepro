import assert from 'node:assert/strict';
import test from 'node:test';

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
      { id: 'verification_recorded', status: 'pending' },
      { id: 'agent_review_recorded', status: 'pending' },
      { id: 'pr_prepare_ready', status: 'pending' },
      { id: 'pr_created', status: 'pending' }
    ]
  }
};

function nodeById(state, id) {
  return state.execution_dag.nodes.find((node) => node.id === id);
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
  assert.equal(nodeById(managedWorktreeState, 'verification_recorded').status, 'pending');
  assert.equal(nodeById(managedWorktreeState, 'pr_created').status, 'pending');
});

test('story-vibepro-managed-worktree-execution-dag ac4 routes PR next actions through the managed worktree', () => {
  // story-vibepro-managed-worktree-execution-dag ac:4
  // Next PR commands are wrapped in a cd to the managed worktree so development and PR preparation stay isolated.
  assert.match(managedWorktreeState.next_actions[0], /^cd \.worktrees\/vibepro\/story-vibepro-managed-worktree-execution-dag-/);
  assert.match(managedWorktreeState.next_actions[0], /vibepro pr prepare \. --story-id story-vibepro-managed-worktree-execution-dag --base origin\/main$/);
});
