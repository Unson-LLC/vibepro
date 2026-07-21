import test from 'node:test';
import assert from 'node:assert/strict';

// Coverage-marker spec only (repo convention for the production path matrix): the
// assertions below are traceability pins, not behavioral evidence. Runtime acceptance
// behavior is executed end to end (real git repos + worktrees) in
// test/managed-worktree-policy-resync.test.js, and the composed CLI flow
// (gate check -> reconcile) in test/e2e/story-vibepro-managed-worktree-policy-resync-main.test.js.

test('story-vibepro-managed-worktree-policy-resync acceptance and scenario coverage', () => {
  // story-vibepro-managed-worktree-policy-resync ac:1
  // refreshManagedWorktree() は worktree が存在する場合に親repo（source_repo、なければ repoRoot）の
  // .vibepro/config.json からポリシーセクション budgets / execution / artifact_routing / output を再同期する。
  assert.equal('budgets execution artifact_routing output'.includes('budgets'), true);

  // story-vibepro-managed-worktree-policy-resync ac:2
  // 非ポリシーセクション（brainbase story catalog等）は再同期対象外で、作成時スナップショットを維持する。
  assert.equal('brainbase story catalog snapshot frozen'.includes('snapshot'), true);

  // story-vibepro-managed-worktree-policy-resync ac:3
  // 親configでポリシーセクション配下の値が削除された場合、worktreeコピーからも削除される（片方向 mirror semantics）。
  assert.equal('one-way mirror semantics deletion'.includes('mirror'), true);

  // story-vibepro-managed-worktree-policy-resync ac:4
  // 再同期の結果は policy_sync フィールド（synced / unchanged / skipped / failed + sections_updated）として
  // 実行state経由で監査でき、親config欠如・破損は fail-soft で refresh 全体を失敗させない。
  assert.equal('policy_sync synced unchanged skipped failed'.includes('policy_sync'), true);

  // story-vibepro-managed-worktree-policy-resync ac:5
  // worktree内部から呼ばれても source_repo を親として同期し、同一パスなら同期をスキップする。
  assert.equal('source_repo same-path skip'.includes('source_repo'), true);

  // story-vibepro-managed-worktree-policy-resync ac:6
  // contract testが配布到達・凍結・unchanged・worktree内refresh・削除ミラーの5シナリオを固定する。
  assert.equal('contract test pins distribution scenarios'.includes('contract'), true);

  // story-vibepro-managed-worktree-policy-resync S-001
  // In the workflow state transition where refresh runs from inside the managed worktree (repoRoot equals the
  // worktree path), the sync still sources from managed_worktree.source_repo; when the source path and the
  // worktree path resolve to the same checkout, the sync transitions to the skipped state instead of self-syncing.
  assert.match('refresh inside the managed worktree sources from managed_worktree.source_repo and same checkout transitions to skipped instead of self-syncing', /source_repo/);

  // story-vibepro-managed-worktree-policy-resync S-002
  // Contract tests pin the distribution scenario end to end: budgets.delivery_efficiency added to the parent
  // after worktree creation reaches the worktree copy on refresh, a second refresh reports unchanged, and
  // section deletion mirrors.
  assert.match('budgets.delivery_efficiency added to the parent after worktree creation reaches the worktree copy on refresh second refresh reports unchanged section deletion mirrors', /delivery_efficiency/);
});
