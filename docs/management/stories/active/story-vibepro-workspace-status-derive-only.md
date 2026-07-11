---
story_id: story-vibepro-workspace-status-derive-only
title: Discover active worktree readiness without a registry
status: active
architecture_docs:
  - docs/architecture/vibepro-workspace-status-derive-only.md
spec_docs:
  - docs/specs/vibepro-workspace-status-derive-only.md
parent_design: vibepro-workspace-status-derive-only
reason: A persistent registry was rejected because Git worktrees, refs, and head-bound PR artifacts already contain the required facts. The compatible boundary is a read-only projection that leaves existing per-story readiness and merge behavior unchanged. Rollback is removal of the additive workspace command and module.
---

# Story: Discover active worktree readiness without a registry

## Background

VibePro stores trustworthy story readiness in each worktree's head-bound
`.vibepro/pr/<story-id>/pr-prepare.json`, but an operator at the canonical
checkout cannot discover those active stories without manually correlating Git
worktrees and artifact paths. A dirty or behind canonical checkout can then be
mistaken for the delivery state even though readiness belongs to the story
worktree and its HEAD.

## Acceptance Criteria

- `vibepro workspace status <repo> --json` enumerates every checkout returned
  by `git worktree list --porcelain` for the repository and reports discovered
  story readiness from each linked worktree-local `pr-prepare.json`; historical
  artifacts retained in canonical are not presented as active work.
- A story is `active_ready` only when `ready_for_pr_create=true`, overall status
  is `ready_for_review`, and the artifact HEAD matches the worktree HEAD.
- A mismatched or missing artifact HEAD is reported as `stale_artifact`; a
  non-ready current artifact is `active_blocked`; a worktree with no story
  artifact remains visible as `unknown`.
- Canonical dirty/behind metadata is reported separately and never changes a
  different worktree's story classification.
- The command performs no fetch and writes no registry, cache, or `.vibepro`
  artifact. Running it leaves repository status unchanged.
- Legacy or malformed artifacts do not crash the scan; they are retained as
  `unknown` with a concrete reason.
- The responsibility-authority resolver remains fail-closed: an unregistered
  responsibility, a missing primary authority reference, or an unsupported
  authority kind cannot be treated as authorized by this read-only command.
