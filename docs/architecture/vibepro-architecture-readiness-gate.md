---
story_id: story-vibepro-architecture-readiness-gate
title: Architecture Readiness Gate Architecture
---

# Architecture

Architecture Readiness Gate is a promotion boundary for authoritative Architecture artifacts.

VibePro intentionally allows agents to write draft Architecture while exploring a story. The boundary is final promotion: once an Architecture is treated as the design authority for Spec and implementation, it must be tied to current Story evidence, Graphify context, diagnosis, Architecture check, and Engineering Judgment.

## Decision

Add a first-class `architecture` command group:

```bash
vibepro architecture readiness <repo> --id <story-id> [--base <ref>] [--json]
vibepro architecture write <repo> --id <story-id> --draft
vibepro architecture write <repo> --id <story-id> --final
```

`architecture readiness` reuses the same evidence surfaces as Pre-Spec Readiness:

- Story artifacts in `.vibepro/stories/` and `.vibepro/vibepro-manifest.json`
- Graphify artifacts in `.vibepro/graphify/`
- Story diagnosis runs in `.vibepro/diagnostics/`
- Architecture check runs in `.vibepro/checks/architecture/`
- Engineering Judgment inside the `pr prepare` Gate DAG context

The compact readiness artifact is stored at:

```text
.vibepro/architecture/<story-id>/architecture-readiness.json
```

`architecture write --draft` writes a draft under `.vibepro/architecture/<story-id>/draft.md` without readiness. `architecture write --final` writes the final markdown to `docs/architecture/<story-id>.md` by default, or to `--output <repo-relative-path>`, only when readiness is ready and current for `HEAD`.

## Boundary

This does not make Architecture check a new approval authority. The check confirms the review package ran and did not fail or require setup. The final authority still comes from the combined readiness bundle plus downstream PR Gate DAG.

This also does not block exploratory writing. Drafts remain cheap; only authority promotion is gated.

## Tradeoffs

- The implementation duplicates the compact readiness collection shape from Pre-Spec Readiness instead of introducing a broader framework. That keeps the change reviewable and preserves the existing behavior of `spec readiness`.
- A future refactor can extract a shared readiness collector once Architecture and Spec gates stabilize.
- The new command writes final Architecture markdown, while existing human-authored docs remain valid. This is a CLI guard for future authoritative promotion, not a migration of historical docs.
