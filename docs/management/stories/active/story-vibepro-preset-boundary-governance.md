---
story_id: story-vibepro-preset-boundary-governance
title: "VibePro自己改善: generic診断から過去プロジェクト固有情報を排除する"
source:
  type: codex-log-audit
  id: VP-SELF-004
  title: "DialogAI診断にAitle由来の語彙が残る疑い"
architecture_docs:
  - ../../architecture/vibepro-self-dogfood-control-loop-architecture.md
spec_docs:
  - ../../specs/vibepro-self-dogfood-control-loop.md
status: active
created_at: 2026-05-16
updated_at: 2026-05-16
---

# Story: VibePro自己改善: generic診断から過去プロジェクト固有情報を排除する

## User Story

**As a** VibeProで複数プロダクトを診断するユーザー
**I want to** genericな診断・Story生成・Architecture提案に過去プロジェクト固有の語彙や前提が混ざらない
**So that** DialogAIのような別プロダクトでも、対象固有の文脈から正しくStoryとArchitectureを立ち上げられる

## Background

DialogAIの診断では、診断だけなら問題が見えにくい一方で、generic化が完全でなければAitleやホテル業務など過去プロジェクトの情報が混入する懸念があった。

一部修正済みだが、VibeProの目的である「StoryからArchitectureを出し、人間が確定したらAIへ任せる」を実現するには、presetとgeneratorの境界を明確にし、generic presetに固有情報が残らないことを継続検証する必要がある。

## Acceptance Criteria

- [ ] default / generic presetに、Aitle、ホテル、shadow-callなど特定プロジェクト固有語彙が含まれない
- [ ] project presetは明示選択された場合だけ有効になる
- [ ] Story生成、diagnosis、architecture suggestionの各出力に anti-leak fixture がある
- [ ] DialogAI、SalesTailor、空のNext.jsアプリなど異なる文脈で、対象外語彙が出ない回帰テストがある
- [ ] project-specificな学習結果は、generic defaultではなく名前付きpresetまたはrepo-local configに保存される

## Implementation Notes

- 対象候補: `src/story-catalog-generator.js`, `src/diagnostic-engine.js`, preset/config周辺
- 固有語彙の禁止は単純な単語リストだけでなく、出力根拠とpreset sourceを証跡化する
