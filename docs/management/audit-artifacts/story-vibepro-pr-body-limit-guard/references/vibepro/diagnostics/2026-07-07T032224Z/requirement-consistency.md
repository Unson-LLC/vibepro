# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 2 |
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

- REQ-SRC-001: PBL-INV-004: Body limit handling MUST NOT change Gate DAG readiness, gate override semantics, push behavior, or existing PR refresh head matching. (spec:docs/specs/story-vibepro-pr-body-limit-guard-spec.md)
- REQ-SRC-002: PBL-CONTRACT-004: execution.pr_body_limit.status is within_limit or truncated, never inferred from command failure text. (spec:docs/specs/story-vibepro-pr-body-limit-guard-spec.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/story-vibepro-pr-body-limit-guard-spec.md: Spec: PR Body Limit Guard

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
