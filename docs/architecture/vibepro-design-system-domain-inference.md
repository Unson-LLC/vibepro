---
title: Design System Domain Inference Architecture
status: active
stories:
  - story-vibepro-design-system-domain-inference
---

# Design System Domain Inference Architecture

## Boundary

Domain inference belongs to the Design System evidence layer. It may summarize product semantics from route/code/brief evidence, but it must not inject a product family from CLI defaults.

## Design

- Route defaults are discovered from existing app routes when `--routes` is omitted.
- Domain classification receives:
  - product name
  - product brief
  - discovered or explicit routes
  - screen evidence from components, CTAs, state, navigation, and data dependencies
- Negated product-family mentions are removed from positive classification evidence.
- Hotel discovery requires strong positive hotel evidence. Generic `map`, `stay`, or negated hotel/booking mentions are not enough.
- Business entity terms such as `project`, `company`, `product`, `template`, `customer`, `account`, and `user` are product workflow evidence. They guide generic role responsibility text without selecting hotel discovery semantics.
- Generic fallback component roles are derived from current component/route names before static generic defaults are appended.

## Non-Goals

- Do not add a full taxonomy engine.
- Do not remove the existing Aitle/hotel discovery behavior when the evidence is explicit.
- Do not make external Design System bundles authoritative.
