---
story_id: story-vibepro-uiux-docs-feature-map
title: UI/UX workflow documentation and feature-map discoverability
status: active
view: dev
period: 2026-07
parent_design: vibepro-uiux-one-command-cockpit
source:
  type: operator_feedback
  title: "Qiita UI/UX prompt checklist gap review"
  url: https://qiita.com/yusuke_ando_vj/items/dd17a285217a15841a3a
related_stories:
  - story-vibepro-uiux-one-command-cockpit
  - story-vibepro-story-scoped-playbook-export
  - story-vibepro-ui-journey-e2e-dogfood
created_at: 2026-07-08
updated_at: 2026-07-08
reason: "ADR unnecessary: alternatives considered were adding a new UI/UX CLI workflow versus documenting the existing workflow; compatibility impact is limited to docs and VitePress page discovery with no API, CLI, schema, or runtime migration; rollback plan is to revert the docs/config commit; boundary is README, feature-map, and playbook documentation only, with no product implementation side effect; accepted followups are none."
---

# Story

The README already mentions `design-system` and `design-modernize`, but the
guide feature map and story-facing documentation do not present the UI/UX
workflow as a discoverable end-to-end path. This makes the actual capability
feel fragmented even when the underlying pieces exist.

## User Story

**As a** new or returning VibePro user<br>
**I want** the UI/UX flow documented as a single discoverable workflow in the
feature map and guides<br>
**So that** I can start from a UI/UX intent and know which VibePro artifacts,
commands, gates, and review surfaces are involved

## Scope

- Update English and Japanese guide feature maps to include UI/UX intake,
  IA flow map, native DS, design-modernize plan, screenshot capture,
  responsive/a11y matrix, UI/UX cockpit, and PR gate linkage.
- Add a short end-to-end command sequence for UI/UX modernization.
- Document authority boundaries: intake and visual hypotheses are guidance;
  Story, Spec, Architecture, route code, native DS, verification evidence, and
  Gate DAG decide readiness.
- Link the new UI/UX stories from the story-scoped playbook or equivalent
  human-readable derivative.

## Impact Scope

This is a documentation and discovery change. The affected surfaces are
README/guide copy, VitePress navigation visibility, the playbook UI/UX
template, minimal playbook link targets needed for public docs build, Story
metadata, and Design SSOT registration. VitePress source exclusion is limited
to the `_feature-template` scaffolding path and does not remove the whole
playbook corpus. CLI commands, public API behavior, configuration schema,
runtime execution, and PR creation semantics are intentionally out of scope and
are covered only by current-head verification evidence.

## Acceptance Criteria

- [ ] UIDOC-S-1: `docs/guide/feature-map.md` and the Japanese counterpart list
  UI/UX workflow capabilities.
- [ ] UIDOC-S-2: README references a single UI/UX preparation path rather than
  only separate `design-system` and `design-modernize` commands.
- [ ] UIDOC-S-3: Documentation includes the authority boundary and explicitly
  avoids treating external visual prompts as implementation truth.
- [ ] UIDOC-S-4: The example command sequence starts from an existing Story and
  ends at `pr prepare` readiness, not at a loose design artifact.
- [ ] UIDOC-S-5: Documentation build or link check evidence is recorded when
  this story is implemented.

## Non Goals

- Rewriting the whole manual.
- Creating marketing copy for VibePro.
- Moving live execution state into a separate template system.
