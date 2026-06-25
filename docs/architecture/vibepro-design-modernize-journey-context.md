---
story_id: story-vibepro-design-modernize-journey-context
title: Design Modernize Journey Context Architecture
status: draft
created_at: 2026-06-25
updated_at: 2026-06-25
---

# Design Modernize Journey Context Architecture

## Intent

`journey` remains a top-level VibePro product-context layer. It must not be hidden inside `design-modernize`, because Journey context is also used by PR readiness, split planning, workflow-heavy gates, and agent handoff.

`design-modernize` must still resolve Journey context at its entry point because screen modernization changes a user's path through the product. Users should not need to know that `journey handoff` is a separate command before starting a UI modernization plan.

## Boundary

| Component | Responsibility | Must Not Do |
| --- | --- | --- |
| `journey handoff` / `journey derive` | Produce machine-derived `journey_context_pack` from Story, Spec, Graphify, and gate evidence | Claim the product Journey is settled without a curated Journey |
| Curated Journey | Store interpreted product Journey under `.vibepro/journeys/<journey-id>.json` | Erase source context pack evidence |
| `design-modernize plan` | Ensure Journey context exists, expose curation status, and include a Design Quality DAG gate | Move Journey ownership under design-modernize or silently treat handoff as authoritative |
| PR Journey Context Gate | Block or review UI changes based on the latest Journey context | Depend on design-modernize artifacts as the only Journey source |

## Flow

```text
design-modernize plan
  -> get journey status
  -> if missing, derive journey_context_pack + handoff
  -> write .vibepro/design-modernize/<story-id>/journey-context.json
  -> add design:journey_context -> design:current_ui_evidence edge
```

## Decision

The CLI UX should make Journey visible where UI work starts, while keeping the source of truth top-level. A missing curated Journey is not fatal to generating a modernization plan, but it must be visible as `needs_review` so downstream PR gates do not inherit a false sense of certainty.

