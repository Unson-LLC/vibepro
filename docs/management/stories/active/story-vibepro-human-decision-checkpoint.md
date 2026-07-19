---
story_id: story-vibepro-human-decision-checkpoint
parent_design:
  - vibepro-autonomy-roadmap-rebaseline
  - vibepro-human-decision-checkpoint
vibepro_story_id: story-vibepro-autonomy-roadmap-rebaseline
title: 実行を止める重要判断だけを永続化して再開するHuman Checkpoint
status: active
view: dev
period: 2026-07
category: product
source:
  type: operator_feedback
  title: "自律実行中に本当に必要な質問だけを受け、回答後に同じRunを再開したい"
related_stories:
  - story-vibepro-guarded-run-session-contract
  - story-vibepro-safe-action-orchestrator
  - story-vibepro-next-best-action-controller
  - story-vibepro-human-review-override
  - story-docs-story-ssot-recovery
reason: "alternatives considered: expose every scanner question, keep decisions only in chat context, or persist only material execution-blocking decisions as typed checkpoints; selected typed checkpoints. compatibility impact: existing Story, Spec, decision record, and manual waiver flows remain valid; new decision artifacts reference them instead of replacing them. rollback plan: fall back to stopped runs plus current manual commands. boundary and scope: Brainbase remains the upstream source of intent, context, and knowledge; VibePro consumes that handoff and asks only downstream execution-blocking clarifications. critical gates cannot be waived by this flow, and merge approval is not automated. accepted followups: runtime adapters will pause and resume through this contract."
created_at: 2026-07-15
updated_at: 2026-07-15
---

# 実行を止める重要判断だけを永続化して再開するHuman Checkpoint

## User Story

**As a** 自律Runを監督するVibePro利用者
**I want** 仕様・権限・splitなど結果を変える判断だけを質問され、回答後に同じRunを再開したい
**So that** 細かな確認で止まらず、重要判断の根拠は監査可能に残る

## Scope

- Pre-Spec、Gate、Action policyの候補から、実行を止めるmaterial questionだけを集約する。
- `.vibepro/executions/<story-id>/runs/<run-id>/decisions/<decision-id>.json`へ質問、選択肢、根拠、回答者、HEAD、関連artifactを保存する。
- `waiting_for_human`と`execute resume --decision <id> --answer ...`を結ぶ。
- 回答がStory/Spec/decision recordのどこへ反映されたかをtraceできるようにする。
- 古いHEAD、別Run、解決済みdecisionへの重複回答を拒否する。

## Acceptance Criteria

- [ ] HDC-S-1: 同じ根拠から派生した質問は重複排除され、material reasonと影響範囲を伴う。
- [ ] HDC-S-2: `clarification`、`scope_split`、`waiver_request`、`external_side_effect`、`security_boundary`を型付きdecisionとして扱う。
- [ ] HDC-S-3: 回答待ちRunは副作用を開始せず、回答後は停止nodeをRun cursorとして永続化し、次のorchestrationがそのnodeから再開してcursorを消費する。
- [ ] HDC-S-4: critical gateのwaiver回答は受理せず、evidence、split、blockを要求する。
- [ ] HDC-S-5: Brainbase由来handoffがある場合、VibeProはその参照を保持し、上流意図を独自に再定義しない。
- [ ] HDC-S-6: 回答と反映先がdecision indexおよびRun journalから再構成でき、indexの部分失敗はdecision artifactから自己修復できる。
- [ ] HDC-S-7: duplicate、stale HEAD、cancelled Run、invalid decision typeのテストがある。

## 依存関係・完了順

ロードマップの5番目。Run契約、Action Orchestrator、Meta Controller完了後に実装し、Agent Runtimeが共通利用する停止・再開境界を作る。

## Non Goals

- Brainbaseの代わりにプロダクト戦略や長期記憶を管理すること。
- 低リスク操作ごとの逐次許可。
- critical gateやmerge判断の自動承認。
- Human Review Overrideの発行や、PR・merge判断の承認。
