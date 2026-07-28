---
story_id: story-vibepro-task-scoped-pr-acceptance
spec_ref: docs/specs/story-vibepro-task-scoped-pr-acceptance.md
status: accepted
---

# Architecture Decision: Task-scoped PR acceptance authority

## Context

`vibepro pr prepare/create --task <task-id>` resolves a Task for operational
context, but outcome gates still consume the parent Story's complete acceptance
criteria. A Story that intentionally sequences later live or human-approved
Tasks therefore blocks an earlier completed Task even when the requested PR is
correctly scoped.

Feature-packet routing also permits the canonical task-plan artifact to live
outside `.vibepro/stories/<story-id>/tasks/tasks.json`; PR preparation currently
hard-codes that legacy location.

## Decision

PR context exposes an explicit `acceptance_scope`:

- with `--task`, the selected Task is the acceptance authority;
- without `--task`, the Story remains the acceptance authority;
- the scope records its source, Story ID, Task ID, and normalized criteria;
- a requested Task with missing, mismatched, or empty acceptance criteria fails
  closed instead of silently falling back to Story criteria.

Only outcome/readiness consumers use `acceptance_scope`: Story E2E coverage,
Gate DAG acceptance nodes and counts, clause traceability, evidence
adjudication, and senior gap ideal-state counts.

Story source integrity, Architecture, Accepted Spec, requirement consistency,
risk classification, and responsibility authority continue to use the complete
Story. Task scoping therefore changes delivery closure, not design authority.

Task state resolution uses the configured `task_plan` artifact route. A
configured JSON route is the read authority; legacy Markdown routing continues
to use its established sibling machine state.

## Consequences

- A completed Task can reach PR readiness while later Story Tasks remain
  intentionally incomplete.
- Machine-readable PR evidence states exactly which acceptance authority was
  evaluated.
- Routed feature packets no longer require a compatibility copy in the legacy
  Story task directory.
- Invalid Task acceptance state blocks early with a specific error.

## Alternatives rejected

- Treating every task PR as Story-complete: prevents incremental, reviewable
  delivery for Stories with explicit HITL or live follow-up Tasks.
- Weakening all Story gates: loses Architecture/Spec/risk integrity.
- Falling back to Story criteria when Task criteria are missing: hides malformed
  task plans and produces misleading evidence.
