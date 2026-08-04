# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 2 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 0 |
| Spec Refs | 0 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: pr prepare が生成する pr-body.md のconcise契約（セクション順序・禁止文字列・20KB上限）は変化しない（既存の contract テストがそのまま通ることで担保）。 (story:docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md)
- REQ-INV-002: formatEvidenceReferenceForHuman（独立して未参照だが、確認済みdead chainの外にあるため別Storyで扱う）。 (story:docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- なし

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
