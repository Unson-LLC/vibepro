---
story_id: story-vibepro-traceability-autobind-backfill
title: Traceability Autobind & Backfill Spec
---

# 仕様

## 必須挙動

- `vibepro story add` は story 登録成功時に `.vibepro/pr/<story-id>/traceability.json` を `lifecycle: declared_not_started`, `source: story_add` で生成する。
- `vibepro pr prepare` は成功時に traceability.json の `lifecycle` を `in_progress` に、`source` を `pr_prepare` に更新する。既存の `created_at` と `evidence[]` は保持する。
- `vibepro trace backfill <repo>` は story doc が存在し PR 実証跡（pr-prepare.json / pr-create.json / gate-dag.json / pr-merge.json）が無い Story を列挙し、各 Story を以下の優先順で分類して traceability.json を書く:
  - 他の git worktree（`git worktree list --porcelain`）の `.vibepro/pr/<story-id>/` に実証跡がある場合は `lifecycle: evidence_in_other_worktree`、`evidence[]` に `{type: "worktree_artifact", ref: <artifact-path>, summary: ...}` を記録する。
  - `git log --grep=<story-id>` で commit が見つかる場合は `lifecycle: merged_without_vibepro_evidence`、`evidence[]` に `{type: "git_log", ref: <sha>, summary: <subject>}` を記録する。
  - 証拠が無く story doc の status が明示的 unstarted（backlog/draft/planned/idea/proposed）の場合のみ `lifecycle: declared_not_started`。
  - それ以外（active/null、merged/closed/done 宣言なのに証拠なし等）は `lifecycle: unknown`。自動分類は「未着手」を推測で主張しない。
- `vibepro trace declare <repo> --story-id <id> --lifecycle declared_not_started|unknown [--reason <text>]` は操作者の明示宣言として traceability.json を `source: manual_declaration` で書き、`evidence[]` に `{type: "manual_declaration", summary: <reason>}` を記録する。
- `trace backfill --dry-run` は分類結果のみを出力し、ファイルを書かない。`--json` は機械可読出力を返す。
- `vibepro usage report` は traceability.json を kind `traceability` として収集するが、`traceability_missing_pr_artifact` の判定で「PR artifact あり」とは数えない。
- `usage report` の gap 判定:
  - `lifecycle: declared_not_started` → gap 除外、`value_signals.declared_unstarted_story_count` に加算。
  - `lifecycle: merged_without_vibepro_evidence` → gap 除外、`value_signals.merged_without_vibepro_evidence_story_count` に加算し story 別フラグ `merged_without_vibepro_evidence: true` を立てる。
  - `lifecycle: evidence_in_other_worktree` → gap 除外、`value_signals.evidence_in_other_worktree_story_count` に加算し story 別フラグ `evidence_in_other_worktree: true` を立てる。
  - `lifecycle: unknown` / `in_progress` / traceability.json なし → 従来どおり gap。
- 既存の `stale_evidence` / `story_source_mismatch` / `raw_pr_bypass_suspected` / 他の gap kind の挙動を変えない。

## 非目標

- pr-prepare.json 等の実証跡 artifact を自動生成すること。
- review evidence の自動修復。
- GitHub API による過去 PR 復元。
