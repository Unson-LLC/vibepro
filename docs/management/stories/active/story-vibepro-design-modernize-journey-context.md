---
story_id: story-vibepro-design-modernize-journey-context
title: "Design ModernizeからJourney Contextへ自然に接続する"
status: active
created_at: 2026-06-25
updated_at: 2026-06-25
architecture:
  - ../../../architecture/vibepro-design-modernize-journey-context.md
spec:
  - ../../../specs/vibepro-design-modernize-journey-context.md
---

# Story: Design ModernizeからJourney Contextへ自然に接続する

## 背景

VibeProの価値は、AI実装で暗黙になりがちなStory、導線、リスク、証跡、PR判断をGate DAGへ明示化することにある。

JourneyはUI modernize専用ではなく、Story / PR Gate / Split Plan / Agent handoffにも効くproduct contextである。一方で、UIを触る利用者にとっては `design-modernize plan` からJourney状態が自然に見えないと、導線確認が別機能に見えてしまう。

## ユーザー価値

UI modernizeを始める時点で、VibeProがJourney context packまたはcurated Journeyの状態を提示し、機械生成のhandoff contextをauthoritative Journeyとして誤用しない。

## 受け入れ条件

- [ ] `vibepro design-modernize plan` はJourney contextを確認し、未生成ならmachine-derived `journey_context_pack` とhandoff artifactを生成する
- [ ] Design Modernize plan JSON/Markdown/implementation specはJourney contextの `artifact_kind`, `curated`, `curation_status`, authorityを表示する
- [ ] Design Quality DAGは `design:journey_context` を入口gateとして持ち、current UI evidenceより前に接続する
- [ ] curated Journeyがない場合、Design Modernizeは機械生成handoffをauthorityにせず `needs_review` とnext commandを表示する
- [ ] 既存のDesign System導出、screen capture、PR Journey Context Gateの意味を壊さない
- [ ] clause IDを含むテストで挙動を固定する

## 実装範囲

- `src/design-modernize.js`
- `test/vibepro-cli.test.js`
- `README.md`
- `docs/architecture/vibepro-design-modernize-journey-context.md`
- `docs/specs/vibepro-design-modernize-journey-context.md`
