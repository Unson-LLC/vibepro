# Independent gate evidence review

- reviewer: `/root/gate_evidence_final_head`
- head: `d39d58591579b5ef379fc17abbcd7c7fd893358f`
- status: `needs_changes`

## Summary

Managed mirror rebuild is fixed, but source-root recovery can accept a mismatched canonical authority state and return the wrong Run binding.

## Inspection

The reviewer inspected the Story, Architecture, Spec, Test Plan, capsule implementation and integrations, current-head evidence, prior findings, managed mirror recovery regression, and source-root authority resolution. It ran 65 focused/integration tests and the acceptance E2E successfully, then reproduced the identity bypass with an isolated managed fixture.

## Finding

`capsule-managed-authority-reload-identity-bypass` (medium): `loadRunContext` validates `story_id` and `run_id` on the initially requested state, but after resolving a managed source mirror to the canonical authority file it reloads canonical state without repeating identity validation. A source-root caller with a correctly bound mirror and canonical state for a different Run can rebuild the wrong binding instead of failing closed. Add a public `recoverRunContext(sourceRoot, ...)` regression requiring `stale_binding` and no mutation, and validate canonical identity after reload.

## Prior finding dispositions

- `capsule-explicit-rebuild-invalid-existing`: accepted, resolved.
- `capsule-new-source-staleness`: accepted, resolved.
- `capsule-semantic-event-churn`: rejected; exact source bytes are the event identity contract.
- `gate-evidence-missing-status-artifacts`: accepted, resolved.
- `capsule-explicit-rebuild-managed-mirror-desync`: accepted, resolved.

