---
story_id: story-vibepro-pr-prepare-authorization-scoring
title: VibePro PR Prepare Authorization Scoring Spec
---

# Spec

## Required Behavior

- `vibepro pr prepare` MUST compute `authorization_scoring` from the change under review and embed the result in `pr-prepare.json` as a top-level field next to `gate_status`.
- The inputs to scoring are derived deterministically from data already collected by `pr prepare`:
  - `riskProfile` ← `classifyChangeRisk({ fileGroups, storySource, networkContracts: null })` using `pr_context.story_source` and the `file_groups` block.
  - `storySource` ← `pr_context.story_source` (same object passed to the classifier).
  - `decisions` ← entries from `readDecisionRecordsIfExists(<story-id>).decisions` (empty array when no records exist).
- The embedded `authorization_scoring` object MUST contain:
  - `schema_version: '0.1.0'`
  - `authorization_level: 'high'|'medium'|'low'|'unknown'`
  - `signals: [...]` (verbatim from `scoreAuthorization`)
  - `review_outcome_recommendation: 'allow'|'require_human_review'|'block'`
  - `matrix_cell: { risk_profile, authorization_level, known_profile }`
  - `risk_profile: <full classifyChangeRisk output object>` — included so consumers do not need to re-derive risk
- When no story can be resolved (transient mode) or no decisions exist, the field MUST still appear, with `authorization_level = 'unknown'` and the matrix's recommendation for that cell.
- `pr-prepare.json` MUST remain valid JSON; adding the new field MUST NOT break any existing field path consumed elsewhere.

## Invariants

- `INV-PAS-1`: `authorization_scoring` is advisory; it MUST NOT alter `gate_status`, role-mode policy, or `ready_for_pr_create`.
- `INV-PAS-2`: Scoring is recomputed on every `pr prepare` run from current inputs; nothing is cached or read back from prior runs.
- `INV-PAS-3`: When `decisionRecords` is `null` (not yet recorded), scoring still succeeds and treats decisions as an empty array.
- `INV-PAS-4`: The embedded `risk_profile` matches `classifyChangeRisk`'s declared output shape; consumers can rely on `risk_profile.profile` being one of the documented profiles.

## Non Goals

- Updating `pr-body.md`, `gate-dag.html`, or `review-cockpit.html` rendering to display the score — left to a follow-up UI story.
- Surfacing the score in `parallel-dispatch.md` (review prepare) — separate consumer wiring story.
- Changing gate logic to honor the recommendation — explicit non-goal of authorization-scoring story.
