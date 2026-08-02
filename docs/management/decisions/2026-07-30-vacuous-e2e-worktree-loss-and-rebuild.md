---
decision_id: 2026-07-30-vacuous-e2e-worktree-loss-and-rebuild
story_id: story-vibepro-vacuous-e2e-test-elimination
type: evidence_rebuild_disclosure
status: accepted
approver: sato_keigo
approved_at: 2026-07-30
---

# Worktree loss and evidence rebuild: story-vibepro-vacuous-e2e-test-elimination

## Why this record exists

Every VibePro process artifact for this Story was destroyed mid-flow and then rebuilt. A
reader comparing artifact timestamps against the commit history would otherwise find
evidence that postdates the commits it certifies, with no explanation. This file is that
explanation. It also records that the subagent budget counter was reset by the same event,
so the consumption figures in the rebuilt artifacts are not the full consumption for this
Story.

## What happened

The implementing worktree `.claude/worktrees/loving-liskov-4c3cf6` was deleted while the
whole-repository suite was being polled — directory and `.git/worktrees` entry both gone.
The deletion was not performed by this flow. It was discovered immediately afterwards; no
Trash copy and no gitdir entry remained, so it was not recoverable.

Work resumed in `.worktrees/p4-vacuous-e2e`, created from the surviving branch. The new
location is outside `.claude/worktrees/` deliberately, since that is where the loss occurred.

## What survived

The branch `claude/vacuous-e2e-deletions` at `6aafd9b5`, with all 15 commits and all 24
tracked file changes intact: the lint and its tests, the acceptance replay spec, the six
reporter-format fixes, the widened typecheck glob, the design-root registration, the
architecture document, the Story and Spec documents, the CHANGELOG entry, the tracked
`.vibepro/config.json`, and the budget-approval record. **No part of the deliverable was
lost.**

## What was lost

Everything under `.vibepro/` that is gitignored, because that tree is per-worktree:

- the four verification evidence records (unit 2269/2269, e2e 89/89, integration 92/92,
  typecheck), all of which had been bound to `6aafd9b5`
- the Story's `spec.json`: clauses S-001, S-002, INV-003, INV-002 and two diagrams
- eight decision records
- three review records, their lifecycles, and the dispatch-authorization ledger
- twenty adjudication verdicts: six clause, fourteen judgment-DAG
- `pr-prepare.json` and all gate state

## What the rebuild is derived from

Not from memory. The scratchpad survived and holds the exact inputs:

- `spec-input.json` — the four clauses and both diagrams, byte-for-byte as submitted to
  `vibepro spec write`
- `judgments.txt` — the fourteen judgment-DAG reasons as recorded
- `deleted.txt` — the seventeen removed paths
- the review transcript stubs

Verification evidence is not transcribed. It is **re-executed** against the current HEAD, so
the rebuilt records are fresh runs rather than restated outcomes. Reviews and adjudication
are likewise re-run by fresh independent subagents; the prior verdicts are not carried over.

## Budget counter reset

`dispatch-authorizations.json` held the consumed-subagent count and was destroyed with the
rest. The counter therefore restarts at zero, and the rebuilt ledger will undercount: ten
subagents had already been consumed for this Story before the loss.

Per the owner approval recorded in
`docs/management/decisions/2026-07-30-vacuous-e2e-test-elimination-budget-approval.md`
(`max_subagent_count: 14`, scoped to the closing round and explicitly through to merge), the
rebuild consumption is treated as drawing on that same envelope rather than on a fresh one.
The honest position is stated plainly: after this event the artifacts can no longer
demonstrate total consumption for this Story, and the figure in the rebuilt ledger is a
lower bound.

## What this record does not do

It does not waive any gate, and it does not carry forward any prior verdict. Every gate is
closed by evidence, review, or adjudication produced after the rebuild, at the head the PR
is created from.
