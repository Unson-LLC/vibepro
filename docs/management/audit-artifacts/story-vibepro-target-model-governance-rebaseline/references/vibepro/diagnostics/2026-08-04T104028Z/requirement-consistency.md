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

- REQ-INV-001: 同一入力に対して2回生成すると、generated_at を除く全内容が完全一致する。 (story:docs/management/stories/active/story-vibepro-target-model-governance-rebaseline.md)
- REQ-INV-002: docs/architecture/target-model.json の note は「自動生成・自動改訂を禁止する」と「modules/allowed_dependenciesの具体的な分割詳細はrulesの範囲内での機械保守の対象」を同居させており、agent が何をしてよいかが読み手依存になっている。 (story:docs/management/stories/active/story-vibepro-target-model-governance-rebaseline.md)
- REQ-INV-003: import scan による依存判定（PR #387 の決定）を維持する。 (story:docs/management/stories/active/story-vibepro-target-model-governance-rebaseline.md)
- REQ-INV-004: architecture conformance の既存出力スキーマ・--strict・--base/--head delta モードの挙動を維持する。 (story:docs/management/stories/active/story-vibepro-target-model-governance-rebaseline.md)

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
