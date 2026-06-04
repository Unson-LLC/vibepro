---
title: Failure Mode Coverage Gate Spec
---

# Failure Mode Coverage Gate Spec

## Invariants

- `INV-FMC-1`: `gate:failure_mode_coverage` MUST be present in the PR Gate DAG.
- `INV-FMC-2`: High-risk candidate failure modes without current verification evidence MUST be `missing_coverage`.
- `INV-FMC-3`: `missing_coverage` MUST be an unresolved critical PR gate.
- `INV-FMC-4`: Static source markers alone MUST NOT satisfy failure-mode coverage.
- `INV-FMC-5`: Light changes MUST NOT be overblocked solely because a non-critical candidate exists.

## Candidate Modes

- `timeout`
- `parse_failure`
- `schema_failure`
- `provider_failure`
- `retry_or_async_failure`
- `auth_denied`
- `persistence_failure`

## Verification

- `V-FMC-1`: `test/risk-adaptive-gate.test.js` asserts workflow-heavy retry/provider candidates are missing without current evidence.
- `V-FMC-2`: `test/vibepro-cli.test.js` and existing verification binding tests continue to prove stale evidence does not count as current evidence.
