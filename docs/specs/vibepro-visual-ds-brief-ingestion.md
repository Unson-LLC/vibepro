---
story_id: story-vibepro-visual-ds-brief-ingestion
title: Visual DS brief ingestion spec
---

# Visual DS brief ingestion spec

## Requirements

- `design-system derive` MUST accept `--brief-file <path>` and derive visual foundations from that file.
- `design-system ingest-brief` MUST require `--id <ds-id>` and `--brief-file <path>`.
- Ingested briefs MUST write `visual-foundations.json` and `visual-foundations.md` under `.vibepro/design-system/<ds-id>/`.
- `design-system.json` MUST include `visual_foundations` and `source_evidence.visual_foundations` when a brief is ingested.
- The DS gate MUST include an explicit visual-foundations authority check and MUST keep `fallback_allowed: false`.
- Visual foundations MUST be reference-only: current code, Graphify evidence, implementation mapping, and VibePro gates remain implementation authority.
- `design-modernize plan` MUST surface `visual_foundations_reference` when a reference native DS contains visual foundations.
- `normalizeDesignSystemBundle` MUST summarize VibePro-native DS semantic tokens and component roles instead of reporting zero tokens/components.
- CTA extraction MUST filter JSX/control-code noise before writing discovered CTA policy.

## Non-goals

- VibePro does not make external visual briefs implementation authority.
- VibePro does not require an external design generator.
- VibePro does not attempt perfect natural-language DS parsing in this MVP.
