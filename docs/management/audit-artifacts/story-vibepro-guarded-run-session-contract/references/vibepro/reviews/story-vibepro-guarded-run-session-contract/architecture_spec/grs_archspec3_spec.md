# Architecture-Spec review #3 — spec_consistency

- agent: codex/grs_archspec3_spec
- status: needs_changes

## Findings

1. The formal Spec and tests did not enumerate the closed lifecycle matrix, so unintended terminal transitions could pass.
2. `authority_kind=repository` lacked a normative creation path for managed-worktree `mode=disabled` and restart fixtures.
3. S-002 needed origin traceability to GRS-S-10 (zero-based acceptance index 9).
4. C-007 audit timestamps had an impossible revision order.

Managed authority, fallback fingerprint, repair, outputs, migration, corruption, and threat boundaries otherwise aligned.
