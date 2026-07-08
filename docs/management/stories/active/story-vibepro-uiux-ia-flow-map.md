---
story_id: story-vibepro-uiux-ia-flow-map
title: UI/UX IA and screen-flow map before per-screen modernization
status: active
view: dev
period: 2026-07
parent_design: vibepro-uiux-ia-flow-map
source_type: operator_feedback
source_title: "Qiita UI/UX prompt checklist gap review"
source_url: https://qiita.com/yusuke_ando_vj/items/dd17a285217a15841a3a
spec_docs:
  - docs/specs/story-vibepro-uiux-ia-flow-map.md
related_stories:
  - story-vibepro-journey-ai-handoff-context
  - story-vibepro-design-modernize-journey-context
  - story-vibepro-readable-journey-markdown
created_at: 2026-07-08
updated_at: 2026-07-08
---

# Story

`design-modernize` preserves existing routes, information structure, CTAs,
states, and data dependencies, but it is still screen-centric. For UI/UX work,
the operator needs a first-class IA and screen-flow artifact that explains how
the user moves through the experience before individual screens are redesigned.

## User Story

**As a** VibePro user planning a UI/UX change<br>
**I want** a story-scoped IA and screen-flow map before per-screen tasks are
generated<br>
**So that** visual improvements do not accidentally optimize isolated screens
while leaving the end-to-end user path unclear

## Scope

- Generate `.vibepro/uiux/<story-id>/ia-flow-map.json` and
  `ia-flow-map.md`.
- Classify the flow archetype, such as product app, operational cockpit,
  marketing landing page, onboarding flow, or mobile discovery flow.
- Preserve existing route evidence and Journey context, while explicitly
  separating current flow, target flow, unknown flow, and non-goals.
- Map pages or screens to purpose, primary user decision, primary CTA,
  secondary CTA, required data, error/empty/loading states, and next screen.
- Show whether the story needs a landing-page block sequence, an app task flow,
  or a mixed product-marketing structure.

## Acceptance Criteria

- [ ] UIFM-S-1: `vibepro uiux map <repo> --id <story-id>` writes an IA flow
  map from Story, Journey, route evidence, and optional UI/UX intake.
- [ ] UIFM-S-2: The map distinguishes current IA from target IA and marks
  target-only claims without evidence as `proposed`, not `confirmed`.
- [ ] UIFM-S-3: `design-modernize plan` references the IA flow map before
  screen-level design briefs.
- [ ] UIFM-S-4: PR evidence surfaces the IA flow map path for UI-heavy stories.
- [ ] UIFM-S-5: When route evidence is missing, VibePro reports the missing
  route/source instead of inventing a complete flow.

## Non Goals

- Making Journey a blocking implementation DAG.
- Replacing curated Journey authority with handoff-only AI context.
- Requiring marketing-style IA for operational product screens.
