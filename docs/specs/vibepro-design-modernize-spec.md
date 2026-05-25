---
title: "VibePro Design Modernize Workflow Spec"
status: draft
created_at: 2026-05-25
updated_at: 2026-05-25
---

# VibePro Design Modernize Workflow Spec

## Purpose

`design-modernize` turns an existing UI into VibePro's internal Design Quality DAG. It is for improving a real product screen while preserving current information architecture, route contracts, data dependencies, and user flows.

It does not require Moonchild or any external generator. External Design System bundles can be used as optional reference material, but the gate logic lives in VibePro.

The workflow may use image generation, but only as visual hypothesis exploration after the current UX invariants and design constraints are locked. Generated images are evidence for critique and distillation, not source-of-truth implementation artifacts.

## CLI

```bash
vibepro design-modernize plan <repo> \
  --id <story-id> \
  --product <name> \
  --routes /home,/map,/detail,/hotel/[hotel_id] \
  --design-system-id <optional-reference-design-system-id> \
  --design-system-title <name> \
  --design-system-bundle <bundle-json> \
  --base-url <running-app-url>

vibepro design-modernize capture <repo> \
  --id <story-id> \
  --base-url <running-app-url> \
  --routes /home,/map,/detail,/hotel/[hotel_id] \
  --sample-hotel-id <id>
```

## Outputs

The command writes:

- `.vibepro/design-modernize/<story-id>/design-modernize.json`
- `.vibepro/design-modernize/<story-id>/design-modernize.md`
- `.vibepro/design-modernize/<story-id>/design-briefs.md`
- `.vibepro/design-modernize/<story-id>/implementation-spec.md`
- `.vibepro/design-modernize/<story-id>/design-constraint-graph.json`
- `.vibepro/design-modernize/<story-id>/visual-hypothesis-prompts.md`
- `.vibepro/design-modernize/<story-id>/visual-hypotheses/<screen>/*.png` when image generation is run
- `.vibepro/design-modernize/<story-id>/visual-hypothesis-gate.json` when visual candidates are critiqued
- `.vibepro/design-modernize/<story-id>/design-system-bundle.json` when a bundle file is supplied
- `.vibepro/design-modernize/<story-id>/screen-capture.json`
- `.vibepro/design-modernize/<story-id>/screen-capture.md`
- `.vibepro/design-modernize/<story-id>/screenshots/*.png` when Playwright can run

## Workflow

1. Graphify/Codex evidence extraction:
   VibePro resolves route files and adjacent screen components, then extracts route, component, state, CTA, data dependency, and navigation hints.

2. Current screen capture:
   Each screen spec defines the route URL, mobile viewport, and screenshot artifact name. `design-modernize capture` reads the plan or explicit route list and captures current browser screenshots. If Playwright or a running base URL is unavailable, it writes a `needs_setup` record instead of silently passing.

3. Design System ingestion:
   Optional bundle material is normalized into token, component, guideline, and design-constraint summaries. Required constraint dimensions include semantic color roles, state colors, CTA priority, information density, navigation structure, motion guidance, and component responsibility.

4. Design Constraint Graph compilation:
   VibePro converts DS and current UI evidence into explicit roles: `ColorRole`, `ComponentRole`, `CTAOrder`, `StateSemantics`, `DensityPolicy`, `NavigationPolicy`, and `MotionPolicy`.

5. Visual hypothesis generation:
   VibePro may call an image-generation provider to create 2-4 visual candidates per screen. The prompt must include the current screenshot, locked invariants, screen intent, DS constraints, density policy, and forbidden changes. The prompt must ask for the same information structure, not a new app concept.

6. Visual hypothesis critique:
   VibePro scores each candidate for invariant preservation, CTA priority, density fit, state clarity, brand fit, accessibility, navigation continuity, and implementation feasibility. Blocking failures reject the candidate before implementation spec generation.

7. Screen-level spec generation:
   Each route receives explicit invariants, contracts, scenarios, anti-patterns, design brief text, and Codex acceptance criteria.

8. Design Quality DAG:
   VibePro reviews each screen through hierarchy, density, CTA priority, state clarity, accessibility, navigation continuity, and implementation-scope gates.

9. Codex implementation:
   VibePro spec, Graphify evidence, current screenshots, and current code remain authoritative. External generated designs or image hypotheses are reference material only.

## Design Cognition Loop

```text
Observe current code and screenshot
  -> Lock UX invariants
  -> Compile DesignConstraintGraph
  -> Generate visual hypotheses with image generation
  -> Critique visual hypotheses through VibePro DAG gates
  -> Distill accepted design moves into implementation spec
  -> Implement with Codex
  -> Verify before/after UX and visual quality
```

## Visual Hypothesis Prompt Contract

Each screen prompt must be short, screen-specific, and constrained.

Required inputs:

- current screenshot reference
- route and screen intent
- invariant IDs and statements
- current CTAs and navigation paths
- current states and data dependencies
- DesignConstraintGraph summary
- density policy
- anti-patterns

Required output:

- 2-4 candidate images or image prompts
- candidate-specific design moves
- preserved UX list
- rejected or risky moves
- implementation notes suitable for Codex

Prompt template:

```text
Modernize the existing <product> screen <route> using the provided current screenshot.

Keep the same information structure, CTAs, route purpose, navigation, state behavior, and data dependencies:
<invariants>

Apply these design constraints:
<design-constraint-graph-summary>

Generate <n> visual candidates for the same screen. Explore hierarchy, spacing, CTA prominence, state clarity, and brand fit. Do not create a new app concept, remove dense operational content, invent data, or change navigation.

For each candidate, return the intended design moves, preserved UX, risky moves, and implementation notes.
```

## Visual Hypothesis Gate

Required checks:

- `VH-INV`: Candidate preserves route purpose, information structure, CTAs, navigation, and data dependencies.
- `VH-CTA`: Candidate keeps primary, secondary, and tertiary CTA hierarchy aligned with the DesignConstraintGraph.
- `VH-DENSITY`: Candidate improves scanability without reducing required information density.
- `VH-STATE`: Candidate keeps semantic state colors and affordances distinct.
- `VH-BRAND`: Candidate uses product-local visual vocabulary instead of generic mobile-app styling.
- `VH-A11Y`: Candidate maintains contrast, target size, and readable Japanese mobile typography.
- `VH-IMPL`: Candidate can be implemented within discovered files or justified shared components.
- `VH-AP`: Candidate does not introduce net-new onboarding, route structure, backend data, or navigation model.

## Moonchild MCP Validation

Validated on 2026-05-25 through HTTP JSON-RPC against `https://forge.moonchild.ai/mcp`. The token was injected only from the current tmux global environment and verified by length, not printed.

Observed tools:

- `organization_list`
- `design_system_list`
- `design_system_get`
- `design_system_list_versions`
- `design_system_get_files`
- `design_system_get_bundle`
- `design_system_search`
- `scene_list`
- `scene_get`
- `frame_get`
- `frame_get_screenshot`
- `frame_get_export`
- `url_resolve`

Aitle facts observed through MCP:

- Published Design System id: `1c436280-9432-4bf0-b4fd-15585d6482f0`
- Published Design System title: `Aitle`
- Published Design System version: `1`
- Design System bundle shape: `{ version, bundle }`, where `bundle.theme`, `bundle.styles`, `bundle.componentsCss`, and `bundle.componentsJs` are string assets.
- Scene id: `eaa54dae-7f7a-4f00-afce-f1bf44a7095b`
- Scene title: `Aitle モバイル Flows`
- Frames: `Home Search Entry`, `Map Search`, `Detail Filters`, `Search Results`, `Hotel Detail`
- Frame screenshots are available as `image/png`.
- `frame_get_export` returns frame metadata, linked Design System metadata, fonts, HTML, and image assets.

Interpretation for VibePro:

- Moonchild is useful as observed reference evidence, but it is not required for the `design-modernize` workflow.
- VibePro must ingest string-based token/style/component bundles as constraints, not only structured JSON token objects.
- The durable product behavior belongs in VibePro's Design Quality DAG: invariant lock, information architecture preservation, CTA hierarchy, state clarity, density control, accessibility, and implementation acceptance.
- Generated or external frame output remains non-authoritative reference material when it conflicts with current product code, current screenshots, or explicit VibePro gate clauses.

## Spec Gate

The gate must be explicit and must not fall back to implicit checks.

Required clause families:

- `INV-*`: route, UX, CTA, data dependency, and information-structure invariants.
- `C-*`: implementation scope and Design System application contracts.
- `S-*`: route-level task scenarios that must still work after modernization.
- `AP-*`: anti-patterns, especially net-new app generation and generated-design-as-source-of-truth.
- `DQ-*`: design quality checks for hierarchy, density, CTA priority, state clarity, accessibility, and implementation fit.
- `VH-*`: visual hypothesis generation and critique checks for image-generated design candidates.
- `V-*`: verification evidence for before/after screenshots, typecheck/build, route-level review, and design drift checks.

Blocking conditions:

- A screen has no explicit invariant.
- A changed screen lacks before/after screenshot evidence or a `needs_setup` record.
- Any generated or inferred design output removes discovered CTAs or introduces an unrelated navigation model.
- Any image-generated candidate is used as implementation authority without visual hypothesis gate evidence.
- Implementation touches files outside the screen evidence without a Graphify-supported reason.
- The PR gate reports `spec: implicit` or missing acceptance criteria.
