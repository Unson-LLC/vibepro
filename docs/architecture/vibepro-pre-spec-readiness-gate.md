---
story_id: story-vibepro-pre-spec-readiness-gate
title: Pre-Spec Readiness Gate Architecture
---

# Architecture

Pre-Spec Readiness Gate is a promotion boundary, not a new diagnosis engine.

VibePro already has the required evidence surfaces:

- Story artifacts in `.vibepro/stories/` and `.vibepro/vibepro-manifest.json`
- Graphify artifacts in `.vibepro/graphify/`
- Story diagnosis runs in `.vibepro/diagnostics/`
- Architecture check runs in `.vibepro/checks/architecture/`
- Engineering Judgment inside `pr prepare` Gate DAG context

The new boundary stores a compact readiness artifact at:

```text
.vibepro/spec/<story-id>/pre-spec-readiness.json
```

## Decision

`vibepro spec readiness` calls the existing PR preparation context builder to materialize Engineering Judgment, then records a compact readiness summary. `spec write --final` reads that artifact and blocks final promotion when any required readiness check is missing, blocked, or stale for the current git HEAD.

Draft spec writing remains possible through `spec write --draft`. Drafts do not update `spec.json`, so `spec show`, `spec drift`, and PR gates continue to read only final specs.

## Tradeoffs

- This keeps existing Gate DAG logic as the source of Engineering Judgment.
- It avoids making `check architecture` a separate approval authority. A check run with review findings can still satisfy the "architecture check was performed" condition unless the pack failed or needs setup.
- It introduces a new mandatory step for final spec promotion. That friction is intentional because final Spec is the contract used by downstream implementation and PR gates.

## Non-goals

- Do not make Graphify bundled or mandatory for every VibePro command.
- Do not make draft exploration impossible.
- Do not replace PR readiness or `checkpoint implementation-start`.
