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

- REQ-INV-001: RML-S-2: 同一 entry_key のエントリは中央台帳で 1 件に重複排除され、再実行しても件数が増えない。 (story:docs/management/stories/active/story-vibepro-roi-measurement-loop-closure.md)
- REQ-INV-002: RML-S-6: テストが昇格・重複排除・空 ledger・report 読解の各経路を固定する。 (story:docs/management/stories/active/story-vibepro-roi-measurement-loop-closure.md)
- REQ-INV-003: execute merge の post-merge 持ち回り（canonical audit と同じステップ）で、story に対応するローカル ledger エントリを中央台帳 docs/management/roi-ledger/ledger.json へ entry_key 重複排除つきでマージする。 (story:docs/management/stories/active/story-vibepro-roi-measurement-loop-closure.md)
- REQ-INV-004: 事前宣言する数値目標: (1) 本 Story マージ以降に execute merge された story の ledger エントリが中央台帳に 100% 到達する、(2) 中央台帳のエントリは entry_key 一意で重複 0 件、(3) usage report --gate-roi が unclassified 件数を明示する（隠さない）。 (story:docs/management/stories/active/story-vibepro-roi-measurement-loop-closure.md)
- REQ-INV-005: outcome の自動分類（human/agent が分類する運用は月次定例側の責務のまま）。 (story:docs/management/stories/active/story-vibepro-roi-measurement-loop-closure.md)
- REQ-INV-006: 重複 entry_key は最初の 1 件を保持する。 (story:docs/management/stories/active/story-vibepro-roi-measurement-loop-closure.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/story-vibepro-roi-measurement-loop-closure.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
