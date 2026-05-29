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

## Anti-Patterns

- `AP-EJD-1`: Do not make VibePro business-system-only. Business systems are a route-specific DAG family.
- `AP-EJD-2`: Do not collapse engineering judgment route and PR route into one field.
- `AP-EJD-3`: Do not add route-specific gates as disconnected report-only islands.
- `AP-EJD-4`: Do not rely on visual graph rendering as proof of connectivity; connectivity must be checked from `nodes` and `edges`.

## Verification

- `V-EJD-1`: E2E route tests assert Engineering Judgment nodes and DAG connectivity for docs-only and release/mirror routes.
- `V-EJD-2`: Focused PR prepare tests assert `agent_workflow` classification for VibePro gate/runtime workflow changes.
- `V-EJD-3`: `node --check src/pr-manager.js` passes.
