# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 6 |
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

- REQ-INV-001: resolveScanConclusiveness は、走査0件かつ適用対象なら inconclusive、走査0件かつ適用外なら not_applicable、走査1件以上かつfindingsなしなら pass を返す (story:docs/management/stories/active/story-vibepro-scanner-inconclusive-coverage.md)
- REQ-INV-002: UIファイルを1件以上走査しfindingsが無い場合は従来どおり pass になる（既存挙動の回帰なし） (story:docs/management/stories/active/story-vibepro-scanner-inconclusive-coverage.md)
- REQ-INV-003: inconclusiveはgate_dagのunresolved集計に入らず、既存のready判定を変えない（非ブロッキング） (story:docs/management/stories/active/story-vibepro-scanner-inconclusive-coverage.md)
- REQ-INV-004: テストは「3状態の分離」「UI story 0件のinconclusive+critical維持」「非UI story 0件のnot_applicable」「走査ありpassの回帰」「network/regressionの0件inconclusive」「表示の区別」を含む (story:docs/management/stories/active/story-vibepro-scanner-inconclusive-coverage.md)
- REQ-INV-005: flow-design-scanner: UI走査0件のとき、UI storyなら従来のcritical finding（FLOW-NO-UI-CODE）を維持しつつ status を inconclusive にする。 (story:docs/management/stories/active/story-vibepro-scanner-inconclusive-coverage.md)
- REQ-INV-006: 既存のblock / fail判定ロジックの変更（0件時の語彙分離のみ） (story:docs/management/stories/active/story-vibepro-scanner-inconclusive-coverage.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/vibepro-scanner-inconclusive-coverage.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
