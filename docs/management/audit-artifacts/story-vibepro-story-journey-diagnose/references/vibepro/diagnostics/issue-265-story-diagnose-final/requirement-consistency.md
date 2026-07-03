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

## Invariants

- INV-SJD-1: A Story with UI/Journey signals must include journey_context.required=true in Story status/report/diagnose output. (inferred_spec:docs/management/stories/active/story-vibepro-story-journey-diagnose.md)
- INV-SJD-2: If no Journey artifact exists for a required Story, the status must remain missing and expose next actions. (inferred_spec:docs/management/stories/active/story-vibepro-story-journey-diagnose.md)
- INV-SJD-3: A machine-derived journey_context_pack must be reported separately from a curated Journey. (inferred_spec:docs/management/stories/active/story-vibepro-story-journey-diagnose.md)
- INV-SJD-4: A Story without UI/Journey signals must be reported as not_required and must not emit Journey derive or handoff actions. (inferred_spec:docs/management/stories/active/story-vibepro-story-journey-diagnose.md)
- INV-SJD-5: PR Gate DAG behavior remains unchanged: gate:journey_context is required only for UI source changes. (inferred_spec:docs/management/stories/active/story-vibepro-story-journey-diagnose.md)

## Scenario Gaps

- なし

## Potential Contradictions

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
