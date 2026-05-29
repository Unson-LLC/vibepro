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

## Enforced judgment gates

The common judgment spine and most route-specific judgment gates are advisory (`status: passed`): they render what a world-class engineer should think about per route, but do not require mechanical evidence. Cognition cannot be gated; its concrete artifacts can.

As a narrow first step, the `security_trust` route promotes `gate:judgment_security_trust_security_regression` to an evidence-backed gate (`type: security_regression_gate`). It is `needs_evidence` (blocking, but waivable with a recorded reason) until either a current-bound passing security regression test is recorded, or an explicit waiver decision is recorded against `gate:judgment_security_trust_security_regression`. Enforcement is deliberately scoped to one concrete, checkable artifact and grown only after observing real waiver behavior, so high-value routes gain teeth without adding blanket friction.

The `agent_workflow` route adds the second enforced gate, `gate:judgment_agent_workflow_evidence_lifecycle` (`type: agent_evidence_lifecycle_gate`). This is the **route axis**, not the risk axis: `gate:agent_review` already scales staged reviews by risk profile, but a change to agent/gate/dag/skill/mcp machinery can classify as low risk and still ship with zero agent-review evidence. The lifecycle gate closes that gap. It reuses the existing `agent_reviews` lifecycle data (`required_review_count`, `unmet_required_review_count`, `stale_result_count`, `lifecycle_timed_out_count`, `block_result_count`) and is `passed` only when that lifecycle is closed for the current git state (or a waiver is recorded against the gate source). The other agent_workflow judgment gates (`context_acquisition`, `tool_boundary`, `delegation_policy`, `human_decision_contract`) stay advisory; `delegation_policy` is the natural next candidate to enforce on higher-risk agent changes.

## Connectivity

`gate:dag_connectivity` checks that every DAG node except the final `pr` node:

- are connected to real edge endpoints,
- are reachable from `story`,
- can reach the final `pr` node.

This prevents future DAG additions from becoming isolated advisory islands.
