---
story_id: story-vibepro-gate-efficiency-fast-readiness
title: Focused PR Readiness Views Stay Lightweight Architecture
parent_design: vibepro-bounded-artifact-view
status: accepted
---

# Architecture

This story keeps focused PR readiness views lightweight without changing the
durable PR preparation authority. The existing `pr prepare` pipeline still owns
Gate DAG evaluation, verification evidence loading, review artifact inspection,
and the full `.vibepro/pr/<story-id>/pr-prepare.json` artifact.

## Decision

For focused consumers, `pr prepare --summary-json` and `pr prepare --view ...`
default to summary-depth evidence unless the caller explicitly passes
`--evidence-depth`. The default is limited to bounded projection surfaces used
for handoff, blocking-gate inspection, and readiness checks.

The bounded views also carry command-shaped next actions through
`primary_next_command` and `next_commands` when VibePro can derive them from
gate action text. This is additive metadata for agents and does not replace the
gate status, required actions, full artifact references, or the durable Gate DAG.

## Public Contract

alternatives_considered: Keeping full evidence in every focused view was
considered and rejected because it makes machine handoff views heavy while the
full artifact already exists as the drill-down authority. Adding a separate
readiness command was also considered and rejected because it would fragment the
existing PR preparation workflow.

compatibility_impact: The CLI contract is backward compatible. Explicit
`--evidence-depth` still wins, full-depth artifacts remain available in
`.vibepro/pr/<story-id>/pr-prepare.json`, and the new command metadata fields
are additive. Existing consumers that ignore unknown fields continue to work.

rollback_plan: Revert the changes in `src/cli.js`, `src/pr-manager.js`,
`src/canonical-audit.js`, and the focused tests, then rerun `vibepro pr prepare`
to regenerate the previous projection artifacts.

boundary: Only bounded PR readiness projection surfaces change. The durable
Gate DAG, verification evidence records, review lifecycle, PR creation gate,
merge gate, and explicit full-depth override remain unchanged.

accepted_followups: none.

## Execution Topology

alternatives_considered: Moving the projection logic into a new command was
rejected because `pr prepare` already coordinates runtime collection, git state,
story resolution, evidence loading, gate evaluation, and PR artifact writing.
Keeping every focused view full-depth was rejected for the same handoff-cost
reason described above.

compatibility_impact: The execution topology remains the existing synchronous
CLI path. No worker, agent, subprocess, network call, retry loop, persistence
store, or artifact lifecycle is added.

rollback_plan: Revert the same three source files and focused tests, then rerun
`vibepro pr prepare` against the reverted behavior.

boundary: The flow is:

```text
caller -> pr prepare CLI -> focused view detection -> summary-depth default
       -> pr-manager Gate DAG and next-command projection
       -> canonical audit bounded projection
       -> durable full artifact remains available for drill-down
```

accepted_followups: none.

## Scope Reviewability

boundary: This is one reviewable story and one runtime surface. The code change
is localized to the CLI evidence-depth default, PR readiness gate action
projection, and bounded canonical audit metadata preservation. The tests cover
the new lightweight default, explicit-depth override, command extraction, and
projection preservation.

accepted_followups: none.
