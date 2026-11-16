# バグ修正フローへの移行

VibeProは、順序付きバグ診断DAGを完了判定の根拠として使いません。ノードの順序、証拠参照文字列、Git HEAD、同じ経路IDから確認できるのは内部整合性までで、元の利用者問題、本番経路、下流実行、正本側readbackは証明できないためです。

## 現在のフロー

Storyの契約種別を登録し、最小構成の Story → Spec → コード → 検証 → 軽量Review → PR を使います。

```bash
vibepro story add . --id story-example-bug --title "障害を修正する" --contract-type bug_fix
vibepro story diagnose . --id story-example-bug --pre-architecture --run-graphify
vibepro verify .
vibepro pr prepare . --base main
```

`story diagnose` は一般的な調査コマンドとして残ります。根本原因DAGの作成や認定は行いません。

`bug`、`bug_fix`、`regression_fix` のStoryでは、`pr prepare` が `fix_scope` を出力します。

- `internal_output`、`downstream_outcome`、`canonical_readback` のすべてが `verified` になるまでは `status: partial_fix`
- 外部成果が未確認でも、`internal_output` が `verified` または verification evidence の信頼判定が `trusted` のときだけ `completion_claim: implementation_verified_external_outcome_unknown`
- 外部成果が未確認で、`internal_output` も `verified` ではなく verification evidence の信頼判定も `trusted` ではないときは `completion_claim: implementation_unverified_external_outcome_unknown`
- 上の3段階がすべて `verified` のときは `status: user_outcome_fix`、`completion_claim: user_outcome_verified`
- 元の問題、影響するoutcome stage、確認済み・未確認の境界をPR証拠の近くに表示

ローカルテストで確認できるのは実装段階までです。それだけでは、本番の同経路結果や受信側readbackを確定できません。外部フローでは [Issue #507](https://github.com/Unson-LLC/vibepro/issues/507) のterminal receipt契約を使います。

## 既存artifactの扱い

`vibepro bug diagnose record` と `vibepro verify-first` は削除しました。既存の `.vibepro/bug-diagnosis/...` と `.vibepro-store/.../bug-diagnosis/...` は履歴として読める状態を保ち、書き換えや削除はしません。

過去のartifactは次のように扱います。

- `ready`、`root_cause_confirmed`、`same_path_reverified`、`verified_complete` は廃止済み構造モデルの状態にすぎません。
- 現在の根本原因確定や利用者問題の解決を承認する根拠にはしません。
- 現行VibeProでPR準備を再生成し、`fix_scope` と未確認境界を明示します。
