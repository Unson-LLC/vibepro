# Product requirement review

- agent_id: `grs_planning_product`
- status: `needs_changes`
- summary: The Run Session is additive and appropriately excludes orchestration, but its default status route and failure/output contracts are not yet internally consistent enough to preserve legacy behavior.

## Findings

- high: `status-run-selection-contradiction` — Architecture says omitted `--run-id` selects the newest Run for status, while the command contract and Spec C-002 require exact legacy status behavior.
- medium: `failure-output-surface-gap` — Typed failures do not define JSON/human output shape, exit codes, or corrupt/future-schema behavior.
- medium: `path-surface-regression-evidence-gap` — The acceptance/test plan does not enumerate the command, output, and invocation contexts needed to prove legacy compatibility.

## Judgment delta

Resolve status routing explicitly, define stable failure rendering and exit behavior, and add a path/surface regression matrix before implementation.
