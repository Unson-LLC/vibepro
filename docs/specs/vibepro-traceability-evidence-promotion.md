---
story_id: story-vibepro-traceability-evidence-promotion
title: Traceability Evidence Promotion Spec
---

# 仕様

## 必須挙動

- `vibepro pr prepare` は traceability.json 書込時に `story_doc_path` を `prContext.story_source.path` から設定する（解決できない場合は既存値を保持）。
- `vibepro pr prepare` は同 stage で生成した pr-body.md と gate-dag.json への workspace 相対パス参照を `evidence[]` に `{type: "pr_artifact", ref, summary}` として追加する。verification-evidence.json は存在する場合のみ追加する。
- `vibepro execute merge` は merge 成功時（pr-merge.json を status merged で書く経路）に traceability.json を `lifecycle: merged` / `source: execute_merge` へ更新し、`evidence[]` に `{type: "pr_merge", ref: <pr-merge.jsonパス>, summary: <PR URL を含む>}` を追加する。
- `execute merge --dry-run` と precondition 停止（blocked）は traceability.json を変更しない。
- 両書込点で `created_at` と既存 `evidence[]` を保持し、同一 type+ref の evidence を重複追加しない（buildTraceability の既存重複排除を利用）。
- `merged` を `TRACEABILITY_LIFECYCLES` に追加する。`DECLARABLE_LIFECYCLES` には追加しない（trace declare で merged を宣言できない）。
- 既存の autobind / backfill / usage report の挙動を変更しない。

## 非目標

- 過去 story の traceability.json の遡及修正。
- evidence への内容ハッシュ付与。
- pr create 時点での evidence 接続。
