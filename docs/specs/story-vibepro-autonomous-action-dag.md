---
spec_id: spec-vibepro-autonomous-action-dag
story_id: story-vibepro-autonomous-action-dag
parent_design: vibepro-autonomous-implementation-closure-roadmap
status: active
code_refs:
  - src/safe-action-orchestrator.js
  - src/guarded-run-session.js
test_refs:
  - test/safe-action-orchestrator.test.js
  - test/guarded-run-session.test.js
---

# Autonomous Action DAG Spec

## S-001 Closed profiles

Action profileは`legacy`または`autonomous`のみ。`legacy`は既存2 node、`autonomous`は`diagnose`、`prepare_artifacts`、`implement`、`verify`、`review`、`repair`、`final_prepare`の順序と直接依存を持つ。autonomous Action objectはprofile、node、input HEAD、idempotency keyを含む。legacy Actionは既存shapeをbyte-compatibleに保ち、profile欠落をlegacyとして扱う。

## S-002 Composition runners

Guarded Run dependencyはcanonical autonomous node名だけを受け付ける閉じたrunner mapを持つ。既存`preparePullRequest`と`safeAutopilotPullRequest`はlegacy runnerのまま維持する。runner欠落は実行を飛ばさず型付き停止にする。

## S-003 Resume and HEAD binding

完了checkpointはrun id、profile、action id、input HEADから生成したkeyで照合する。同一HEAD再開では再実行せず、mutationでHEADが変われば後続iterationは新keyで評価する。異なるprofileのjournalは完了根拠に使わない。

## S-004 Result contract

runner結果は`continue`、`pr_ready`、`waiting_for_human`、`waiting_for_runtime`、`blocked`、`failed`だけを受け付ける。artifact参照、summary、output HEADをjournalへ保存する。最終`pr_ready`は`final_prepare` runnerがcurrent HEADのGate SSOTを確認した場合だけ返せる。

## S-005 Safety and compatibility

任意shell、merge、waiver、deploy、未知Actionはcanonical planに入らない。既存Runとprofile未指定呼出しはlegacy挙動を保つ。autonomous profileの無効化はlegacyへ明示fallbackし、silent downgradeを行わない。
