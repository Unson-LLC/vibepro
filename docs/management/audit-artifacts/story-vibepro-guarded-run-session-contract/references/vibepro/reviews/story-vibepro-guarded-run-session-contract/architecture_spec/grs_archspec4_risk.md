# Architecture-Spec review #4 — regression_risk

- agent: codex/grs_archspec4_risk
- status: needs_changes

Legacy routing and Gate/shell/waiver/merge boundaries remain protected. The partial recovery predicate cannot accept the real unavailable artifact because `current_head_sha` is null, and orphan-lock output/no-steal/nonmutation coverage is missing.
