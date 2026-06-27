# Artifact Map

VibePro stores reviewable evidence under `.vibepro/`.

| Path | Purpose |
| --- | --- |
| `.vibepro/graphify/` | Imported Graphify graph and reports |
| `.vibepro/pr/<story-id>/pr-prepare.json` | Canonical PR readiness payload |
| `.vibepro/pr/<story-id>/pr-body.md` | Concise GitHub PR body draft |
| `.vibepro/pr/<story-id>/gate-dag.html` | Gate dependency graph |
| `.vibepro/pr/<story-id>/review-cockpit.html` | Human review cockpit |
| `.vibepro/pr/<story-id>/split-plan.html` | PR split and merge-order plan |
| `.vibepro/reviews/` | Agent review lifecycle and results |
| `.vibepro/verification-artifacts/` | Verification and CI evidence |
| `.vibepro/executions/` | Managed execution and merge audit state |

## `pr_context`

`pr-prepare.json` contains `pr_context`.

Important fields:

- `graph_context`: Graphify impact scope when imported graph artifacts exist.
- `code_topology_context`: optional `codebase-memory-mcp` topology context.
- `code_topology_context.available`: whether a usable provider result matched the current changed files.
- `code_topology_context.reason`: why the provider was available, unavailable, or unmatched.
- `code_topology_context.investigation_files`: related files worth reading during review.
- `code_topology_context.signals`: `code_topology:*` activation signals used as supporting Engineering Judgment evidence.

These fields are audit context. Required proof still comes from tests, replays, inspections, CI, review, and explicit decisions.
