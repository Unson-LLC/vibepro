---
story_id: story-vibepro-task-scoped-pr-acceptance
architecture_ref: docs/architecture/ADR-story-vibepro-task-scoped-pr-acceptance.md
status: accepted
---

# Spec: Task-scoped PR acceptance authority

## Contracts

### TSPA-CONTRACT-001 Acceptance scope

`pr prepare` emits `pr_context.acceptance_scope` with:

- `source`: `task` or `story`
- `story_id`
- `task_id`: selected Task ID or `null`
- `acceptance_criteria`: non-empty normalized criterion strings

### TSPA-CONTRACT-002 Outcome consumers

Story E2E coverage, Gate DAG acceptance nodes/counts, clause traceability,
evidence adjudication, and senior gap acceptance counts consume the acceptance
scope.

### TSPA-CONTRACT-003 Story-wide consumers

Story source integrity, Architecture, Accepted Spec, requirement consistency,
risk classification, and responsibility authority continue to consume the
complete Story source.

### TSPA-CONTRACT-004 Routed task plan

PR Task lookup resolves the configured `task_plan` artifact route. When the
canonical route is JSON it reads that file; legacy Markdown routing keeps using
the established `.vibepro/stories/<story-id>/tasks/tasks.json` machine state.

### TSPA-CONTRACT-005 Fail closed

An explicit Task request fails before Gate evaluation when the routed task plan
is absent, the Task ID is absent, or the selected Task has no non-empty
acceptance criteria. It never falls back to Story acceptance criteria.

## Scenarios

### TSPA-STORY-001 Current Task complete, later Task incomplete

Given a Story has a completed current Task and a later incomplete Task, when PR
preparation selects the current Task, then outcome evidence contains only the
current Task criteria while Story-wide design consistency still uses the full
Story.

### TSPA-STORY-002 No Task selected

Given PR preparation does not select a Task, when gates are constructed, then
the Story acceptance criteria remain authoritative.

### TSPA-STORY-003 Routed feature task plan

Given a feature packet routes its canonical task plan outside the legacy Story
directory, when PR preparation selects a Task, then it reads the routed
canonical JSON without requiring a compatibility copy.

### TSPA-STORY-004 Invalid Task acceptance

Given an explicit Task has no usable acceptance criteria, when PR preparation
starts, then it fails with a Task-specific error before emitting misleading
Story-scoped readiness evidence.
