---
story_id: story-vibepro-visual-ds-brief-ingestion
title: Visual DS brief ingestion architecture
---

# Visual DS brief ingestion architecture

## Decision

VibePro stores external visual DS briefs as `visual_foundations` inside the VibePro-native Design System. The brief becomes a reference layer, not the source of implementation truth.

The artifact flow is:

1. `design-system derive --brief-file` or `design-system ingest-brief --brief-file` reads a Markdown/text brief.
2. VibePro extracts visual foundations into structured buckets: design language, density, semantic colors, typography, spacing/radius/motion/shadow, component visuals, composition, native CTA language, and forbidden generic CTA language.
3. VibePro writes `visual-foundations.json` and `visual-foundations.md`.
4. `design-system.json` records `visual_foundations` plus `source_evidence.visual_foundations`.
5. `ds-gate.json` records the authority boundary.
6. `design-modernize plan` carries the visual foundations reference forward when a native DS is used as the reference bundle.

## Rationale

The external brief is useful for concrete visual judgment, but product evidence must still control implementation. Keeping visual foundations as a typed reference lets Codex and reviewers see color, density, composition, and CTA guidance without allowing a generated or external design to override current routes, information architecture, state behavior, or data dependencies.

## Boundaries

- Current code, Graphify evidence, implementation mapping, and Gate DAG remain authoritative.
- Unsupported or missing visual brief input blocks the ingest command instead of silently producing empty authority.
- Native DS bundle normalization understands VibePro-native artifact shape so downstream plans do not degrade to zero-token/zero-component summaries.
