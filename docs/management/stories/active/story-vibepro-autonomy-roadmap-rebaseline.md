---
story_id: story-vibepro-autonomy-roadmap-rebaseline
parent_design: vibepro-autonomy-roadmap-rebaseline
title: Guarded Autonomyロードマップを最新契約へ再編する
status: active
view: dev
period: 2026-07
category: architecture
source:
  type: operator_feedback
  title: "直近追加Storyと衝突しない実装順へ再編したい"
related_stories:
  - story-vibepro-guarded-run-session-contract
  - story-vibepro-run-context-capsule
  - story-vibepro-safe-action-orchestrator
  - story-vibepro-next-best-action-controller
  - story-vibepro-human-decision-checkpoint
  - story-vibepro-agent-runtime-adapters
  - story-vibepro-risk-adaptive-validation-sequencing
  - story-vibepro-review-finding-repair-loop
  - story-vibepro-story-run-portfolio-controller
  - story-vibepro-guarded-autonomy-hardening
reason: "alternatives considered: continue the original six-story shorthand, collapse newly discovered responsibilities into the remaining five, or rebaseline as ten ordered stories with explicit ownership and integration gates; selected the ten-story sequence. compatibility impact: existing Guarded Run, Run Context Capsule, review lifecycle repair, decision records, evidence freshness, and PR publishing contracts remain authoritative and are extended rather than replaced. rollback plan: selectively revert the ordering and dependency sections in the parent Story, Architecture, and Spec while retaining the eight child Story documents as independent backlog entries; do not revert the whole commit. boundary and scope: this Story changes roadmap SSOT and dependency contracts only; it does not implement autonomous execution or merge authority."
created_at: 2026-07-18
updated_at: 2026-07-18
---

# Guarded Autonomyロードマップを最新契約へ再編する

## User Story

**As a** VibeProのGuarded Autonomyを段階的に完成させたい開発者
**I want** 最新mainと進行中PRを前提に、各Storyの責務・依存・完了順を一つの正本へ固定したい
**So that** コード上の責務衝突だけでなく責務の二重実装と後工程の手戻りも防げる

## Scope

- 当初の6 Story shorthandを、依存関係に沿った10 Storyへ再編する。
- 完了済みのGuarded Run Session ContractとRun Context Capsuleを基盤として固定する。
- 既存実装と未マージPRが所有する責務をreplacementではなくintegration contractとして明記する。
- 各Storyのentry gate、exit gate、禁止される責務をArchitectureへ定義する。
- 実装順を `3 → 4 → 5 → 6 → 7 → 8 → 9 → 10` に固定する。

## 影響範囲

impact_scope_explained: このStoryの影響範囲はロードマップのStory、Architecture、Spec、Design SSOTに限定する。runtime behavior、認証境界、Gate waiver、merge authority、既存のreview repairとevidence lifecycleは変更しない。

## Acceptance Criteria

- [ ] RBL-S-1: 10 Storyが一意な順序、依存、責務を持ち、残りが8 Storyであることを正本で確認できる。
- [ ] RBL-S-2: `review repair`、decision records、content-scoped evidence freshness、published evidence、human review overrideとの所有境界が明記される。
- [ ] RBL-S-3: PR #338、#321、#331について、どのStoryのentry gateまたはnon-blocking inputかを明記する。
- [ ] RBL-S-4: 各未完Storyは先行Storyのexit gateを満たすまで実装開始しない順序を持つ。
- [ ] RBL-S-5: Hardeningは既存budget・cost・review provenance・evidence freshnessを再実装せず、残存統合ギャップだけを閉じる。
- [ ] RBL-S-6: ロードマップ再編自体はruntime behavior、Gate waiver、merge authorityを変更しない。

## Non Goals

- 8つの未完StoryをこのStory内で実装すること。
- 未マージPRを暗黙に採用・破棄・mergeすること。
- Brainbaseまたは人間が持つ上流優先順位をVibeProが決定すること。
