---
story_id: story-vibepro-codex-detached-completion-inbox
title: Codex subagentを同期wait境界から切り離して完了を永続回収するRuntime Inbox
status: active
view: dev
period: 2026-07
category: platform
source:
  type: operator_feedback
  title: "10分wait超過でsubagent成果を失わず、後継Runが完了通知を回収したい"
related_stories:
  - story-vibepro-agent-runtime-adapters
  - story-vibepro-review-finding-repair-loop
  - story-vibepro-content-scoped-evidence-freshness
parent_design:
  - vibepro-autonomy-roadmap-rebaseline
reason: "alternatives considered: 10分ごとにagentをshutdownしてreplacementを起動する、親sessionを無期限に維持する、またはprovider completionを永続Inboxへ配送してRunがreconcileする; selected the persistent completion Inbox boundary. compatibility impact: existing provider-neutral adapter methods and manual review lifecycle remain supported while adapters may additionally expose detached completion delivery. rollback plan: disable the Codex host adapter and return to explicit polling without deleting Inbox events. boundary and scope: VibePro owns policy, binding, lifecycle, Inbox schema, deduplication, bounded recovery, and fail-closed decisions; host owns actual spawn, completion delivery, wakeup, and shutdown. PR #370のStory予算最適化は変更せず、本Storyはruntime delivery lifecycleだけを所有する。"
created_at: 2026-07-22
updated_at: 2026-07-22
---

# Codex subagentを同期wait境界から切り離して完了を永続回収するRuntime Inbox

## User Story

**As a** VibeProでCodex subagent reviewを実行するRun coordinator
**I want** 親の同期waitが終わってもagentを継続させ、provider completionを永続Inboxから一度だけ回収したい
**So that** 長時間reviewの成果を失わず、replacement再実行と追加予算の反復を避けてreview lifecycleを閉じられる

## 現状と未結線

- PR #360はprovider-neutral adapter契約とGuarded Runへのauthority-first永続化を導入したが、実Codex hostのspawn/completion配送と永続Inboxは未結線である。
- PR #370はStory全体のbudget・validation・review効率を扱うopen PRであり、本Storyのruntime delivery責務を流用または上書きしない。
- 直前の実測では軽量Codex subagentが`wait_agent(600000)`を超過してrunningのままshutdownされ、review結果なし、budget追加、HEAD変更、証跡stale、replacement再実行という閉路になった。
- 本Storyは`createCodexGuardedRunBridge`をproduction composition boundaryとして追加し、`VIBEPRO_CODEX_HOST_MODULE`と公開runtime commandからhost所有のspawn/配送をVibeProのInbox/coordinator/Guarded Runへ実際に結線する。

## Acceptance Criteria

- [x] CDI-S-1: 10分境界は親の同期監視境界として扱い、provider runが継続中ならshutdownせず`running_detached`をauthority-firstに永続化する。
- [x] CDI-S-2: provider/host completion eventをappend-onlyの永続Inboxへ保存し、親session不在でも後継session/Runが回収できる。
- [x] CDI-S-3: push wakeupで親またはRunを再開でき、通知喪失時もInbox reconcileで同じ結果を回収できる。
- [x] CDI-S-4: 同一dispatch IDのresume/reconcileは二重spawnせず、timeout recoveryを新規subagent budgetへ二重計上しない。
- [x] CDI-S-5: heartbeatだけでは延命せず、progress checkpoint、no-progress deadline、総wall-clock、attempt、cost上限から`stalled`を判定する。
- [x] CDI-S-6: 複数判定の部分成果を永続化し、完了済み部分を再利用して未完了部分だけを再開できる。
- [x] CDI-S-7: HEADとinspection surfaceが不変なら結果を再利用し、budget設定、証跡timestamp、rebaseだけでは全面失効しない。surface変更時だけ影響範囲を再判定する。
- [x] CDI-S-8: VibeProとhostの所有境界をfail closedで強制し、host capabilityが未結線なら完了扱いしない。
- [x] CDI-S-9: 実Codex hostを模したcontract/integration/E2Eでspawn→10分境界→detached継続→completion Inbox→結果回収→review lifecycle closeを証明する。
- [x] CDI-S-10: recoveryは論理task単位のwall-clock/attempt/cost上限内で行い、追加予算の反復を正常系にしない。

## Non Goals

- PR #370のStory budget policyやreview role selectionを再実装すること。
- provider認証情報、raw transcript、任意外部副作用をVibePro artifactへ保存すること。
- host固有spawn APIをVibePro coreへ直接埋め込むこと。
- Agent Reviewの独立性、Gate、waiver、merge authorityをhostへ委譲すること。
