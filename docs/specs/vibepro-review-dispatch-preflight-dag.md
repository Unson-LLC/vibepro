---
story_id: story-vibepro-review-dispatch-preflight-dag
title: Review Dispatch Preflight DAG Spec
---

# Review Dispatch Preflight DAG Spec

## Requirements

- `S-RDP-1`: For every required Agent Review stage, PR Gate DAG emits `review:dispatch_batch:<stage>` with type `agent_review_dispatch_batch_gate`.
- `S-RDP-2`: For every required role in that stage, PR Gate DAG emits `review:preflight:<stage>:<role>` with type `agent_review_dispatch_preflight_gate`.
- `S-RDP-3`: Dispatch preflight fails when the role has stale review evidence, an active same-role lifecycle, a timed-out lifecycle, or a recorded blocker.
- `S-RDP-4`: Dispatch preflight returns `needs_review` when the latest lifecycle was manually shut down or the recorded pass lacks verified parallel subagent provenance.
- `S-RDP-5`: Dispatch preflight passes for a current role pass, explicitly marking duplicate dispatch as unnecessary, and for missing roles that are ready for the next dispatch batch.
- `S-RDP-6`: Gate DAG edges preserve stage serialization and add the order `dispatch_batch -> preflight -> prepare -> role -> record -> join`.
- `S-RDP-7`: Review lifecycle summaries include recovery actions for timed-out and manually shut down role lifecycles so handoff can reconstruct the next action.

## Evidence

- Unit/CLI tests should assert DAG node IDs, node types, status mapping, and edge ordering.
- `vibepro pr prepare` output for this story should include the generated Gate DAG and PR readiness artifacts.
