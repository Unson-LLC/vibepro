# VibePro PR Route Gate DAG Spec

## Invariants

- `INV-1`: `pr_context.pr_route` is required before PR readiness is calculated.
- `INV-2`: Route-specific gates must be explicit DAG nodes. They must not be hidden in prose or implicit fallback.
- `INV-3`: Committed `.vibepro/` artifacts require an artifact-policy decision even when the same path has local dirty edits.
- `INV-4`: PR creation must reject non-workspace dirty files because they are included in local evidence but not in the pushed PR branch.

## Scenarios

- `S-1`: A docs-only workflow transitions through route classification, PR body contract, and judgment graph rendering with `documentation_decision_review`.
- `S-2`: Mirror and release workflows transition to source traceability plus CI/waiver gates before PR creation.
- `S-3`: A split workflow transitions from `needs_clean_branch` to `passed` only after an accepted split-resolution decision.
- `S-4`: Workflow-heavy Agent Review transitions require both checkpoint reviews and PR-final reviews to be passed for the current HEAD.

## Anti-Patterns

- `AP-1`: Treating generated or inferred evidence as enough when route-specific gates have not emitted explicit node status.
- `AP-2`: Letting dirty non-workspace files influence PR evidence without forcing them into the pushed branch.
- `AP-3`: Recording a review as passed without actionable inspection evidence for the required role.

## Verification Clauses

- `V-1`: Story E2E executes `vibepro pr prepare` in temporary repositories and asserts actual `gate_dag` node statuses for docs, mirror, release, artifact, and split routes.
- `V-2`: CLI tests assert decision-record resolution, PR creation dirty-worktree blocking, PR body waiver visibility, and checkpoint/PR-final Agent Review separation.
- `V-3`: Typecheck must pass after route DAG, execution-state, checkpoint, and review-policy changes.

## Data Model
`pr_context.pr_route` MUST include:

- `route_type`
- `label`
- `confidence`
- `body_template`
- `required_gates`
- `signals`

`gate_dag.summary` MUST include:

- `pr_route`
- `pr_body_template`

## Required Nodes
`pr prepare` MUST emit:

- `gate:pr_route_classification` with type `pr_route_gate`
- `gate:pr_body_contract` with type `pr_body_contract_gate`

`mirror_sync` and `release_merge` MUST also emit:

- `gate:mirror_source_traceability`
- `gate:ci_status_or_waiver`

When `.vibepro/` artifacts are in the review diff, `pr prepare` MUST emit:

- `gate:vibepro_artifact_policy`

When scope is `needs_clean_branch`, `pr prepare` MUST emit:

- `gate:split_resolution`

## PR Body Contract
The human decision section MUST render:

- Story/source of truth
- PR Route and body template
- Gate status
- Scope decision
- Judgment graph with route, source file links, evidence, and split decision

## Verification
- A docs-only PR classifies as `docs_only` and renders `documentation_decision_review`.
- A mirror sync PR emits source traceability and CI/waiver gates and blocks PR creation when source/CI evidence is missing.
- Accepted Decision Records for `gate:mirror_source_traceability`, `gate:ci_status_or_waiver`, `gate:vibepro_artifact_policy`, and `gate:split_resolution` unblock those gates.
- Dirty local `.vibepro/` workspace evidence is ignored, but committed `.vibepro/` artifacts require the artifact policy gate.
- Workflow-heavy PRs keep PR-final review roles separate from checkpoint review roles, and PR readiness remains blocked until both sets pass for the current git state.
