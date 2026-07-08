---
story_id: story-vibepro-uiux-structured-intake
title: UI/UX structured intake for design-modernize
status: active
area: uiux-design-modernize
source: https://qiita.com/yusuke_ando_vj/items/dd17a285217a15841a3a
parent_design: vibepro-uiux-structured-intake
---

# UI/UX structured intake for design-modernize

## Problem

`design-modernize plan` accepts a free-form `--brief`, but UI/UX implementation needs a structured intake covering target users, purpose, route scope, impression, style constraints, responsive behavior, accessibility, and design-token expectations. Vague prompts such as "make it better" should not silently look complete.

## Acceptance Criteria

- Add story-scoped UI/UX intake artifacts under `.vibepro/uiux/<story-id>/`.
- `vibepro uiux intake template <repo> --id <story-id>` writes markdown and JSON templates with required fields.
- `vibepro uiux intake validate <repo> --id <story-id>` reports missing, inferred, explicit, and not-applicable field coverage as machine-readable JSON.
- `design-modernize plan` reads the intake artifact when present and writes `uiux-intake-coverage.json`.
- Free-form `--brief` remains supported, but vague-only briefs surface `needs_intake_detail` guidance.
- Current route code, data contracts, screenshots, and VibePro story/spec artifacts remain authoritative when intake conflicts.

## Out of Scope

- Visual redesign implementation for a downstream app.
- Replacing `design-system` or `design-ssot` workflows.
- Treating generated intake text as implementation authority.
