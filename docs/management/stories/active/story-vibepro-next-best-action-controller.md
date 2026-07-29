---
story_id: story-vibepro-next-best-action-controller
parent_design: vibepro-autonomy-roadmap-rebaseline
vibepro_story_id: story-vibepro-autonomy-roadmap-rebaseline
title: 期待価値で次の一手を選ぶMeta Controller
status: active
view: dev
period: 2026-07
category: product
source:
  type: operator_feedback
  title: "トークン最小ではなくTrusted PR-readyまでの総コストで次のActionを選びたい"
related_stories:
  - story-vibepro-run-context-capsule
  - story-vibepro-safe-action-orchestrator
  - story-vibepro-evidence-cost-budget
  - story-vibepro-agent-runtime-metrics
reason: "alternatives considered: execute the first dependency-ready action, ask an LLM to reflect after every tool call, or rank typed candidate actions at material checkpoints using explicit value and cost factors; selected event-driven typed ranking. compatibility impact: the Safe Action registry and Gate DAG remain the authority for what may run, while the controller adds a recommendation and selection layer. rollback plan: disable ranking and return to dependency-order execution. boundary and scope: the controller chooses among already permitted actions and may choose ask, split, wait, or stop; it cannot create authority, waive gates, run forbidden commands, or expose hidden chain-of-thought. unknown time/token inputs remain unknown rather than zero. accepted followups: risk-adaptive validation sequencing and final hardening consume the decision records."
created_at: 2026-07-16
updated_at: 2026-07-19
---

# 期待価値で次の一手を選ぶMeta Controller

## User Story

**As a** Guarded Runを総コストで最適化したい利用者
**I want** 安全に実行可能な候補から、進捗・不確実性低減・リスク低減・証跡再利用に対して最も費用対効果の高いActionを選んでほしい
**So that** 安いだけの操作や高コスト検証の反復ではなく、Trusted PR-readyへ最短で近づける

## Scope

- typed Action registryからdependency-readyかつpolicy許可済みの候補だけを受け取る。
- 各候補にexpected progress、uncertainty reduction、risk reduction、evidence reuse、active time、wait time、token/cost、evidence invalidation、rework risk、confidenceを付与する。
- Run開始、material progress、failure、HEAD mutation、budget pressure、human/runtime wait、高コストAction直前にのみ再評価する。
- 選択結果を短いdecision recordとして保存し、採用候補、棄却候補、観測値、unknown、選択理由を監査可能にする。
- 実行継続だけでなく、`ask`、`split`、`wait`、`stop`を第一級Actionとして比較する。

## Acceptance Criteria

- [ ] NBA-S-1: Controllerはpolicyまたはdependencyで禁止されたActionを候補集合へ入れない。
- [ ] NBA-S-2: 候補評価は`expected_progress`、`uncertainty_reduction`、`risk_reduction`、`evidence_reuse`、`estimated_time`、`estimated_tokens_or_cost`、`invalidation_risk`、`rework_risk`、`confidence`をmachine-readableに記録する。
- [ ] NBA-S-3: 同一入力とpolicyでは同じActionを選び、tie-breakと選択理由が再現できる。
- [ ] NBA-S-4: token、time、costが未収集の場合は`unknown`を保持し、0として有利に評価しない。
- [ ] NBA-S-5: material eventがないtool呼び出しごとには再評価せず、checkpoint reasonと前回からの状態差分を記録する。
- [ ] NBA-S-6: 高コストActionより先に同等以上の不確実性を安く下げる対象調査・targeted test・preflightがある場合、安い候補を推奨する。
- [ ] NBA-S-7: 2回連続でmaterial progressが増えない場合、同じActionの無限反復ではなく再診断、split、human checkpoint、stopのいずれかへ遷移する。
- [ ] NBA-S-8: decision recordは結論と入力指標だけを保持し、hidden chain-of-thoughtやraw transcriptを要求・保存しない。
- [ ] NBA-S-9: `cancelled`または`pr_ready`の終端RunではControllerを再実行せず既存の終端状態を返し、`cancelled`への再cancelは冪等に同じ状態を返す。

## 依存関係・完了順

ロードマップの4番目。Context CapsuleとSafe Action Orchestratorが提供する状態・候補Actionの上に置き、後続の検証順序とAgent dispatchを選択する。

## Non Goals

- Gate DAG、Action allowlist、Human Decision、merge権限を上書きすること。
- LLMの自由文だけで実行可能性やcostを決めること。
- token最小化を品質、安全、再現性より優先すること。
