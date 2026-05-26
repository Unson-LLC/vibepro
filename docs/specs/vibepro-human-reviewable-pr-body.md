---
story_id: story-vibepro-human-reviewable-pr-body
title: Human-reviewable PR body spec
---

# Human-reviewable PR body spec

## Requirements

- `vibepro pr prepare` MUST render `## このPRで決めたいこと` before `## 概要`.
- The decision brief MUST include Story, human merge decision, review entry points, Gate status, scope decision, and changed file count.
- The decision brief MUST include a human review question labeled `このPRで閉じる問い` before raw Story/Gate details.
- The decision brief MUST render `### 判断グラフ` with purpose, source of truth, changed surfaces, gate evidence digest, and split decision digest.
- The human-facing top section MUST render `## 変更内容`, `## なぜこの変更か`, `## レビューしてほしい観点`, `## 検証`, `## リスク・確認事項`, and `## 明示的にやらないこと` before `## 監査ログ`.
- The PR body MUST render a reviewer-oriented change map with Runtime, Contract Docs, Capability Map, Tests, and Repo Control categories when applicable.
- The PR body MUST render explicit non-goals so reviewers can keep the review scope narrow.
- The PR body MUST keep Gate DAG, Gate Enforcement, Agent Review, split plan, and evidence sections available as audit logs.
- Gate DAG, Gate Enforcement, Agent Review, Explore Evidence, split plan, and runtime metadata MUST render after `## 監査ログ`.
- The human-facing top section MUST NOT expose raw internal scope labels such as `needs_clean_branch`; it MUST translate them into an actionable reviewer decision.
- The human-facing top section SHOULD translate `split_recommended` into whether the current PR can still be reviewed or whether split/scope explanation is required.
- Verification commands MUST render `[x]` only when the matching Gate status is `passed` or `pass`.
- Verification commands with missing, failed, stale, or needs-evidence Gates MUST remain unchecked.

## Non-goals

- VibePro does not auto-waive failed or missing Gates.
- VibePro does not hide scope or split warnings.
- VibePro does not require product-specific vocabulary to produce a reviewable PR body.
