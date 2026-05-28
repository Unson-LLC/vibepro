# VibePro PR Route Gate DAG

## Intent
`pr prepare` must decide how a PR should be read before it decides whether the PR is ready. The route is a DAG input, not prose generated at the end.

## DAG Shape
The route gates run immediately after Story resolution:

1. `story`
2. `gate:pr_route_classification`
3. route-specific gates
4. `gate:pr_body_contract`
5. existing change classification, freshness, architecture, spec, requirement, verification, review, and PR gates

This keeps the final Gate from treating every PR as a generic runtime Story.

## Routes
- `docs_only`: documentation intent and reader decision.
- `test_only`: test intent and evidence relevance.
- `runtime_change`: runtime contract, Story/Spec, and verification.
- `design_or_ui_change`: UX invariants, visual evidence, and design quality evidence.
- `config_or_agent_policy`: repo-control boundary and affected agent/hook policy.
- `mirror_sync`: source PR/commit/ref, source or target CI, and artifact policy.
- `release_merge`: source PR set, release CI, deployment scope, and waiver handling.
- `general_change`: standard Story review when no stronger route is detected.

## Criticality
Route-specific unresolved gates are critical when they protect merge interpretation:

- missing PR route
- missing PR body contract
- missing mirror/release source traceability
- missing mirror/release CI or explicit waiver
- unresolved `.vibepro/` artifact policy
- unresolved split/clean-branch decision

`scope.status=reviewable` is not a substitute for this DAG. PR creation remains blocked until the Gate DAG is ready or an explicit supported waiver path is used.

## Evidence Paths
Route gates must not become permanent blockers. Evidence can arrive through:

- commit metadata for mirror/release source pointers
- current verification evidence that cites CI/check status
- accepted Decision Records scoped to the relevant gate id

Dirty local `.vibepro/` workspace artifacts stay outside product review scope. Only committed `.vibepro/` artifacts trigger the artifact policy gate.

Workflow-heavy review is split by phase: development-phase roles are checkpoint requirements, while gate/preview roles are PR-final requirements. PR readiness checks both sets so skipping checkpoints cannot silently pass.
