# Architecture boundary review

- agent_id: `grs_planning_arch`
- status: `needs_changes`
- summary: The module boundary is sound, but persistence authority, identifier validation, and recoverable-state semantics need to be explicit before code is written.

## Findings

- high: `run-id-path-boundary` — The artifact path contains caller-controlled identity without a strict format and rejection contract.
- high: `managed-worktree-run-authority` — The canonical artifact and linked-copy behavior across source and managed worktrees are undefined.
- medium: `failed-terminal-resume-contradiction` — `failed` is called terminal but is also resumable.
- medium: `path-surface-regression-matrix-gap` — Source/managed invocation and stale binding cases are not specified as a complete test matrix.

## Judgment delta

Define a server-generated opaque Run ID, linked persistence authority, recoverable versus terminal states, and worktree/head invariants.
