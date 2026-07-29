---
story_id: story-vibepro-autonomous-implementation-closure-roadmap
vibepro_story_id: story-vibepro-autonomous-roadmap-catalog-closure
parent_design: vibepro-autonomous-implementation-closure-roadmap
title: 自律実装の実行プレーンを1コマンドPR-readyへ接続する
status: completed
view: dev
period: 2026-07
category: architecture
source:
  type: operator_feedback
  title: "制御プレーンだけでなく実装・検証・Review・修正まで自律的に閉じたい"
related_stories:
  - story-vibepro-autonomous-action-dag
  - story-vibepro-production-runtime-connectors
  - story-vibepro-independent-review-orchestration
  - story-vibepro-one-command-pr-ready-closure
reason: "alternatives considered: declare the merged Guarded Autonomy control plane complete, expand the old hardening Story after merge, or preserve its audit history and add a closure roadmap for the missing execution-plane wiring; selected the new closure roadmap. compatibility impact: existing Run, managed worktree, Gate DAG, Agent Runtime Adapter, Review, Repair, evidence, budget, and merge contracts remain authoritative. rollback plan: disable the new Action DAG feature and return to the current pr_prepare/pr_autopilot_safe flow. boundary and scope: this roadmap connects existing primitives and adds production runtime execution; it never auto-merges, auto-waives critical gates, or performs unapproved external side effects."
created_at: 2026-07-21
updated_at: 2026-07-24
---

# 自律実装の実行プレーンを1コマンドPR-readyへ接続する

## User Story

**As a** Storyから安全に実装を完了させたい開発者
**I want** `execute run --until pr-ready --autonomy guarded`が準備、実装、検証、独立Review、修正を自律実行してほしい
**So that** 人間は重要判断とmergeだけを担い、通常の実装ループを手動接続しなくてよい

## Scope

- 現在2 ActionだけのGuarded Runを、型付きの完全な実行DAGへ拡張する。
- production Agent Runtimeを接続し、managed worktree内で実装を委譲する。
- 既存のrecipe preflight、managed worktree、verification autopilot、Review lifecycle、Repair Loopを同じRunへ接続する。
- current HEADのGate DAGがreadyになるまでboundedに反復する。
- 実装順を関連Storyの記載順へ固定する。

## Acceptance Criteria

- [x] AIC-S-1: 4 Storyの責務、entry/exit gate、既存契約との所有境界が一意である。
- [x] AIC-S-2: 4 Storyを順番に完了し、後続Storyは先行Storyのexit gateを要求する。
- [x] AIC-S-3: 最終E2Eが実装commit、検証、`needs_changes`、修正commit、独立再Review、`pr_ready`または型付き停止を1 Run契約として証明する。
- [x] AIC-S-4: merge、critical waiver、未承認外部副作用は自動化されない。
- [x] AIC-S-5: 既存の各制御契約を再実装せず、composition rootと不足providerだけを追加する。

## Completion Evidence

- Autonomous Action DAG: PR #372のmerge済み実行順序とtyped state contractを再利用。
- Production Runtime Connectors: PR #377、merge `0c11f4fb9081407bb57ac59c3f6ca696faefa21f`。
- Independent Review Orchestration: PR #382、merge `b235b36df6a225c49f4a98340c381eb2d8b8ad1c`。
- One-command PR-ready Closure: PR #385、merge `2617304f007c6d0ec5a7014873662d5ba3a2cff7`。real CLI dogfood、current-HEAD verification、独立review、Gate、Node 20/22 CI import、明示的execute mergeを完了。
- Delivery reconciliation: PR #386、merge `904233b47bf69f755561433964d8420409da74ed`。schema 0.2.0のStory ownership routeを修復し、post-merge reconciliationを`reconciled`で完了。
- PR #372、#377、#382、#385、#386のclosure evidenceが揃い、Story文書と`.vibepro/config.json` catalogの双方が`completed`で一致し、実行プレーンclosure roadmapに未完了Storyは残らない。

## Non Goals

- Brainbaseの上流優先順位や意図管理をVibeProへ移すこと。
- PR mergeまたはproduction deployをGuarded Runへ含めること。
- provider障害、予算切れ、未確認値を成功へ変換すること。
