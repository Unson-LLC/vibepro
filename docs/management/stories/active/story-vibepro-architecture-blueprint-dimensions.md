---
story_id: story-vibepro-architecture-blueprint-dimensions
title: Architecture Blueprint Dimensions Gate
status: active
---

# Architecture Blueprint Dimensions Gate

## Background
The Architecture Gate today checks that architecture evidence *exists* (an ADR doc, or an explicit ADR-unnecessary decision). It does not check that the architecture evidence *addresses the design questions that matter for the kind of thing being built*.

Issue #128: while drafting a workflow/scheduler story, `vibepro check architecture` passed, but the architecture missed a key decision — what runs local scheduled jobs and what infrastructure runs server-side scheduled jobs. The gate was too shallow for that story shape.

This is explicitly **not** a universal architecture checklist for every story. The required blueprint dimensions depend on what is being built. It sits after the Engineering Judgment DAG: once the story shape is known, require the architecture evidence to cover the dimensions that shape demands.

## Acceptance Criteria
- A conservative, high-precision detector classifies a story's shape from its text (title/background/summary/acceptance criteria). It starts with one shape: `workflow_scheduler`.
- A data map (`shape -> required dimensions`) defines the dimensions per shape, so adding shapes/dimensions later is a data change, not a logic change.
- For a detected shape, `gate:architecture_blueprint` (`type: architecture_blueprint_gate`) requires the architecture evidence (architecture docs + story text) to address each required dimension. `workflow_scheduler` requires `scheduling_owner` and `job_infrastructure`.
- When a required dimension is not addressed, the gate is `needs_evidence` (blocking `ready_for_pr_create`); it is resolved by covering the dimension in the architecture doc, or by a waiver decision recorded against `gate:architecture_blueprint`.
- The gate is independent of the existing Architecture Gate: architecture evidence can be `satisfied` while the blueprint gate is `needs_evidence` (the exact #128 scenario).
- The gate is absent (no friction) for stories whose shape is not detected.
- It is wired into the Gate DAG after the architecture node (architecture -> gate:architecture_blueprint -> code) and DAG connectivity stays `passed`.
- It is non-critical (waiver-resolvable), not a hard wall.
