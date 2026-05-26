---
story_id: story-aitle-design-modernize
title: "Aitle existing UI modernization with VibePro Design Cognition Loop"
status: draft
product: Aitle
optional_reference_design_system_id: 1c436280-9432-4bf0-b4fd-15585d6482f0
optional_reference_design_system_version: v1
optional_reference_scene_id: eaa54dae-7f7a-4f00-afce-f1bf44a7095b
---

# Aitle Existing UI Modernization Story Spec

## Background

Aitle has useful design-generation learnings from prior reference work, but the product workflow should not depend on an external generator. A previous five-frame mobile flow was useful as a new concept, but it drifted from the current Aitle screens and information structure.

The deeper learning is that good design generation combines two things: explicit structural constraints and image-based visual hypothesis exploration. VibePro must internalize both. The modernization workflow must preserve current UX constraints first, compile product-local design constraints second, use image generation only to explore visual candidates for the same locked screen structure, then distill accepted design moves into Codex implementation specs.

## Target Screens

| Route | Current code evidence |
|------|-----------------------|
| `/home` | `src/app/(app)/home/page.tsx`, `src/app/(app)/home/client.tsx`, `src/app/(app)/home/_components/*` |
| `/map` | `src/app/(app)/map/page.tsx`, `src/app/(app)/map/_components/*` |
| `/detail` | `src/app/(app)/detail/page.tsx`, `src/app/(app)/detail/_components/*` |
| `/hotel/[hotel_id]` | `src/app/(public)/hotel/[hotel_id]/page.tsx` |

## Invariants

- `INV-AITLE-1`: Keep the existing route list and route purposes: home entry, map search, detail filters/results, and hotel detail.
- `INV-AITLE-2`: Preserve discovered CTAs, search controls, filters, map interactions, result cards, and hotel detail data fields unless an implementation spec explicitly replaces them.
- `INV-AITLE-3`: Preserve current data dependencies and server/client boundaries. Do not replace existing Server Actions, search params, route params, or data loaders with invented APIs.
- `INV-AITLE-4`: Current screenshots are source evidence. Any generated design output is reference only when it agrees with the screen spec and code evidence.
- `INV-AITLE-5`: Image generation must happen after UX invariant lock and must keep the same screen information structure.

## Contracts

- `C-AITLE-1`: VibePro must evaluate design beyond color: state colors, CTA priority, information density, navigation structure, motion, and component role must be considered.
- `C-AITLE-2`: One design brief must target exactly one current screen.
- `C-AITLE-3`: Codex implementation must use current code and VibePro spec as the source of truth when any generated direction conflicts with current UX.
- `C-AITLE-4`: File changes must stay within the target screen files or shared components justified by Graphify evidence.
- `C-AITLE-5`: VibePro must compile a DesignConstraintGraph before generating visual hypotheses.
- `C-AITLE-6`: VibePro must critique image-generated candidates before writing implementation instructions.

## Design Cognition Loop

```text
current Aitle code + current screenshot
  -> UX invariant lock
  -> DesignConstraintGraph
  -> visual hypothesis generation
  -> visual hypothesis gate
  -> implementation spec distillation
  -> Codex implementation
  -> before/after regression gate
```

## DesignConstraintGraph Requirements

- `DCG-AITLE-1`: Color roles include dark surface, primary purple, mint availability, cyan location/distance, amber urgency, and neutral disabled/unavailable states.
- `DCG-AITLE-2`: Component roles include AI phone CTA, hotel card, compact hotel card, availability badge, filter chip, bottom sheet, and bottom navigation when present in the target screen.
- `DCG-AITLE-3`: CTA priority distinguishes AI phone confirmation and primary discovery actions from filters, navigation, and metadata actions.
- `DCG-AITLE-4`: Density policy preserves Aitle's dense mobile search/comparison workflow while improving scanability.
- `DCG-AITLE-5`: State semantics distinguish loading, empty, error, selected, disabled, available, limited, and unavailable states.

## Visual Hypothesis Requirements

- `VH-AITLE-1`: Generate 2-4 visual candidates per target screen only after the current screenshot and invariants are available.
- `VH-AITLE-2`: Each candidate must list preserved UX, design moves, risky/rejected moves, and Codex implementation notes.
- `VH-AITLE-3`: Candidates must be evaluated for invariant preservation, CTA priority, density fit, state clarity, brand fit, accessibility, navigation continuity, and implementation feasibility.
- `VH-AITLE-4`: A candidate with new route structure, removed CTA, invented data, or generic travel-app navigation must be rejected.

## Scenarios

- `S-AITLE-HOME-1`: A user can start hotel discovery from `/home` without losing current entry actions.
- `S-AITLE-MAP-1`: A user can search and compare hotels on `/map` with the map, filters, current location affordance, and result card behavior preserved.
- `S-AITLE-DETAIL-1`: A user can refine conditions on `/detail` and view matching hotel results with existing filters and empty/error/loading states preserved.
- `S-AITLE-HOTEL-1`: A user can inspect `/hotel/[hotel_id]` with current hotel facts, imagery, actions, and route params preserved.
- `S-AITLE-VH-1`: A designer or agent can compare image-generated candidates and see which design moves were accepted or rejected before Codex implementation.

## Anti-patterns

- `AP-AITLE-1`: Do not implement a five-frame new-app concept as if it were the current app.
- `AP-AITLE-2`: Do not replace Aitle's existing information structure with a generic travel app flow.
- `AP-AITLE-3`: Do not remove dense search controls only to make the screen look simpler.
- `AP-AITLE-4`: Do not invent unavailable hotel data, booking actions, onboarding, or navigation.
- `AP-AITLE-5`: Do not implement generated pixels, exported HTML, or a visual candidate wholesale.
- `AP-AITLE-6`: Do not run image generation from a prompt that lacks current screenshot, invariant IDs, and forbidden changes.

## Verification

- `V-AITLE-1`: Capture before screenshots for `/home`, `/map`, `/detail`, and `/hotel/[hotel_id]`.
- `V-AITLE-2`: Capture after screenshots from the implemented branch using the same viewport.
- `V-AITLE-3`: Run typecheck/build or record `needs_setup` evidence.
- `V-AITLE-4`: Run route-level UI verification for preserved CTAs and primary flows.
- `V-AITLE-5`: `vibepro pr prepare` must show explicit spec clauses and no implicit spec fallback.
- `V-AITLE-6`: Store DesignConstraintGraph, visual hypothesis prompts, candidate artifacts or `needs_setup`, visual hypothesis gate results, and distilled implementation spec.

## Screen Design Brief Template

```text
Modernize the current Aitle screen for route <route> using VibePro's Design Cognition Loop.

Preserve:
- current route purpose
- current information hierarchy
- current CTAs
- current search/filter/detail data fields
- current navigation and state behavior

Allowed:
- visual polish
- spacing and typography improvements
- product-local token/component consistency
- clearer CTA priority
- more consistent state colors and density
- image-generated visual candidates, only after invariants and design constraints are provided

Do not:
- create a new app concept
- remove or rename current CTAs
- invent backend data or actions
- replace route/navigation structure
- implement generated pixels or exported HTML wholesale

Return 2-4 visual candidates, critique them against invariants, then return one distilled implementation direction with concrete notes.
```
