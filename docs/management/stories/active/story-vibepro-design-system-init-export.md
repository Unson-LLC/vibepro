---
story_id: story-vibepro-design-system-init-export
title: Design System scaffold and export lifecycle commands
view: dev
period: 2026-05
github_issue: 83
spec_docs:
  - ../../specs/vibepro-design-system-init-export.md
reason: Existing Design System CLI lifecycle architecture is reused; this story adds scaffold/export commands without introducing a new subsystem boundary.
status: active
created_at: 2026-06-03
updated_at: 2026-06-03
---

# Design System scaffold and export lifecycle commands

## Background

VibePro-native Design System derivation, visual brief ingestion, external bundle ingestion, and validation already exist. The remaining lifecycle gap is the ability to create a DS before route/code evidence exists and to export the DS for humans or tools after it has been managed by VibePro.

## Purpose

Add first-class `design-system init` and `design-system export` commands so VibePro-native DS artifacts can be created, reviewed, shared, and consumed without pretending that an empty scaffold is complete evidence.

## Acceptance Criteria

- `vibepro design-system init <repo> --id <ds-id> --product <name>` creates `.vibepro/design-system/<ds-id>/`.
- The initialized DS records product id/name, schema version, authority boundary, empty-but-valid token/component/state/CTA sections, and `authority: vibepro_native_design_system`.
- The initialized `ds-gate.json` keeps `fallback_allowed: false` and reports `needs_evidence` instead of pass.
- `vibepro design-system export <repo> --id <ds-id> --format json` emits the aggregate Design System JSON.
- `vibepro design-system export <repo> --id <ds-id> --format markdown` emits the human-readable Design System summary.
- `vibepro design-system export <repo> --id <ds-id> --format css` emits CSS custom properties when semantic/theme tokens exist.
- CSS export returns a clear `needs_tokens` result when no semantic/theme tokens exist.
- Help and README document both commands.
