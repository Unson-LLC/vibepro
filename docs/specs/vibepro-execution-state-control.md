---
story_id: story-vibepro-execution-state-control
title: VibePro Execution State Control Spec
---

# Spec

## Required Behavior

- `vibepro execute start . --story-id <id> --target pr_create --base <ref>` creates or refreshes `.vibepro/executions/<story-id>/state.json`.
- `vibepro execute status . --story-id <id>` returns the saved state when present, or an unsaved derived state when absent.
- `vibepro execute next . --story-id <id>` returns only the current phase, completion status, blocking gate, and next actions.
- `vibepro execute reconcile . --story-id <id>` rebuilds and writes state from existing VibePro artifacts.
- `verify record`, `review prepare`, `review record`, `review status`, `pr prepare`, and `pr create` must attempt to refresh execution state when a story id is known.
- State target defaults to `pr_create`.
- `completion_status` values are:
  - `not_prepared`
  - `blocked`
  - `ready_for_pr_create`
  - `pr_created`
- `current_phase` values include:
  - `prepare_pr`
  - `verification`
  - `agent_review`
  - `create_pr`
  - `complete`
- A Story with verification evidence but unresolved Gate DAG remains `blocked`.
- A Story with `gate_status.ready_for_pr_create=true` becomes `ready_for_pr_create`.
- A non-dry-run `pr create` with a PR URL becomes `pr_created`.
- `pr-create.json` / `pr-merge.json` can advance `pr_created` / `merged` only when the lifecycle artifact is bound to the current git HEAD. Stale lifecycle artifacts remain historical evidence and must not drive execution state forward.

## State Shape

The state file includes:

- `story_id`
- `target`
- `started_at`
- `updated_at`
- `current_phase`
- `completed_phases`
- `completion_status`
- `blocking_gate`
- `next_actions`
- `required_commands`
- `last_pr_prepare`
- `last_review_status`
- `last_verification_evidence`
- `pr_url`

## Compatibility

- Existing PR/review/verification artifacts remain the source of truth.
- Execution state is a resumable control view, not a replacement for Gate DAG or evidence artifacts.
- Execution state must ignore stale PR lifecycle artifacts when deriving completion status, next actions, `pr_url`, and execution DAG nodes.
- Human manual review does not satisfy required Agent Review Gate unless existing Gate logic already accepts it.
