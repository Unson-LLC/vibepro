---
story_id: story-vibepro-pr-readiness-status-ssot
title: VibePro PR Readiness Status SSOT Spec
---

# VibePro PR Readiness Status SSOT Spec

## Invariants

- `INV-PRS-1`: `pr_prepare.gate_status.ready_for_pr_create` MUST be `true` only when `gate_dag.overall_status === "ready_for_review"`.
- `INV-PRS-2`: `execution_gate.pr_create_allowed` MUST be `false` when `gate_dag.overall_status !== "ready_for_review"`.
- `INV-PRS-3`: If `gate_dag.overall_status !== "ready_for_review"` and no unresolved required gate details are emitted, VibePro MUST expose a synthetic readiness item instead of returning `ready`.
- `INV-PRS-4`: The synthetic readiness item MUST NOT add Agent Review roles or require a new review lifecycle; it is an instruction to regenerate or inspect existing gate evidence.
- `INV-PRS-5`: `ready_for_review` with no unresolved required gate details remains PR-create ready.

## Acceptance Paths

- `AP-PRS-1`: A `needs_verification` Gate DAG with only passing/present required nodes yields `ready_for_pr_create=false`.
- `AP-PRS-2`: The same Gate DAG yields `execution_gate.status=waiver_required` and `pr_create_allowed=false`.
- `AP-PRS-3`: The same Gate DAG exposes `gate:overall_status` as the unresolved readiness item.
- `AP-PRS-4`: A `ready_for_review` Gate DAG with no unresolved required nodes yields `execution_gate.status=ready`.

## Verification

- `V-PRS-1`: `test/pr-readiness-gate-status.test.js` covers the status mismatch guard and ready path.
- `V-PRS-2`: `test/e2e/story-vibepro-pr-readiness-status-ssot-main.test.js` binds the Story acceptance criteria to executable assertions.
