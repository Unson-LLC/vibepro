---
story_id: story-vibepro-human-reviewable-pr-body
title: Human-reviewable PR body architecture
parent_design: vibepro-manual-pr-flow-alignment
---

# Human-reviewable PR body architecture

## Status

Superseded for GitHub PR body rendering by `docs/architecture/vibepro-concise-pr-body.md` and `docs/specs/vibepro-concise-pr-body.md`.

This document remains useful as historical context for why reviewers need a human decision layer. It no longer defines the shape of the GitHub PR body.

## Decision

VibePro keeps machine evidence in `.vibepro/pr/<story-id>/` artifacts and uses `pr-body.md` as a concise GitHub-facing decision brief.

The current GitHub PR body is organized as:

1. `What`: changed surface and review scope.
2. `Why`: Story and requirement reason.
3. `How to review`: reviewer entry points and risk focus.
4. `Verification`: concise current-head verification summary.
5. `VibePro`: Gate, Execution, Scope, and artifact references.

The full decision graph, Gate DAG, Agent Review, split plan, runtime metadata, verification evidence, PR create evidence, and merge evidence live in `.vibepro/pr/<story-id>/` and canonical audit artifacts.

## Rationale

Gate artifacts are necessary for auditability, but they should not be copied into the GitHub body. The reviewer needs a narrow mental model first, then links to the evidence trail.

Raw machine states such as `needs_clean_branch` are still preserved in audit details, but the first screen translates them into the human decision they imply: split the PR, explain the scope, or waive a non-critical warning with reason.

The concise body should answer the reviewer question directly: whether the changed surfaces should be accepted for the Story and where the authoritative evidence lives.

File and artifact references belong in the concise body because the reviewer should be able to open the authoritative Story, Spec, Architecture, runtime, test, and evidence files from the first screen. Link rendering is best-effort: GitHub remotes produce `blob/<head-ref>/<path>` links for source files, while artifact references remain repository-relative so the PR body never emits misleading URLs.

## Boundaries

- This does not remove Gate DAG, Agent Review, split plan, or evidence artifacts.
- This does not place full audit sections in the GitHub body.
- This does not make `scope.status=reviewable` a completion approval.
- This does not infer unchecked verification as completed.
- Domain-specific context may still be supplied through Story / Spec / narrative slots, but the default PR body remains generic.
