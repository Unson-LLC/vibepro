---
story_id: story-vibepro-workspace-status-derive-only
title: Derive-only Workspace Status Architecture
parent_design: vibepro-workspace-status-derive-only
---

# Architecture

## Decision

Add a read-only `workspace status` projection. Git remains the discovery index:
the command resolves the repository common directory, parses `git worktree list
--porcelain`, reads each worktree's current HEAD and dirty state, then reads only
bounded readiness fields from worktree-local `pr-prepare.json` files.

No registry or persisted workspace projection is introduced. The expected
worktree count is small, and correctness is more valuable than caching a view
that must be reconciled before every use.

## Boundaries

- `src/workspace-status.js` owns Git worktree discovery, bounded artifact reads,
  classification, and human rendering.
- `src/cli.js` only dispatches `vibepro workspace status` and selects JSON or
  human output.
- Story readiness remains owned by `pr-prepare.json`; workspace status never
  upgrades readiness and never treats canonical checkout health as a gate.
- Remote fetch is intentionally excluded. The result reports the locally known
  upstream relation when available and marks unavailable data as unknown.
- Merge closure, evidence retention, and garbage collection are separate future
  stories.

## Failure Handling

- A missing worktree path or malformed artifact yields an `unknown` item with a
  reason instead of aborting the repository-wide view.
- A deleted artifact between discovery and read is handled as a missing artifact.
- Git command failure aborts with the command error because worktree discovery
  itself cannot then be trusted.
