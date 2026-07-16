# Architecture-Spec review #4 — architecture_boundary

- agent: codex/grs_archspec4_arch
- status: needs_changes

The expanded fingerprint, repository authority, closed lifecycle, and legacy boundaries pass. Partial bootstrap recovery does not: unavailable `current_head_sha` is null, `created_from_sha` may be the resolved base rather than invocation HEAD, and legacy `execute start` does not share the new Run lock. Orphan-lock and cleanup/retry paths also need fixtures.
