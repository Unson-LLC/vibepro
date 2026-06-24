---
story_id: story-vibepro-ui-journey-context-gate
title: UI Journey Context Gate Spec
related_architecture:
  - ../architecture/vibepro-ui-journey-context-gate.md
---

# UI Journey Context Gate Spec

## Invariants

- `INV-UJG-1`: UI experience source changes MUST add `gate:journey_context` to
  the Gate DAG.
- `INV-UJG-2`: Non-UI changes MUST NOT add Journey Map friction.
- `INV-UJG-3`: `gate:journey_context` MUST be connected between
  `gate:path_surface_matrix` and `gate:requirement`.
- `INV-UJG-4`: Missing Journey Map evidence for UI changes MUST be a critical
  unresolved PR readiness item.
- `INV-UJG-5`: A placed current Story with no affected conflict or blocking
  Journey question MUST pass the Journey Context Gate.
- `INV-UJG-6`: A `gate:journey_context` decision record MAY accept a bounded
  follow-up without pretending the Journey evidence exists.

## Scenarios

- `S-UJG-1`: A change to `components/Signup.tsx` without
  `.vibepro/journey/latest-journey.json` produces `gate:journey_context` with
  `status=needs_evidence`.
- `S-UJG-2`: A change to `components/Signup.tsx` after `vibepro journey derive`
  places the current Story on `activation/signup` produces
  `gate:journey_context` with `status=passed`.
- `S-UJG-3`: A Journey conflict on the current Story step produces
  `status=needs_review`.
- `S-UJG-4`: Docs-only changes do not produce `gate:journey_context`.

## Verification

- `test/journey-map.test.js` covers missing Journey context and placed Journey
  context for UI source changes.
- `npm run typecheck` passes.
- `node --test test/journey-map.test.js` passes.
