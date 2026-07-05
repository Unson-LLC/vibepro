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

- REQ-INV-001: 互換期間: 既存のキーワード照合による解消は移行期間（最低 1 ヶ月）維持し、キーワード経由で解消された場合は deprecation 注記をゲート詳細に出す。 (story:docs/management/stories/active/story-vibepro-keyword-gate-structured-migration.md)
- REQ-INV-002: Keyword-based resolution paths remain functional during the migration window and are unchanged until the separately committed removal. (story:docs/management/stories/active/story-vibepro-keyword-gate-structured-migration.md)
- REQ-INV-003: 移行期間終了後のキーワード照合コード削除（後続の削除専用変更で行う）。 (story:docs/management/stories/active/story-vibepro-keyword-gate-structured-migration.md)
- REQ-INV-004: bug_physics triage の matcher 言語依存誤発火の修正（別 Story で扱う）。 (story:docs/management/stories/active/story-vibepro-keyword-gate-structured-migration.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/story-vibepro-keyword-gate-structured-migration.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
