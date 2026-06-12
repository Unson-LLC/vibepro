---
story_id: story-vibepro-traceability-evidence-promotion
title: Traceability Evidence Promotion Architecture
---

# アーキテクチャ

## 判断

traceability.json は宣言（lifecycle）と証拠（evidence）の両方を持つ設計だが、これまで書き手（pr prepare / execute merge）が証拠側を埋めていなかった。修正は新しい artifact を増やすのではなく、既存の 2 つの lifecycle 書込点に「その時点で実在する artifact への参照」を接続する。evidence は実在確認済みのパス参照のみとし、buildTraceability の type+ref 重複排除で再実行に対して冪等にする。merge の lifecycle 遷移は実際に merged になった後（pr-merge.json 書込と同じ経路）に限定し、dry-run / precondition 停止では何も書かない。

## 入力

- `prContext.story_source.path`（pr prepare 時の story doc 解決結果）
- pr prepare が同 stage で書く実 artifact（pr-body.md / gate-dag.json）と、存在する場合の verification-evidence.json
- execute merge の merge 成功結果（pr-merge.json パス、PR URL、merge commit）

## 出力

- `.vibepro/pr/<story-id>/traceability.json` の昇格:
  - `story_doc_path`: workspace 相対の story doc パス
  - `evidence[]`: `{type: "pr_artifact", ref, summary}` × 生成 artifact、merge 後は `{type: "pr_merge", ref, summary}` を追加
  - `lifecycle`: prepare 時 `in_progress` → merge 成功時 `merged`（source: `execute_merge`）
- `TRACEABILITY_LIFECYCLES` に `merged` を追加（`trace declare` の宣言可能集合には含めない）

## 境界

- 過去 story への遡及書換はしない。次に prepare / merge が走った story から自然に昇格する
- evidence への接続は「その実行で実在を確認できた artifact」のみ。存在しないパスを予約的に書かない
- dry-run / blocked merge は traceability に触れない（merge していないのに merged を宣言する経路を作らない）
