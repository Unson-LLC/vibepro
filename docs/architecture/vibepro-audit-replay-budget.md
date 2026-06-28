---
story_id: story-vibepro-audit-replay-budget
title: Canonical Audit Replay Budget Architecture
---

# Canonical Audit Replay Budget Architecture

Compact canonical audit has two surfaces:

- `audit-index.json`: the authoritative decision surface for daily automation and handoff.
- `audit-replay-bundle.json.gz`: an integrity-checked replay package for reconstructing the high-level verdict when a later engineer needs to verify the handoff.

The replay package does not need full raw artifact bodies because `audit replay` already returns its verdict from `decision_index`. Full bodies mainly increase token and line cost. The replay package should instead retain digest-backed artifact manifests plus bounded summaries that explain what each source artifact contributed.

## Data Shape

Each replay artifact entry keeps:

- identity: `kind`, `type`, `stage`, `source`
- integrity: `digest`, `audit_digest`, `line_count`, `raw_line_count`
- scope: `audit_scope`, `excluded_from_audit`
- bounded meaning: `summary`

It omits:

- full JSON `data`
- markdown/text `content`
- raw stdout/stderr or full gate/review lifecycle payloads

## Cost Semantics

For compact canonical audit, `cost_summary.artifact_lines` measures the persisted canonical audit surface. Raw source artifact size is still useful for diagnosis, so it is preserved as `raw_source_artifact_lines`. This keeps the value audit focused on what VibePro actually makes future audits read or carry forward.

## Rollback

Reverting this story returns compact replay to full artifact-body replay. Historical bundles remain replayable because `audit replay` uses the bundle metadata and decision index, not a mandatory full-body artifact contract.
