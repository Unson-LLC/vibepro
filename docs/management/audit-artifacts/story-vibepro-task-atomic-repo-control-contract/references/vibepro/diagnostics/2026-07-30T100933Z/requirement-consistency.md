# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 6 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 1 |
| Requirement Sources | 1 |
| Spec Refs | 1 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- C-001: TaskBoundRepoControlDecision may clear the independent repo-control unsafe signal only for an explicitly selected Task whose classification repo_control groups exactly cover every changed independent repo-control path and are dependency-gra (inferred_spec:docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md)
- INV-001: Missing Task context, malformed or duplicate groups, unknown dependency IDs, partial exact coverage, extra repo-control paths, and disconnected repo-control groups retain unsafe_for_atomic_override true. (inferred_spec:docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md)
- INV-002: Task path coverage uses exact repository-relative target_files strings and never infers coverage from globs, basenames, prose, or acceptance text. (inferred_spec:docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md)
- C-002: An eligible Task proof persists Task ID, canonical Task state path, covered repo-control paths, covering repo-control group IDs, and dependency edges in machine-readable scope evidence and the split plan. (inferred_spec:docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md)
- INV-003: Task eligibility does not bypass Story atomic metadata, generated-lane coverage, current-HEAD reviewer ownership, verification evidence, Gate status, strict target validation, or VibePro PR creation. (inferred_spec:docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md)
- INV-004: Story-scoped preparation without a Task, the existing config-only registration exception, ordinary unsafe repo-control splitting, and strict target validation retain their prior behavior. (inferred_spec:docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/story-vibepro-task-atomic-repo-control-contract.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
