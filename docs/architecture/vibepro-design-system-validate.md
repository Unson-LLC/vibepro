---
title: VibePro Design System Validate Architecture
status: draft
created_at: 2026-05-26
updated_at: 2026-05-26
related_stories:
  - story-vibepro-design-system-validate
---

# VibePro Design System Validate Architecture

`design-system validate` is a local artifact gate. It does not create or mutate Design System structure except for validation artifacts.

The command reads:

- `.vibepro/design-system/<ds-id>/design-system.json`
- sibling DS artifacts for secret scanning
- Story, Spec, and Architecture markdown/json files related to `--story-id`

The command writes validation evidence under `.vibepro/design-system/<ds-id>/validation/`.

Implementation authority remains current code, Story, Spec, Architecture, and VibePro gates. Visual foundations and generated visuals are reference material only.
