---
story_id: story-vibepro-session-time-cwd-normalization
title: Session inference should treat git-common-dir cwd matches as decisive
architecture_docs:
  - docs/architecture/vibepro-session-time-cwd-normalization.md
spec_docs:
  - docs/specs/vibepro-session-time-cwd-normalization.md
parent_design: vibepro-session-time-cwd-normalization
---

# Story: Session inference should treat git-common-dir cwd matches as decisive

## Background

`src/session-efficiency-audit.js` already normalizes a session's observed cwd against
the target repo via `matchesRepo()`, which correctly recognizes that a Codex session
run from a sibling git worktree (e.g. `.claude/worktrees/<name>` or
`code/.worktrees/vibepro-*`) shares the same `git rev-parse --git-common-dir` as the
canonical repo. That signal (`cwd_matches_repo: true`) is real and precise: it cannot
be true for a genuinely unrelated repository.

However `resolveSessionSelection()`'s scoring model only assigns 45 of the needed 50
points for a cwd match (`mergeSessionCandidateGroup` / `summarizeSessionCandidate`),
so a worktree-run session whose transcript happens to lack other corroborating
signals (story reference text, requested-window overlap, process-manager cwd, or
even token/final-answer events, e.g. a short or interrupted session) scores exactly
45 and is rejected as `ambiguous`/`low confidence` even though its cwd was correctly
and unambiguously matched to the repo. This produces exactly the class of failure
reported as "no session JSONL files matched the session/cwd filters" for otherwise
legitimate worktree sessions.

## Acceptance Criteria

- A session whose cwd is proven to match the target repo via `matchesRepo()`
  (same path OR same `git-common-dir`, i.e. a genuine git worktree of the same repo)
  is never rejected purely due to lacking unrelated corroborating signals.
- A session whose cwd belongs to a genuinely different repository (no shared
  git-common-dir, no same path) continues to be treated as a mismatch and does not
  gain any inference advantage from this change.
- Existing ambiguous/unavailable behavior for ties and truly signal-less sessions
  (no cwd match at all) is unchanged.
- Add regression coverage for: (a) worktree-cwd-only match now resolves with
  medium/high confidence, (b) a different repo's worktree cwd still fails to match.
