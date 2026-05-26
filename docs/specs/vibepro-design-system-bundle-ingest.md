---
title: VibePro Design System Bundle Ingest Spec
status: draft
created_at: 2026-05-26
updated_at: 2026-05-26
related_stories:
  - story-vibepro-design-system-bundle-ingest
---

# VibePro Design System Bundle Ingest Spec

## Command

`vibepro design-system ingest [repo] --id <ds-id> --bundle <file> [--product <name>] [--json]`

## Input

The command accepts JSON bundles with any of these shapes:

- `tokens`, `designTokens`, `files.tokens`, `bundle.theme`, `bundle.styles`
- `components`, `files.components`, `bundle.componentsCss`, `bundle.componentsJs`
- `guidelines`, `files.guidelines`, `overview`, `bundle.documentation`

String-based CSS/JS exports are accepted as reference evidence. Raw string exports are not persisted as implementation authority.

## Output

The command writes or updates `.vibepro/design-system/<ds-id>/` artifacts:

- `design-system.json`
- `theme-tokens.json`
- `semantic-tokens.json`
- `component-roles.json`
- `component-states.json`
- `cta-policy.json`
- `density-policy.json`
- `navigation-policy.json`
- `anti-patterns.json`
- `evidence-coverage.json`
- `ds-gate.json`
- `external-bundle.json`

## Authority

The resulting DS MUST keep `authority: vibepro_native_design_system`. External bundle content is recorded as reference evidence only. Current code, Story, Spec, Architecture, and VibePro gates remain implementation authority.

## Secret Handling

Likely credentials, API keys, bearer tokens, and live secret patterns from the input bundle MUST be omitted from persisted DS artifacts. The artifact may record redaction counts but not the original value.
