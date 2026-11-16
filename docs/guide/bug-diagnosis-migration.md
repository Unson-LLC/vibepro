# Bug-fix migration

VibePro no longer uses the ordered bug-diagnosis DAG as completion authority. Its node order, evidence-reference strings, Git HEAD, and matching path identifiers could prove internal consistency, but they could not prove the original user problem, the production path, downstream execution, or canonical receiver readback.

## Current workflow

Register the Story contract and use the minimal Story → Spec → code → verification → lightweight review → PR flow:

```bash
vibepro story add . --id story-example-bug --title "Fix example failure" --contract-type bug_fix
vibepro story diagnose . --id story-example-bug --pre-architecture --run-graphify
vibepro verify .
vibepro pr prepare . --base main
```

`story diagnose` remains a general investigation command. It does not create or certify a root-cause DAG.

For `bug`, `bug_fix`, and `regression_fix` Stories, `pr prepare` emits `fix_scope`:

- `status: partial_fix` until `internal_output`, `downstream_outcome`, and `canonical_readback` are all `verified`.
- When the external outcome remains unconfirmed, `completion_claim: implementation_verified_external_outcome_unknown` is used only if `internal_output` is `verified` or the verification evidence has a `trusted` status.
- If the external outcome remains unconfirmed while `internal_output` is not `verified` and the verification evidence is not `trusted`, the claim is `implementation_unverified_external_outcome_unknown`.
- Once all three stages are `verified`, the status is `user_outcome_fix` and the claim is `user_outcome_verified`.
- `original_problem`, affected outcome stages, and confirmed/unconfirmed boundaries near the PR evidence.

Local tests can verify an implementation stage. They cannot, by themselves, establish a production same-path result or a receiver-side readback. External flows should use the terminal receipt contract tracked in [Issue #507](https://github.com/Unson-LLC/vibepro/issues/507).

## Existing artifacts

The `vibepro bug diagnose record` and `vibepro verify-first` commands are removed. Existing `.vibepro/bug-diagnosis/...` and `.vibepro-store/.../bug-diagnosis/...` files remain readable historical records and are not rewritten or deleted.

For historical artifacts:

- `ready`, `root_cause_confirmed`, `same_path_reverified`, and `verified_complete` describe the retired structural model only.
- They do not authorize a current root-cause or user-outcome completion claim.
- Regenerate PR preparation with the current VibePro version to obtain `fix_scope` and explicit unknown boundaries.
