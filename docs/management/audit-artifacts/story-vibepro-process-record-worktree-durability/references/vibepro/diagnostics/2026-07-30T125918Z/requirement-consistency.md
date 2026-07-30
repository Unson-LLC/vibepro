# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 5 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 2 |
| Requirement Sources | 0 |
| Spec Refs | 0 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- INV-001: The durable process-record store root resolves to the main checkout for linked worktrees, so stored records survive worktree deletion. (inferred_spec:docs/management/stories/active/story-vibepro-process-record-worktree-durability.md)
- S-001: snapshot mirrors story-scoped durable record classes to the store, and hydrate restores them into a regenerated worktree. (inferred_spec:docs/management/stories/active/story-vibepro-process-record-worktree-durability.md)
- INV-002: Hydration is non-destructive: it never deletes local files and never overwrites a local record newer than the stored copy. (inferred_spec:docs/management/stories/active/story-vibepro-process-record-worktree-durability.md)
- INV-003: Gate-outcome ledger hydration unions entries by entry_key, so a regenerated clear ledger cannot erase a recorded trip (fail-closed). (inferred_spec:docs/management/stories/active/story-vibepro-process-record-worktree-durability.md)
- S-002: Mutating CLI commands (verify, review, adjudicate record, spec write, pr prepare, decision record) trigger a fail-soft auto-snapshot that never fails the producing command. (inferred_spec:docs/management/stories/active/story-vibepro-process-record-worktree-durability.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- なし

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
