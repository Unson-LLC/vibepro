---
summary: "Per-story-shape architecture blueprint dimensions gate that sits after the Engineering Judgment DAG and deepens the Architecture Gate (issue #128)."
read_when:
  - Adding required architecture blueprint dimensions for a story shape/route
  - Changing how the Architecture Gate enforces design coverage
  - Debugging gate:architecture_blueprint
---

# Architecture Blueprint Dimensions Gate

## Position

The Engineering Judgment DAG classifies *what kind of engineering thinking* a change needs. This gate is the next step issue #128 asked for: once the story shape is known, require the architecture evidence to actually cover the design questions that shape makes load-bearing — not just that an architecture doc exists.

It deepens, rather than replaces, the Architecture Gate. The Architecture Gate answers "is there architecture evidence?"; the Blueprint Gate answers "does that evidence address the dimensions this story shape makes load-bearing?".

## Conservative detector, dimensions behind it

`detectBlueprintShapes(storySource)` is high-precision: it only returns a shape when the story text clearly describes it. The first (and currently only) shape is `workflow_scheduler`. Keeping the detector conservative means ordinary stories never see the gate; the dimension list sits behind the detector, never in front of it.

## Data map, not logic

`ARCHITECTURE_BLUEPRINT_DIMENSIONS` maps shape -> list of `{ id, label, hint, keywords }`. Adding a new shape (e.g. `data_migration` requiring rollback/backfill) or dimension is a data edit, not control flow. `keywords` is the matcher used to decide whether the architecture evidence addresses the dimension.

`workflow_scheduler` dimensions:
- `scheduling_owner` — what runs the scheduled jobs (local vs server-side) and how they are triggered.
- `job_infrastructure` — what infrastructure runs server-side scheduled jobs.

## Coverage check

`buildArchitectureBlueprintCoverage(repoRoot, { storySource, fileGroups })` runs upstream (async) because it reads architecture doc content, which the Gate DAG builder otherwise does not load. It concatenates story text + architecture doc contents and tests each required dimension's matcher. The result (`shapes`, `required`, `covered`, `missing`) is passed into `buildGateDag` like `engineeringJudgment`/`environmentGraph`.

## Gate

`buildArchitectureBlueprintGate` returns null when no shape applies (gate absent). Otherwise it is `needs_evidence` until every required dimension is covered, or a waiver is recorded against `gate:architecture_blueprint`. Independent of the Architecture Gate, so architecture evidence can be `satisfied` while this gate blocks — the #128 scenario. Non-critical (`isCriticalUnresolvedGate` does not list it), so it puts execution into `waiver_required`, not a hard block.

## Wiring

The node sits right after `architecture`: `architecture -> gate:architecture_blueprint -> code` (replacing the direct `architecture -> code` edge when present). This places it after the Engineering Judgment DAG and keeps the graph connected; `gate:dag_connectivity` stays `passed`.

## Sequencing

First slice is one shape (`workflow_scheduler`), matching the established discipline: enforce one concrete, checkable thing; grow the shape/dimension map after observing waiver behavior.
