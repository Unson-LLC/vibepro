---
title: "VibePro Safe Action Orchestrator Architecture"
status: accepted
created_at: 2026-07-18
updated_at: 2026-07-18
related_stories:
  - story-vibepro-safe-action-orchestrator
  - story-vibepro-guarded-run-session-contract
  - story-vibepro-run-context-capsule
---

# VibePro Safe Action Orchestrator Architecture

## Intent

Guarded Runを、表示された`next_commands`のshell実行ではなく、閉じた型付きAction registryから既存VibePro APIを呼ぶ制御ループへ拡張する。Runはallowlist済み操作だけを依存順に進め、PR-ready、検証失敗、Gate、人間判断、runtime要求、禁止Actionのいずれかで停止する。

## Boundaries

| Boundary | Responsibility | Must Not Do |
|----------|----------------|-------------|
| Guarded Run Session | authoritative Run state、HEAD binding、transition、永続化を所有する | Actionの安全分類を文字列コマンドから推測する |
| Safe Action Orchestrator | registry、依存順、冪等性、journal、停止理由を所有する | 任意shell、merge、waiver、agent dispatchを実行する |
| Existing Operations | `pr prepare`と`pr autopilot`の既存Gate semanticsを提供する | Orchestrator専用の別Gate判定を作る |
| Human / Runtime Boundary | approval、判断、runtime要求をtyped stopとして返す | 未解決判断をpassへ昇格する |

## Action Model

Action registry entryは`id`、`classification`、`depends_on`を持つ閉じたmetadataとする。実行能力をregistry entry自身には持たせず、Guarded RunがAction ID別のrunnerを注入する。repository mutationは宣言値ではなく実行後のgit identity比較で検出する。分類は`read_only`、`repo_local_safe`、`approval_required`、`forbidden`のみ。最初の実行planは次の2 nodeに限定する。

1. `pr_prepare`: `repo_local_safe`。current HEADのGate DAGを永続化・評価する。
2. `pr_autopilot_safe`: `repo_local_safe`。Orchestrator専用optionでCLI/config/prepare由来のverification command実行を禁止し、既存passing evidenceの再利用、Gate評価、review preparationだけを既存API経由で進める。未解決verificationはruntime stopへする。`importCi`、PR番号、CI check、任意envを含む外部optionも拒否し、要求された場合は`approval_required`へ分類する。
HEAD変更時の`rebind_head`と`pr_prepare_current_head`は、ユーザー選択可能なActionではなくGuarded Runのpostcondition checkpointとする。両者は同じjournal形式と決定的idempotency keyを持つが、registry runnerとして外部から選択・差替えできない。前者はcurrent HEADへの再bindを行い、Gate再評価より前にauthority-firstで永続化する。後者はcurrent HEADのGate DAGだけを再評価し、評価結果がreadyでなければ`blocked/gate_recheck_required`、評価処理自体が例外終了した場合は失敗entryとrecoveryを永続化して`failed/gate_recheck_failed`で停止する。

`execute start`はRun作成時の既存bootstrapとしてのみ再利用し、`reconcile`はlegacy state観測が必要な場合だけtyped runnerから呼ぶ。`next_commands`は観測・案内用データであり、Action選択にも実行にも使わない。registry外Action、`approval_required`、`forbidden`は実行前にtyped stopへ変換する。

## Journal and Idempotency

Run stateへappend-onlyの`action_journal`を追加する。entryは`action_id`、`node_id`、入力HEAD、出力HEAD、idempotency key、status、artifact、result summary、timestampsを記録する。keyは`run_id + node_id + input_head_sha`から決定的に生成する。

Run schemaは`0.2.0`へ上げる。既存`0.1.0` Runはread時に`action_journal: []`を補い、authorityを先、linked mirrorを後の既存順序で同一内容へmigrationする。`status/watch/resume/cancel`の既存意味は維持し、journal欠落をcorrupt stateとして扱わない。

同じkeyの`completed` entryが存在する場合は副作用を再実行せずskipする。`failed` entryは成功として扱わず、Runを`failed/action_failed`へ遷移させる。repository mutation後はgit identityからHEADを再取得し、Runの`current_head_sha`を更新して次nodeの`pr_prepare`評価を必須にする。

## Stop Mapping

| Condition | Run status | stop_reason |
|-----------|------------|-------------|
| Gate ready | `pr_ready` | null |
| human judgment | `waiting_for_human` | `human_judgment_required` |
| runtime required | `waiting_for_runtime` | `runtime_required` |
| verification/critical Gate | `blocked` | typed upstream reason |
| action exception/failure | `failed` | `action_failed` |
| forbidden/unknown action | `blocked` | `action_forbidden` |

## Compatibility and Rollback

既存`execute start/next/reconcile`、`pr prepare`、`pr autopilot`のpublic contractは変更しない。`execute run --until pr-ready`のみがorchestrationを開始し、`--until`なしの`execute run`は従来どおりRunを作成するだけでActionを実行しない。既存`--target`、`--run-id`、repair flag、legacy `execute status`、英日help、JSON/human出力も維持する。Orchestrator制約は専用safe adapterにだけ適用し、option未指定のmanual `pr autopilot`はCLI/config/prepare verificationの解決・実行、失敗停止、passing evidence再利用を従来どおり行う。

`--dry-run`はRun作成、preflight、prepare、autopilotを一切呼ばず、registryから純粋なplanを返すため、Run authority/mirror、legacy state、`.vibepro/pr`、HEAD、git statusを変更しない。rollbackはorchestrator呼び出しを無効化し、既存manual commandsへ戻す。

schema migrationは認識済みpredecessorを連鎖させる。schema欠落または`0.0.0`は既存migrationを経由して`0.2.0`へ進め、既存field、status、transitionを保持する。authority-first/mirror-second、mirror同期失敗後の明示repair、未知のfuture schemaを非変異でfail-closedにする既存契約も維持する。

`failed/action_failed` Runを明示resumeした場合だけ、同じidempotency keyのfailed entryを新しいattemptとして再試行できる。completed entryはresume後もskipする。status/watch/cancelと反復cancelはjournalの順序と内容を変えず、JSON/human summaryは最新Action結果を観測可能にする。

## Verification

- registryが閉じており、任意`next_commands`を実行しないこと
- dry-runで副作用がないこと
-同一Run/node/HEADがskipされること
- verification failとcritical Gateが停止すること
- HEAD変更後にprepareがcurrent HEADで再評価されること
- forbidden Actionが実行前に停止すること
- CLI/config/prepare由来のverification commandがOrchestrator経路では実行されないこと
- safe optionなしのmanual `pr autopilot`が従来どおりverificationを扱うこと
- schema欠落/`0.0.0`/`0.1.0` migration、mirror failure/repair、future schema fail-closedが維持されること
- `--until`なしのRun作成、resume/watch/status/cancelとjournalの互換性が維持されること
