---
title: Senior Gap Judgment Architecture
status: active
created_at: 2026-06-26
updated_at: 2026-06-26
related_stories:
  - story-vibepro-senior-gap-judgment
---

# Senior Gap Judgment Architecture

## Decision

Add a compact Senior Gap Judgment layer after existing PR context construction. The layer does not replace Engineering Judgment axes, Design SSOT, Responsibility Authority, Requirement, review, or verification gates. It binds their outputs into a single reusable decision artifact:

```text
ideal_state + current_state -> gaps[] -> decision -> residual_risks[] / followups[] / cost_context
```

## Data Flow

```text
Story / Architecture / Spec
  -> PR context
  -> Engineering Judgment axes
  -> Design SSOT / Responsibility / Requirement / Traceability / Evidence Reuse
  -> senior-gap-judgment.json
  -> gate:senior_gap_judgment
  -> PR prepare / PR create / canonical audit replay
```

## Authority Boundary

Senior Gap Judgment is a synthesis artifact. It may block when existing machine-readable evidence already says the gap is non-deferrable, such as unresolved required gates, deterministic Design SSOT conflicts, or unmapped acceptance clauses.

It must not invent free-form semantic conclusions without backing evidence. Ambiguous or cost-only concerns remain explicit residual risks until a later story adds stronger proof.

## Status Semantics

- `block`: critical non-deferrable gap exists.
- `needs_review`: non-critical but non-deferrable gap exists.
- `passed_with_residual_risk`: no blocking gap, but explicit residual risks remain.
- `passed`: no senior gap detected.

The Gate DAG node maps `passed_with_residual_risk` to a passing gate while preserving residual risk counts in the artifact. This prevents cost telemetry gaps from being falsely treated as zero-cost evidence while avoiding a new blanket blocker.

## Canonical Audit

Canonical audit promotion includes `senior-gap-judgment.json` in both full and compact replay bundles. `decision-summary.md` exposes whether the judgment existed and its gap counts.

## Non-Goals

- No new LLM-only judgment authority.
- No automatic issue closure.
- No replacement of existing gates.
- No direct token/session log ingestion in this story.
