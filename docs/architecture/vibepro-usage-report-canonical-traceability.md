---
story_id: story-vibepro-usage-report-canonical-traceability
title: Usage Report Canonical Traceability Architecture
---

# Architecture

## Decision

`usage report` should treat traceability as a resolved evidence source, not as a hard dependency on the current checkout's `.vibepro/pr/<story-id>` directory.

## Resolution Order

The report first reads local `.vibepro` artifacts because they are current for active work. If local artifacts are absent, it reads canonical audit bundles and tracked traceability records. Manifest merge records can add PR URL and merge metadata, but they do not replace verification or review evidence unless the canonical bundle points to those artifacts.

## Output Shape

Each story row exposes which source was selected and whether the traceability gap is actual or resolved through an alternate surface. Aggregate metrics count true gaps separately from alternate-source resolutions.

## Boundary

This does not query GitHub or infer old PRs by branch naming. The architecture stays file-backed so offline/fresh checkout audits remain reproducible.
