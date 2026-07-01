---
story_id: story-vibepro-single-pass-senior-judgment-card
title: senior judgmentを一枚のdecision cardに要約する
view: dev
period: 2026-07
parent_design: vibepro-single-pass-senior-judgment-card
architecture_docs:
  - docs/architecture/vibepro-single-pass-senior-judgment-card.md
spec_docs:
  - docs/specs/vibepro-single-pass-senior-judgment-card.md
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
---

# senior judgmentを一枚のdecision cardに要約する

## 背景

senior-gap artifactは情報量が増えたが、handoff先が「今mergeしてよいか」を一読で判断するには長い。

## 受け入れ基準

- [ ] `senior-gap-judgment.json` が `decision_card` を持つ
- [ ] cardにhead binding、artifact value、session attribution、blocking/residual riskが出る
- [ ] markdown summaryがcardの主要状態を表示する
