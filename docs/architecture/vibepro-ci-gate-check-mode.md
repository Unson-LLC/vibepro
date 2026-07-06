---
story_id: story-vibepro-ci-gate-check-mode
title: VibePro CI Gate Check Mode Architecture
parent_design: vibepro-ci-gate-check-mode
status: draft
---

# Architecture

## Decision

`vibepro gate check` is a thin, read-only wrapper over the existing PR
readiness Gate DAG computation in `preparePullRequest`. It does not
reimplement gate semantics, scoring, or route classification. External
repositories (brainbase, salestailor) that previously hand-rolled their own
gate/scoring scripts in CI can call this command instead and consume the real
Gate DAG result directly.

Because `preparePullRequest` unconditionally persists PR-lifecycle artifacts
under `.vibepro/pr/<story-id>/` and appends to
`.vibepro/gate-outcomes/ledger.json` whenever the workspace is initialized,
and no dry-run toggle exists for it, read-only behavior is achieved by
snapshot-and-restore isolation around the real call rather than by forking
gate logic or adding a write-suppression flag to a 13,000+ line function.

## Public Contract

The public CLI addition is:

```text
vibepro gate check <repo> [--story-id <id>] [--base <ref>] [--head <ref>] [--ci] [--json]
```

The command returns a normalized, machine-readable report:

```json
{
  "schema_version": "0.1.0",
  "story_id": "story-example",
  "status": "passed",
  "overall_status": "ready_for_review",
  "ready_for_pr_create": true,
  "gates": [
    { "id": "gate:example", "status": "passed", "blocking": false, "reason": null }
  ],
  "unresolved_gate_count": 0,
  "critical_unresolved_gate_count": 0,
  "generated_at": "2026-07-06T00:00:00.000Z"
}
```

`--ci` marks the invocation as the CI-blessed one and enables the strict
exit-code contract described under Invariants. Running without `--ci` performs
the identical evaluation for local/manual use; the non-JSON summary adds a
one-line note that it is not the CI-blessed invocation. Existing `pr prepare`,
`checkpoint`, and self-dogfood CI contracts remain unchanged.

## Flow

```text
vibepro gate check
  -> resolve repoRoot and story id (readWorkspaceState + resolveStory, both read-only)
  -> snapshot .vibepro/pr/<story-id>/ and .vibepro/gate-outcomes/ (if present)
  -> call the real preparePullRequest (unmodified gate computation)
  -> extract gate_dag, gate_status, story_id from the return value
  -> restore the snapshotted subpaths to their exact prior state (finally block)
  -> return the normalized report and exit 0/1
```

## Boundaries

- `gate check` may read repository and `.vibepro/` state and may invoke the
  real `preparePullRequest` computation.
- `gate check` must not create, update, or delete any `.vibepro/` artifact as
  an observable net effect of running it.
- `gate check` must not dispatch agent review subagents, import CI evidence,
  or perform any network call; it only evaluates the current Gate DAG.
- `gate check` must not record waivers, splits, or review verdicts. Human
  judgment points remain exactly as `pr prepare` reports them.
- Story id resolution mirrors `checkpoint`'s default-story behavior exactly:
  when `--story-id` is omitted, the same resolver `preparePullRequest` uses
  internally is invoked ahead of time (read-only) so the correct
  `.vibepro/pr/<story-id>/` path can be snapshotted before the real call runs.

## Invariants

- Given a repository where all required gates are satisfied, `gate check --ci`
  exits 0 and reports `ready_for_pr_create: true`.
- Given a repository with unresolved required gates, `gate check --ci` exits 1
  and reports the unresolved gate ids and reasons.
- `.vibepro/pr/<story-id>/` and `.vibepro/gate-outcomes/` are byte-identical
  before and after any `gate check` invocation, whether or not they existed
  beforehand.
- An unresolvable `--story-id` produces a clean error message and a non-zero
  exit code, never an uncaught stack trace.
- `gate check`'s exit-code and JSON-shape contract does not depend on whether
  `--ci` is passed; `--ci` only changes advisory output text.

## Rollback

The feature is removable by deleting the `gate check` CLI branch, the
`evaluateGateReadiness` wrapper in `src/pr-manager.js`, this Story's Spec and
Architecture docs, the `docs/guide/ci-integration.md` guide, and the focused
`test/vibepro-gate-check.test.js` file. `pr prepare`, `checkpoint`, and
self-dogfood CI do not depend on `gate check` and are unaffected by its
removal.
