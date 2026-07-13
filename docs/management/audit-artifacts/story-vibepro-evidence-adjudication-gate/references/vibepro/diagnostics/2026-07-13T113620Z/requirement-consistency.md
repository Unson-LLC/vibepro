# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 5 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 2 |
| Spec Refs | 1 |
| Architecture Refs | 1 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: ACが1件もないStoryに対する adjudicate prepare は、pass相当の成果物を作らず「acceptance criteria なし」を明示するエラーになる (story:docs/management/stories/active/story-vibepro-evidence-adjudication-gate.md)
- REQ-SRC-001: 裁定transcriptの自動品質採点（fake-value-hardening の Non-Goal を維持） (spec:docs/specs/vibepro-evidence-adjudication-gate.md)
- REQ-SRC-002: Story markdown の受け入れ基準 clause（traceability と同じ抽出器を再利用し、clause id / 全文を取得） (architecture:docs/architecture/story-vibepro-evidence-adjudication-gate.md)
- REQ-SRC-003: 裁定の実行はcoordinatorが起動するsubagentの責務 (architecture:docs/architecture/story-vibepro-evidence-adjudication-gate.md)
- REQ-SRC-004: 裁定transcriptの自動品質採点はしない（fake-value-hardening の Non-Goal を維持） (architecture:docs/architecture/story-vibepro-evidence-adjudication-gate.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/vibepro-evidence-adjudication-gate.md: Spec
- architecture: docs/architecture/story-vibepro-evidence-adjudication-gate.md: アーキテクチャ

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
