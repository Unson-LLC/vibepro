---
story_id: story-vibepro-graphify-judgment-evidence
title: Engineering Judgmentで任意Graphify evidenceを使う
status: active
source:
  type: user_feedback
  id: graphify-judgment-evidence
architecture_docs:
  - docs/architecture/vibepro-graphify-judgment-evidence.md
spec_docs:
  - docs/specs/vibepro-graphify-judgment-evidence.md
---

# Story

Graphifyは任意インストールの外部ツールなので、ローカルに無いだけでVibeProのGateを落としてはいけない。
一方で、Graphify artifactが存在する場合は、差分だけでは見落とす呼び出し先・呼び出し元・共有moduleの影響範囲をEngineering Judgmentに使うべきである。

VibeProは、Graphifyを「必須依存」ではなく「存在する場合に使うimpact-scope evidence」として扱い、PR本文とGate DAGからその利用有無を確認できる必要がある。

## Acceptance Criteria

- Graphify artifactが存在しない場合、Engineering Judgment GateはGraphify不在だけではblockしない。
- Graphify artifactが存在し、変更ファイルに一致するnodeがある場合、`gate:common_judgment_spine` のsubcheckに `graph_impact_scope` が任意evidenceとして表示される。
- `graph_impact_scope` は挙動検証ではないため、`focused_test` / `flow_replay` / `artifact_replay` などの必須evidenceを単独で満たさない。
- PR split planとEngineering Judgment spineは同じGraphify impact contextを使う。
- PR本文から、Graphifyが任意の影響範囲evidenceとして判断に入ったことを確認できる。
