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

- REQ-INV-001: CDL-S-2: 同一commitを2回スキャンすると、violation ID集合・全次元カウントが完全一致する（再現性の回帰テストで証明）。 (story:docs/management/stories/active/story-vibepro-conformance-delta-ledger.md)
- REQ-INV-002: CDL-S-4: サマリーは単一のviolation_countではなく、次元別に分離される: 新規違反（severity別）/ 解消 / 既存 / 孤児 / 予算超過 / モジュール循環依存 / inconclusive。 (story:docs/management/stories/active/story-vibepro-conformance-delta-ledger.md)
- REQ-INV-003: 裁定から13日で、R-003凍結13ファイル中8ファイルが凍結行数を超過（pr-manager +873行等）し、孤児24ファイル・未宣言依存41件が蓄積した。 (story:docs/management/stories/active/story-vibepro-conformance-delta-ledger.md)
- REQ-INV-004: senior-gap judgmentの loadTargetArchitectureContext の読み取り契約（model + conformance.jsonのsummary）を維持する。 (story:docs/management/stories/active/story-vibepro-conformance-delta-ledger.md)

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
