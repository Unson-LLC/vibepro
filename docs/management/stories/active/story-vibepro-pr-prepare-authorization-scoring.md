---
story_id: story-vibepro-pr-prepare-authorization-scoring
title: VibePro pr prepare should embed authorization scoring next to gate_status
architecture_docs:
  - docs/architecture/vibepro-pr-prepare-authorization-scoring.md
spec_docs:
  - docs/specs/vibepro-pr-prepare-authorization-scoring.md
---

# Story: VibePro pr prepare should embed authorization scoring next to gate_status

## Background

The authorization scoring module (`src/authorization-scoring.js`, story-vibepro-review-authorization-scoring) is a pure function with no consumers. Until it is invoked from `pr prepare`, the recommendation is invisible to the humans and AI coordinators who actually read `pr-prepare.json` and `review-cockpit.html`.

Wiring scoring into `pr prepare` makes the recommendation visible without altering any gate decision — INV-PAS-1 explicitly forbids the score from changing `ready_for_pr_create`. The point is to give reviewers an advisory signal alongside the existing risk-profile-driven gate logic.

## Acceptance Criteria

- `src/pr-manager.js` imports `classifyChangeRisk` from `./change-risk-classifier.js` and `scoreAuthorization` from `./authorization-scoring.js`.
- After `buildPrContext` runs and before the `preparation` object is assembled, scoring is computed from `fileGroups`, `pr_context.story_source`, and the decision records array.
- The resulting `authorization_scoring` field is embedded on `preparation` and serialized into `pr-prepare.json`.
- The embedded object includes the full `risk_profile`, `authorization_level`, `signals`, `review_outcome_recommendation`, and `matrix_cell` — matching the spec.
- The field appears whether or not decision records exist; missing decisions resolve to `decisions: []` not an error.
- `gate_status`, `ready_for_pr_create`, and role-mode policy are unchanged for the same inputs (INV-PAS-1).
- Tests cover: scoring appears in pr-prepare.json end-to-end via `runCli(['pr', 'prepare', ...])`, scoring with explicit story acceptance criteria yields the expected level, scoring tolerates missing decisions.

## Out of Scope

- Surfacing scoring in `pr-body.md`, `gate-dag.html`, `review-cockpit.html`, or `parallel-dispatch.md`.
- Letting the recommendation influence gate decisions or role-mode policy.
- Wiring scoring into `prepareAgentReview` so reviewers see it in their request markdown.
