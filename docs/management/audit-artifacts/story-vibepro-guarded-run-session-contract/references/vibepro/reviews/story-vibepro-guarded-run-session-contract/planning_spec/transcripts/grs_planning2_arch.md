# Architecture boundary replacement review

- agent_id: `grs_planning2_arch`
- status: `needs_changes`
- summary: Prior findings are substantially resolved, but Story identity, unmanaged worktree identity, and linked-copy partial failure remain underspecified.

## Findings

- high: `story-id-path-boundary` — Story ID also participates in the artifact path and needs a normative validated source/format plus typed failure.
- high: `unmanaged-worktree-resume-binding` — Every Run needs a canonical execution root/worktree identity, even when managed mode is disabled.
- medium: `linked-copy-partial-failure-contract` — Cross-worktree writes cannot be atomic as a pair; authority-first partial commit and recovery semantics need definition.
