---
title: VibePro DESIGN.md Gate Architecture
status: draft
created_at: 2026-06-24
updated_at: 2026-06-24
related_stories:
  - story-vibepro-design-md-gate
---

# VibePro DESIGN.md Gate Architecture

`design-system ingest-design-md` is a reference-evidence adapter for human and agent readable design intent. It accepts a DESIGN.md file with optional YAML front matter and Markdown rationale, extracts safe structural signals, and maps them into the VibePro-native Design System artifact family.

The command does not make DESIGN.md implementation authority. The aggregate `design-system.json` keeps `authority: vibepro_native_design_system`; `source_evidence.design_md` records the imported file, parser status, and artifact paths. Current code, Story, Spec, Architecture, screenshots, Graphify/Codex evidence, and VibePro gates remain authoritative.

## Artifact Flow

1. Parse optional YAML front matter into a conservative token tree.
2. Parse Markdown body into canonical sections, unknown sections, rationale text, and Do/Don't statements.
3. Validate broken token references, duplicate sections, section order, token coverage, component contrast pairs, prose intent, and Do/Don't coverage.
4. Update VibePro-native DS sections with reference-only token, component, CTA, density, typography, and anti-pattern signals.
5. Write `.vibepro/design-system/<ds-id>/DESIGN.md` and `design-md.json`.
6. Add `DS-GATE-DESIGN-MD-*` checks to `ds-gate.json` with `fallback_allowed: false`.

## Diff Flow

`design-system diff --base <ref>` reads `.vibepro/design-system/<ds-id>/DESIGN.md` from the selected git ref and compares it with the current artifact. It reports token additions/removals/modifications, section additions/removals, warning/error deltas from lint summaries, and a regression flag when the current file has more blocking findings or loses rationale/Do-Don't coverage.

## Boundary

DESIGN.md is optimized for readability and design-intent transport. It can guide VibePro-native DS derivation and review, but implementation still follows VibePro-native DS gates, current implementation evidence, and Story/Spec/Architecture constraints.

## Decision Quality

### Public Contract

- Alternatives considered: reuse `design-system ingest --bundle` as the only import path, add a dependency on the external `@google/design.md` package, or implement a local DESIGN.md adapter. The local adapter is selected because it preserves VibePro-native authority while accepting the readable token/rationale shape without adding an optional runtime dependency.
- Compatibility impact: the change adds new CLI commands and a new `design-md` export format. Existing `design-system ingest`, `derive`, `export json|markdown|css`, and `validate` contracts stay compatible. The aggregate Design System keeps `authority: vibepro_native_design_system`, so DESIGN.md cannot replace current code, Story, Spec, Architecture, or gate evidence.
- Rollback plan: revert the DESIGN.md command wiring and `src/design-system.js` adapter additions. Existing non-DESIGN.md Design System artifacts remain valid because the new artifacts are additive under `.vibepro/design-system/<ds-id>/` and are not required by the older commands.
- Boundary: DESIGN.md is reference evidence for design intent only. It may populate VibePro-native DS sections, but gate decisions continue to use the native DS, current code evidence, Graphify/Codex evidence, Story/Spec/Architecture, and PR Gate DAG.
- Accepted followups: full YAML compatibility and native `@google/design.md` package integration are deferred as non-blocking follow-ups; this MVP intentionally supports the conservative YAML/token subset needed for VibePro gate evidence.

### Scope Reviewability

- Boundary: this PR contains one coherent workflow: DESIGN.md ingestion, lint/export/diff surfaces, docs, and tests. It does not change visual modernization execution, validation semantics outside DESIGN.md, or external package management.
- Accepted followups: broader package-level interoperability and richer generated report UI are tracked as follow-ups, not as hidden scope inside this PR.
