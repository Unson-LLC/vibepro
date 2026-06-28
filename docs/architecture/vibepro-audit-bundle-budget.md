---
story_id: story-vibepro-audit-bundle-budget
title: Canonical Audit Bundle Budget Architecture
---

# Canonical Audit Bundle Budget Architecture

Canonical audit has three surfaces with different jobs:

- `audit-index.json`: authoritative machine-readable decision and cost surface.
- `decision-summary.md`: short human-readable handoff summary.
- `audit-bundle.json`: manifest of canonical files and replay references.

The bundle should not duplicate the index. Duplication increases persisted artifact lines without increasing audit value, because daily automation and handoff already read the index directly.

## Compact Bundle Shape

The compact bundle keeps:

- paths to the index, summary, and compressed replay bundle
- merge summary
- handoff replay status and command
- digest-backed raw artifact manifest
- missing/unresolved reference summaries

It omits:

- full `decision_index`
- full `cost_summary`
- full `automation_value_audit`
- raw lifecycle payload bodies

## Cost Semantics

`artifact_lines` should represent what the canonical repo actually persists for future audits. Internal objects used during promotion are not part of the carried audit burden and should not be counted when they contain fields that are not written.

## Rollback

Reverting this story restores the previous compact replay behavior where the bundle also carried duplicated decision/cost bodies. Historical canonical bundles remain readable because replay falls back through payload, index, and bundle fields.
