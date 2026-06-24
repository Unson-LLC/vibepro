---
story_id: story-vibepro-evidence-reuse-metric-semantics
title: Evidence Reuse Metric Semantics Spec
---

# Spec

## Contracts

### ERM-CONTRACT-001: Same-key generation count

`full_evidence.generation_count` MUST mean generation count for the current `evidence_key` only.
When a later `pr prepare` sees the same `evidence_key` and a previous full evidence digest, it MUST set
`full_evidence.status=reused` and keep `full_evidence.generation_count=1`.

### ERM-CONTRACT-002: Cumulative generation count

`full_evidence.cumulative_generation_count` MUST represent the number of full evidence generations across
the story's observed reuse chain. It MAY increase when the previous artifact is stale or missing, but it MUST
NOT be used as the same-key reuse KPI.

### ERM-CONTRACT-003: Explicit metric scope

`full_evidence.generation_count_scope` MUST be `same_evidence_key` whenever `generation_count` is emitted.
`full_evidence.same_key_generation_count` MUST mirror the same-key value so consumers do not need to infer
the legacy field's scope.

### ERM-CONTRACT-004: Report and canonical audit visibility

`usage report` and canonical audit summaries MUST expose both same-key and cumulative generation counts.
Main-only audit reconstruction MUST preserve `generation_count_scope`, `same_key_generation_count`, and
`cumulative_generation_count` when compacting evidence reuse artifacts.

## Scenarios

### ERM-SCENARIO-001: Fresh reuse

Given a first `pr prepare` generated full evidence for a key, when a second `pr prepare` runs for the same
key, then `status=hit`, `full_evidence.status=reused`, `generation_count=1`,
`same_key_generation_count=1`, and `cumulative_generation_count` remains unchanged.

### ERM-SCENARIO-002: Stale regeneration

Given a previous evidence key became stale because the head SHA changed, when `pr prepare` regenerates full
evidence for the new key, then `generation_count=1` and `cumulative_generation_count` increases by one.

### ERM-SCENARIO-003: Reuse after stale regeneration

Given stale regeneration produced a new key with cumulative count `N`, when a later `pr prepare` runs with
that same new key, then `status=hit`, `generation_count=1`, and `cumulative_generation_count=N`.

## Anti-patterns

- Do not infer reuse quality from a cumulative count alone.
- Do not display a cumulative count under the old `full_generation_count` label without scope.
- Do not rewrite historical canonical audit artifacts to pretend old metrics had the new meaning.

## Verification

- `ERM-VERIFY-001`: Unit coverage proves same-key reuse keeps `generation_count=1`.
- `ERM-VERIFY-002`: Unit coverage proves stale regeneration increments only `cumulative_generation_count`.
- `ERM-VERIFY-003`: Usage report coverage proves both scoped metrics are visible.
- `ERM-VERIFY-004`: Canonical audit coverage proves compact summaries preserve both metrics.
