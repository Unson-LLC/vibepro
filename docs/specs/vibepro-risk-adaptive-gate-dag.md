---
title: VibePro Risk-Adaptive Gate DAG Spec
status: draft
created_at: 2026-05-25
updated_at: 2026-05-25
related_stories:
  - story-vibepro-risk-adaptive-gate-dag
---

# VibePro Risk-Adaptive Gate DAG Spec

## Change Classification

`vibepro pr prepare` MUST classify every PR context before building the final Gate DAG.

Output:

```json
{
  "schema_version": "0.1.0",
  "profile": "light | api_contract | ui_interaction | workflow_heavy",
  "change_type": "simple_code_change | api_contract_change | ui_interaction_change | cross_surface_workflow_change",
  "risk_surfaces": [],
  "reasons": [],
  "required_gate_profile": "light | api_contract | ui_interaction | workflow_heavy"
}
```

`workflow_heavy` is selected when multiple runtime surfaces change and Story/diff signals indicate state transition or workflow orchestration risk.

Risk surfaces:

- `frontend_interaction`
- `server_api`
- `service_orchestration`
- `database_state`
- `queue_worker`
- `polling_retry`
- `auth_boundary`
- `legacy_v1_compatibility`
- `core_workflow_state`
- `gate_orchestration`
- `verification_evidence`
- `review_lifecycle`
- `test_coverage`

## Gate DAG

`gate-dag.json` MUST include `gate:change_classification`.

For `workflow_heavy`, the DAG MUST also include required gates:

- `gate:workflow_state_machine`
- `gate:production_path_matrix`
- `gate:workflow_flow_replay`
- `gate:evidence_coverage`
- `gate:release_confidence`

These gates are release critical. If any is unresolved, `overall_status` MUST be `needs_verification`.

## Workflow-Heavy Readiness Rules

- Flow Verification pass or current bound E2E/flow verification evidence is required.
- Flow Verification evidence MUST be bound to the current git state before it can satisfy workflow-heavy release readiness.
- Flow Verification MUST preserve existing `BASIC_AUTH_USER && BASIC_AUTH_PASSWORD` env handling without persisting plaintext credentials.
- Current E2E evidence for workflow-heavy readiness MUST execute a story acceptance E2E file with executable assertions; marker-only files do not satisfy flow replay.
- At least one scenario clause is required to represent workflow state transitions.
- `spec.open_questions[].blocker=true` prevents release readiness.
- A passing Unit/API suite does not satisfy workflow-heavy release readiness by itself.

## Agent Review

Agent Review policy MUST be risk-adaptive.

For `workflow_heavy`, required review roles include:

- `architecture_spec:regression_risk`
- `test_plan:e2e_ux`
- `test_plan:gate_coverage`
- `implementation:runtime_contract`
- `implementation:ux_completion`
- `gate:release_risk`
- `preview:preview_smoke`
- `preview:network_runtime`
- `preview:human_usability`

## Tests

- Unit: classifier selects `workflow_heavy` for cross-surface workflow changes.
- Unit: classifier does not over-classify docs-only, API-only, or UI-only changes.
- Integration: `pr prepare` emits workflow-heavy gates and blocks readiness without flow evidence.
- Integration: workflow-heavy required Agent Review roles include preview/network/runtime/gate coverage roles.
- Integration: blocker open questions and missing scenario clauses keep release confidence unresolved.
