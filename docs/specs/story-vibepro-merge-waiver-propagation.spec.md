---
story_id: story-vibepro-merge-waiver-propagation
title: Merge Waiver Propagation Spec
parent_design: story-vibepro-merge-waiver-propagation
related_architecture:
  - ../architecture/story-vibepro-merge-waiver-propagation.md
---

# Merge Waiver Propagation Spec

## Invariants

- `INV-001`: A `ready_for_review` Gate DAG authorizes merge without a waiver.
- `INV-002`: A stale, missing, malformed, target-mismatched, or critical-gate-bearing authority fails closed before GitHub operations.
- `INV-003`: Waiver target and critical Gate ID sets exactly match a current-HEAD `pr-prepare.gate_status`; whenever a routed Gate DAG exists, the embedded Gate DAG is mandatory and has the same authorization surface (overall status plus required node identity, type, status, and critical classification).

## Contracts

- `C-001`: Only a current-HEAD `pr-create.json` override with `allowed=true`, a reason, a waiver policy, non-empty targets, and zero critical targets can authorize merge.
- `C-002`: Merge execution state and `pr-merge.json` persist the authorization source and waiver audit fields.
- `C-003`: `review record` attaches a result only to a lifecycle closed as `completed`; timeout, replacement, and manual shutdown reject the result before any current or history result artifact is written.

## Scenarios

- `S-001`: Production `execute merge` accepts a valid current-HEAD noncritical waiver, rejects stale or inconsistent `pr-prepare` authority and current critical Gates, and reaches GitHub merge only after the remaining external preconditions pass.
- `S-002`: An authorized review closes as completed and its result is recovered exactly once; non-completed closure reasons persist no pass result and do not spawn a replacement.

## Verification

- `test/merge-gate-authorization.test.js` covers schema, target reconciliation, current-HEAD binding, and routed Gate DAG consistency.
- `test/review-inspection-first.test.js` proves completed result recovery and absence of current/history artifacts for timeout, replacement, and manual shutdown.
- `test/vibepro-cli.test.js` covers dry-run, missing or mismatched embedded Gate DAG rejection before GitHub, persistence failure, and the actual merge fixture.
- `test/e2e/story-vibepro-merge-waiver-propagation-main.spec.ts` binds AC-1 through AC-8 and S-001/S-002 to production wiring.
