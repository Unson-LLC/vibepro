---
story_id: story-vibepro-engineering-judgment-dag
title: Engineering Judgment DAG
status: active
---

# Engineering Judgment DAG

## Background
VibePro should not be a fixed checklist runner. It should encode how a world-class engineer thinks before changing a system, then select a route-specific DAG for the target surface. Business systems are one route, not the whole product. Developer tools, UI/UX modernization, AI agent workflows, data migrations, security/trust, release engineering, API platforms, and infra/ops need different thinking paths.

## Acceptance Criteria
- `vibepro pr prepare` emits an `engineering_judgment` classification in `pr_context`.
- Gate DAG includes `gate:engineering_judgment_route` before PR route classification.
- Gate DAG includes `gate:common_judgment_spine` before route-specific gates.
- Route-specific judgment gates are selected from the engineering judgment route and converge back into PR route classification.
- Gate DAG includes `gate:dag_connectivity` before the final PR node.
- PR body decision graph shows the Engineering Judgment route and selected route DAG.
