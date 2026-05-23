---
story_id: story-vibepro-human-reviewable-pr-body
title: Human-reviewable PR body architecture
---

# Human-reviewable PR body architecture

## Decision

VibePro keeps the machine evidence sections in `pr-body.md`, but adds a human decision layer before them.

The PR body is organized as:

1. Decision brief: what this PR asks the reviewer to decide.
2. Human review map: Runtime / Contract Docs / Capability Map / Tests / Repo Control.
3. Explicit non-goals: what the PR does not claim to change or verify.
4. Verification checklist: commands with `[x]` only when bound Gate evidence has passed.
5. Audit log: Gate DAG, Agent Review, split plan, and detailed evidence.

## Rationale

Gate artifacts are necessary for auditability, but they should not be the first thing a human has to parse. The reviewer needs a narrow mental model first, then the evidence trail.

## Boundaries

- This does not remove Gate DAG, Agent Review, split plan, or evidence sections.
- This does not make `scope.status=reviewable` a completion approval.
- This does not infer unchecked verification as completed.
- Domain-specific context may still be supplied through Story / Spec / narrative slots, but the default PR body remains generic.
