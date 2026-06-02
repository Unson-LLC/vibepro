---
title: VibePro Bug Physics Triage Router Spec
status: active
story_id: story-vibepro-bug-physics-triage-router
created_at: 2026-06-02
---

# VibePro Bug Physics Triage Router Spec

## Invariants

- `INV-BP-1`: Gate DAG MUST include `gate:bug_physics_triage`.
- `INV-BP-2`: Bug physics class MUST be a multi-label array from `timing`, `state-invariant`, `deterministic-byte`, `observability`, `deployment`.
- `INV-BP-3`: A selected class MUST change the downstream gate profile.
- `INV-BP-4`: Typed N/A with reason MUST be distinct from waiver decisions.
- `INV-BP-5`: Active triage MUST require probe evidence before PR readiness.
- `INV-BP-6`: Harness contradiction MUST expose a feedback edge to triage.

## Scenarios

- `S-BP-1`: A timing story with race/violation-rate language selects `timing`, requires a violation-rate/SLO gate, and marks single-shot E2E typed N/A.
- `S-BP-2`: A deterministic byte story selects `deterministic-byte`, requires real-byte fixture/headless replay evidence, and does not require SLO proof.
- `S-BP-3`: A deployment story selects `deployment`, requires version-stamp propagation evidence, and marks code gates typed N/A.
- `S-BP-4`: An observability story selects `observability`, requires an authoritative signal source, and marks E2E code-gate proof typed N/A.
- `S-BP-5`: A multi-label story can select both `state-invariant` and `deterministic-byte`.
- `S-BP-6`: If evidence says the selected harness cannot reproduce the bug, `gate:bug_physics_contradiction_feedback` fails and an edge returns to `gate:bug_physics_triage`.

## Verification

- Focused PR prepare tests assert DAG nodes, classes, required gates, typed N/A gates, and feedback edges.
- Full CLI regression suite must pass before PR creation.
