---
story_id: story-vibepro-development-judgment-workflow
title: Development Judgment Workflow Spec
status: active
---

# Development Judgment Workflow Spec

## Required Behavior

### DJW-001 Prepare

`vibepro judgment prepare <repo> --id <story-id>` MUST write a valid Senior Judgment input draft.

The draft MUST:

- use schema `0.3.0`
- bind `story_id` and a unique or explicitly supplied `run_id`
- link the current Senior Judgment run as `parent_run_id` when present
- include current changed-file observations
- contain every standard judgment axis
- initialize every axis as `inactive`
- set `problem_frame.status=uncertain`
- state that semantic framing has not been adopted

The command MAY accept `--output` and `--run-id`.

### DJW-002 Evaluate and compile

`vibepro judgment evaluate` MUST continue to execute the existing Senior Engineering Judgment evaluation and write its existing artifacts.

After that evaluation, it MUST compile a `vibepro_development_judgment_dag` with these ordered nodes:

1. `goal_contract`
2. `problem_frame`
3. `development_mode`
4. `option_pruning`
5. `recommendation`

The compiled DAG MUST be acyclic, advisory, and non-blocking. It MUST write:

- immutable run JSON and Markdown
- current JSON and Markdown projection

### DJW-003 Outcome

`vibepro judgment outcome record` MUST require:

- Story ID
- run ID
- human decision
- judgment effect
- evaluation status
- summary

Allowed human decisions:

- `accepted`
- `modified`
- `rejected`

Allowed effects:

- `changed_plan`
- `changed_review_focus`
- `escalated_to_human`
- `no_effect`

Allowed statuses:

- `confirmed`
- `mixed`
- `falsified`
- `unknown`

Recording an Outcome MUST append an evaluation to the current DAG recommendation and write a separate Outcome artifact. The immutable run artifact MUST remain byte-identical.

### DJW-004 PR projection

`pr prepare` MUST read the current Development Judgment projection fail-soft.

The machine-readable preparation and PR body MUST expose:

- availability/status
- run ID
- development mode
- recommendation
- unknown count
- outcome count
- latest outcome status
- artifact
- `advisory=true`
- `blocking=false`

The projection MUST NOT participate in readiness resolution. The same repository state and review/bug evidence MUST produce the same `gate_status` whether the judgment projection exists or not.

### DJW-005 Failure boundary

A missing Development Judgment artifact MUST produce `status=not_recorded`.

An unreadable or invalid artifact MUST produce `status=unavailable` with a bounded error summary. Neither state may fail `pr prepare` by itself.

## Verification

- focused unit/integration tests cover draft generation, compilation, cycle validity, immutable run preservation, outcome append, CLI routing, and PR projection
- `npm run typecheck`
- generated CLI references remain synchronized
- public documentation build remains valid

## Non-goals

- enforcing Judgment as a PR Gate
- automatic Frame or Story adoption
- automatic Brainbase promotion
- restoring managed merge or generic Gate DAG behavior
