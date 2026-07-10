---
story_id: story-vibepro-session-time-cwd-normalization
title: VibePro Session Time cwd Normalization Architecture
---

# Architecture

## Decision

Keep `matchesRepo()` as the single owner of "same repository" truth (same
resolved path, or same `git rev-parse --git-common-dir`). Do not add a second,
parallel notion of worktree equivalence elsewhere in `session-efficiency-audit.js`.

The only change is in the confidence-scoring layer
(`resolveSessionSelection()` / `mergeSessionCandidateGroup()` /
`summarizeSessionCandidate()`): raise the weight already assigned to
`cwd_matches_repo` from 45 to 50 so that a proven cwd match crosses the
existing `score < 50` confidence threshold on its own, without requiring any
other corroborating signal (story reference text, requested-window overlap,
process-manager cwd, or token/final-answer events).

## Boundaries

- `matchesRepo()` / `gitCommonDir()` / `sameExistingPath()` own repo-identity
  determination. This story does not touch their logic.
- `resolveSessionSelection()` and its scoring helpers own confidence
  thresholding. This story only adjusts one weight inside that scoring model.
- Session discovery (`collectCandidateSessionFiles`, `selectSessionDayDirs`) is
  unrelated and untouched.

## Why no ADR is required

This is a scoring-weight tuning fix inside an existing, already-documented
mechanism (`matchesRepo()`'s git-common-dir normalization). It does not cross a
new API/Auth/Billing/Data/external-integration boundary, and it does not change
which paths are considered "the same repository" — only how much confidence a
correct match is given.
