# Architecture-Spec review #3 — architecture_boundary

- agent: codex/grs_archspec3_arch
- status: needs_changes

## Findings

1. The bootstrap fingerprint omitted expected `managed_worktree.branch`; `actual_branch` is null for unavailable bindings, so a branch-only new attempt could collide.
2. `startExecution` commits source legacy state before linked-copy writes. A failed linked write can throw without returning the unavailable binding, leaving the next invocation to see a pre-existing unavailable state. The wrapper needs a deterministic, concurrency-safe partial-bootstrap recovery boundary or an explicit fail-closed contract.

Module separation, authority kinds, Run atomicity, threat/no-mirror boundaries, and follow-up Story separation otherwise passed.
