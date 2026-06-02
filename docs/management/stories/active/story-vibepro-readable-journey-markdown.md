---
story_id: story-vibepro-readable-journey-markdown
title: 読みやすいJourney Markdown
status: active
view: dev
horizon: month
period: 2026-06
architecture_docs:
  - ../../../architecture/vibepro-readable-journey-markdown.md
specs:
  - ../../../specs/vibepro-readable-journey-markdown.md
---

# 読みやすいJourney Markdown

## 背景

現在の `.vibepro/journey/latest-journey.md` は、Patton式の表と証跡を出せるが、Story ID、英語ラベル、証跡typeの羅列が主役になっている。これでは「今のJourneyは何か」「次に何を判断すべきか」を読む前に、内部表現を頭の中で翻訳する必要がある。

brainbase MCPで確認した佐藤圭吾向けの判断軸では、全量を見せるより先に判断できる構造、ID羅列ではなく意味のある日本語ラベル、次アクションまで出る構成が読みやすい。詳細証跡は消さず、監査ログとして下部に置く。

## 目的

`vibepro journey derive` / `vibepro journey map` が生成するMarkdownを、最初にプロダクトの現在地と次の判断が分かるJourneyとして読める形にする。

## 受け入れ基準

- Journey Markdownの先頭に `いまの結論` があり、最小体験、衝突、未配置Story、次に見るべき領域を日本語で要約する
- `現在の体験フロー` では、Story ID羅列ではなく、体験段階、状態、主なステップ、判断を表で表示する
- `リリーススライス` では、最小体験 / 次の成長領域 / 信頼性・品質強化を日本語の正ラベルとして表示する
- `次の判断` では、最小体験不足、Journey衝突、未配置Story、次の成長領域の空欄などに応じた次アクションを表示する
- Story ID、証跡type、検証証跡などの詳細は消さず、`監査ログ` 配下に下げる
- 既存のJourney JSON利用者が読む主要フィールドとPR prepareのJourney summaryは壊さない
