---
story_id: story-vibepro-agent-runtime-adapters
parent_design: vibepro-autonomy-roadmap-rebaseline
vibepro_story_id: story-vibepro-autonomy-roadmap-rebaseline
title: 実装・Reviewを委譲するProvider-neutral Agent Runtime Adapter
status: active
view: dev
period: 2026-07
category: platform
source:
  type: operator_feedback
  title: "handoffとreview dispatch文書を作るだけでなく、利用可能なagent runtimeへ実行委譲したい"
related_stories:
  - story-vibepro-guarded-run-session-contract
  - story-vibepro-safe-action-orchestrator
  - story-vibepro-human-decision-checkpoint
  - story-vibepro-next-best-action-controller
  - story-vibepro-subagent-review-autonomy
  - story-vibepro-agent-review-independence-provenance
  - story-vibepro-content-scoped-evidence-freshness
reason: "alternatives considered: embed one vendor SDK in the Gate engine, require the coordinator to keep dispatching manually, or define a provider-neutral runtime adapter boundary; selected the adapter boundary. compatibility impact: manual task handoff and review lifecycle commands remain supported, while adapters write the same lifecycle and provenance evidence. rollback plan: disable adapter discovery and return to manual coordinator dispatch. boundary and scope: VibePro owns policy, state, evidence, and stop decisions; implementation agents alone may mutate the managed worktree, and review agents must use separate identities. provider credentials, sandboxing, and external side effects remain governed by the selected runtime. accepted followups: review findings will be routed back through these adapters in a separate Story."
created_at: 2026-07-15
updated_at: 2026-07-15
---

# 実装・Reviewを委譲するProvider-neutral Agent Runtime Adapter

## User Story

**As a** VibeProのGuarded Run利用者
**I want** 利用可能なCodex/Claude Code等へ実装・Reviewを委譲し、結果をRunへ回収してほしい
**So that** VibeProのGateと証跡を維持したまま、外部coordinatorの手作業なしで次nodeへ進める

## Scope

- Adapter contractとして`probe`、`start`、`status`、`cancel`、`collect_result`を定義する。
- capability、agent identity、session/thread id、sandbox、approval policy、timeoutをRunへ記録する。
- implementation roleはVibePro管理worktreeだけを変更可能とする。
- required Reviewは実装sessionと分離したidentityで並列起動し、既存review lifecycleへ記録する。
- runtime unavailable、quota、timeout、permission waitを型付き停止理由へ変換する。

## Acceptance Criteria

- [ ] ARA-S-1: core workflowはprovider固有APIを直接参照せず、共通Adapter contractだけに依存する。
- [ ] ARA-S-2: runtime能力をprobeし、要件を満たさない場合は実行前に`waiting_for_runtime`で停止する。
- [ ] ARA-S-3: 実装結果はchanged files、HEAD、test suggestion、completion statusを持つ構造化resultとして回収される。
- [ ] ARA-S-4: Review adapterはparallel subagent provenanceとclosed lifecycleを既存Gateへ記録できる。
- [ ] ARA-S-5: cancel/timeout後に孤立agentを残さず、再開時に二重起動しない。
- [ ] ARA-S-6: adapter失敗はGate passや実装完了へ暗黙変換されない。
- [ ] ARA-S-7: fake adapterによるsuccess、quota、timeout、cancel、separate reviewerのcontract testがある。

## 依存関係・完了順

ロードマップの6番目。Run、Context Capsule、Action、Meta Controller、Human Checkpointの契約が確定してから実装する。

## Non Goals

- VibePro coreを特定agent providerへ固定すること。
- AgentにGate、waiver、merge権限を委譲すること。
- Providerの認証情報をVibePro artifactへ保存すること。
- Agent Reviewのinspection surfaceやcontent freshness policyをadapter側で再定義すること。
