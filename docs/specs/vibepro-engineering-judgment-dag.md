---
story_id: story-vibepro-engineering-judgment-dag
title: Engineering Judgment DAG Spec
---

# Engineering Judgment DAG Spec

## Invariants

- `INV-EJD-1`: Every `pr prepare` Gate DAG MUST start from `story`, classify `engineering_judgment`, pass through the common judgment spine, then enter PR route classification.
- `INV-EJD-2`: Engineering Judgment route classification MUST be separate from PR route classification. Product/system route answers "what kind of engineering thinking is needed"; PR route answers "what PR contract is needed".
- `INV-EJD-3`: Business-system thinking is one route family, not the VibePro default. Other routes remain selectable by DAG classification.
- `INV-EJD-4`: Route-specific judgment gates MUST converge back into `gate:pr_route_classification` so the graph remains one connected decision DAG.
- `INV-EJD-5`: The final PR decision MUST be protected by `gate:dag_connectivity`.

## Scenarios

- `S-EJD-1`: For generic docs-only changes without a stronger product/system route, `engineering_judgment.route_type` is `knowledge_docs` and route-specific docs gates appear before PR route classification.
- `S-EJD-2`: For mirror/release changes, `engineering_judgment.route_type` is `release_engineering` and release traceability judgment gates appear before PR route classification.
- `S-EJD-3`: For VibePro agent/gate workflow changes, `engineering_judgment.route_type` is `agent_workflow` and context/tool/delegation/evidence lifecycle gates appear before PR route classification.
- `S-EJD-4`: If a future node is added without a valid path from `story` to `pr`, DAG connectivity status is not `passed`.
- `S-EJD-5`: For `security_trust` route changes, `gate:judgment_security_trust_security_regression` is an evidence-backed gate (`type: security_regression_gate`). Without a current-bound passing security regression test or an explicit waiver decision, its status is `needs_evidence` and `ready_for_pr_create` is `false`. A recorded waiver decision against the gate source resolves it. All other route-specific judgment gates remain advisory (`status: passed`).
- `S-EJD-6`: For `agent_workflow` route changes, `gate:judgment_agent_workflow_evidence_lifecycle` is an evidence-backed gate (`type: agent_evidence_lifecycle_gate`), enforced on the route axis (agent/gate/dag/skill/mcp machinery) regardless of risk tier. Its status is `passed` only when the agent review evidence lifecycle is closed for the current git state (agent reviews `status: pass`, or a clean summary with `required_review_count > 0` and zero unmet/stale/timed-out/blocked results) or an explicit waiver decision is recorded against the gate source; otherwise `needs_evidence` and `ready_for_pr_create` is `false`. Sibling agent_workflow judgment gates remain advisory.

## Anti-Patterns

- `AP-EJD-1`: Do not make VibePro business-system-only. Business systems are a route-specific DAG family.
- `AP-EJD-2`: Do not collapse engineering judgment route and PR route into one field.
- `AP-EJD-3`: Do not add route-specific gates as disconnected report-only islands.
- `AP-EJD-4`: Do not rely on visual graph rendering as proof of connectivity; connectivity must be checked from `nodes` and `edges`.

## Verification

- `V-EJD-1`: E2E route tests assert Engineering Judgment nodes and DAG connectivity for docs-only and release/mirror routes.
- `V-EJD-2`: Focused PR prepare tests assert `agent_workflow` classification for VibePro gate/runtime workflow changes.
- `V-EJD-4`: A focused PR prepare test asserts the `security_trust` route's security regression gate is `needs_evidence` (blocking) without evidence and `passed` after a waiver decision, while sibling judgment gates stay advisory.
- `V-EJD-5`: A focused PR prepare test asserts the `agent_workflow` route's evidence lifecycle gate is `needs_evidence` (blocking) without agent-review evidence and `passed` after a waiver decision, while sibling judgment gates stay advisory.
- `V-EJD-3`: `node --check src/pr-manager.js` passes.
