# architecture_spec / regression_risk

Status: needs_changes

## Summary

Legacy compatibility, schema failure, identity validation, and mirror repair direction are sound, but managed-context selection and creation partial-failure retry semantics still required implementation decisions.

## Inspection

- Current Architecture, Spec, test plan
- Existing execute routing and execution-state persistence
- Managed worktree creation, discovery, canonical-path behavior
- Existing CLI regression tests

## Findings

- high / `managed-run-context-resolution`: existing `startExecution` can create a nested managed worktree if reused from the managed root, and authoritative binding was ambiguous.
- medium / `run-creation-partial-failure-idempotency`: a blind retry of `execute run` necessarily creates a different opaque Run, contradicting a universal nonduplication statement.
