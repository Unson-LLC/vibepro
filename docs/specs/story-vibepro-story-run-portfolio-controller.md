---
title: "Story Run Portfolio Controller Spec"
status: accepted
created_at: 2026-07-20
updated_at: 2026-07-20
related_stories:
  - story-vibepro-story-run-portfolio-controller
parent_design:
  - vibepro-autonomy-roadmap-rebaseline
---

# Story Run Portfolio Controller Spec

## Contract

`createStoryRunPortfolioController(dependencies)` exposes `create`, `status`, `advance`, `decide`, and `promote`. A portfolio id is a safe `portfolio-*` path segment and Story ids are safe `story-*` values. Creation rejects duplicates and all modes except `sequential`.

An entry contains `story_id`, zero-based `order`, `run_id`, `status`, `worktree`, `head_sha`, `cost_attribution`, and `stop_reason`. Cost attribution separately represents Trusted PR-ready milliseconds, active/wait milliseconds, tokens/cost, Full Suite count, evidence reuse count, and human interruption count. Unknown measurements are `null` in JSON and `unknown` in human output.

`advance` starts at most one child. If a child is active, it observes and verifies that child first. A running or stopped child returns without starting another child. A `pr_ready` child permits the next child. A cancelled child leaves the portfolio stopped unless the operator records an explicit typed decision.

`decide` accepts only `continue`, `retry`, or `skip`, plus `policy_type` and `reason`. Continue/retry delegate to Guarded Run resume. Skip creates an auditable `explicit_skip` stop reason and permits later advancement. Mutations acquire a portfolio-scoped lock before reading state or starting a child Run. `promote` accepts an earlier source Story, later consumer Story, non-transcript artifact path, SHA-256 digest, and reason; it resolves the artifact realpath, reads the artifact, computes its digest, and rejects a supplied mismatch.

## Invariants

- `INV-SRP-1`: one Portfolio entry owns one Story and at most one child Run.
- `INV-SRP-2`: later mutation cannot begin until prior entries are `pr_ready` or explicitly `skipped`.
- `INV-SRP-3`: stopped and cancelled child states are not success.
- `INV-SRP-4`: Story, Run, worktree, branch, review, or session mismatch fails as `scope_contamination`.
- `INV-SRP-5`: no raw transcript crosses a Story boundary.
- `INV-SRP-6`: unavailable cost and time remain unknown.
- `INV-SRP-7`: every mutation, including create, owns the Portfolio lock; dead-owner locks recover atomically and unverifiable owners fail closed.
- `INV-SRP-8`: child creation persists `starting` before the external Run side effect and restart reconciles that Story's existing Run before retrying creation.

Stopped human summaries expose the typed `portfolio-decide` continuation shape so the persisted stop is actionable after restart.

## Verification

`test/story-run-portfolio.test.js` covers the closed entry schema, a six-Story sequence, concurrent mutation and create rejection, dead-owner lock recovery, token-safe release, exception cleanup, post-Run publish failure reconciliation, mid-Story blocker, restart, typed skip, digest/realpath-safe context promotion including internal transcript symlinks, persisted contamination stop and next action, summary attribution, parallel rejection, and every portfolio CLI mutation plus JSON/human error surfaces.
