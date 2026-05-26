---
story_id: story-vibepro-human-reviewable-pr-body
title: Human-reviewable PR body architecture
---

# Human-reviewable PR body architecture

## Decision

VibePro keeps the machine evidence sections in `pr-body.md`, but adds a human decision layer before them.

The PR body is organized as:

1. Decision brief: what this PR asks the reviewer to decide.
2. Decision graph: a compressed human-readable graph of purpose, source of truth, changed surfaces, gate evidence, and split decision.
3. Change and rationale summary: what changed and why.
4. Human review map: focused reviewer questions and Runtime / Contract Docs / Capability Map / Tests / Repo Control classification.
5. Verification checklist: commands with `[x]` only when bound Gate evidence has passed.
6. Risks and explicit non-goals: what the PR does not claim to change or verify.
7. Audit log: Gate DAG, Agent Review, split plan, runtime metadata, and detailed evidence.

## Rationale

Gate artifacts are necessary for auditability, but they should not be the first thing a human has to parse. The reviewer needs a narrow mental model first, then the evidence trail.

Raw machine states such as `needs_clean_branch` are still preserved in audit details, but the first screen translates them into the human decision they imply: split the PR, explain the scope, or waive a non-critical warning with reason.

The top section should answer the reviewer question directly: whether the changed surfaces should be accepted for the Story. The decision graph is not a full Gate DAG dump; it is a human-sized projection of the Story / Spec / Gate DAG evidence.

## Boundaries

- This does not remove Gate DAG, Agent Review, split plan, or evidence sections.
- This does not make `scope.status=reviewable` a completion approval.
- This does not infer unchecked verification as completed.
- Domain-specific context may still be supplied through Story / Spec / narrative slots, but the default PR body remains generic.
