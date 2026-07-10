---
story_id: story-vibepro-session-cost-carryover-bucket
title: VibePro Session Cost Carryover Bucket Architecture
parent_design: vibepro-session-cost-carryover-bucket
---

# Architecture

## Decision

Add a new, first-class exposure bucket (`replayed_context`) to the existing
`SESSION_EXPOSURE_BUCKETS` list instead of introducing a parallel accounting
mechanism. Classification stays centralized in `summarizeSessionExposureEntry()`:
before running the existing pattern-based `classifySessionExposureText()`, check
whether the entry's top-level `type` is one Codex emits when it replays prior
context after compaction (`compacted`, and the `compaction`/`context_compacted`
aliases some Codex builds have used). If so, the entry's extracted text is
classified into `replayed_context` unconditionally — this takes precedence over
any path/content pattern match, because compaction replay text commonly
mentions `.vibepro/`, `docs/`, or `test/` paths that would otherwise
mis-attribute it as fresh evidence-gathering.

## Boundaries

- `classifySessionExposureText()` continues to own path/content pattern
  classification for non-replay entries; it is not modified.
- `buildArtifactTokenAccounting()` / `emptyExposureBuckets()` already iterate
  `SESSION_EXPOSURE_BUCKETS` generically, so no change is needed there — the new
  bucket flows through the existing aggregation path.
- This story does not change token estimation, window filtering, or the
  session-selection/scoring logic covered by
  `story-vibepro-session-time-cwd-normalization`.

## Why no ADR is required

This adds a new label to an existing, already-documented classification
enumeration (`SESSION_EXPOSURE_BUCKETS`) and a single early-return branch in one
existing function. It does not cross a new API/Auth/Billing/Data/external
integration boundary.
