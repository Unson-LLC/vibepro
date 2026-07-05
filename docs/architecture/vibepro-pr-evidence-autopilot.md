---
story_id: story-vibepro-pr-evidence-autopilot
title: VibePro PR Evidence Autopilot Architecture
parent_design: vibepro-pr-evidence-autopilot
---

# Architecture

## Decision

`vibepro pr autopilot` is a thin orchestration layer over the existing PR
readiness, verification evidence, CI import, and agent review preparation
commands. It reduces the fixed command sequence for routine evidence collection
without changing the meaning of any gate, waiver, split, or review verdict.

## Public Contract

The public CLI addition is:

```text
vibepro pr autopilot <repo> --story-id <id> --base <ref> [--verify <kind=command>]... [--pr <number>] [--import-ci] [--check <name=kind>]... [--dry-run]
```

The command returns a machine-readable run summary with the initial and final
`pr prepare` status, executed or planned operations, stop reason, and next
commands. Existing `pr prepare`, `verify record`, `verify import-ci`,
`review prepare`, `pr create`, and `execute merge` contracts remain unchanged.

## Flow

```text
vibepro pr autopilot
  -> pr prepare
  -> run configured verification commands
  -> verify record for each command result
  -> pr prepare after each evidence update
  -> optional CI import when a PR number is known
  -> review prepare for concrete review dispatches
  -> stop at human judgment points
```

## Boundaries

- Autopilot may execute configured verification commands and record their exact
  exit-code result.
- Autopilot may import CI checks when the caller provides enough PR/check
  context.
- Autopilot may generate review dispatch artifacts when `pr prepare` identifies
  concrete review work.
- Autopilot must not create waivers, choose a split plan, fabricate a passing
  review verdict, merge a PR, or override a blocking gate.
- Autopilot artifacts live under `.vibepro/pr/<story-id>/autopilot/` and are
  evidence inputs, not replacement sources of truth.

## Invariants

- A nonzero verification command is recorded as failing evidence and stops the
  run.
- An existing current passing evidence record for the same kind is preserved
  rather than overwritten by default.
- `--dry-run` reports planned operations without writing verification evidence,
  review artifacts, or autopilot run artifacts.
- Re-running the command converges toward the same `pr prepare` state instead of
  creating duplicate manual work.

## Rollback

The feature is removable by deleting the `pr autopilot` CLI branch, the
orchestration helpers, this Story's Spec and Architecture docs, and the focused
CLI tests. Existing PR and evidence commands do not depend on Autopilot.
