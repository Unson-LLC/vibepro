---
story_id: story-vibepro-review-token-accounting-closure
title: Review実トークンの記録を必須化しusage reportのtoken accountingを実データ化する
status: active
view: dev
period: 2026-07
category: quality
source:
  type: operator_feedback
  title: "usage report --subagent-roi のtoken合計が全件0で、証跡作成の無駄をトークンで証明も反証もできない"
related_stories:
  - story-vibepro-subagent-roi-audit
  - story-vibepro-cost-telemetry-residual-closure
  - story-vibepro-session-cost-attribution-hardening
  - story-vibepro-usage-report
reason: "alternatives considered: keep token flags optional (status quo keeps totals at zero), estimate tokens from artifact line counts (fabricates telemetry), or require actual token usage or an explicit not_provided reason at review record time; selected required-or-explicit-reason. compatibility impact: existing review records without token fields remain readable as legacy; review record gains a fail-closed validation only for new records. rollback plan: revert the review record validation and usage report aggregation change in one commit; recorded token fields remain valid data. boundary and scope: recording and aggregation only; this Story does not change review pass/block semantics, model policy, or cost budgets."
created_at: 2026-07-25
updated_at: 2026-07-25
---

# Review実トークンの記録を必須化しusage reportのtoken accountingを実データ化する

## Background

`vibepro review record` には `--agent-input-tokens` / `--agent-output-tokens` /
`--agent-total-tokens` / `--agent-cost-usd` が既に存在するが任意入力のため、
2026-07-01以降の77 reviewすべてでtoken合計が0のまま記録されている。
`usage report --subagent-roi` の `token_accounting_status` は `partial` に張り付き、
「証跡作成の無駄なトークンを削れたか」という最重要の問いに実データで答えられない。

## User Story

**As a** VibeProの証跡コストを実データで判断したい運用者
**I want** review recordがsubagentの実トークン消費（または未提供の明示理由）なしに新規記録を受理しないでほしい
**So that** usage reportのtoken集計が実測値になり、削減施策の効果をトークンで証明・反証できる

## Acceptance Criteria

- [ ] RTA-S-1: 新規の `review record` は、token実績（input/output/total）または `not_provided` 系の明示理由のどちらかを必須とし、どちらも無い記録をfail-closedで拒否する。既存記録は互換読取される。
- [ ] RTA-S-2: `review prepare` が生成するparallel-dispatch指示に、subagent実行結果からtoken実績を取得して `review record` へ渡す手順が含まれる。
- [ ] RTA-S-3: `usage report --subagent-roi` がtoken実績あり／明示未提供／legacy欠損を区別して集計し、実績が揃った範囲では `token_accounting_status` を `complete` と判定できる。
- [ ] RTA-S-4: 未提供理由は集計上 `unclassified` に混ざらず、story別・review別に追跡できる。

## Non Goals

- token数からのコスト推定・按分ロジックの新設（`session-cost` 系Storyの責務）。
- review pass/needs_changes/block判定条件の変更。
- 行数などからのtoken量の推定値による代替（実測が無いものを実測として扱わない）。
