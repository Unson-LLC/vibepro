---
title: VibePro Design System Bundle Ingest Architecture
status: draft
created_at: 2026-05-26
updated_at: 2026-05-26
related_stories:
  - story-vibepro-design-system-bundle-ingest
---

# VibePro Design System Bundle Ingest Architecture

`design-system ingest` is an artifact normalizer. It accepts external Design System bundle data, extracts safe summaries and candidate DS constraints, and writes VibePro-native DS sections.

The command does not persist raw external CSS/JS exports as authority. It extracts:

- CSS custom property names and safe color/spacing/font values
- component names from component arrays, CSS class names, and custom element registration strings
- guideline topics from markdown/text/object fields
- CTA/state/density/navigation hints from bundle names and guideline text

The external bundle is stored as `source_evidence.external_bundle` and `.vibepro/design-system/<ds-id>/external-bundle.json` with reference-only authority. `ds-gate.json` keeps `fallback_allowed: false`.
