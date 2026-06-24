---
title: VibePro DESIGN.md Gate Spec
status: draft
created_at: 2026-06-24
updated_at: 2026-06-24
related_stories:
  - story-vibepro-design-md-gate
---

# VibePro DESIGN.md Gate Spec

## Commands

`vibepro design-system ingest-design-md [repo] --id <ds-id> --file <file> [--product <name>] [--json]`

`vibepro design-system export-design-md [repo] --id <ds-id> [--json]`

`vibepro design-system export [repo] --id <ds-id> --format design-md [--json]`

`vibepro design-system lint [repo] --id <ds-id> [--file <file>] [--json]`

`vibepro design-system diff [repo] --id <ds-id> --base <base-ref> [--json]`

## Input

The DESIGN.md input may include:

- optional YAML front matter delimited by `---`
- token groups such as `colors`, `typography`, `rounded`, `spacing`, and `components`
- token references using `{path.to.token}`
- Markdown sections including Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, and Do's and Don'ts
- unknown sections, which must be preserved and must not fail ingestion

## Output

Ingestion writes or updates `.vibepro/design-system/<ds-id>/` artifacts:

- `DESIGN.md`
- `design-md.json`
- `design-system.json`
- `theme-tokens.json`
- `semantic-tokens.json`
- `component-roles.json`
- `component-states.json`
- `cta-policy.json`
- `density-policy.json`
- `anti-patterns.json`
- `evidence-coverage.json`
- `ds-gate.json`

## Authority

The aggregate Design System MUST keep `authority: vibepro_native_design_system`. DESIGN.md content MUST be recorded as reference evidence only. Current code, Story, Spec, Architecture, and VibePro gates remain implementation authority.

## Lint Checks

The linter MUST report:

- `DS-DESIGN-MD-BROKEN-REF` for unresolved token references
- `DS-DESIGN-MD-DUPLICATE-SECTION` for repeated canonical sections
- `DS-DESIGN-MD-SECTION-ORDER` for canonical sections out of order
- `DS-DESIGN-MD-MISSING-PROSE-INTENT` when no meaningful body prose exists
- `DS-DESIGN-MD-MISSING-DO-DONT` when no Do/Don't guidance exists
- `DS-DESIGN-MD-CONTRAST` for component background/text color pairs that can be checked and fail AA contrast
- `DS-DESIGN-MD-TOKEN-SUMMARY` with extracted token and section counts

## Diff Checks

Diff MUST compare current DESIGN.md with the selected base ref artifact and return:

- token groups added, removed, and modified
- sections added and removed
- lint summary before/after
- `regression: true` when current errors increase, current warnings increase, prose intent disappears, or Do/Don't coverage disappears

## Non-goals

- VibePro does not attempt full YAML spec compatibility in this MVP.
- VibePro does not make DESIGN.md a replacement for Story, Spec, Architecture, current code, screenshots, Graphify evidence, or PR Gate DAG evidence.
- VibePro does not require the external `@google/design.md` package to be installed.
