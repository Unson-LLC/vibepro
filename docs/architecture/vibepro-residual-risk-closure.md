---
title: VibePro Residual Risk Closure
status: active
---

# VibePro Residual Risk Closure

## Decision

Senior Gap Judgment separates unresolved risk from evidence that has been closed by current artifacts. Accepted follow-ups remain visible while evidence is missing, but they stop appearing as residual risks after the same axis has the required evidence.

## Boundaries

- PR prepare does not invent session token counts.
- Missing token accounting remains explicit in cost_context.
- Artifact policy can bound PR-body token exposure only when `artifact_policy.pr_body_token_policy.status=bounded_by_artifact_links` and `duplicates_canonical_artifacts=false`.
- Scope reviewability uses PR prepare's own split-plan classification as evidence when the current diff is reviewable.
- The shared PR execution Story is `story-vibepro-residual-risk-closure`; child stories keep separate `story_id` values and bind to it through `vibepro_story_id`.

## Compatibility

Existing Gate DAG accepted_followup semantics remain unchanged for axes that still miss evidence. Consumers can continue reading judgment_axes status, Senior Gap gaps, and cost_context with the same top-level fields.
