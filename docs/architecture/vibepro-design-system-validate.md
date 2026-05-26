---
story_id: story-vibepro-design-system-validate
title: Design System validation architecture
---

# Design System validation architecture

## Decision

Add `design-system validate` as the gate-oriented companion to `design-system derive` and `ingest-brief`.

The command reads the native DS aggregate artifact, reads Story/Spec/Architecture context for the target story, evaluates explicit DS validation findings, and writes immutable validation evidence under `.vibepro/design-system/<ds-id>/validation/`.

## Validation Model

The validation result contains:

- design system id and story id
- status summary
- Story source references
- findings with one of `pass`, `needs_evidence`, `needs_review`, or `block`
- authority statement that current code, graph evidence, implementation mapping, and gates remain authoritative

The MVP checks artifact completeness and policy presence rather than screenshot-level visual compliance. It intentionally blocks on secret-like values because DS artifacts may be passed into agents and PR bodies.

## Boundaries

- Validation does not mutate native DS artifacts.
- Missing evidence is surfaced as `needs_evidence` or `needs_review`; it is not converted into an implicit pass.
- Future PR Gate integration can consume the validation JSON without reparsing Markdown.
