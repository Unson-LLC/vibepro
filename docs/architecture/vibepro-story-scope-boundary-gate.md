---
story_id: story-vibepro-story-scope-boundary-gate
title: VibePro Story Scope Boundary Gate Architecture
parent_design: vibepro-story-scope-boundary-gate
---

# Architecture

## Decision

Persist the scope boundary declaration as a new `scope_boundary` field inside
the existing `.vibepro/stories/<story-id>/tasks/tasks.json` (owned by
`src/task-manager.js`, written by `createTasksFromPlan()`), rather than a new
sibling artifact. `tasks.json` is already the story-scoped, story-lifetime
record that both `task-manager.js` and `pr-manager.js` (`readTaskState()` /
`loadPrTaskContext()`) read; adding one field keeps the boundary declaration
co-located with the `target_files` data it is derived from and avoids a new
file/schema for `pr prepare` to discover.

`src/pr-manager.js` gains a new, always-evaluated Gate DAG node
(`gate:scope_boundary`, `type: scope_boundary_gate`) built by
`buildScopeBoundaryGate()`. It is wired into `buildGateDag()` next to the
existing `gate:pr_scope_judgment` node (same neighborhood: both reason about
"should these changed files be in this PR"), and into
`collectUnresolvedRequiredGates()` / `isCriticalUnresolvedGate()` following the
exact pattern already used for `gate:pr_scope_judgment` (critical only when
unresolved; an accepted decision record resolves it, matching
`findAcceptedDecisionForSource(decisionRecords, 'gate:scope_boundary')`).

This supersedes the narrower `assertStrictTargetFiles()` hard-throw path in
intent (both check "changed files vs. declared scope") but does not replace or
modify it in this Story: `assertStrictTargetFiles()` is exact-match, per-task,
`--strict`-only, and throws; `gate:scope_boundary` is glob-based, per-story,
always evaluated, non-critical when undeclared, and produces auditable Gate
DAG evidence with a waiver path. Removing/consolidating the old strict-mode
check is left as a follow-up so this Story stays additive and low-risk.

## Boundaries

- `src/task-manager.js` owns computing and persisting `scope_boundary`
  (declared vs. derived, glob normalization). `src/pr-manager.js` only reads
  it (`readScopeBoundaryIfExists()`, mirroring the existing
  `readDecisionRecordsIfExists()` / `readEvidenceReuseIfExists()` "best-effort
  JSON read, tolerate ENOENT" convention already used throughout the file).
- Glob matching is a small, dependency-free `matchesAnyGlob()` helper local to
  `pr-manager.js` (supports `*`, `**`, and literal path/prefix matches) — no
  new npm dependency for a feature this narrow.
- The gate never inspects `git` history beyond the same `changed_files` list
  already computed for every other Gate DAG node in this run; no new git
  invocation is added.

## Why no ADR is required

This is an additive Gate DAG node using the exact same "read best-effort JSON
sidecar, build a gate object, wire into the two gate-collection helpers"
pattern as five-plus existing gates in `pr-manager.js` (e.g.
`gate:pr_scope_judgment`, `gate:split_resolution`, `gate:responsibility_authority`).
It introduces no new external integration, storage engine, or cross-service
boundary, and is fully backward compatible (undeclared stories are unaffected).
