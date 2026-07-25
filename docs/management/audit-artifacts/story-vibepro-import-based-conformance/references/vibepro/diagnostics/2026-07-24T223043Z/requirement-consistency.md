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

- REQ-INV-001: target model が存在しない、またはスキャン対象の scope_roots にソースファイルが1件もない場合は従来通り fail loud する(S-005 契約の継続)。 (story:docs/management/stories/active/story-vibepro-import-based-conformance.md)
- REQ-INV-002: 並走マージ後は本Storyの import edge をそのrule_id判定にそのまま渡せる形を維持するに留める。 (story:docs/management/stories/active/story-vibepro-import-based-conformance.md)

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
