# Gate Evidence Recheck

- Status: `needs_changes`
- Reviewer: `/root/gate_evidence_recheck`
- Reviewed HEAD: `38fbaa62410bf7c41d7c885e544387a025ff17f9`

## Summary

The three prior findings are resolved or contractually disposed, and the current-head verification artifacts are sound. Explicit recovery still cannot rebuild a malformed or oversized existing capsule, contradicting the Story recovery boundary.

## Inspection

The reviewer inspected the current request, `origin/main..HEAD` diff, Story, Architecture, Spec, Test Plan, capsule projector and recorder hooks, focused and E2E tests, prior review result, current verification evidence, generic status artifacts, and current `pr prepare` gate state. No files were edited and no tests were run.

## Finding

`medium:capsule-explicit-rebuild-invalid-existing`

`recoverCapsule` catches `RunContextCapsuleError` and calls `refreshCapsule`, but refresh parses any existing capsule first. Malformed JSON therefore fails again, while a valid oversized capsule with the same event fingerprint may be returned unchanged and rejected again. Add a forced rebuild path that ignores or replaces the disposable existing capsule after a validated read failure, plus malformed and oversized `recover(..., rebuildOnStale: true)` regressions.

## Prior finding dispositions

- `capsule-new-source-staleness`: resolved by complete source-set comparison and regression coverage.
- `capsule-semantic-event-churn`: accepted by the explicit exact-authoritative-byte identity contract.
- `gate-evidence-missing-status-artifacts`: resolved by current-head machine-verifiable unit, integration, and E2E status artifacts.
