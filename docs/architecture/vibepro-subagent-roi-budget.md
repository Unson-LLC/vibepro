---
title: Subagent ROI Budget Architecture
story_id: story-vibepro-subagent-roi-budget
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
related_stories:
  - story-vibepro-subagent-roi-budget
---

# Subagent ROI Budget Architecture

## Goal

レビューartifactを増やす前に、追加subagentが本当に判断を改善するかをVibePro artifact上で明示する。

## Decision

- `decision_card.subagent_review_budget` が推奨アクションを返す
- blocking gapがあればtargeted subagent、traceabilityが弱ければtraceability subagentを選ぶ
- artifact value ledgerがありblocking gapがなければ `no_subagent_needed` を許可する
- session attributionが欠けていて他に強い理由がなければ、subagentより先にcost attributionを促す

## Non-goals

- subagent起動数のグローバル上限管理
- review scoreの貨幣換算
