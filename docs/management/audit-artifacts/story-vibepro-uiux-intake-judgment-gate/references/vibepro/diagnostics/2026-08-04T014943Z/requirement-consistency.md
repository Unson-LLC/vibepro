# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 5 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 2 |
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

- INV-001: gate:uiux_intake_judgment is always present and required in the pr prepare gate DAG, and reports needs_evidence when the story has neither an intake coverage artifact nor an accepted intake_not_applicable/waiver decision; the gate fails clo (inferred_spec:docs/management/stories/active/story-vibepro-uiux-intake-judgment-gate.md)
- S-001: When .vibepro/uiux/<story-id>/uiux-intake-coverage.json or .vibepro/design-modernize/<story-id>/uiux-intake-coverage.json exists and parses as an object, gate:uiux_intake_judgment passes with resolved_by=intake_coverage_artifact and surface (inferred_spec:docs/management/stories/active/story-vibepro-uiux-intake-judgment-gate.md)
- S-002: vibepro decision record --type intake_not_applicable is accepted only with --reason; an accepted intake_not_applicable decision resolves gate:uiux_intake_judgment with resolved_by=intake_not_applicable_decision and the gate surfaces the rec (inferred_spec:docs/management/stories/active/story-vibepro-uiux-intake-judgment-gate.md)
- INV-002: A corrupt or unparsable coverage artifact does not satisfy gate:uiux_intake_judgment and does not crash pr prepare; the gate stays needs_evidence. (inferred_spec:docs/management/stories/active/story-vibepro-uiux-intake-judgment-gate.md)
- S-003: An accepted waiver decision with --source gate:uiux_intake_judgment resolves the gate with resolved_by=waiver_decision, and the unresolved-gate recovery plan names both closures: running uiux intake validate, or recording an intake_not_appl (inferred_spec:docs/management/stories/active/story-vibepro-uiux-intake-judgment-gate.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/story-vibepro-uiux-intake-judgment-gate.md: uiux intake applicability judgment gate contract

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
