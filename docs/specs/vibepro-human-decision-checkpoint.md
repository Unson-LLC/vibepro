---
spec_id: spec-vibepro-human-decision-checkpoint
story_id: story-vibepro-human-decision-checkpoint
parent_design: vibepro-human-decision-checkpoint
status: active
code_refs:
  - src/human-decision-checkpoint.js
  - src/guarded-run-session.js
  - src/cli.js
test_refs:
  - test/human-decision-checkpoint.test.js
  - test/guarded-run-session.test.js
---

# Human Decision Checkpoint Spec

## Contract

### Create

`createHumanDecision(repoRoot, runState, input)`は5種のdecision type、question、material reason、non-empty impact scopeを要求する。同じtype・reason・impact・source refsから作るpending decisionは同一IDを返す。artifactはRunのHEAD、Story、Run、Brainbase handoff参照を保持する。

### Wait

`execute transition ... waiting_for_human`相当の内部境界は、decision artifactのatomic write後にだけRunを停止する。Runの`pending_decision`はartifact path、decision id、type、停止nodeを指す。待機中は`transition ... running`を拒否する。

### Resume

`vibepro execute resume <repo> --story-id <id> --run-id <id> --decision <id> --answer <answer> [--answered-by <actor>] [--reflected-in <csv>]`で回答する。decisionが同じStory、Run、HEADのpending artifactである場合だけ、回答artifactとindexをcommitしてから同じRunをrunningへ戻す。停止nodeは`resume_from_node_id`としてRunへ引き継ぎ、次のorchestrationは正規Safe Action planをそのnodeから実行してcursorを消費する。未知nodeは`invalid_resume_node`でfail closedする。

criticalな`waiver_request`は回答内容にかかわらず`critical_gate_waiver_forbidden`で拒否する。解決済みdecision、stale HEAD、cancelled Run、未知typeも状態を変更せず拒否する。

## Persistence

```text
.vibepro/executions/<story-id>/runs/<run-id>/decisions/
  decision-<fingerprint>.json
  index.json
```

Runの`human_decision_journal[]`はdecision id、回答、回答者、回答時刻、反映先を保持し、artifact indexと合わせて再構築可能にする。

decision artifact作成後にindex writeだけが失敗しても、同一decisionの再作成はdeduplicateされたartifactを返す前に全artifactからindexを再構築する。破損decision JSONは`invalid_decision_artifact`として型付きで拒否し、調査可能な元ファイルを上書きしない。

## Compatibility

waiting_for_runtime、blocked、failedのoperator resumeは従来互換。PR/Gate decision records、Human Review Override、merge approvalには接続しない。
