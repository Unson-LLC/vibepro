---
story_id: story-vibepro-concise-pr-body
title: Concise GitHub PR body architecture
---

# Architecture

## Decision

Use `pr-body.md` as the GitHub-facing decision brief, not as the full audit log.

`preparePullRequest` continues to build the same PR context, Gate DAG, decision index, review cockpit, split plan, and lifecycle artifacts. `renderPrBody` projects that context into five short sections:

1. `What`: Story, changed file count, review areas, and change summary.
2. `Why`: requirement, background, task context, and optional narrative.
3. `How to review`: Gate summary, scope, managed worktree state, Engineering Judgment summary, review focus, change map, risks, and non-goals.
4. `Verification`: concise verification checklist.
5. `VibePro`: Gate/Execution/Scope status plus references to `.vibepro/pr/<story-id>/` artifacts.

## Rationale

Human reviewers need the first screen to answer: what changed, why, where to look, and what verified it. Full Gate DAG and Agent Review evidence is still valuable, but it belongs in structured artifacts where it can be replayed, diffed, and summarized without consuming GitHub body budget or LLM context by default.

## Boundaries

- `renderPrBody` changes only the GitHub-facing Markdown projection.
- Gate DAG readiness, Agent Review requirements, evidence depth, and PR creation enforcement remain unchanged.
- `self-dogfood` checks the new body contract by looking for the decision brief, Verification, and `.vibepro` evidence references instead of requiring full Gate DAG and Execution Gate sections in the PR body.

## Risk Controls

- The `VibePro` section always includes artifact paths so the audit trail remains discoverable.
- Gate and execution status stay visible in the concise body.
- Raw `gh pr create` bodies still fail self-dogfood because they lack VibePro evidence references and matching PR lifecycle artifacts.
