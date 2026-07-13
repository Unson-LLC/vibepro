---
story_id: story-vibepro-evidence-adjudication-gate
title: Evidence Adjudication Gate Spec
parent_design: vibepro-evidence-adjudication-gate
---

# Spec

機械可読の正本は `docs/specs/story-vibepro-evidence-adjudication-gate.vibepro.json`（`vibepro spec write --final` 入力）。この文書は人間向け要約。

## Contracts

### ADJ-CONTRACT-001: 裁定依頼書の生成

`vibepro adjudicate prepare` は、Storyの全AC clause原文・記録済み検証証拠（command / summary / observation）・verdict 3値語彙・独立fresh contextでの反証指示を含む `adjudication-request.md` を生成しなければならない。ACが1件もないStoryでは、pass相当の成果物を作らず明示エラーで停止しなければならない。

### ADJ-CONTRACT-002: 裁定記録の入力検証とHEADバインド

`vibepro adjudicate record` は verdict が `demonstrated | not_demonstrated | not_verifiable_by_automation` 以外、reason 空、agent-system / agent-id 欠落のいずれでも拒否し、受理した裁定を current HEAD commit にバインドしなければならない。

### ADJ-CONTRACT-003: ゲート状態遷移

`pr prepare` の `evidence_adjudication` ゲートは、(a) fresh裁定を欠くclauseがあれば `needs_evidence`（不足clause idを列挙）、(b) いずれかが `not_demonstrated` なら `failed`（裁定理由を含む）、(c) `not_verifiable_by_automation` は accepted decision record（source `gate:evidence_adjudication:<clause-id>` + reason + artifact）でのみ解決、(d) 全clauseが解決すれば `passed`、(e) clause 0件は明示 `not_applicable`、と遷移しなければならない。

### ADJ-CONTRACT-004: 強制力

`evidence_adjudication` は required かつ critical であり、未解決の間 `overall_status` は `ready_for_review` にならず、`ready_for_pr_create` は false、execution gate の blocking_gates に含まれ、理由のみのwaiverでは通らない。

### ADJ-CONTRACT-005: オプトアウトと後方互換

`.vibepro/config.json` の `evidence_adjudication.enabled: false` はゲート生成を止める。adjudication成果物が存在しないリポジトリでも `pr prepare` はクラッシュしない。

## Non Goals

- VibePro自身によるLLM API呼び出し
- agent_review gate の置き換え
- 裁定transcriptの自動品質採点（fake-value-hardening の Non-Goal を維持）
- verify record status語彙の変更
- 既存全スキャナのvacuum pass一括修正
