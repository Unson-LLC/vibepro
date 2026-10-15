---
story_id: story-vibepro-disposition-reviewed-by
title: judgment disposition record が --reviewed-by を保存しない
status: active
contract_type: bug_fix
artifact_profile: feature_packet
feature_slug: disposition-reviewed-by
source:
  type: ledger_requirement
  id: "263f2678"
reason: judgment disposition record は人の判断を記録するコマンドだが、--reviewed-by を読まず、disposition JSON に reviewed_by を残さない。--recorded-by と既存レコードの形は維持し、空の --reviewed-by はレビュー担当として保存しない。
---

# Story

ローカルCLIの `judgment disposition record` を使う開発者として、人が判断を記録したときの `--reviewed-by` を disposition record に残したい。

台帳要件 ID は `263f2678`。この ID の台帳本文は、このリポジトリ、GitHub、Google Drive からは取得していない。受け入れ条件は依頼で示された不具合と境界から書く。

## Acceptance Criteria

- DRB-AC-001: `--reviewed-by` に非空の文字列を渡すと、disposition record の `reviewed_by` に trim 後の値を保存する。前後の空白は除く。日本語を含む値もそのまま保存する。
- DRB-AC-002: `--reviewed-by` が無い、空文字、空白のみ、または値なしで引数の末尾にあるとき、コマンドはエラーにせず成功し、`reviewed_by` は null になる。値なしの末尾フラグは無視する。`--recorded-by` が無いときの `recorded_by: "unknown"` は維持する。
- DRB-AC-003: `reviewed_by` キーを持たない既存 disposition record を、`judgment status` と `judgment outcome record` がエラーにせず読める。
- DRB-AC-004: この変更は disposition JSON へのフィールド追加に限り、データベースは追加しない。
- DRB-AC-005: applicability が記録済みの `judgment outcome record` が `--human-decision` または `--effect` とともに disposition を書くとき、非空の `--reviewed-by` は disposition JSON の `reviewed_by` に保存される。

## Boundary

- `--reviewed-by` を必須にはしない。
- `--recorded-by` の意味は変えない。
- 既存レコードを書き戻して `reviewed_by` を補完しない。
- 値のない `--reviewed-by` を引数の末尾に置いたときはエラーにしない。値は渡されなかったものとして扱い、`reviewed_by` は null になる。
- 佐藤さんの承認は、この Story の登録時点では未取得。
