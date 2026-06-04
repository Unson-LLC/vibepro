---
title: PR Scope Judgment Gate Spec
---

# PR Scope Judgment Gate Spec

## Invariants

- `INV-PSJ-1`: `gate:pr_scope_judgment` MUST be present in the PR Gate DAG.
- `INV-PSJ-2`: Existing `scope.status !== reviewable` MUST make the gate `needs_split`.
- `INV-PSJ-3`: `needs_split` MUST be an unresolved critical PR gate.
- `INV-PSJ-4`: Reviewable single-story PRs MUST pass the gate.

## Verification

- `V-PSJ-1`: `test/vibepro-cli.test.js` asserts broad session diffs produce `gate:pr_scope_judgment=needs_split` and block PR creation.
- `V-PSJ-2`: `test/vibepro-cli.test.js` asserts the Engineering Judgment DAG edge order includes `gate:pr_scope_judgment` between the common spine and bug-physics triage.
