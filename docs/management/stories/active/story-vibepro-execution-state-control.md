---
story_id: story-vibepro-execution-state-control
title: VibePro execution state should close AI work without Codex goal dependence
architecture_docs:
  - docs/architecture/vibepro-execution-state-control.md
spec_docs:
  - docs/specs/vibepro-execution-state-control.md
---

# Story: VibePro execution state should close AI work without Codex goal dependence

## 背景

Codexでは goal 機能が「PR作成まで続ける」という終端条件を保持しているため、VibeProのGateと相性がよい。一方でClaude Codeでは会話文脈やSkillに依存しやすく、中断後に次のGateや完了条件を復元しにくい。

## 目的

VibePro自身がStory単位の実行状態を持ち、Codex/Claude Codeのどちらでも次にやるべきGate、レビュー、PR作成可否を復元できるようにする。

## 受け入れ基準

- `vibepro execute start/status/next/reconcile` でStory単位の実行状態を扱える。
- 実行状態は `.vibepro/executions/<story-id>/state.json` に保存される。
- `verify record`, `review prepare/status/record`, `pr prepare`, `pr create` 後に状態を再計算できる。
- `pr prepare` 未実行時は次アクションとして `vibepro pr prepare` を示す。
- Agent Review Gateで止まっている時は、subagent reviewのprepare/record/closeを次アクションとして示す。
- `ready_for_pr_create` になったら次アクションとして `vibepro pr create` を示す。
- PR作成済みの場合は `completion_status=pr_created` とPR URLを保存する。
- 既存の `pr prepare`, `review`, `verify` 出力互換を壊さない。
