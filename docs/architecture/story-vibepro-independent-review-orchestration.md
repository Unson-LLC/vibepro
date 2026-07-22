---
story_id: story-vibepro-independent-review-orchestration
title: Independent Review Orchestration Architecture
status: accepted
updated_at: 2026-07-22
reason: "compose the existing Gate, Review Lifecycle, runtime adapter, and repair contracts behind a run-session owner; alternatives rejected: CLI-driven orchestration creates a reverse dependency and manual coordinator instructions do not close the autonomous UX; compatibility: existing review artifacts and verdicts remain authoritative; rollback: disconnect the owner runner and return the typed runtime_required stop; boundary: orchestration owns sequencing only, not reviewer judgment or finding schemas."
---

# Independent Review Orchestration Architecture

## Decision

The guarded Run `review` action delegates to a run-session owner module. The owner reads the required review stages and roles from the existing Gate/Agent Review projection, processes stages in their declared serial order, and dispatches all roles within the current stage concurrently.

The owner composes existing boundaries through dependency injection:

1. `prepareAgentReview` produces the role requests and review surface.
2. `authorizeAgentReviewDispatch` and `startAgentReviewLifecycle` reserve and open a lifecycle for each role.
3. the provider-neutral runtime coordinator dispatches and polls read-only reviewer sessions.
4. `closeAgentReviewLifecycle` closes each terminal reviewer session.
5. `recordAgentReview` records the unchanged `pass`, `needs_changes`, or `block` result.
6. existing Gate aggregation and Review Finding Repair Loop decide whether to advance, repair, or stop.

The CLI remains an outer adapter. Neither the owner nor the review/runtime modules call `cli.js`.

## State and idempotency

Each role operation uses a deterministic stage/role/operation key inside the HEAD-bound guarded Run action journal. The journal durably reserves that key before crossing an external boundary, then completes the entry with either success or a typed-stop result before the next boundary is entered. On resume, a reserved operation is reconciled through the same provider-neutral idempotency key; completed checkpoints are reused, a provider dispatch is not recreated, and a recorded review is not duplicated. A typed stop after lifecycle start closes that lifecycle before returning control to Guarded Run.

Stage progression is a barrier: the next stage is not prepared until every required role in the current stage is terminal, closed, and recorded. Role dispatch within one stage uses `Promise.all` semantics, while checkpoint writes are serialized and monotonic so a slower, older snapshot cannot overwrite a newer one.

## Failure contract

- unavailable runtime and authentication failures become typed runtime stops;
- timeout becomes a typed terminal stop; lifecycle cleanup remains owned by the injected runtime/lifecycle boundary;
- mutable sandbox, same identity/session, stale HEAD, changed files, or invalid provenance fail closed and never record `pass`;
- `needs_changes` and `block` are preserved verbatim; `needs_changes` returns control to the existing repair loop;
- restart resumes from persisted checkpoints without converting uncertainty into success.

## Conformance constraint

After the target-architecture change from PR #378 is present, run `vibepro architecture conformance .`. Compare against the current `origin/main` baseline (69 violations; 68 at PR #378 plus one inherited later-main violation). The implementation must not increase that baseline, must remain inside the run-session owner boundary, and must add no reverse dependency to `cli.js`.

## Verification

Targeted contract tests cover parallel pass, `needs_changes`, `block`, unavailable/auth/timeout, invalid or same-session provenance, and restart idempotency. Guarded Run integration tests prove action-journal persistence and repair handoff. The repository conformance command is rerun after rebasing the target-architecture change.
