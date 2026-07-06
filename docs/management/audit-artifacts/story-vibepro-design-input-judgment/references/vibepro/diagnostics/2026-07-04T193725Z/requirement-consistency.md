# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 4 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 2 |
| Spec Refs | 1 |
| Architecture Refs | 1 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |

## Invariants

- S-004: Given the VibePro workflow state is Story selected, when an agent runs story diagnose --pre-architecture, then the workflow state transitions to design_input and the manifest run plus evidence file record phase=design_input. (inferred_spec:docs/management/stories/active/story-vibepro-design-input-judgment.md)
- S-005: Given the VibePro workflow status is Architecture/Spec and implementation files changed without design-input diagnosis, when PR prepare runs, then gate:design_input_judgment is needs_review and required=false. (inferred_spec:docs/management/stories/active/story-vibepro-design-input-judgment.md)
- S-006: Given the VibePro workflow state already has design-input diagnosis for the Story, when PR prepare builds the Gate DAG, then gate:design_input_judgment transitions to passed. (inferred_spec:docs/management/stories/active/story-vibepro-design-input-judgment.md)
- INV-001: pre_implementation diagnosis evidence must not overwrite or collapse DesignInput diagnosis evidence. (inferred_spec:docs/management/stories/active/story-vibepro-design-input-judgment.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Requirement Sources

- spec: docs/specs/vibepro-design-input-judgment.md: Spec
- architecture: docs/architecture/vibepro-design-input-judgment.md: Architecture

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
