---
title: Guarded Run Autonomous Action DAG Architecture
status: accepted
created_at: 2026-07-21
updated_at: 2026-07-21
related_stories:
  - story-vibepro-autonomous-action-dag
parent_design:
  - vibepro-autonomous-implementation-closure-roadmap
---

# Guarded Run Autonomous Action DAG Architecture

## Intent

Guarded Runの既存二段Actionを、artifact診断、実装委譲、検証、独立Review、修正、最終Gate再評価まで表現できる閉じたDAGへ拡張する。各nodeは既存owner APIを注入するcomposition portであり、Gate、worktree、verification、Review、findingの正本を新設しない。production owner adapterの具体配線は後続Storyが所有する。

## Boundary

| Owner | Owns | Must not own |
|---|---|---|
| Safe Action Orchestrator | canonical action profile、依存順序、HEAD単位idempotency、typed stop | provider起動、Gate判定、Review verdict |
| Guarded Run composition root | canonical runner port、authority-first checkpoint、resume、未接続時のtyped stop | 各subsystemのartifact schema、production adapter配線 |
| Existing owner APIs | diagnose/preflight、managed worktree/runtime、PR autopilot、Review lifecycle、Repair Loop | Run全体のAction選択 |

## Decision

`safe-action-orchestrator`に`legacy`と`autonomous`の閉じたprofileを置く。legacyは`pr_prepare -> pr_autopilot_safe`を保持する。autonomousは`diagnose -> prepare_artifacts -> implement -> verify -> review -> repair -> final_prepare`で、任意Actionや生成shellを受け付けない。

Guarded RunはprofileをRun stateへ固定し、再開時に同じprofileだけを使う。ただしautonomous featureが明示的にdisableされた場合は、新規・既存Runとも`requested=autonomous`、`effective=legacy`、typed fallback reasonをstateへ永続化してlegacyへ移行し、summaryにも表示する。各runnerはdependency injectionされた関数で、未接続nodeは`waiting_for_runtime`または`blocked`として停止する。node成功は既存owner artifactの参照だけをjournalへ保存する。mutation後は実worktree HEADを再取得し、次iterationで新HEAD用idempotency keyを生成する。

公開CLIでは新規Runだけが`--action-profile legacy|autonomous`を選択できる。feature disableは`execute run|resume --disable-autonomous-actions`で明示し、既存Runでは`resume --until pr-ready`のorchestration開始前にlegacyへ移行する。status/watch/cancelでの指定や未知profileは副作用前に型付きエラーとして拒否する。

## Compatibility and Rollback

既存Runはprofile欠落を`legacy`としてmigrateし、二段planを維持する。autonomous profileを無効化すれば新規Runだけでなく既存autonomous Runも旧flowへ戻り、fallbackのrequested/effective profileと理由を監査可能に残す。既存`pr prepare`、`pr autopilot`、runtime adapter、Review lifecycle、Repair Loopのpublic contractは変更しない。

## Failure Model

未知profile、未知Action、dependency飛越、runner欠落、HEAD不一致はfail closed。`waiting_for_human`、`waiting_for_runtime`、`blocked`、`failed`をpassへ変換しない。merge、waiver、外部副作用はregistryに含めない。
