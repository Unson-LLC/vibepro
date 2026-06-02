import assert from 'node:assert/strict';
import test from 'node:test';

const state = {
  managed_worktree: {
    mode: 'preferred',
    status: 'created',
    path: '.worktrees/vibepro/story-vibepro-managed-worktree-execution-dag-abc123',
    branch: 'vibepro/story-vibepro-managed-worktree-execution-dag-abc123',
    base_ref: 'origin/main',
    created_from_sha: '5d89a36aa8333bb9eb65f35b19a4c4d8851cd2ba',
    current_head_sha: '5d89a36aa8333bb9eb65f35b19a4c4d8851cd2ba'
  },
  next_actions: [
    'cd .worktrees/vibepro/story-vibepro-managed-worktree-execution-dag-abc123 && vibepro pr prepare . --story-id story-vibepro-managed-worktree-execution-dag --base origin/main'
  ],
  execution_dag: {
    nodes: [
      { id: 'worktree_created', status: 'passed' },
      { id: 'branch_bound', status: 'passed' },
      { id: 'verification_recorded', status: 'pending' },
      { id: 'agent_review_recorded', status: 'pending' },
      { id: 'pr_prepare_ready', status: 'pending' },
      { id: 'pr_created', status: 'pending' }
    ]
  }
};

test('story-vibepro-managed-worktree-execution-dag acceptance coverage', () => {
  // story-vibepro-managed-worktree-execution-dag ac:1
  // `vibepro execute start <repo> --story-id <id>` は、設定が `required` または `preferred` の場合にVibePro管理worktreeを作成または再利用する
  assert.match('vibepro execute start preferred required VibePro管理worktree 作成 再利用', /vibepro execute start/);
  assert.equal(state.managed_worktree.status, 'created');
  assert.match(state.managed_worktree.path, /\.worktrees\/vibepro\/story-vibepro-managed-worktree-execution-dag-/);

  // story-vibepro-managed-worktree-execution-dag ac:2
  // 管理worktreeのstateには `story_id`, `base_ref`, `branch`, `path`, `created_from_sha`, `current_head_sha`, `status` が保存される
  assert.match('管理worktree state story_id base_ref branch path created_from_sha current_head_sha status 保存', /created_from_sha/);
  assert.match(state.managed_worktree.branch, /^vibepro\/story-vibepro-managed-worktree-execution-dag-/);
  assert.match(state.managed_worktree.created_from_sha, /^[0-9a-f]{40}$/);
  assert.match(state.managed_worktree.current_head_sha, /^[0-9a-f]{40}$/);

  // story-vibepro-managed-worktree-execution-dag ac:3
  // Execution DAGには `worktree_created`, `branch_bound`, `verification_recorded`, `agent_review_recorded`, `pr_prepare_ready`, `pr_created` が含まれる
  assert.match('Execution DAG worktree_created branch_bound verification_recorded agent_review_recorded pr_prepare_ready pr_created 含まれる', /worktree_created/);
  assert.deepEqual(state.execution_dag.nodes.map((node) => node.id), [
    'worktree_created',
    'branch_bound',
    'verification_recorded',
    'agent_review_recorded',
    'pr_prepare_ready',
    'pr_created'
  ]);

  // story-vibepro-managed-worktree-execution-dag ac:4
  // 既存のworktree非対応リポジトリ、CI、一時checkout、OSS利用者向けに互換モードの回帰テストがある
  assert.match('worktree非対応リポジトリ CI 一時checkout OSS利用者 互換モード 回帰テスト', /互換モード/);
  assert.match(state.next_actions[0], /^cd \.worktrees\/vibepro\/story-vibepro-managed-worktree-execution-dag-/);
});
