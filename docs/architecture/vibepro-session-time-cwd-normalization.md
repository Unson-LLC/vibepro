---
story_id: story-vibepro-session-time-cwd-normalization
title: VibePro Session Time cwd Normalization Architecture
status: designed
---

# Architecture

## Decision (Phase 1, merged as #309)

Keep `matchesRepo()` as the single owner of "same repository" truth (same
resolved path, or same `git rev-parse --git-common-dir`). Do not add a second,
parallel notion of worktree equivalence elsewhere in `session-efficiency-audit.js`.

Raise the weight assigned to `cwd_matches_repo` from 45 to 50 in the
confidence-scoring layer (`resolveSessionSelection()` /
`mergeSessionCandidateGroup()` / `summarizeSessionCandidate()`) so that a
proven cwd match crosses the existing `score < 50` confidence threshold on its
own, without requiring any other corroborating signal.

## Decision (Phase 2, this PR): deterministic affinity chain for deleted worktrees

Phase 1 can only prove identity while the candidate cwd still exists, because
`gitCommonDir(candidatePath)` executes git **inside** the candidate path.
Session worktrees are routinely deleted after merge, so post-merge/daily
audits lose exactly the sessions they need. Phase 2 keeps single ownership of
repo-identity truth but widens it into one deterministic chain,
`resolveRepoAffinity(candidatePath, repoRoot)` (with `matchesRepo()` kept as a
boolean wrapper over it):

1. `exact`: realpath-based path equality (existing behavior).
2. `git_common_dir`: both sides resolve to the same
   `git rev-parse --git-common-dir` (existing behavior; covers live worktrees).
3. `managed_worktree_path`: strip the `/.claude/worktrees/<name>` or
   `/.worktrees/<name>` segment from either side and compare canonical roots;
   at least one side must actually sit inside a managed worktree segment.
   Recovers pruned managed worktrees, and lets a repoRoot that is itself a
   managed worktree match its canonical repo cwd.
4. `registered_worktree`: candidate path equals (or sits under) an entry of
   `git worktree list --porcelain` run in the target repo — including
   prunable entries whose directories are already gone.

All checks are deterministic, local, and read-only. No name-prefix or fuzzy
heuristics are allowed (mis-attribution risk). Paths that no longer exist are
canonicalized via their longest existing ancestor so symlinked roots (e.g.
`/var` vs `/private/var`) still compare equal.

## Boundaries

- `resolveRepoAffinity()` / `gitCommonDir()` / `sameExistingPath()` own
  repo-identity determination.
- `resolveSessionSelection()` and its scoring helpers own confidence
  thresholding; the `cwd_matches_repo` weight stays 50, and threshold/tie
  semantics are unchanged.
- `managed_worktree_path` only matches when the stripped canonical roots are
  equal; another repo's directory (e.g. a sibling product under
  `code/.worktrees/`) never matches because its canonical root differs from
  the target repoRoot.
- Session discovery (`collectCandidateSessionFiles`, `selectSessionDayDirs`)
  is unrelated and untouched.

## State / Evidence

- No new workspace artifact. Candidates gain `cwd_match_method`
  (`exact` / `git_common_dir` / `registered_worktree` / `managed_worktree_path`
  / null) and the audit result gains `observed_worktree_match_method`, so the
  match path is reconstructable from audit evidence.
- `git worktree list` results are memoized per audit run (one git process per
  repo, not per candidate).

## Why no ADR is required

The affinity chain is an internal hardening of an existing, already-documented
mechanism. It does not cross a new API/Auth/Billing/Data/external-integration
boundary; it changes how robustly "the same repository" can be proven for
paths that no longer exist, never which repositories are considered the same.
