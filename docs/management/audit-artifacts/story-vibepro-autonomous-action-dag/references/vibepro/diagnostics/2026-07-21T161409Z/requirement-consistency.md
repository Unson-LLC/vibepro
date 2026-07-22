# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 5 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 2 |
| Requirement Sources | 2 |
| Spec Refs | 2 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 3 |

## Invariants

- S-002: The autonomous workflow state transitions through diagnose, prepare_artifacts, implement, verify, review, repair, and final_prepare in dependency order; typed stop states halt the suffix, resume re-enters from the persisted state, and pr_re (inferred_spec:docs/management/stories/active/story-vibepro-autonomous-action-dag.md)
- INV-003: A completed action checkpoint is reused only for the same Run, profile, canonical action, and input HEAD. After every runner, only the repository-resolved authoritative HEAD may bind evidence or rebind a suffix; a mismatched runner-reported (inferred_spec:docs/management/stories/active/story-vibepro-autonomous-action-dag.md)
- S-003: A missing canonical owner produces waiting_for_runtime, while an unknown action, profile, dependency bypass, or forged plan fails closed before execution. (inferred_spec:docs/management/stories/active/story-vibepro-autonomous-action-dag.md)
- INV-004: Autonomous runners return only continue, pr_ready, waiting_for_human, waiting_for_runtime, blocked, or failed; untyped results are rejected. (inferred_spec:docs/management/stories/active/story-vibepro-autonomous-action-dag.md)
- INV-005: The autonomous registry excludes arbitrary shell, merge, waiver, and deploy, while profile omission preserves the byte-compatible legacy plan and journal contract. (inferred_spec:docs/management/stories/active/story-vibepro-autonomous-action-dag.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- src/guarded-run-session.js: operation === 'dispatch' && dispatchAuthority.error - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/guarded-run-session.js: operation === 'dispatch' && options.request?.requirements?.managed_worktree !== authorityRoot - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/guarded-run-session.js: loaded.state.status === 'cancelled' || loaded.state.status === 'pr_ready' || loaded.state.status === 'waiting_for_human' - replace with inferred spec clause inherited_behavior: { condition, classification, files }

## Requirement Sources

- spec: docs/specs/story-vibepro-autonomous-action-dag.md: Autonomous Action DAG Spec
- spec: docs/specs/vibepro-judgment-dag-adjudication.md: Judgment DAG Adjudication Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
