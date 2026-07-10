---
story_id: story-vibepro-story-scope-boundary-gate
title: Story-declared file scope boundaries should be checked at PR prepare time
architecture_docs:
  - docs/architecture/vibepro-story-scope-boundary-gate.md
spec_docs:
  - docs/specs/vibepro-story-scope-boundary-gate.md
parent_design: vibepro-story-scope-boundary-gate
---

# Story: Story-declared file scope boundaries should be checked at PR prepare time

## Background

VibePro already runs multiple Stories concurrently in separate worktrees, but
nothing stops one Story's edits from leaking into another Story's PR when both
happen to share a working tree window. This is not hypothetical: the code and
tests for `story-vibepro-session-cost-carryover-bucket` were committed into the
same working tree that was mid-edit for
`story-vibepro-session-time-cwd-normalization`, and both landed together in
PR #309 (merged), forcing PR #310 to become a docs-only after-the-fact
correction instead of a clean split.

`src/pr-manager.js` already has a narrow, opt-in version of this idea:
`assertStrictTargetFiles()` (only active when `pr prepare --strict --task <id>`
is passed) hard-throws when changed files fall outside a single task's exact
`target_files` list, with no waiver path and no visibility in the Gate DAG.
This is too narrow (task-level, exact-match only, no globs) and too brittle
(a thrown error instead of an auditable, waivable Gate) to have prevented the
PR #309/#310 incident, and most `pr prepare` runs never pass `--strict --task`
at all.

## Acceptance Criteria

- `vibepro task create --from-plan` accepts an optional `--allowed-paths
  <comma-separated-globs>` flag. When given, the story's
  `.vibepro/stories/<story-id>/tasks/tasks.json` persists a `scope_boundary`
  object with `declared: true` and the normalized glob list.
- When `--allowed-paths` is not given, `tasks.json` still records a
  `scope_boundary` object with `declared: false`, populated from the union of
  every task candidate's `target_files` (informational only).
- `vibepro pr prepare --story-id <story-id>` reads that story's `scope_boundary`
  and adds a `gate:scope_boundary` node to the Gate DAG that compares every
  changed file (base..HEAD, excluding `.vibepro/` artifacts and test files) against
  the declared glob patterns.
  - `declared: false` (no explicit declaration) never blocks PR creation
    (`required: false`) — this keeps existing Stories that never opted in
    working exactly as before.
  - `declared: true` with every changed file matching a pattern resolves to
    `status: passed`.
  - `declared: true` with at least one changed file matching no pattern
    resolves to `status: needs_scope_correction`, is treated as a critical
    unresolved gate (same severity class as `gate:pr_scope_judgment`), lists
    the offending files, and instructs the agent to either split the PR or
    update the story's declared scope and rerun `pr prepare`.
  - An accepted decision record against `gate:scope_boundary` (or
    `gate:split_resolution`, matching existing waiver conventions) resolves a
    `needs_scope_correction` gate without requiring the files to be removed
    from the diff.
- Existing Stories with no `tasks.json` at all (task create never run for this
  story) get `scope_boundary: null` and the gate is omitted entirely — fully
  backward compatible with the current `pr prepare --story-id <id>` (no
  `--task`) flow.
