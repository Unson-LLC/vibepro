---
title: "VibePro Design Cognition Loop Architecture"
status: draft
created_at: 2026-05-25
updated_at: 2026-05-25
related_stories:
  - story-aitle-design-modernize
related_specs:
  - docs/specs/vibepro-design-modernize-spec.md
---

# VibePro Design Cognition Loop Architecture

## Intent

VibePro must internalize the design-generation discipline observed from Moonchild without becoming a Moonchild orchestrator. The core architecture is a loop that combines current-product evidence, UX invariant locking, Design System constraints, image-based visual hypothesis exploration, DAG critique, and Codex implementation distillation.

The loop exists for existing-product modernization. Its job is to make a real screen better while preserving information architecture, route contracts, data dependencies, and user task continuity.

## Control Loop

```text
Current product code + current screenshots
  -> Current UI Evidence Gate
  -> UX Invariant Lock
  -> Design Constraint Compiler
  -> Visual Hypothesis Generator
  -> Visual Hypothesis Gate
  -> Implementation Spec Distiller
  -> Codex Implementation
  -> Before / After Visual + UX Regression Gate
```

## Responsibilities

| Node | Responsibility | Must Not Do |
|------|----------------|-------------|
| Current UI Evidence Gate | Extract routes, files, components, CTAs, states, data dependencies, navigation, and screenshots | Treat a missing screenshot as pass |
| UX Invariant Lock | Freeze route purpose, information structure, primary tasks, CTA inventory, state behavior, and data contracts | Let visual generation redefine the product flow |
| Design Constraint Compiler | Convert DS or current UI evidence into color roles, component roles, CTA priority, state semantics, density policy, navigation policy, and motion policy | Treat tokens as decorative colors only |
| Visual Hypothesis Generator | Use image generation to explore multiple visual candidates for the same locked screen structure | Generate a new app concept or remove dense operational content |
| Visual Hypothesis Gate | Score candidates against invariants, DS constraints, hierarchy, density, state clarity, accessibility, and implementation feasibility | Approve an image because it looks polished while violating UX |
| Implementation Spec Distiller | Convert accepted visual ideas into concrete file-scoped implementation instructions | Treat generated pixels or HTML as source of truth |
| Before / After Regression Gate | Compare before/after screenshots and route behavior evidence | Accept implicit fallback or unchecked visual drift |

## Data Model

### DesignConstraintGraph

```json
{
  "color_roles": ["brand", "surface", "text", "success", "warning", "location", "urgency"],
  "component_roles": ["primary_cta", "result_card", "status_badge", "filter_chip", "bottom_sheet", "bottom_navigation"],
  "cta_priority": ["primary", "secondary", "tertiary"],
  "state_semantics": ["loading", "empty", "error", "selected", "disabled", "available", "limited", "unavailable"],
  "density_policy": "dense-operational",
  "navigation_policy": ["preserve_route_purpose", "preserve_bottom_nav", "preserve_back_affordance"],
  "motion_policy": ["snappy", "state_transition_only", "no_navigation_rewrite"]
}
```

### VisualHypothesis

```json
{
  "screen_id": "/home",
  "candidate_id": "VH-HOME-1",
  "source": "image_generation",
  "input_refs": {
    "current_screenshot": ".vibepro/design-modernize/story/screenshots/home.png",
    "invariant_ids": ["INV-HOME-1", "INV-HOME-2"],
    "constraint_graph": ".vibepro/design-modernize/story/design-constraint-graph.json"
  },
  "image_artifact": ".vibepro/design-modernize/story/visual-hypotheses/home/VH-HOME-1.png",
  "design_moves": [
    "raise AI phone CTA prominence",
    "separate location metadata from price metadata",
    "preserve recent search chips"
  ],
  "rejected_moves": [
    "new onboarding hero",
    "removed bottom navigation"
  ]
}
```

### VisualHypothesisGate

```json
{
  "candidate_id": "VH-HOME-1",
  "status": "pass",
  "scores": {
    "invariant_preservation": 1,
    "cta_priority": 1,
    "density_fit": 1,
    "state_clarity": 0.8,
    "brand_fit": 0.9,
    "implementation_feasibility": 0.8
  },
  "blocking_failures": []
}
```

## Aitle Mapping

Moonchild MCP validation showed that Aitle's reference DS is not only color tokens. It includes component roles such as AI phone CTA, hotel card, compact hotel card, availability badge, filter chip, bottom sheet, and bottom navigation. It also encodes a dark mobile surface, purple primary action, mint availability, cyan location/distance, amber urgency, dense Japanese mobile typography, and Phosphor-style iconography.

VibePro must preserve the current Aitle route purposes and use image generation only after the invariant lock:

| Screen | Screen Intent | Visual Hypothesis Focus |
|--------|---------------|-------------------------|
| `/home` | Search entry | Entry hierarchy, recent chips, first result preview, primary discovery CTA |
| `/map` | Spatial exploration | Map pin hierarchy, selected result bottom sheet, filter-chip density |
| `/detail` | Filter refinement | Form grouping, selected state clarity, dense condition scanability |
| `/hotel/[hotel_id]` | Decision detail | Image hierarchy, hotel facts, availability, AI phone CTA prominence |

## Gate Policy

- Visual hypotheses are evidence, not implementation authority.
- At least one current screenshot or explicit `needs_setup` record is required before visual hypothesis generation.
- Every visual candidate must cite the invariant IDs and DesignConstraintGraph version used to generate it.
- A candidate fails if it removes discovered CTAs, changes route purpose, invents backend data, or replaces current navigation.
- Implementation specs may adopt only distilled design moves, never generated markup or pixels wholesale.
- PR readiness must include explicit `INV`, `C`, `S`, `AP`, `VH`, `DQ`, and `V` evidence.

## Rollout

1. Extend `design-modernize plan` to emit a DesignConstraintGraph and Visual Hypothesis prompt pack.
2. Extend `design-modernize capture` to store before screenshots as required visual evidence.
3. Add `design-modernize hypothesize` for image-generation candidates, with provider-agnostic artifacts.
4. Add `design-modernize critique` to score candidates against invariant and DS constraints.
5. Extend `pr prepare` so design modernization PRs include visual-hypothesis gate status before visual QA.
