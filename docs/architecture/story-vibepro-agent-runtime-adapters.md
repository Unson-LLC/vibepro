---
title: "Provider-neutral Agent Runtime Adapter Architecture"
status: accepted
created_at: 2026-07-19
updated_at: 2026-07-19
related_stories:
  - story-vibepro-agent-runtime-adapters
  - story-vibepro-guarded-run-session-contract
  - story-vibepro-human-decision-checkpoint
parent_design:
  - vibepro-autonomy-roadmap-rebaseline
---

# Provider-neutral Agent Runtime Adapter Architecture

## Intent

VibeProがprovider APIや認証情報を所有せず、Guarded Runのpolicy、HEAD binding、停止判断を保ったまま、実装とReviewを利用可能なagent runtimeへ委譲する境界を定義する。

## Boundary

| Owner | Owns | Must not own |
|---|---|---|
| Guarded Run Session | managed worktree照合、authority-first永続化、Agent Review recording boundary | provider固有API、provider認証、Gate passの捏造 |
| VibePro coordinator | adapter選択、capability要件、dispatch identity、冪等性、typed stop、構造化result検証 | provider認証、sandbox実装、任意外部副作用 |
| Runtime adapter | `probe/start/status/cancel/collect_result`とprovider run idの変換 | Gate pass、waiver、merge、Run policy |
| Implementation agent | 指定managed worktree内の実装 | Review identity、Gate判定、別worktree変更 |
| Review agent | 分離identityでのinspectionとclosed lifecycle result | implementation sessionの流用、暗黙pass |

## Decision

`defineAgentRuntimeAdapter`が5 methodの閉じたcontractを検証し、`createAgentRuntimeCoordinator`だけがadapterを呼ぶ。Guarded Run Sessionはdependency injectionされたCoordinatorのみを参照し、`dispatchRuntime/pollRuntime/cancelRuntime`で更新stateをauthority→mirror順に永続化する。dispatch前にmanaged worktreeをRun authority rootと照合して`probe`し、capability不足、runtime unavailable、quota、permission waitは実行を開始せず`waiting_for_runtime`へ写像する。providerが復旧してstart/statusがrunningへ戻った時はRun全体のstale stop reasonを消去する。

dispatch idはRun、adapter、task、role、HEAD、review identity、implementation sessionから決定的に生成する。provider runを持つrunning/completed dispatchを再要求しても`start`を再実行せず、provider run未作成のtyped waitは再probeできる。孤立判定済みdispatchは再要求しても再起動せず、別の明示的なtask/HEAD/session identityが必要になる。全provider operationをrequest timeoutで境界付ける。start timeoutとgeneric start failureはdispatch idによるforce containmentを行い、cancel応答のterminal statusを検証する。status/result timeoutはprovider runのcancel・terminal再確認を行う。いずれも確認不能なら`orphaned_agent`としてfail closedする。通常cancel失敗時もforce cancelへ進む。

実装resultは`changed_files/head_sha/test_suggestions/completion_status/summary`を必須とする。実装agentがcommitしてmanaged worktreeのHEADを進めることを正規の完了経路とし、poll時には開始時HEADの一致を要求しない。その代わり、完了resultの`head_sha`を実managed worktree HEADと照合し、一致した時だけRun authorityの`current_head_sha`を新HEADへ再bindする。不一致は`runtime_head_mismatch`でfail closedする。

Review dispatchは`workspace_write` capabilityを拒否し、probe時に`read-only` sandboxを要求し、start応答のagent identityをrequested reviewerと即時照合し、start時点のsession/thread correlationを必須とする。Review resultはさらに空の`changed_files`、input HEAD一致、`parallel_subagent` provenance、requested reviewerおよびstart identityと一致してimplementerと異なるagent identity、start時に取得したreview session/threadとの一致、implementation sessionとの差異、`closed` lifecycleを必須とする。Guarded Runの`recordRuntimeReview`は、保存済みdispatchを信頼せず、決定的dispatch id、role/status、保存済み`read-only` sandboxとreview capability、`workspace_write`不在、input/result HEAD、changed files、execution mode、requested/start/result identity、start/result session correlation、implementation session分離、lifecycleを現在のRun authorityに対して再検証した後だけ、実測したsession provenanceを既存Agent Review recording boundaryへ渡す。adapter例外、不正result、timeoutは成功やGate passへ変換しない。

## Compatibility and Rollback

既存のmanual handoff、`review prepare/start/record`、Gate、Human Checkpoint、merge authorityは変更しない。adapter registryを空にすればruntime要求はtyped waitとなり、manual coordinator経路へ戻せる。provider credentialsやraw transcriptはRun dispatch recordへ保存しない。

## Verification

fake adapterでcapability不足と復旧後re-probe、stale Run stop消去、auth/permission wait、成功、separate reviewer、review read-only sandbox、start/result identity/session/HEAD偽装拒否、implementation session別dispatch、duplicate、cancel、force cancel、start/generic failure/status/result timeout containment、terminal acknowledgement、orphan再起動拒否、不正resultをcontract testする。Guarded Run integration testでmanaged worktree照合、実装commit後HEADの検証とauthority再bind、報告HEAD不一致の拒否、authority persistence、completed reviewからAgent Review boundaryへの受渡し、保存後に改ざんされたreview provenance、sandbox、capabilityの再検証拒否を再生する。
