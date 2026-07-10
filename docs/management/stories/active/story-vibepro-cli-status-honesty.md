---
story_id: story-vibepro-cli-status-honesty
title: CLI status output must match the observable evidence
architecture_docs:
  - docs/architecture/vibepro-cli-status-honesty.md
spec_docs:
  - docs/specs/vibepro-cli-status-honesty.md
parent_design: vibepro-cli-status-honesty
---

# Story: CLI status output must match the observable evidence

## Background

Two real, reproduced cases where VibePro CLI output contradicts the evidence it
just collected, forcing a human to re-verify by hand:

1. `vibepro execute merge` on an already-merged PR reports
   `status: blocked` / `stop_reason: base_not_fresh,pr_not_mergeable` even
   though its own `gh pr view` result (stored in the same `pr-merge.json`)
   says `"state":"MERGED"` with all checks SUCCESS. Reproduced live on
   PR #314 (2026-07-10) and previously on PR #309: after `gh pr merge`, the
   squash commit makes `origin/main` a non-ancestor of the branch head and the
   PR non-OPEN, so both preconditions can never pass again — the tool blocks
   forever on a PR that is already merged, and no merge record
   (`merge_commit_sha` / `merged_at` / traceability / canonical audit) is kept.
2. `vibepro design-ssot init` against a registry that already contains 57+
   design roots prints `design_roots: 1`. The registry file itself is updated
   non-destructively (57 -> 58 roots verified on disk), but the status output
   hardcodes `design_root_count: 1` in `src/cli.js`, so the operator reading
   the output believes the registry was truncated.

Both defects share one intent: the CLI's stated status must be derived from
the same evidence the CLI just observed, never from an assumption.

## Acceptance Criteria

- When `vibepro execute merge` resolves the target PR and `gh pr view` reports
  `state: MERGED`, the command reconciles instead of blocking: it fetches the
  merged PR's `mergeCommit`/`mergedAt`, verifies the merge commit is an
  ancestor of `origin/<base>`, and finishes with `status: merged_externally`,
  `stop_reason: null`, `merge_commit_sha` and `merged_at` populated in
  `pr-merge.json`.
- The reconciled run still performs the normal post-merge record keeping:
  traceability lifecycle promotion to `merged` and canonical audit promotion,
  identical to a merge executed by the tool itself.
- If the PR is MERGED but the merge commit cannot be confirmed on
  `origin/<base>` (or the merged view cannot be fetched), the command stays
  `blocked` with the explicit stop_reason `pr_merged_externally_unverified` —
  it never fabricates a merge record.
- An OPEN PR keeps today's behavior byte-for-byte: preconditions gate the
  merge, and `status: merged` is only set after `gh pr merge` succeeds.
- `vibepro design-ssot init` status output reports the actual registry totals
  (`design_root_count`, `child_link_count`) read back from the registry it
  just wrote, for both a fresh registry (1) and an existing multi-root
  registry (N+1 after adding one root).
