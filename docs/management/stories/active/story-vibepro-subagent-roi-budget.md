---
story_id: story-vibepro-subagent-roi-budget
title: subagentを増やす前にROI budgetを出す
view: dev
period: 2026-07
parent_design: vibepro-subagent-roi-budget
architecture_docs:
  - docs/architecture/vibepro-subagent-roi-budget.md
spec_docs:
  - docs/specs/vibepro-subagent-roi-budget.md
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
---

# subagentを増やす前にROI budgetを出す

## 背景

Engineering Judgment gateが弱いと、追加subagentとreview artifactを増やして安心感だけを作りやすい。

## 受け入れ基準

- [ ] senior judgment cardが `subagent_review_budget` を持つ
- [ ] blocking gapがある場合はtargeted subagentを推奨する
- [ ] ledgerとtraceabilityで判断可能な場合は `no_subagent_needed` を推奨する
- [ ] session cost帰属がない場合は、追加subagentより先にcost attributionを促す
