---
story_id: story-vibepro-session-cost-attribution-hardening
title: Session Cost Attribution Hardening Architecture
parent_design: vibepro-runtime-cost-gap-closure
---

# Architecture

## Decision

Harden the existing `audit session-cost` collector instead of adding another
cost pipeline. Merge-time accounting remains optional and non-blocking, but when
requested it must be fast enough for the PR path and conservative enough to avoid
false attribution.

## Flow

```mermaid
flowchart TD
  Request["execute merge / audit session-cost"] --> Window["explicit or automation window"]
  Request --> Selection["session selection"]
  Selection --> Files["bounded JSONL discovery"]
  Files --> Cwd["repo/worktree attribution"]
  Cwd --> Parse["token/time parser"]
  Parse --> Cost["cost_accounting or partial provenance"]
  Cost --> Canonical["canonical audit summary"]
```

## Boundaries

- Session inference may inspect Codex JSONL metadata, but must not follow
  symlink directory loops.
- Explicit session IDs are allowed, but a repo/cwd mismatch is a readiness
  blocker.
- Window bounds are accounting bounds, not proof that work happened. If the
  selected window has no events, elapsed time is unavailable.
- Daily automation windows and merge/story windows are different evidence
  scopes. VibePro must preserve which one was used.
