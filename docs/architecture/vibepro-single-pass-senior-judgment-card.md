---
title: Single-Pass Senior Judgment Card Architecture
story_id: story-vibepro-single-pass-senior-judgment-card
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
related_stories:
  - story-vibepro-single-pass-senior-judgment-card
---

# Single-Pass Senior Judgment Card Architecture

## Goal

別engineer/agentが大量artifactを読む前に、現在のHEADに束縛された判断状態を一枚で確認できるようにする。

## Decision

- `buildSeniorGapJudgment` が `decision_card` を生成する
- cardは既存のgap decisionを再解釈せず、head/artifact/session/subagent budgetの集約だけを行う
- summary rendererはcardの主要状態を短い行で表示する

## Non-goals

- 既存gate decisionの上書き
- PR本文への全文展開
