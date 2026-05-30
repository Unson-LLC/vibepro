---
story_id: story-vibepro-deploy-verification
title: Deploy Verification Gate
status: active
---

# Deploy Verification Gate

## Background
VibePro's Gate DAG ends at `pr` — it guarantees a change is *merge-ready*, not *delivered*. But "merged" is not "released" and not "verified in production" ("Release Is A Different State"). A risk-bearing change to an app that actually deploys somewhere can pass every code gate and still die silently: never deployed, broken in prod, migration unrun, environment drift.

The Environment Graph (story-vibepro-environment-graph) now models what deploys where. This story uses it: when a change is risk-bearing *and* the topology has real deploy targets, VibePro must require that deploy/verification intent is closed as evidence before treating the PR as ready.

`pr prepare` runs pre-merge, so the gate cannot require a completed production deploy. It requires the *evidence contract* to be closed: a current-bound deploy/smoke/health record, or an explicit waiver decision. Mechanical, route-independent, risk-adaptive, and waivable — the same discipline as the security_regression, agent evidence-lifecycle, and secret-surface gates.

## Acceptance Criteria
- `gate:deploy_verification` (`type: deploy_verification_gate`) appears only when the Environment Graph has deploy targets AND the change is risk-bearing (`workflow_heavy`/`api_contract` profile, or a `mirror_sync`/`release_merge` PR route).
- When it appears it is `needs_evidence` (blocking `ready_for_pr_create`) until a current-bound deploy/smoke/health verification record, or an explicit waiver decision against `gate:deploy_verification`, is recorded.
- The gate lists the deploy targets (id/type/provider/environment) it is protecting, drawn from the Environment Graph.
- It is absent (no friction) when there are no deploy targets, or the change is low-risk.
- It is wired into the Gate DAG between `gate:pr_route_classification` and `gate:pr_body_contract`, and DAG connectivity stays `passed`.
- It is non-critical (waiver-resolvable), not a hard wall; the waiver is an audit-trailed decision.
