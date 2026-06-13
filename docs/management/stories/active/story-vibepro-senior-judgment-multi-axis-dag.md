---
story_id: story-vibepro-senior-judgment-multi-axis-dag
title: Engineering JudgmentをSenior first scanのmulti-axis DAGにする
status: active
source:
  type: user_feedback_and_oss_research
  id: senior-judgment-multi-axis-dag
architecture_docs:
  - docs/architecture/vibepro-senior-judgment-multi-axis-dag.md
spec_docs:
  - docs/specs/vibepro-senior-judgment-multi-axis-dag.md
---

# Story

VibeProのEngineering Judgment DAGは、現状では`route_type`を1つ選び、そのroute-specific gateを生やす構造に寄っている。
しかし、public OSSの高密度レビューを調査すると、senior engineerは「1つのルート」ではなく、public contract、rollback/version skew、security boundary、data/state、execution topology、UX、performance、scope、release/opsといった複数の判断軸を同時に立てている。

VibeProは、Story/PR diffを見た最初の段階で`Senior first scan`を行い、必要な`judgment_axes[]`をmulti-labelでactiveにする必要がある。
各axisは、単なる説明文ではなく、decision question、required evidence、blocking criteria、acceptable follow-upを持つ。
Graphifyはこのfirst scanとscope/review/verificationの補助入力として使うが、任意インストールなので、存在しないだけではblockしない。

## Acceptance Criteria

- `pr prepare`の`pr_context.engineering_judgment`または隣接contextに、単一`route_type`とは別に`judgment_axes[]`が出力される。
- `Senior first scan`は、PR/Story/diff/Graphify optional contextから複数axisをactive化できる。1軸のみ、複数軸、全軸相当の重いPRのいずれも表現できる。
- 各active axisには、`axis`, `status`, `reason`, `confidence`, `decision_question`, `required_evidence`, `blocking_criteria`, `acceptable_followup`が含まれる。
- Graphify artifactが存在する場合は、`graph_impact_scope`がaxis activation、scope/reviewability、review ownership、verification matrixの補助evidenceとして使われる。
- Graphify artifactが存在しない場合は、`graph_context.available=false`として続行し、Graphify不在だけでGate DAGをblockしない。
- Architecture gateはADR有無だけでなく、active axesに対して`alternatives_considered`, `compatibility_impact`, `rollback_plan`, `boundary`, `accepted_followups`の不足を検出できる。
- Route-specific judgment gateは、advisoryな自動`passed`だけにせず、少なくとも新規multi-axis pathではevidence-backedな`needs_evidence`/`passed`/`accepted_followup`を表現できる。
- `acceptable_followup`と`waiver`は区別される。現在の安全性に必要な証拠を欠くものはfollow-upではなくblockまたはwaiver扱いになる。
- PR bodyまたはGate DAGから、人間が「なぜこのaxisがactiveになったか」「何が証拠として必要か」「何がblock条件か」を再構成できる。
