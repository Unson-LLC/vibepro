---
story_id: story-vibepro-journey-ai-handoff-context
title: Journey AI Handoff Context Spec
related_architecture:
  - ../architecture/vibepro-journey-ai-handoff-context.md
---

# Journey AI Handoff Context Spec

## Invariants

- `INV-JAH-1`: Machine-derived Journey artifacts MUST declare `artifact_kind=journey_context_pack`, `machine_derived=true`, `authoritative=false`, and `curation_status=needs_curated_journey`.
- `INV-JAH-2`: `journey status` MUST NOT return `available` from machine-derived context alone.
- `INV-JAH-3`: `journey handoff` MUST emit AI-readable Markdown and persist `.vibepro/journey/latest-handoff.md`.
- `INV-JAH-4`: Curated Journey JSON under `.vibepro/journeys/<journey-id>.json` MUST be read separately from the machine-derived context pack.
- `INV-JAH-5`: PR Journey context MUST expose whether the current Journey evidence is curated or handoff-only.
- `INV-JAH-6`: Existing candidate placement, conflict, walking skeleton, and open question evidence MUST remain available inside the handoff context.

## Scenarios

- `S-JAH-1`: Running `vibepro journey derive <repo> --json` returns a context pack with `artifact_kind=journey_context_pack` and `curation_status=needs_curated_journey`.
- `S-JAH-2`: Running `vibepro journey status <repo> --json` after derive but before curated JSON exists returns `status=needs_curated_journey`.
- `S-JAH-3`: Running `vibepro journey handoff <repo>` writes `.vibepro/journey/latest-handoff.md` with AI handoff instructions and unresolved Journey questions.
- `S-JAH-4`: When `.vibepro/journeys/<journey-id>.json` exists, `journey status` reports `status=available` with `curated=true` and keeps the context pack as supporting evidence.
- `S-JAH-5`: `pr prepare` includes Journey PR context fields for `curated`, `handoff_available`, and `artifact_kind`.

## Verification

- `test/journey-map.test.js` covers machine context status, handoff Markdown, curated Journey loading, and PR context fields.
- `npm run typecheck` passes.
