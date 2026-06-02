---
story_id: story-vibepro-managed-worktree-gate
title: VibePro管理worktree Gate Spec
---

# 仕様

## 必須挙動

- `pr prepare` はGate DAGに `gate:managed_worktree` を含める。
- `execution.managed_worktree=required` かつ現在repoが記録済み `managed_worktree.path` の外側なら、Gate statusを `block`、requiredを `true` にする。
- `execution.managed_worktree=required` かつ現在repoが記録済み `managed_worktree.path` の内側なら、Gate statusを `passed` にする。
- `execution.managed_worktree=preferred` かつ管理worktree外なら、Gate statusを `needs_review`、requiredを `false` にする。
- `execution.managed_worktree=disabled` なら、Gate statusを `not_applicable`、PR本文表示を `disabled` にする。
- `decision record --type waiver --source gate:managed_worktree --status accepted` がある場合、Gate statusを `bypassed` にする。
- PR本文上部に `管理worktree: passed|needs_review|bypassed|disabled` のいずれかを表示する。
- `verify record` と `review record` は、`required` で管理worktree外なら証跡ファイル作成前に拒否する。
- `pr create` は `gate:managed_worktree` がrequiredかつ未解決ならcritical gateとして拒否する。

## 証跡

`gate:managed_worktree` は次を保持する。

- `mode`
- `current_repo`
- `managed_worktree_path`
- `branch`
- `decision_id`
- `reason`

## Decision record

Emergency bypassには理由が必要である。これは `decision record --type waiver` の既存仕様で強制する。VibeProは `source=gate:managed_worktree` かつ `status=accepted` のdecisionだけをlocality bypassとして扱う。

## 互換性

`preferred` と `disabled` は既存の非worktree運用を止めない。`preferred` は人間のPR判断に露出するため、管理worktreeへの移行を促せるが、既存CIや一時checkoutを即時破壊しない。

## 回帰テスト

- Unit/CLI: `test/vibepro-cli.test.js` の管理worktree gateテストで、preferred、disabled、required block、passed、waiverを検証する。
- Story E2E: `test/e2e/story-vibepro-managed-worktree-gate-main.test.js` と `.spec.ts` で受け入れ基準の文言カバレッジを持つ。
