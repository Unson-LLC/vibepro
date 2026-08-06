# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 3 |
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

- REQ-INV-001: AC1: policy kernelは純関数+注入clockで構成され、observe に同一進捗値を渡してもデッドラインが延長されない（重複進捗の延命拒否）。 (story:docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md)
- REQ-INV-002: P1: 単調進捗checkpoint（重複ID拒否）によるデッドライン延長 (story:docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md)
- REQ-INV-003: evaluateProgressBounds の意味論を副作用なしのpolicy kernel（createProgressDeadline: observe(単調進捗値) / check() → verdict {ok | kill(cause)}、clock注入、重複進捗の延命拒否、no_progress / hard_cap / external_signal のcause発行）として src の共有モジュールへ抽出する。 (story:docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md)

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
