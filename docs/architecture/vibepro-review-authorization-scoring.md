---
story_id: story-vibepro-review-authorization-scoring
title: VibePro Review Authorization Scoring Architecture
---

# Architecture

## Decision

Add a pure scoring module `src/authorization-scoring.js` that takes the existing classifier output, the story source, and the decision records list, and returns `{ authorization_level, signals, review_outcome_recommendation }`.

The scoring module is consumed by `src/agent-review.js` when preparing review artifacts and by `src/pr-manager.js` when emitting `pr-prepare.json`. Neither consumer changes existing required-role policy; the recommendation is an additional field.

## Inputs

- `riskProfile`: the `{ profile, change_type, risk_surfaces }` object returned by `classifyChangeRisk`.
- `storySource`: the same shape already passed to `classifyChangeRisk` (title, background, acceptance_criteria, policy).
- `decisions`: the list returned by `decision status` for the story (entries with `type`, `status`, `source`, `summary`).

## Outputs

```json
{
  "schema_version": "0.1.0",
  "authorization_level": "high|medium|low|unknown",
  "signals": [
    { "kind": "acceptance_criteria_mentions_surface", "surface": "api_contract" },
    { "kind": "decision_record_accepted", "source": "gate:agent_review", "decision_id": "dec-…" }
  ],
  "review_outcome_recommendation": "allow|require_human_review|block",
  "matrix_cell": {
    "risk_profile": "api_contract",
    "authorization_level": "medium",
    "known_profile": true
  }
}
```

`matrix_cell.known_profile` is `false` when `risk_profile` is outside the documented set (`light`, `ui_interaction`, `api_contract`, `workflow_heavy`); in that case the recommendation falls through to `require_human_review` (see Failure Modes).

## Boundaries

- The scoring module owns: signal extraction, level derivation, matrix lookup.
- It does NOT own: PR preparation, gate enforcement, role mode policy, or any I/O.
- `agent-review.js` owns artifact composition; it imports the module and writes the result into `parallel-dispatch.md` and review request JSON under `authorization_scoring`.
- `pr-manager.js` owns gate status; it adds `authorization_scoring` to `pr-prepare.json` next to existing `risk_profile`.

## State

No new workspace artifact is required. The scoring result is embedded in existing artifacts so it appears in `review-cockpit.html` automatically via the same template path that surfaces `risk_profile`.

## Failure Modes

- Missing story / decisions → `authorization_level = unknown`, recommendation derived from matrix.
- Decision record references a non-existent gate ID → that signal is dropped (logged in `signals` with `kind: decision_record_invalid_source`), does not contribute to `high`.
- Risk profile outside the known set → recommendation falls through to `require_human_review` (conservative default).
