---
story_id: story-vibepro-agent-review-minimal-recovery-plan
title: Agent Review Minimal Recovery Plan Spec
parent_design:
  - vibepro-agent-review-minimal-recovery-plan
---

# Agent Review Minimal Recovery Plan Spec

## Invariants

- `INV-1`: Agent Review Gate output includes a compact `minimal_recovery_plan` when required reviews are not complete.
- `INV-2`: The plan identifies the current serial stage separately from later stages blocked by the serial barrier.
- `INV-3`: The plan deduplicates blocker messages that point to the same `stage:role` root review artifact.
- `INV-4`: Timed-out lifecycle recovery includes the known `agent_id`, `lifecycle_id`, close command, and replacement start command.

## Contracts

- `C-1`: `gate:agent_review.minimal_recovery_plan.current_stage` is derived from `parallel_dispatch.required_stages`.
- `C-2`: `current_stage_work[]` contains only the currently dispatchable stage.
- `C-3`: `later_stages_blocked[]` lists serial-barriered stages and does not ask callers to dispatch them.
- `C-4`: `gate_status.agent_review_minimal_recovery_plan` mirrors the Agent Review Gate plan for handoff consumers.

## Scenarios

- `S-1`: Missing current-stage review role produces a `missing` recovery item and a first command pointing at `review prepare`.
- `S-2`: A stale review result plus a timed-out lifecycle for the same `stage:role` produces one recovery item, prioritized as `timed_out`.
- `S-3`: Later review stages remain listed as blocked until the current stage is closed and recorded.

## Anti-patterns

- `AP-1`: Do not flatten dispatch batch, preflight, role, record, and artifact consistency blockers into unrelated manual tasks when they share the same root review artifact.
- `AP-2`: Do not suggest dispatching a later Agent Review stage while an earlier serial stage is still incomplete.
- `AP-3`: Do not hide lifecycle recovery identifiers inside prose-only details.

## Verification

- `V-1`: `test/risk-adaptive-gate.test.js` covers missing current-stage recovery.
- `V-2`: `test/risk-adaptive-gate.test.js` covers stale fingerprint review results and timed-out lifecycle entries in a multi-stage setup.
