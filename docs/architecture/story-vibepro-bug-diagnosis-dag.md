---
story_id: story-vibepro-bug-diagnosis-dag
title: "バグ診断DAG廃止記録"
status: retired
created_at: 2026-08-16
updated_at: 2026-09-17
---

# バグ診断DAG廃止記録

## 判断

順序付きバグ診断DAGを、実行計画、PR準備、CLI、完了判定から削除した。ローカルな構造整合性から、元の利用者問題の根本原因や外部成果の完了までを強く主張できたためである。

## 現在の責務境界

- `contract_type` はバグ修正Storyの分類と表示に使う。
- 実装・ローカルテストの証拠は内部段階の確認として扱う。
- 下流実行と正本側readbackが確認されるまでは `partial_fix` とする。
- PR準備は `fix_scope` に元の問題、影響段階、確認済み・未確認境界を表示する。
- 外部フローの完了はterminal receiptで確認し、文字列参照やローカルHEADを代用しない。

## 互換性

既存のバグ診断artifactとプロセス記録は履歴として保持する。旧artifact内の `ready` や強い状態名は、現在の完了権限として読み込まない。旧CLI入口と診断モジュールは削除し、新しいDAGや移行用gateは追加しない。
