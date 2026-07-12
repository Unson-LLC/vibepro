# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 3 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 1 |
| Spec Refs | 1 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: 同一正規化内容はSHA-256 digestで識別し、unique tokenとduplicate tokenを別集計する。 (story:docs/management/stories/active/story-vibepro-session-exposure-provenance-dedup.md)
- REQ-INV-002: 既存の意味bucketとtotal token accountingは後方互換を維持する。 (story:docs/management/stories/active/story-vibepro-session-exposure-provenance-dedup.md)
- REQ-INV-003: synthetic sessionで分類と重複排除を回帰検証する。 (story:docs/management/stories/active/story-vibepro-session-exposure-provenance-dedup.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/vibepro-session-exposure-provenance-dedup.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
