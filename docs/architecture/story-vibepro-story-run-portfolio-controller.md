---
title: "Story Run Portfolio Controller Architecture"
status: accepted
created_at: 2026-07-20
updated_at: 2026-07-20
related_stories:
  - story-vibepro-story-run-portfolio-controller
parent_design:
  - vibepro-autonomy-roadmap-rebaseline
---

# Story Run Portfolio Controller Architecture

## Decision

`src/story-run-portfolio.js` is an additive controller above `createGuardedRunSession`. It owns ordered portfolio state and delegates every child lifecycle mutation to the existing single-Story Run boundary. It does not merge Stories, execute arbitrary actions, decide business priority, or copy a provider transcript.

The authority artifact is `.vibepro/portfolios/<portfolio-id>/state.json`. A portfolio-scoped mutation lock encloses create and each read/side-effect/write transaction, and atomic replacement persists the ordered entries, per-Story telemetry, typed decision journal, immutable scope binding, and digest-bound context promotions. The lock is atomically published with owner metadata; a later process may recover it only when the recorded owner PID is no longer alive, while unverifiable ownership fails closed with a typed recovery error. Recovery first owns a separate atomic recovery mutex and re-reads the current owner before moving the dead lock; release re-reads its owner token before deletion. Each entry has exactly one Story and at most one active Run. The scope binding captures the child worktree and branch at start; every subsequent observation checks Story, Run, worktree, branch, review-artifact attribution, and session attribution before any later Story can start.

Sequential mode is the only accepted execution mode in this Story. `portfolio-advance` observes an active child first. It starts the next queued child only after every previous entry is `pr_ready` or explicitly `skipped`. Waiting, blocked, failed, and cancelled states never become success. Continue, retry, and skip require a typed policy and reason; waiting-for-human additionally flows through the child Run's Human Decision contract.

## Boundaries

- Portfolio controls ordering and cross-Run isolation; Guarded Run remains authoritative for one child Run's state and mutation.
- Brainbase or the operator remains authoritative for Story priority and business intent.
- Cost fields remain per entry. Missing token, cost, or timing data stays `null` and renders as `unknown`, never zero.
- Cross-Story learning is an explicit source/consumer artifact reference with a SHA-256 digest computed from a readable realpath-contained artifact and a reason. A supplied digest must match; missing artifacts, symlink escapes, raw transcripts, and session paths fail closed.
- Parallel mode fails with `parallel_isolation_unproven`; a later Story may add proof-carrying parallel groups without weakening sequential defaults.

## Failure and recovery

Portfolio state is restart-safe because every operation reloads and validates the canonical artifact under the mutation lock, and a dead lock owner is recovered before mutation. Child creation first persists a `starting` intent with a deterministic, Portfolio-entry-scoped creation request identity. Guarded Run resolves that identity under its creation lock: the first call creates and labels a Run, while retries return only the Run bearing the same identity. Thus a process stop before creation cannot adopt historical or manual Runs, and a stop after creation but before Portfolio publication rebinds the exact child without duplication. A stopped child remains selected until a typed decision is persisted, and human summaries print the typed decision command shape. Scope contamination persists a `blocked` entry and typed `scope_contamination` stop reason before returning the error. The operator can export the ordered Story ids and continue individual child Runs if this additive controller is rolled back.
