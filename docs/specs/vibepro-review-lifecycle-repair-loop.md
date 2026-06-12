---
story_id: story-vibepro-review-lifecycle-repair-loop
title: Review Lifecycle Repair Loop Spec
---

# 仕様

## 必須挙動

- `vibepro review repair <repo> [--story-id <id>] [--dry-run] [--json]` は `.vibepro/reviews/<story-id>/<stage>/review-summary.json` を走査し、修復候補を列挙する。
- 候補判定（role 単位）:
  - `effective_status: missing` → action `run_review`
  - `effective_status: stale`（または stale フラグ） → action `rerun_stale_review`
  - `effective_status: timed_out` → action `replace_timed_out_review`
  - `effective_status: unverified_agent`、または pass だが `provenance_status !== "verified_agent"` / provenance 欠損 → action `rerecord_with_provenance`
  - provenance はあるが `agent_provenance.lifecycle.agent_closed !== true` → action `close_and_rerecord`
  - pass + verified_agent + closed の role は候補にしない。
- 各候補は `{story_id, stage, role, reason, action, next_commands[]}` を持ち、next_commands は `vibepro review prepare`（stage/role 指定）、`vibepro review start`、`vibepro review record`（`--agent-system` / `--execution-mode parallel_subagent` / `--agent-id` / `--agent-closed` を含む）の順で並ぶ。
- 修復計画は story/stage ごとに `.vibepro/reviews/<story-id>/<stage>/repair-plan.json` へ書く。`--dry-run` は書かない。
- `review repair` は review-result / review-summary / lifecycle artifact の既存内容を変更しない。
- `vibepro usage report` の `traceability_incomplete_review_evidence` gap の next_command は `vibepro review repair . --story-id <story_id>` を指す。
- 検出ロジックは usage report の incomplete review evidence 判定（getIncompleteReviewEvidenceReason）を共有し、判定の二重実装をしない。

## 非目標

- review 結果の自動生成・自動 pass 化。
- repair plan からの subagent 自動起動。
- review-summary.json スキーマの変更。
