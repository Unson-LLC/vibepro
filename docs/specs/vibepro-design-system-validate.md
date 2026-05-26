---
story_id: story-vibepro-design-system-validate
title: Design System validation spec
---

# Design System validation spec

## Requirements

- `design-system validate` MUST require `--id <ds-id>` and `--story-id <story-id>`.
- Validation MUST read `.vibepro/design-system/<ds-id>/design-system.json`.
- Validation MUST collect selected Story/Spec/Architecture context when available.
- Validation MUST emit `.vibepro/design-system/<ds-id>/validation/<story-id>.json` and `.md`.
- Findings MUST use `pass`, `needs_evidence`, `needs_review`, or `block`.
- Validation MUST check DS authority drift, CTA priority evidence, state semantics evidence, component role evidence, navigation/density evidence, Story alignment, and secret-like values in DS artifacts.
- Secret-like values in DS artifacts MUST produce `block`.
- Missing Story/Spec/Architecture context MUST produce `needs_evidence`, not silent pass.

## Non-goals

- Validation does not replace visual review or route-level UI tests.
- Validation does not prove screenshots match DS tokens.
- Validation does not mutate Design System artifacts.
