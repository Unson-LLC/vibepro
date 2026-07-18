---
story_id: story-vibepro-story-run-portfolio-controller
parent_design: vibepro-autonomy-roadmap-rebaseline
vibepro_story_id: story-vibepro-autonomy-roadmap-rebaseline
title: 複数Storyを混載しないStory Run Portfolio Controller
status: active
view: dev
period: 2026-07
category: product
source:
  type: operator_feedback
  title: "複数Storyを一つの長大sessionへ混載せず、Storyごとに閉じて順次進めたい"
related_stories:
  - story-vibepro-guarded-run-session-contract
  - story-vibepro-run-context-capsule
  - story-vibepro-session-attribution-boundary-guard
  - story-vibepro-story-scope-boundary-gate
  - story-vibepro-guarded-autonomy-hardening
reason: "alternatives considered: keep multi-story sequencing as operator discipline, share one agent transcript and Run across all Stories, or add a lightweight portfolio queue whose children are isolated single-Story Runs; selected isolated child Runs. compatibility impact: single-Story execute run remains unchanged and portfolio operation is additive. rollback plan: export the ordered Story ids and resume each Run manually. boundary and scope: VibePro sequences downstream execution only; Brainbase or the human remains authoritative for portfolio priority and intent. shared discoveries cross Story boundaries only through explicit referenced artifacts, never inherited raw transcript or evidence. accepted followups: final hardening validates end-to-end cost attribution and stop behavior."
created_at: 2026-07-16
updated_at: 2026-07-16
---

# 複数Storyを混載しないStory Run Portfolio Controller

## User Story

**As a** 複数Storyを順にVibeProで完了させたい利用者
**I want** ordered queueを管理しつつ、各Storyを別Run・別context・別証跡・別cost attributionで閉じたい
**So that** 長大sessionのcompaction、証跡混線、工数の過大帰属を防ぎながらロードマップを進められる

## Scope

- ordered Story IDsからportfolioを作り、各entryを単一Story Runへ結び付ける。
- Storyごとにrun id、managed worktree、branch、context capsule、evidence、session cost、terminal stateを分離する。
- 前Storyが`pr_ready`、typed stop、cancelのいずれかへ到達してから、policyに従って次Storyを開始する。
- blocker、未確認、runtime waitを空結果やsuccessへ変換せず、portfolio状態へ保持する。
- Story間で再利用する知識は、明示的なartifact referenceと適用理由を持つpromotionとして渡す。
- parallel実行は独立scope・別worktree・別runtime attributionを証明できる場合だけ明示的に許可する。

## Acceptance Criteria

- [ ] SRP-S-1: portfolio entryは`story_id`、`order`、`run_id`、`status`、`worktree`、`head_sha`、`cost_attribution`、`stop_reason`を持つ。
- [ ] SRP-S-2: 1つのRunは1つのStoryだけを所有し、他Storyのmutation、evidence、review、token/timeを同じRunへ混載しない。
- [ ] SRP-S-3: sequential modeは前entryのterminal stateを確認するまで次entryのmutating Actionを開始しない。
- [ ] SRP-S-4: blocked、waiting、failed、cancelledは成功扱いされず、continue、skip、retryには型付きpolicyまたはHuman Decisionが必要になる。
- [ ] SRP-S-5: promoted contextはsource Story、artifact path、digest、consumer Story、適用理由を持ち、raw transcriptを引き継がない。
- [ ] SRP-S-6: portfolio summaryは各StoryのTrusted PR-ready時間、active/wait、token/cost、Full Suite回数、evidence reuse、human interruptionを個別表示する。
- [ ] SRP-S-7: mixed Story path、branch、review artifact、session attributionを検知した場合は次Storyへ進まず、scope contaminationとして停止する。
- [ ] SRP-S-8: six-story sequential run、mid-story blocker、restart、explicit skip、safe context promotion、parallel rejectionのE2E matrixがある。

## 依存関係・完了順

ロードマップの9番目。単一Story Run、Context Capsule、Validation Sequencing、Repair Loopが収束してから、複数Storyを隔離したまま順次実行する制御を追加する。

## Non Goals

- Brainbaseや人間に代わってStory優先順位・事業価値・上流意図を決めること。
- 複数Storyを一つのbranch、worktree、review、evidence setへまとめること。
- blocked Storyを暗黙skipまたは成功扱いすること。
