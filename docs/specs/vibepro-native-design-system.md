---
title: VibePro Native Design System Spec
status: active
created_at: 2026-05-26
updated_at: 2026-05-26
---

# VibePro Native Design System Spec

## Purpose

`design-system derive` creates a product-local Design System from existing product evidence. It is the reusable DS source for screen modernization, implementation specs, and DS drift gates.

The command does not create a new product concept. It reads current routes, code, style/token files, optional Graphify artifacts, and a product brief, then writes explicit constraints that coding agents can verify.

## CLI

```bash
vibepro design-system derive <repo> \
  --id <ds-id> \
  --product <name> \
  --routes /home,/map,/detail \
  --brief "<product brief>" \
  --from-code \
  --run-graphify
```

`--run-graphify` is optional. When graph artifacts are absent, VibePro still derives a DS from code and style evidence, but `evidence-coverage.json` must warn that graph evidence is missing.

## Outputs

The command writes under `.vibepro/design-system/<ds-id>/`:

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

## Required Model

The aggregate `design-system.json` must include:

- `product_semantics`: product domain, language policy, interaction model, route intents, native CTAs, forbidden patterns
- `theme_tokens`: raw style evidence from CSS variables, style classes, color values, spacing values
- `semantic_tokens`: surface, text, brand/interactive, status, domain, and CTA semantics
- `component_roles`: reusable UI roles and their responsibilities
- `component_states`: loading, empty, error, selected, disabled, success, available, limited, unavailable
- `screen_patterns`: route family, intent, current components, CTAs, states, data dependencies, navigation targets, UX invariants
- `cta_policy`: product-native action hierarchy and rules
- `density_policy`: scanability and information-density constraints
- `navigation_policy`: route purpose and navigation continuity constraints
- `anti_patterns`: forbidden design moves
- `implementation_mapping`: route/component/file mapping for implementation handoff
- `evidence_coverage`: pass/warn/fail findings for routes, styles, graph evidence, implementation mapping, semantics
- `ds_gate`: explicit DS gate with fallback disabled

## Gate Rules

- DS derivation must not silently pass with no route/code evidence.
- Missing Graphify evidence is a warning, not a failure, unless the caller explicitly requires `--run-graphify`.
- Missing style/token evidence is a warning.
- Missing semantic color roles is a failure.
- `ds-gate.json` must keep `fallback_allowed: false`.
- Product-native primary CTA wording must not be replaced by generic conversion language without Story or Spec evidence.

## Non-goals

- Do not replace Figma or visual design tools.
- Do not require an external visual generator.
- Do not treat generated visual candidates as implementation authority.
- Do not infer backend data or route structures that are not present in current evidence.
