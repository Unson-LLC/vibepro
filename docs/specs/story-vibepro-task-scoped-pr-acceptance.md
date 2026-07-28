---
story_id: story-vibepro-task-scoped-pr-acceptance
architecture_ref: docs/architecture/story-vibepro-task-scoped-pr-acceptance.md
parent_design: vibepro-task-scoped-pr-acceptance
status: accepted
---

# Spec: Task-scoped PR acceptance authority

## Contracts

### TSPA-CONTRACT-001 Acceptance scope

`pr prepare` emits `pr_context.acceptance_scope` with:

- `source`: `task` or `story`
- `story_id`
- `task_id`: selected Task ID or `null`
- `acceptance_criteria`: normalized criterion strings. An explicit Task scope
  requires at least one non-empty criterion; Story fallback preserves the
  existing missing-criteria Gate behavior.

The same normalized authority is rendered in `pr-body.md`,
`pr-prepare.html`, and `review-cockpit.html` as a human-readable decision
scope. Those surfaces identify the source (`Task` or `Story`), Story ID, Task
ID (or none), criterion count, and criterion text without requiring a reviewer
to inspect JSON.

### TSPA-CONTRACT-002 Outcome consumers

Story E2E coverage, Gate DAG acceptance nodes/counts, clause traceability,
evidence adjudication, and senior gap acceptance counts consume the acceptance
scope. Evidence adjudication requests and recorded verdicts expose the
normalized scope plus a deterministic scope fingerprint. A verdict is reusable
only when its HEAD and scope fingerprint both match the current PR preparation.
Task-scoped human closures use the scope fingerprint in their decision source;
an unscoped, differently scoped, or different-HEAD closure does not satisfy the
Task gate. A stored fingerprint that contradicts its embedded normalized scope
is invalid rather than authoritative.

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
Malformed canonical JSON reports the resolved repository-relative path, an
actionable repair instruction, and the underlying parser cause.

## Diagrams

### TSPA-DIAGRAM-001 Task acceptance trust boundary

```mermaid
flowchart LR
  Input[Configured routed Task artifact] --> Validate{Canonical Task validation}
  Validate -->|valid Story ID, Task ID, and criteria| Scope[Task acceptance_scope]
  Scope --> Outcome[Outcome gates and PR evidence]
  Scope --> Bind[Bind adjudication to HEAD and scope fingerprint]
  Validate -->|missing, malformed, mismatched, or empty| Reject[Fail closed before Gate evaluation]
  Story[Complete Story source] --> Design[Story-wide design and risk gates]
  Reject -. no silent fallback .-> Story
```

The routed Task artifact is an input boundary rather than an authority to
rewrite Story design. Missing, malformed, mismatched, or empty Task data is
rejected before Gate evaluation. Only validated criteria enter Task-scoped
outcome evidence; the complete Story remains authoritative for design and risk
checks.

### TSPA-STORY-005 Same HEAD, different Task

Given Task A and Task B are prepared from the same commit and both number their
first criterion `ac:1`, when Task A has a demonstrated adjudication verdict and
PR preparation switches to Task B, then Task B remains `needs_evidence` until
an independent verdict is recorded for Task B's acceptance scope.

### TSPA-STORY-006 Contradictory adjudication artifact

Given a stored verdict embeds Task A's normalized scope but claims Task B's
fingerprint, when Task B's gate and PR summary are evaluated, then the verdict
is stale and cannot contribute to readiness.

### TSPA-STORY-007 Old-HEAD human closure

Given a Task-scoped human closure was accepted on an older HEAD, when the same
Task is evaluated on a new HEAD, then the closure cannot satisfy the current
Task gate even if its scope fingerprint matches.

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
