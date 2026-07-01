---
title: Artifact Value Ledger Architecture
story_id: story-vibepro-artifact-value-ledger
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
related_stories:
  - story-vibepro-artifact-value-ledger
---

# Artifact Value Ledger Architecture

## Goal

VibeProが生成するartifactを、量ではなく判断への寄与で監査できるようにする。

## Decision

- `buildEvidenceReuse` が `artifact_value_ledger` を生成する
- ledger entryはcanonical PR artifact、consumer、supported decision、head bindingを保持する
- `buildSeniorGapJudgment` はledger summaryを `cost_context` と `decision_card` に露出する
- `usage report` はdecision-bound countとlinked consumer countを集計する

## Non-goals

- artifact本文全文の再保存
- LLMによるsemantic scoringの追加
