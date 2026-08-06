# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 4 |
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

- REQ-INV-001: SHBO-S-3: role policyでstrict_headと具体的なfreshness_reasonを明示した独自高リスクroleはstrict bindingを維持できる。 (story:docs/management/stories/active/story-vibepro-strict-head-binding-origin-guard.md)
- REQ-INV-002: frozen release candidateへのfinal_review（マージ対象とレビュー対象の完全一致を要するTOCTOU防止）と、通常レビューの任意strict化が同じフラグで区別されていないのが原因。 (story:docs/management/stories/active/story-vibepro-strict-head-binding-origin-guard.md)
- REQ-INV-003: frozen release candidateへのfinal_reviewのstrict HEAD要求（TOCTOU防止）は維持する。 (story:docs/management/stories/active/story-vibepro-strict-head-binding-origin-guard.md)
- REQ-INV-004: binding/inspection input欠落のlegacy evidenceのfail-closed扱いを維持する。 (story:docs/management/stories/active/story-vibepro-strict-head-binding-origin-guard.md)

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
