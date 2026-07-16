# Spec consistency review

- agent_id: `grs_planning_spec`
- status: `needs_changes`
- summary: The clauses identify the intended lifecycle, but default routing, deterministic selection, corruption handling, and the threat model are not yet testable as separate behaviors.

## Findings

- high: `spec-consistency-status-default-route` — Status without a Run selector is specified both as legacy status and newest-Run status.
- high: `path-surface-latest-run-ordering` — Persisted creation time and deterministic tie-breaking are absent from the schema contract.
- high: `regression-guard-legacy-output-matrix` — Legacy output/nonmutation coverage is too broad to verify exact compatibility.
- medium: `path-surface-schema-failure-conflation` — Corrupt JSON and future schema are conflated in one scenario despite requiring different handling.
- medium: `spec-threat-model-missing` — Path traversal, stale bindings, authority escalation, and gate-waiver boundaries are not captured as security invariants.

## Judgment delta

Split the scenarios, add deterministic identity/selection fields, enumerate the compatibility matrix, and state the threat model and fail-closed guarantees.
