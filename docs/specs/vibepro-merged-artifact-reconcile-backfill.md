---
story_id: story-vibepro-merged-artifact-reconcile-backfill
title: Merged Artifact Reconcile Backfill Spec
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        Artifacts["Merged artifacts"] --> Scanner["Reconcile scanner"]
        Scanner --> Facts["Fact extraction"]
        Facts --> Rewrite["State rewrite/report"]
        Facts --> Missing["Needs evidence for unresolved"]
        Rewrite --> Report["Before/after reconcile report"]
        Missing --> Report
    rationale: "Merged execution state must be derived from artifact facts and fail closed when facts are insufficient."
---

# Spec

## Contracts

- `MARB-001`: `vibepro execute reconcile . --all-merged` or an equivalent operation MUST recalculate execution state for existing merged stories.
- `MARB-002`: For `completion_status=merged`, `pr_created`, `agent_review_recorded`, and `merged_or_closed` MUST be re-evaluated from artifact facts.
- `MARB-003`: Review lifecycle or provenance inconsistencies between `review-summary.json` and `review-result-*.json` MUST be detected.
- `MARB-004`: Repairable lifecycle gaps MUST be marked as synthesized lifecycle rather than silent pass evidence.
- `MARB-005`: Reconcile output MUST include story id, before status, after status, and source artifacts for each update.
- `MARB-006`: Unrepairable stories MUST fail closed as `needs_evidence` with the missing fact stated.

## Invariants

- Reconcile never invents a passed review when no artifact fact exists.
- GitHub history recovery is outside this story; local/canonical artifact facts are the authority.
- Execution state is treated as a derived view, not a separate source of truth.

## Verification

- Unit fixtures cover a merged story with stale pending state that can be repaired.
- Unit fixtures cover a merged story with insufficient facts that remains `needs_evidence`.
- Report assertions verify before/after status and source artifact references are present.

## Implementation Scenarios

- Scenario `MARB-S-001`: Given `.vibepro/pr/<story-id>/pr-create.json` and `pr-merge.json` prove a Story was merged while execution state still says `pr_created`, `vibepro execute reconcile . --all-merged --json` rewrites that Story to `completion_status=merged`.
- Scenario `MARB-S-002`: The all-merged reconcile report includes `story_id`, `before_status`, `after_status`, `changed`, the written execution artifact, and source evidence artifacts for each reconciled Story.
- Scenario `MARB-S-003`: If a merged candidate lacks enough artifact facts, reconcile does not synthesize pass evidence and reports missing evidence instead.
