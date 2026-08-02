# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 5 |
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

- REQ-SRC-001: The recommendation is surfaced as a new artifact and a new field on PR preparation, never as a silent gate downgrade. (spec:docs/specs/vibepro-review-authorization-scoring.md)
- REQ-SRC-002: INV-RAS-1: A vague story statement that does not name the affected risk surface MUST NOT produce high or medium. (spec:docs/specs/vibepro-review-authorization-scoring.md)
- REQ-SRC-003: INV-RAS-3: review_outcome_recommendation MUST NOT be allow for workflow_heavy risk profiles when authorization is low or unknown. (spec:docs/specs/vibepro-review-authorization-scoring.md)
- REQ-SRC-004: INV-RAS-4: Scoring is a pure function of the supplied evidence inputs; it MUST NOT read repository state directly. (spec:docs/specs/vibepro-review-authorization-scoring.md)
- REQ-SRC-005: INV-RAS-5: When inputs are empty/absent, authorization_level resolves to unknown (never to high). (spec:docs/specs/vibepro-review-authorization-scoring.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/vibepro-review-authorization-scoring.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
