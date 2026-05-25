---
title: VibePro Derived Design System Spec
status: active
created_at: 2026-05-25
updated_at: 2026-05-25
---

# VibePro Derived Design System Spec

## Purpose

Derived Design System is VibePro's internal design constraint model for existing UI modernization. It captures the design cognition step learned from Moonchild: before generating screens, first define the product-local design decision space.

This model is not a Moonchild export and does not require an external image or design-system generator. External Design System bundles remain optional reference evidence.

## CLI

```bash
vibepro design-modernize derive-system <repo> \
  --id <story-id> \
  --product <name> \
  --routes /home,/map,/detail \
  --brief "<product brief>"
```

`design-modernize plan` must also derive the same internal system and include it in the plan.

## Required Outputs

`derive-system` and `plan` write these artifacts under `.vibepro/design-modernize/<story-id>/`:

- `product-semantic-model.json`
- `derived-design-system.json`
- `component-role-map.json`
- `composition-guidelines.md`
- `ds-gate.json`

`derive-system` additionally writes:

- `design-system-derivation.json`
- `design-system-derivation.md`

## Product Semantic Model

The product semantic model must include:

- `primary_domain`
- `language_policy`
- `interaction_model`
- `domain_concepts`
- route intents
- current CTAs
- forbidden patterns

For a Japanese hotel discovery app, the model should identify hotel discovery, Japanese UI, location/map/condition search, plan types, availability, price, distance, facilities, and AI phone confirmation when present in the brief or current UI evidence.

## Derived Design System

The derived system must include:

- identity: product, design language, interaction model, language policy
- foundations: theme order, token dependency order, density, typography, motion
- semantic tokens: color roles, state semantics, CTA priority, domain semantics
- component role map: responsibilities and usage constraints
- composition guidelines: screen structure and layout rules
- CTA hierarchy
- anti-patterns
- visual hypothesis policy

The component role map must describe responsibility, not just component names. For Aitle-like hotel discovery this includes SearchBar, SegmentedSearchMode, PlanTypeSelector, FilterChip, HotelCard, CompactHotelCard, MapPricePin, BottomSheet, BottomNavigation, PageHeader, AIPhoneCTA, FacilityBadge, AvailabilityBadge, and PlanBadge when applicable.

## Visual Hypothesis Policy

Image generation is optional and non-authoritative. It is used to explore 2-4 candidate visual directions after the UX invariant lock and design system derivation.

Each candidate must record:

- preserved UX
- design moves
- risky or rejected moves
- implementation notes
- DS drift risks

Implementation authority remains:

- VibePro spec
- current code
- current screenshots
- Graphify/Codex evidence
- Gate DAG evidence

## DS Gate

`ds-gate.json` must be explicit and must set `fallback_allowed: false`.

Required checks:

- `DS-GATE-IDENTITY`: product identity, interaction model, language policy, and forbidden patterns exist
- `DS-GATE-SEMANTICS`: semantic tokens cover surface, text, brand/interactive, state colors, CTA priority, density, motion, and domain semantics
- `DS-GATE-COMPONENT-ROLES`: component roles define responsibility and usage constraints
- `DS-GATE-COMPOSITION`: composition guidelines preserve route hierarchy, navigation, card/list usage, badge order, and primary CTA placement
- `DS-GATE-VISUAL-HYPOTHESIS`: image generation is candidate evidence and not implementation authority
- `DS-GATE-ANTI-PATTERN`: anti-pattern coverage is explicit

## Anti-patterns

The derived system must reject:

- net-new app concepts
- navigation rewrites without evidence
- invented backend data
- marketing landing-page composition for operational product screens
- generic booking CTAs when the product has a native confirmation model

## Verification

Tests must cover:

- standalone `derive-system`
- `plan` embedding derived system artifacts
- Aitle-like hotel discovery semantics
- CLI help discoverability
- README discoverability
- explicit DS gate checks
