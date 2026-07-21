---
title: "Codex Detached Completion Inbox Architecture"
status: accepted
created_at: 2026-07-22
updated_at: 2026-07-22
related_stories:
  - story-vibepro-codex-detached-completion-inbox
  - story-vibepro-agent-runtime-adapters
parent_design:
  - vibepro-autonomy-roadmap-rebaseline
---

# Codex Detached Completion Inbox Architecture

## Intent

PR #360のprovider-neutral runtime adapterを、親sessionの同期wait寿命とは独立したCodex subagent lifecycleへ結線する。10分は観測境界であり実行期限ではない。結果はprovider callbackから永続Inboxへ先に入り、push wakeupまたは後続reconcileが同じdispatchを一度だけ回収する。

## Authority Boundary

| Owner | Owns | Must not own |
|---|---|---|
| VibePro runtime coordinator | deterministic dispatch ID、HEAD/surface binding、detach/reconcile policy、bounded recovery、fail-closed判定 | provider認証、実spawn、host process shutdown |
| Completion Inbox | append-only event、dedupe、receipt、partial result、authority-first atomic persistence | Gate pass、review judgment、provider side effect |
| Codex host adapter | host capability probe、spawn、completion callback配送、wakeup、status、shutdown | VibePro Gate、waiver、merge、surface freshness policy |
| Guarded Run | authority stateの`running_detached`、reconcile、result取込、review lifecycle bridge | callback到着まで親sessionを維持すること |

## Decision

`defineAgentRuntimeAdapter`の既存5メソッドを互換維持し、optionalな`detach`と`reconcile` capabilityを追加する。coordinatorの`poll`は`monitor_boundary_ms`到達時に実行中provider runをcancelせず自動detachし、dispatchを`running_detached`として更新する。`reconcile`は同じdispatch IDのInboxを先に読み、completion eventがなければhost statusを観測する。dispatch IDはbudget・timestamp・HEAD SHAそのものから独立し、run、adapter、logical task、role、inspection surface、identityだけで決定する。HEADが変わった場合は同一surfaceの明示的assertionがある時だけrebindし、暗黙再利用は`stale_head`でfail closedする。

`createAgentCompletionInbox`は`.vibepro/runtime-inbox/<dispatch-id>/events/<event-id>.json`へimmutable eventをatomic renameで追加し、event別receiptをatomic renameで更新する。event IDとdispatch IDで重複配送を抑止し、ack前後ともeventは別sessionから監査・再読できる。completion eventはprovider run correlation、HEAD、surface hash、partial judgments、usage、resultを保持するが、credential/raw transcriptは保持しない。

`createCodexSubagentRuntimeAdapter`は注入されたhostの`probe/spawn/status/shutdown/subscribeCompletion/wake`へだけ依存する。spawn前にcompletion callbackを登録し、callbackはprovider run/dispatch correlationを検証してからInbox writeを完了し、その後にwakeを呼ぶ。同一dispatchのstartが競合した場合もin-flight promiseを共有し、subscribe/spawnは一度だけ行う。通知失敗はeventを失わせない。`status/collect_result/reconcile`はInbox優先である。completion callback未接続のhostは構築またはstart時にfail closedする。`createCodexGuardedRunBridge`がInbox、adapter、coordinator、Guarded Runを一つのproduction composition boundaryとして結線し、hostの`registerResumeHandler`へ`resumeFromWake`を必ず登録する。公開入口`node bin/vibepro.js`は`VIBEPRO_CODEX_HOST_MODULE`からhost所有moduleを解決し、`execute runtime-dispatch/runtime-poll/runtime-reconcile`をbridgeへ到達させる。明示moduleやresume登録が不正ならlegacy経路へfallbackせずfail closedする。

progress policyはheartbeatとcheckpointを区別する。checkpointは新しい`checkpoint_id`または増加したcompleted judgment集合だけをprogressとして扱う。`no_progress_deadline_ms`、`max_wall_clock_ms`、`max_attempts`、`max_cost_usd`のいずれかを超えると`stalled`になり、その時だけhost shutdown containmentへ進む。detach/reconcile自体はattemptやcostを増やさない。

review resultはjudgment key別のpartial resultをInboxへ保存する。dispatch前に完了済みjudgmentを計画へ取り込み、host spawnへは未完了judgmentだけを渡す。reconcile時に期待surface hashと一致するreusable、partial、completion judgmentだけをunionする。同一HEADかつ同一surface hashなら再利用し、budget変更とevidence timestampでは破棄しない。rebase後はsurface不変の明示的assertionがある時だけ再利用する。surface hashが変わった場合は、変更pathとjudgment surfaceのintersectionに基づく`invalidated_judgments`だけを再判定し、変更pathが提供されない場合は影響判定不能として既存judgmentをfail closedで再判定する。

Guarded Run Sessionに`detachRuntime`と`reconcileRuntime`を追加し、既存のauthority→mirror永続化とmanaged worktree/HEAD検証を再利用する。reconcileでcompleted reviewを得てもAgent Review recording boundaryを迂回せず、既存`recordRuntimeReview`がidentity、session、HEAD、read-only、closed lifecycleを再検証してからclose済み結果を記録する。

## Compatibility and Rollback

optional lifecycle methodを持たないadapterは従来poll/cancel経路を維持するが、10分超過をdetached成功として扱えない。Codex host adapterをregistryから外せばmanual coordinatorへ戻せる。Inbox eventはappend-only監査証跡として残し、rollback時に削除しない。PR #370のbudget設定とreview role選択は変更しない。

## Verification

- contract: same dispatchのdetach/reconcileでspawn countが1、recovery attempt/costが増えない。
- integration: Guarded Run authorityへ`running_detached`を保存し、別SessionがInbox completionを回収する。
- failure: wake通知喪失後もreconcileでき、heartbeatのみではno-progress deadlineを延長せず、bounded limitで`stalled`とshutdownになる。
- partial: 完了judgmentを再利用し、surface変更時に影響judgmentだけinvalidatedになる。
- E2E: repo-local CLIのhost module解決とruntime command、Codex host harnessのspawn→600000ms監視境界→detached継続→completion callback→Inbox→自動登録済みpush `resumeFromWake`→closed review bridgeを再生し、別テストで通知喪失時のreconcile fallbackを証明する。
