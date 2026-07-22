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

`defineAgentRuntimeAdapter`の既存5メソッドを互換維持し、optionalな`detach`と`reconcile` capabilityを追加する。coordinatorの`poll`は`monitor_boundary_ms`到達時に実行中provider runをcancelせず自動detachし、dispatchを`running_detached`として更新する。`reconcile`は同じdispatch IDのInboxを先に読み、completion eventがなければhost statusを観測する。hostが`running`を返しても永続済み`running_detached`を巻き戻さず、`logical_started_at`と`attempt_started_at`を汎用`updated_at`から分離して後継processへ引き継ぐ。dispatch IDはbudget・timestamp・HEAD SHAそのものから独立し、run、adapter、logical task、role、inspection surface、identityだけで決定する。HEADが変わった場合は同一surfaceの明示的assertionがある時だけrebindし、暗黙再利用は`stale_head`でfail closedする。

`createAgentCompletionInbox`は`.vibepro/runtime-inbox/<dispatch-id>/events/<event-id>.json`へtemporary fileとno-replace hard linkでimmutable eventを追加し、event別receiptも同じ方式で更新する。event IDとdispatch IDで重複配送を抑止し、ack前後ともeventは別sessionから監査・再読できる。completion eventはVibePro所有のkind別allowlist schemaだけを受理し、provider run correlation、HEAD、surface hash、partial judgments、usage、bounded resultを保持する。allowlistはfield名だけでなくscalar/array/object型、nested finding形状、text/event sizeも閉じ、未知field、credential/raw transcript専用field、nested arbitrary objectを永続化前にfail closedする。allowed scalarの内容を秘密情報検出器として判定する契約は持たず、host prompt/output schemaとbounded fieldでraw transcript自体を入力しない。findingはInboxからruntime resultまで`{severity,id,detail}`をcanonical形状として保ち、既存Agent Review CLI境界でのみ`severity:id:detail`へ変換する。

`createCodexSubagentRuntimeAdapter`は注入されたhostの`probe/spawn/status/shutdown/subscribeCompletion/wake`へだけ依存する。spawn前にcompletion callbackを登録し、callbackはprovider run/dispatch correlationを検証してからInbox writeを完了し、その後にwakeを呼ぶ。同一dispatchのstartが競合した場合もin-flight promiseを共有し、subscribe/spawnは一度だけ行う。通知失敗はeventを失わせない。`status/collect_result/reconcile`はInbox優先である。completion callback未接続のhostは構築またはstart時にfail closedする。`createCodexGuardedRunBridge`がInbox、adapter、coordinator、Guarded Runを一つのproduction composition boundaryとして結線し、hostの`registerResumeHandler`へ`resumeFromWake`を必ず登録する。review dispatchはVibePro所有の`review_binding`でstage、role、inspection surface、strict HEAD policyをdispatch時に固定し、correlated completionの`review_record`を回収したpush resumeが既存Agent Review recording boundaryへ自動的に渡す。spawn requestにはhostが親process終了後にも使える`completion_delivery` descriptorを渡し、公開`execute runtime-ingest`がpersisted dispatch/provider identityを再検証してInboxへ保存し、その新しいprocessでRunとreview lifecycleを再開する。

production `createCodexSubagentHost`はrepo内の`.vibepro/codex-host/runs`へdispatch/attemptごとのatomic claim、sanitized request/state、structured eventだけを0600で保存し、独立process groupのdetached workerからargv-onlyで`codex exec --json --output-schema --sandbox read-only`を実行する。bounded recoveryまたは明示cancelでshutdownする時はworker PIDだけでなくprocess groupへsignalを送り、実Codex子processもcontainmentする。workerはraw JSONLをメモリ内でbounded parseし、Codex session IDとVibePro所有schemaの最終JSONだけを取り出す。各structured judgmentをatomic `partial_result` eventとしてcompletionより先に保存し、processがその間で停止しても後継scanが部分成果を回収できる。親が生存していればsubscription scan、親が不在ならworkerのrepo-local `runtime-ingest`がInboxへ配送する。公開入口`node bin/vibepro.js`はこのbuilt-in hostを標準結線し、`VIBEPRO_CODEX_HOST_MODULE`を明示した場合だけhost所有moduleへ差し替える。明示module、resume登録、correlation、またはbinding済みreview completionが不正ならlegacy経路へfallbackせずfail closedする。

progress policyはheartbeatとcheckpointを区別する。checkpointは新しい`checkpoint_id`または増加したcompleted judgment集合だけをprogressとして扱う。`no_progress_deadline_ms`超過時は、persisted partialを取り込み、同じlogical dispatchの次attemptをatomic idempotency keyで一度だけ起動して未完了judgmentだけを渡す。総`max_wall_clock_ms`はattempt間でresetせず、`max_attempts`とattempt間で累積したprovider報告costを`max_cost_usd`に照合し、hard limitをno-progress recoveryより先に評価する。上限到達時は新attemptを起動せず`stalled`とhost shutdown containmentへ進む。detach/reconcile自体はattemptやcostを増やさない。

review resultはjudgment key別のpartial resultをInboxへ保存する。dispatch前に完了済みjudgmentを計画へ取り込み、host spawnへは未完了judgmentだけを渡す。reconcile時に期待surface hashと一致するreusable、partial、completion judgmentだけをunionする。同一HEADかつ同一surface hashなら再利用し、budget変更とevidence timestampでは破棄しない。rebase後はsurface不変の明示的assertionがある時だけ再利用する。surface hashが変わった場合は、変更pathとjudgment surfaceのintersectionに基づく`invalidated_judgments`だけを再判定し、変更pathが提供されない場合は影響判定不能として既存judgmentをfail closedで再判定する。

Guarded Run Sessionに`detachRuntime`と`reconcileRuntime`を追加し、既存のauthority→mirror永続化とmanaged worktree/HEAD検証を再利用する。reconcileでcompleted reviewを得てもAgent Review recording boundaryを迂回せず、既存`recordRuntimeReview`がidentity、session、HEAD、read-only、closed lifecycleを再検証してからclose済み結果を記録する。記録後はdispatch authorityへ`review_gate_record`を永続化し、同一dispatchのduplicate pushや後続reconcileは保存済み結果を返してAgent Review履歴を増やさない。canonical `recordAgentReview`にも`runtime_dispatch_id`を渡すため、review書込後・Run marker書込前にprocessが中断しても同じdispatchの再実行は既存結果を再利用できる。CLI production compositionはテスト用dependency注入がなくてもcanonical `recordAgentReview`を注入し、host module file→binary `main`→dispatch→detach→push resume→Inbox recovery→review recordを一続きに保つ。runtime CLIはshell cwdではなく明示repo引数をcaller rootとして扱い、persisted dispatchの`requirements.managed_worktree`をstatus、shutdown、completion drainへ毎回渡す。したがってprocess-localなroot記憶に依存せず、source checkoutから起動した後継processもmanaged authority内のprovider stateとstructured eventを再発見し、Inboxへ回収できる。

## Compatibility and Rollback

optional lifecycle methodを持たないadapterは従来poll/cancel経路を維持するが、10分超過をdetached成功として扱えない。Codex host adapterをregistryから外せばmanual coordinatorへ戻せる。Inbox eventはappend-only監査証跡として残し、rollback時に削除しない。PR #370のbudget設定とreview role選択は変更しない。

## Verification

- contract: same dispatchのdetach/reconcileで通常spawn countが1、no-progress recovery時だけbounded attemptが1増え、同一attemptの競合spawnはhostのatomic claimで1回になる。
- integration: Guarded Run authorityへ`running_detached`を保存し、別SessionがInbox completionを回収し、duplicate resumeでもAgent Reviewを一度だけ記録する。
- failure: wake通知喪失後もreconcileでき、heartbeatのみではno-progress deadlineを延長せず、bounded limitで`stalled`とshutdownになる。
- partial: production workerがstructured judgmentをcompletionより先にatomic event化し、adapterが完了judgmentを再利用してsurface変更時に影響judgmentだけinvalidatedにする。
- E2E: built-in production hostのdetached Codex CLI workerとrepo-local runtime command、spawn→600000ms監視境界→detached継続→親process終了→別OS processの`runtime-ingest`→Inbox→非空findingを持つclosed review bridgeを再生し、別テストで同一process pushと通知喪失時のreconcile fallbackを証明する。
