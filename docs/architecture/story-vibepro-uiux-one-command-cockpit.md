# story-vibepro-uiux-one-command-cockpit Architecture

## Shape

`src/uiux-prepare.js` owns the one-command read model. It collects existing
Story, intake, IA, journey, Design System, style preset, responsive/a11y,
visual, verification, and PR gate artifacts. The module writes only UI/UX
workspace artifacts under `.vibepro/uiux/<story-id>/`.

`src/cli.js` exposes `vibepro uiux prepare [repo] --id <story-id>` and returns
the JSON readiness model with `--json`.

`src/canonical-audit.js` keeps HTML out of canonical source-of-truth data. The
bounded `pr prepare --view design-ssot` projection only points reviewers to the
readiness JSON and cockpit HTML.

## Status Model

Readiness is a prioritized status:

- `blocked` for missing Story, invalid artifacts, or unresolved blocking PR
  gates.
- `needs_intake` when structured intake coverage is missing or incomplete.
- `needs_journey` when journey context is missing or not curated.
- `needs_design_system` when native or derived Design System evidence is
  missing or not validated.
- `needs_evidence` when IA, responsive/a11y, visual, or verification evidence
  is still missing.
- `ready` when all sections are present and no blocking gates remain.

## Authority Boundary

The cockpit is a navigation surface. Story, Spec, Architecture, current code,
Design System artifacts, verification artifacts, and VibePro gate artifacts
remain authoritative.
