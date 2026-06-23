---
story_id: story-vibepro-evidence-summary-reuse
title: Evidence Summary Reuse Spec
---

# Spec

## Contracts

### ESR-CONTRACT-001: Evidence key

`pr prepare` MUST compute an `evidence_key` from Story ID, base/head refs, base/head SHAs,
Spec fingerprint, risk surface fingerprint, verification summary fingerprint, verification
evidence update timestamp, verification command timestamps, evidence depth, and planner version.

### ESR-CONTRACT-002: Summary/index embedding

`pr prepare` MUST write `.vibepro/pr/<story-id>/evidence-reuse.json` and embed a compact
`evidence_reuse` block in `pr-prepare.json`, `evidence-plan.json`, and `decision-index.json`.

### ESR-CONTRACT-003: Review input ordering

`review prepare` MUST read fresh `evidence-reuse.json` and list `evidence-reuse.json`,
`decision-index.json`, and `evidence-plan.json` as the first review inputs before any full
artifact. If the reuse artifact is stale, it MUST be recorded as stale and MUST NOT be used as
fresh review input.

### ESR-CONTRACT-004: Full evidence generation count

For the same `evidence_key`, full evidence MAY be referenced by digest and MUST NOT be regenerated
more than once. A second `pr prepare` for the same key MUST keep `full_evidence.generation_count`
at `1` and mark the full evidence status as `reused`.

### ESR-CONTRACT-005: Stale reasons

Changes to head SHA, Spec fingerprint, verification summary fingerprint, verification evidence update
timestamp, verification command timestamps, or risk surface fingerprint MUST mark the previous
summary/index stale and record machine-readable stale reasons.

### ESR-CONTRACT-006: Usage report visibility

`usage report` MUST aggregate `evidence_reuse` hit/miss/stale counts and show per-story reuse status.

### ESR-CONTRACT-007: Stale misuse gate

If any consumer marks a stale reuse artifact as used fresh, PR readiness MUST fail through an explicit
Gate DAG node. Stale detection without fresh misuse is allowed and should trigger regeneration/review refresh,
not silent pass-through.

### ESR-CONTRACT-008: Canonical audit

`execute merge` canonical audit promotion MUST include `evidence-reuse.json` or its compact summary so a
main-only audit can reconstruct whether the merged story reused or regenerated evidence.
