---
story_id: story-vibepro-ai-artifact-lineage-reconcile
title: AI Artifact Lineage Reconcile Architecture
---

# Architecture

## Decision

Artifact lineage belongs in `audit session-cost` because that command already
binds repo, story id, Codex session, token window, and changed-line accounting.
The value audit should consume a richer diagnosis instead of re-implementing
worktree archaeology.

## Flow

```mermaid
flowchart TD
  Repo["audited repo"] --> Current["current artifact root"]
  Session["selected Codex JSONL"] --> Cwd["cwd/workdir hints"]
  Session --> Refs[".vibepro/pr/story refs"]
  Cwd --> Candidates["detached candidates"]
  Refs --> Candidates
  Current --> Effective["effective inventory root"]
  Candidates --> Effective
  Effective --> Audit["session-cost output"]
```

## Boundaries

- Current worktree artifacts remain authoritative when present.
- Detached readable artifacts can be used for inventory but are labeled with
  their absolute source path.
- Observed but unavailable detached artifacts are surfaced as a lineage warning;
  they are not counted as artifact lines.
- Canonical import or copying is left to a future explicit reconcile command.
