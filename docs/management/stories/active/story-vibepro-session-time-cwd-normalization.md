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

## Phase 2: deleted-worktree cwd normalization (this PR)

The score-weight fix above (merged as #309) only helps sessions whose worktree
still exists on disk: `matchesRepo()` proves identity by running
`git rev-parse --git-common-dir` **inside the candidate cwd**, so when the
worktree has been deleted after the session ran (the normal lifecycle for
`.claude/worktrees/*` and `.worktrees/*` session worktrees), the proof can no
longer be executed and the session falls back to `cwd_matches_repo=false` —
reproducing the original "no session matched" failure for exactly the sessions
audits most need to find (post-merge / daily audits).

Phase 2 extends the affinity check into a deterministic chain
(`resolveRepoAffinity`): `exact` → `git_common_dir` → `managed_worktree_path`
(strip `/.claude/worktrees/<name>` / `/.worktrees/<name>` segments and compare
canonical roots) → `registered_worktree` (`git worktree list --porcelain`
entries of the target repo, including prunable ones), and records the match
method as audit evidence.

### Phase 2 Acceptance Criteria

- SCWN-S-2: A session cwd whose worktree was deleted after the session (still
  registered, or pruned but under a managed worktree path of the repo) still
  normalizes to the repo.
- SCWN-S-3: A cwd belonging to a different repository's worktree directory
  (no shared canonical root, no registration) never matches.
- SCWN-S-4: The match method (`exact` / `git_common_dir` /
  `registered_worktree` / `managed_worktree_path`) is recorded on candidates
  (`cwd_match_method`) and the audit result (`observed_worktree_match_method`).
- SCWN-S-5: Equal-score ties remain `ambiguous`; no silent selection.
- SCWN-S-6: All existing SCATTR-*/SAI-* scenarios pass unchanged.

### Inherited behavior

- The existing `entry.type === 'session_meta'` branch that reads
  `session_id`/`cwd` from session JSONL is unchanged/existing; only the
  affinity judgment over the already-read cwd changes.
- Explicit `--session-id <id>` selection bypasses inference entirely
  (unchanged).
- The `cwd_matches_repo` score weight stays 50 as merged in #309; the
  confidence threshold and tie semantics are unchanged.

### Phase 2 Scenario Clauses

#### Scenario: deleted registered worktree cwd is recovered from the worktree registry

Given a Codex session JSONL whose cwd was a registered worktree of the target repo that has since been deleted from disk
When session inference runs
Then the cwd still matches the repo with `cwd_match_method=registered_worktree`.

#### Scenario: pruned managed worktree cwd is recovered from the managed path pattern

Given a session cwd under `<repo>/.claude/worktrees/<name>` whose worktree was deleted and pruned
When session inference runs
Then the cwd still matches the repo with `cwd_match_method=managed_worktree_path`.

#### Scenario: unrelated repo worktree cwd is still rejected

Given a Codex session JSONL whose cwd belongs to a different repository's worktree directory
When session inference runs against the target repo
Then `cwd_matches_repo` remains false and no match method is recorded.
