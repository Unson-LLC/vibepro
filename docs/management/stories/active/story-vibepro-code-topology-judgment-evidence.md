---
story_id: story-vibepro-code-topology-judgment-evidence
title: Engineering Judgmentに任意code topology evidenceを使う
status: active
parent_design: vibepro-code-topology-judgment-evidence
source:
  type: user_feedback
  id: code-topology-judgment-evidence
architecture_docs:
  - docs/architecture/vibepro-code-topology-judgment-evidence.md
spec_docs:
  - docs/specs/vibepro-code-topology-judgment-evidence.md
---

# Story

Senior engineerは修正前とPR前に、変更ファイルだけでなく呼び元、呼び先、route、shared module、fan-in、blast radiusを確認する。
Graphifyは任意のartifact lensとして既に使えるが、日常的なコード構造探索ではMCP/CLI型のcode topology providerもEngineering Judgmentに接続したい。

VibeProは、codebase-memory-mcpが利用可能な場合にだけ`detect_changes`相当の結果を読み、Engineering Judgment DAGの判断材料として使う。
providerが未インストール、失敗、stale、または結果が空の場合でも、PR readinessはその理由だけではblockしない。

## Acceptance Criteria

- `vibepro pr prepare` は任意の `code_topology_context` を `pr_context` に出力する。
- codebase-memory-mcp が利用できない場合、`code_topology_context.available=false` と理由を出し、Gate DAG readinessをそれだけではblockしない。
- codebase-memory-mcp が変更ファイルに対する関連ファイル、symbol、route、call path、riskを返した場合、Engineering Judgmentのaxis activationに非テキストsignalとして使う。
- `gate:common_judgment_spine` のimpact-sensitive subcheckは、利用可能なcode topologyを `code_topology_impact_scope` の任意evidenceとして表示する。
- `code_topology_impact_scope` は挙動検証ではないため、`focused_test` / `flow_replay` / `artifact_replay` / `scenario_clause_e2e` などの必須evidenceを単独で満たさない。
- Graphifyの既存 `graph_context` と `graph_impact_scope` は後方互換のため維持する。
