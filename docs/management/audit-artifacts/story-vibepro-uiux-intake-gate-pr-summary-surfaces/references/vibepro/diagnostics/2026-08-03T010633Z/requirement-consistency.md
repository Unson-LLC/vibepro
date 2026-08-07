# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 3 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 1 |
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

- S-001: When the gate DAG contains a gate:uiux_intake_judgment node, renderPrGateSummary outputs a line with the node's label, status, and required flag. (inferred_spec:docs/management/stories/active/story-vibepro-uiux-intake-gate-pr-summary-surfaces.md)
- S-002: When the gate DAG contains a gate:uiux_intake_judgment node, buildHumanEvidenceDigest includes a 'UI/UX Intake <status>' entry in the digest. (inferred_spec:docs/management/stories/active/story-vibepro-uiux-intake-gate-pr-summary-surfaces.md)
- INV-001: When the gate DAG has no gate:uiux_intake_judgment node, renderPrGateSummary and buildHumanEvidenceDigest output is identical to the pre-change behavior, with no UI/UX Intake line. (inferred_spec:docs/management/stories/active/story-vibepro-uiux-intake-gate-pr-summary-surfaces.md)

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
