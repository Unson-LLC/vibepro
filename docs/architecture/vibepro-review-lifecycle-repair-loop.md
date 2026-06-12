---
story_id: story-vibepro-review-lifecycle-repair-loop
title: Review Lifecycle Repair Loop Architecture
---

# アーキテクチャ

## 判断

review credibility の回復は「結果を直す」ことではなく「再レビューへの導線を決定的に生成する」ことで行う。repair は read-only の分析と plan artifact の生成に限定し、review 結果や summary の status には一切触れない。これにより修復ループ自体が新たな fake-value（自動 pass 化）の経路になることを構造的に防ぐ。検出語彙は agent-review の effective_status（missing / stale / timed_out / unverified_agent 等)と usage report の incomplete-evidence 判定を共有し、検出器と修復器の判定がズレないようにする。

## 入力

- `.vibepro/reviews/<story-id>/<stage>/review-summary.json`（roles の status / effective_status / provenance_status / agent_provenance.lifecycle）
- usage report の incomplete review evidence 判定ロジック（getIncompleteReviewEvidenceReason を共有）

## 出力

- `vibepro review repair` の修復候補一覧（human-readable / `--json`）
  - 候補 = `{story_id, stage, role, reason, action, next_commands[]}`
- `.vibepro/reviews/<story-id>/<stage>/repair-plan.json`（`--dry-run` 時は書かない）
- usage report の `traceability_incomplete_review_evidence` gap の next_command が repair コマンドへ接続される

## 境界

- repair は review-result / review-summary / lifecycle artifact を書き換えない（plan の追加のみ）
- subagent の自動起動はしない。dispatch は coordinator runtime（人間または agent セッション）の責務
- stale の再レビューは現在 head での再実行を提案するのみで、旧結果の有効性を主張しない
