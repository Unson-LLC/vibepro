---
title: Automation Handoff Signal Architecture
story_id: story-vibepro-automation-handoff-signal
status: active
created_at: 2026-06-30
updated_at: 2026-06-30
related_stories:
  - story-vibepro-automation-handoff-signal
---

# Automation Handoff Signal Architecture

## Goal

日次 value audit が canonical bundle本体を深掘りしなくても、
handoff replay の blocked 状態を `audit-index.json` と
`automation_value_audit` だけで判定できるようにする。

## Decision

- `promoteReferencedAuditArtifacts` の解決結果を `buildDecisionIndex` に渡し、
  handoff replay の集約状態を index 正本に持たせる
- replay bundle 圧縮ループは `currentAccountingSignature === previousAccountingSignature`
  になった時点で停止し、handoff signal をその安定後の会計スナップショットに束縛する
- `buildAutomationValueAuditContract` は handoff replay 状態を
  `value_signal_inputs` に露出し、blocked なら専用 finding を追加する
- full bundle / compact bundle の両方で同じ handoff signal を維持する

## Non-goals

- unresolved reference の自動修復
- handoff replay の詳細ログ全文を automation finding に複製すること
