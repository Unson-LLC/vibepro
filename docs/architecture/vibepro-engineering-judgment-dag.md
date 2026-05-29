---
summary: "Architecture for adding Engineering Judgment route taxonomy above PR route gates."
read_when:
  - Changing pr prepare Gate DAG routing
  - Adding route-specific engineering judgment gates
  - Debugging DAG connectivity checks
---

# Engineering Judgment DAG

VibePro's PR Gate DAG now has a higher-level judgment layer before PR route classification. The layer models the common thinking spine of a strong engineer and chooses a route-specific DAG family.

## Architecture

The DAG starts with:

```text
story
  -> gate:engineering_judgment_route
  -> gate:common_judgment_spine
  -> gate:judgment_<route>_*
  -> gate:pr_route_classification
```

The existing PR route gates continue after that point. This keeps existing `docs_only`, `runtime_change`, `mirror_sync`, `release_merge`, and other PR body contracts intact while adding a product/system-development judgment layer above them.

## Route Taxonomy

Initial route families:

- `business_system`
- `developer_tool`
- `ui_ux_modernization`
- `agent_workflow`
- `data_pipeline`
- `security_trust`
- `release_engineering`
- `api_platform`
- `infra_ops`
- `knowledge_docs`
- `general_engineering`

The route classifier uses Story text, changed file groups, risk surfaces, PR route, and network-contract evidence. It is intentionally broad at this stage. Deeper route DAGs can add stricter evidence gates later without changing the common spine.

## Connectivity

`gate:dag_connectivity` checks that every DAG node except the final `pr` node:

- are connected to real edge endpoints,
- are reachable from `story`,
- can reach the final `pr` node.

This prevents future DAG additions from becoming isolated advisory islands.
