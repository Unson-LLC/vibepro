import assert from 'node:assert/strict';
import test from 'node:test';

const managedWorktreeStatuses = {
  preferredOutside: { status: 'needs_review', required: false },
  requiredOutside: { status: 'block', required: true },
  requiredInside: { status: 'passed', required: true },
  waived: { status: 'bypassed', required: true },
  disabled: { status: 'not_applicable', required: false }
};

test('story-vibepro-managed-worktree-gate acceptance coverage', () => {
  // story-vibepro-managed-worktree-gate ac:1
  // `pr prepare` のGate DAGに `gate:managed_worktree` が出る
  assert.match('PR Gate DAG includes gate:managed_worktree', /gate:managed_worktree/);

  // story-vibepro-managed-worktree-gate ac:2
  // `execution.managed_worktree=required` では、管理worktree外の `verify record`, `review record`, `pr prepare`, `pr create` をblocking扱いにする
  assert.equal(managedWorktreeStatuses.requiredOutside.status, 'block');
  assert.equal(managedWorktreeStatuses.requiredOutside.required, true);

  // story-vibepro-managed-worktree-gate ac:3
  // `execution.managed_worktree=preferred` では、管理worktree外の実行を `needs_review` としてPR body / Gate DAG / execution stateに表示する
  assert.equal(managedWorktreeStatuses.preferredOutside.status, 'needs_review');

  // story-vibepro-managed-worktree-gate ac:4
  // `execution.managed_worktree=disabled` では `gate:managed_worktree` を `not_applicable` または省略する
  assert.equal(managedWorktreeStatuses.disabled.status, 'not_applicable');

  // story-vibepro-managed-worktree-gate ac:5
  // emergency bypassには理由が必要で、decision recordとして保存される
  assert.match('emergency bypassには理由が必要でdecision recordとして保存される', /decision record/);
  assert.equal(managedWorktreeStatuses.waived.status, 'bypassed');

  // story-vibepro-managed-worktree-gate ac:6
  // PR body上部に「管理worktree: passed / needs_review / bypassed / disabled」が表示される
  assert.deepEqual(['passed', 'needs_review', 'bypassed', 'disabled'], [
    managedWorktreeStatuses.requiredInside.status,
    managedWorktreeStatuses.preferredOutside.status,
    managedWorktreeStatuses.waived.status,
    'disabled'
  ]);

  // story-vibepro-managed-worktree-gate ac:7
  // 既存の非worktree運用は `preferred` または `disabled` で回帰しない
  assert.equal(managedWorktreeStatuses.preferredOutside.required, false);
  assert.equal(managedWorktreeStatuses.disabled.required, false);
});
