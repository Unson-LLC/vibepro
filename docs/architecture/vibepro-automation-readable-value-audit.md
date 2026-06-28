---
story_id: story-vibepro-automation-readable-value-audit
title: Automation Readable Value Audit Evidence Architecture
---

# Architecture

## Decision

VibePro should not make the final daily value judgment inside `execute merge`. The daily Codex
automation owns that judgment. VibePro's responsibility is to persist stable, compact evidence that
the automation can read without replaying every raw artifact.

The canonical audit layer is the right boundary because it is already the merge-time persistence
point for PR lifecycle, verification, review, senior gap, changed-line, token, elapsed-time, and
artifact budget evidence.

## Contract Shape

`automation_value_audit` is written alongside `cost_summary`:

- `status`: readiness of the automation input, not product approval.
- `allocation`: implementation, verification/docs, audit evidence, and bucketed changed lines.
- `ratios`: test/docs/audit evidence relative to `src` implementation changes.
- `session_cost`: token/time status and measured values when available.
- `value_signal_inputs`: gate, review, senior gap, evidence reuse, and missing artifact counts.
- `findings`: stable IDs for automation aggregation.

## Boundaries

- Canonical audit produces the evidence contract.
- Usage report forwards and renders the contract.
- Daily automation interprets whether VibePro delivered value.
- `execute merge` remains a merge/audit persistence command, not a value scoring engine.

## Invariants

- Unknown token/time remains unknown.
- Findings are inputs for automation, not merge blockers.
- The contract is compact enough to be read directly from canonical `audit-index.json`.
- Ratios must be reproducible from changed-line buckets.
