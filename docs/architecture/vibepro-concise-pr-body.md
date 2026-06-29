---
story_id: story-vibepro-concise-pr-body
title: Concise GitHub PR body architecture
---

# Architecture

## Decision

Use `pr-body.md` as the GitHub-facing decision brief, not as the full audit log.

`preparePullRequest` continues to build the same PR context, Gate DAG, decision index, review cockpit, split plan, and lifecycle artifacts. `renderPrBody` projects that context into a Japanese judgment brief that can be read without opening the artifact directory first:

1. `判断`: the Story interpretation and the decision the reviewer is being asked to make.
2. `経緯`: requirement, origin/background, task context, and optional narrative.
3. `原因`: root cause or the best available risk/problem summary.
4. `解決`: solution/policy or the best available change summary.
5. `レビュー観点`: Gate summary, scope, managed worktree state, review focus, and bounded risks.
6. `確認`: concise verification plus the final E2E/flow confidence line.
7. `詳細`: only the minimal `.vibepro/pr/<story-id>/` evidence entrypoints and runtime status.

## Rationale

Human reviewers reading dozens of AI-generated PRs need the first screen to answer: what Story interpretation is being reviewed, where it came from, what root cause was found, what solution was applied, and which final test makes the change shippable. Full Gate DAG and Agent Review evidence is still valuable, but it belongs in structured artifacts where it can be replayed, diffed, and summarized without consuming GitHub body budget or LLM context by default.

## Boundaries

- `renderPrBody` changes only the GitHub-facing Markdown projection.
- Gate DAG readiness, Agent Review requirements, evidence depth, and PR creation enforcement remain unchanged.
- `self-dogfood` checks the body contract by looking for the Japanese decision brief, confirmation section, and `.vibepro` evidence references instead of requiring full Gate DAG and Execution Gate sections in the PR body.

## Risk Controls

- The `詳細` section includes the minimal artifact paths so the audit trail remains discoverable without turning the PR body into an artifact index.
- Gate and execution status stay visible in the concise body.
- Raw `gh pr create` bodies still fail self-dogfood because they lack VibePro evidence references and matching PR lifecycle artifacts.
