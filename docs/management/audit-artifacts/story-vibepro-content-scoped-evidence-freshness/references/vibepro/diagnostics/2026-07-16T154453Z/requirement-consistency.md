# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 4 |
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

- REQ-INV-001: CEF-S-1: コード証跡の記録後に docs のみのコミットを行っても、pr prepare は当該証跡を current として扱う。 (story:docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md)
- REQ-INV-002: CEF-S-3: agent review 証跡も同じ規則に従い、surface 外の変更では stale にならない。 (story:docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md)
- REQ-INV-003: pr prepare の鮮度判定は、束縛された surface のコンテンツハッシュが現在のツリーと一致するかで行う。 (story:docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md)
- REQ-INV-004: レビュー証跡（agent review record）にも同じコンテンツ束縛を適用する。 (story:docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/story-vibepro-content-scoped-evidence-freshness.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
