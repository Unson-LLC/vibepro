---
story_id: story-vibepro-execution-state-control
title: VibePro Execution State Control Architecture
---

# Architecture

## Decision

Add a Story-scoped execution state layer on top of existing VibePro artifacts.

The canonical evidence remains:

- `.vibepro/pr/<story-id>/pr-prepare.json`
- `.vibepro/pr/<story-id>/gate-dag.json`
- `.vibepro/pr/<story-id>/verification-evidence.json`
- `.vibepro/reviews/<story-id>/<stage>/review-summary.json`
- `.vibepro/pr/<story-id>/pr-create.json`

Execution state is derived from those artifacts and saved to:

`.vibepro/executions/<story-id>/state.json`

## Boundary

VibePro does not become a subagent runner. It produces a machine-readable execution state and next actions so Codex or Claude Code can continue without relying on Codex goal state.

## Invariants

- Execution state never overrides Gate DAG.
- `ready_for_pr_create` requires existing PR Gate logic to pass.
- `pr_created` requires a non-dry-run PR create result with a PR URL.
- Corrupt execution state is quarantined rather than silently overwritten.
- Existing commands continue to work without requiring `execute start` first.
