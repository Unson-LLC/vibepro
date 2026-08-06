# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 5 |
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

- REQ-INV-001: 同一グラフを 2 回スキャンすると id 集合が完全一致する。 (story:docs/management/stories/active/story-vibepro-dependency-cycle-scc-reduction.md)
- REQ-INV-002: DCS-S-7: export function detectModuleCycles(moduleEdges) は署名・戻り値契約ともに維持され、既存の CDL-S-6 テスト（正規化の start node 非依存性）がそのまま通る。 (story:docs/management/stories/active/story-vibepro-dependency-cycle-scc-reduction.md)
- REQ-INV-003: import scan による依存判定（PR #387 / EDGE_SOURCE = 'import_scan'）を維持する。 (story:docs/management/stories/active/story-vibepro-dependency-cycle-scc-reduction.md)
- REQ-INV-004: violation id は要素自身の意味値から導出する（配列 index やグループ序数を使わない）という CDL-S-1/S-2 の不変条件を維持する。 (story:docs/management/stories/active/story-vibepro-dependency-cycle-scc-reduction.md)
- REQ-INV-005: detectModuleCycles 維持、両 story の spec drift が clean であることの実測 (story:docs/management/stories/active/story-vibepro-dependency-cycle-scc-reduction.md)

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
