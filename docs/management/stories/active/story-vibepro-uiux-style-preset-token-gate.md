---
story_id: story-vibepro-uiux-style-preset-token-gate
title: UI/UX style presets and token compliance gate
status: active
view: dev
period: 2026-07
parent_design: vibepro-uiux-style-preset-token-gate
source_type: operator_feedback
source_title: "Qiita UI/UX prompt checklist gap review"
source_url: https://qiita.com/yusuke_ando_vj/items/dd17a285217a15841a3a
spec_docs:
  - docs/specs/story-vibepro-uiux-style-preset-token-gate.md
related_stories:
  - story-vibepro-uiux-structured-intake
  - story-vibepro-uiux-ia-flow-map
  - story-vibepro-design-md-gate
created_at: 2026-07-08
updated_at: 2026-07-08
---

# Story

VibePro can gather structured UI/UX intent and preserve current route evidence,
but visual direction is still too easy to express as vague prose. The workflow
needs product-archetype style presets that make the intended UI posture concrete
while keeping implementation bounded by native Design System tokens and
component roles.

## User Story

**As a** VibePro user modernizing an existing UI<br>
**I want** product-archetype style presets connected to token/component
compliance checks<br>
**So that** visual direction is concrete, comparable, and bounded by the native
Design System instead of becoming ad hoc styling

## Scope

- Add style preset metadata for operator/developer cockpit, B2B SaaS,
  marketing landing page, onboarding flow, and mobile discovery.
- Each preset defines density, layout posture, color posture, typography
  posture, component usage, motion posture, and anti-patterns.
- Let UI/UX intake choose or infer a preset with confidence and evidence.
- Connect preset guidance to native DS tokens and component roles.
- Add a validation gate that detects one-off color, typography, radius, shadow,
  or spacing values in changed UI/style files when token policy is bypassed.

## Acceptance Criteria

- [ ] UIST-S-1: UI/UX intake and `design-modernize plan` can record selected
  style preset with evidence and confidence.
- [ ] UIST-S-2: Presets are guidance only; native DS, Story, Spec,
  Architecture, route code, and Gate DAG remain authoritative.
- [ ] UIST-S-3: `design-system validate` reports changed-style findings when a
  UI change introduces one-off color, typography, radius, shadow, or spacing
  values outside native token policy.
- [ ] UIST-S-4: The default archetype is operator/developer cockpit, not
  marketing landing page.
- [ ] UIST-S-5: Non-web or low-style repos can mark style preset coverage
  `not_applicable` with explicit rationale and evidence.

## Non Goals

- Replacing native Design System tokens with preset-specific tokens.
- Treating a preset as implementation authority.
- Running visual screenshot automation for CLI-only validation changes.
