---
story_id: story-vibepro-managed-worktree-policy-resync
title: Managed Worktree Policy Resync Spec
status: final
parent_design:
  - vibepro-managed-worktree-policy-resync
---

# Managed Worktree Policy Resync Spec

機械可読の正本は `.vibepro/spec/story-vibepro-managed-worktree-policy-resync/spec.json`。本docはそのhuman-readableミラー。

## Contract

- **S-001**: `refreshManagedWorktree()` は、worktreeが存在する場合に親repo（`managed_worktree.source_repo`、なければ引数repoRoot）の `.vibepro/config.json` からポリシーセクション `budgets` / `execution` / `artifact_routing` / `output` をworktreeのconfigコピーへ再同期する。
- **S-002**（invariant）: 非ポリシーセクション（`brainbase` story catalog等）は再同期で上書きされず、worktree作成時のスナップショットのまま維持される。
- **S-003**: 親configでポリシーセクション配下の値が削除された場合、次のrefreshでworktreeコピーからも削除される（mirror semantics。片方向: 親→worktreeのみ、書き戻しなし）。
- **S-004**: refresh結果は `policy_sync` フィールド（status: `synced` / `unchanged` / `skipped` / `failed` + `sections_updated`）を持ち、execution state経由で監査できる。親configの欠如・破損はrefresh全体を失敗させない（fail-soft）。同期イベントは同期時点でworktree側 `.vibepro/policy-sync.json` へ永続スタンプされ、後続refresh（同一コマンド内のgate check→reconcileの合成フロー含む）でも `policy_sync.last_event` として監査可能に残る。
- **S-005**（scenario）: worktree内部からrefreshが呼ばれた場合（repoRoot=worktreeパス）でも `source_repo` を親として同期する。source pathとworktree pathが同一checkoutへ解決される場合は `skipped` へ遷移し、self-syncしない。
- **S-006**（scenario）: contract testが配布シナリオを固定する: worktree作成後に親へ追加した `budgets.delivery_efficiency` がrefreshで届く / 2回目のrefreshは `unchanged` / セクション削除がミラーされる。

## Inherited behaviors（unchanged）

- `ensureManagedWorktree()` 作成/再利用時の `copyWorkspaceControlFiles()` による全量コピー。
- user dirty fingerprintの `.vibepro` 除外（再同期されたtracked configコピーは `raw_dirty` にのみ現れる）。

## Code references

- `src/managed-worktree.js` — `syncWorktreePolicySections()` / `POLICY_CONFIG_SECTIONS` / `policy_sync` / `recordPolicySyncEvent()`
- `test/managed-worktree-policy-resync.test.js` — contract tests（6件）
- `test/e2e/story-vibepro-managed-worktree-policy-resync-main.test.js` — 合成フロー（gate check→reconcile）のaudit e2e

## Diagrams

policy resync flow / `policy_sync` state transitions / threat model は spec.json の `diagrams[]`（D-001〜D-003）を正本とする。
