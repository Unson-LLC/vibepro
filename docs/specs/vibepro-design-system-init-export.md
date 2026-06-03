---
title: VibePro Design System Init and Export Spec
status: draft
created_at: 2026-06-03
updated_at: 2026-06-03
related_stories:
  - story-vibepro-design-system-init-export
---

# VibePro Design System Init and Export Spec

## Commands

`vibepro design-system init [repo] --id <ds-id> --product <name> [--json]`

`vibepro design-system export [repo] --id <ds-id> --format json|markdown|css [--json]`

## Init Contract

`design-system init` MUST create `.vibepro/design-system/<ds-id>/` and write the same core artifact family used by derived or ingested native DS artifacts.

Required initialized artifacts:

- `design-system.json`
- `design-system.md`
- `product-semantics.json`
- `theme-tokens.json`
- `semantic-tokens.json`
- `component-roles.json`
- `component-states.json`
- `screen-patterns.json`
- `cta-policy.json`
- `density-policy.json`
- `navigation-policy.json`
- `anti-patterns.json`
- `implementation-mapping.json`
- `evidence-coverage.json`
- `ds-gate.json`

The initialized aggregate DS MUST include `schema_version`, `workflow: native-design-system-init`, `design_system_id`, `product_id`, `product`, `authority: vibepro_native_design_system`, and `authority_boundary`.

Empty sections MUST be structurally valid arrays/objects. Empty tokens, component roles, component states, CTA hierarchy, navigation policy, and density policy MUST NOT be represented by missing fields.

## Gate Semantics

The initialized DS gate MUST keep `fallback_allowed: false`.

The initialized DS gate MUST report `needs_evidence`. It MUST NOT report pass until product evidence has been derived, ingested, or validated.

## Export Contract

JSON export MUST emit the aggregate `design-system.json` content.

Markdown export MUST emit the same human-readable summary used by `design-system.md`.

CSS export MUST emit CSS custom-property aliases when theme or semantic token evidence exists.

CSS export MUST return `status: needs_tokens` when no semantic/theme token evidence exists.

Unknown export formats MUST fail with a clear `--format json|markdown|css` error.
