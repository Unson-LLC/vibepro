---
story_id: story-vibepro-review-surface-violation-ledger
title: Review Surface Violation Ledger Spec
parent_design: vibepro-review-surface-violation-ledger
diagrams:
  - kind: flow
    mermaid: |
      flowchart LR
        Start["review start"] --> Snapshot["head_sha + surface_digest recorded"]
        Snapshot --> Running["reviewer inspects"]
        Running --> Close["lifecycle close"]
        Close --> Compare{"surface moved and close_reason completed"}
        Compare -- no --> Lifecycle["closed_head_sha + closed_surface_digest only"]
        Compare -- yes --> Ledger["append-only surface-violations.json"]
        Ledger --> Gate["gate:review_surface_integrity failed"]
        Gate --> Ack["accepted decision record"]
        Ack --> Gate
  - kind: threat_model
    mermaid: |
      flowchart LR
        Actor["Implementing agent or operator"] --> Surface["Review surface between start and close"]
        Surface --> Asset["Recorded review verdict and the PR gate decision it feeds"]
        Threat1["Mutate the tree while a review is running"] --> Surface
        Threat2["Re-run the review so the finding is overwritten"] --> Asset
        Threat3["Rewrite the ledger to a well-formed empty file"] --> Asset
        Threat4["Corrupt the ledger so it reads as empty"] --> Asset
        Surface --> Control1["close computes closed_head_sha + closed_surface_digest, agent self-report is not an input"]
        Control1 --> Control2["append-only ledger with no delete or update operation"]
        Control2 --> Control3["lifecycle surface_violation_ids pointers reconciled against ledger entries"]
        Control3 --> Control4["unreadable ledger fails closed, absent ledger reads clean"]
        Control4 --> Asset
---

# Spec

Machine-checkable restatement of
`docs/management/stories/active/story-vibepro-review-surface-violation-ledger.md`.
Every contract below is exercised by `test/review-surface-violation-ledger.test.js`
and `test/e2e/story-vibepro-review-surface-violation-ledger-acceptance.spec.ts`.

## Contracts

Clause ids match `.vibepro/spec/story-vibepro-review-surface-violation-ledger/spec.json`.

### INV-001 (RSV-1): every lifecycle close records both close-time snapshots

Any operation that closes a review lifecycle MUST write `closed_head_sha` and
`closed_surface_digest` onto the lifecycle entry, including closes where nothing
moved and including the `review record --agent-closed` path that closes a
lifecycle without an explicit `review close`. Choosing how to close MUST NOT
change whether the snapshots are recorded.

### INV-002 (RSV-4): the entry id is derived, so replays do not duplicate

`violation_id` MUST be derived deterministically from story, stage, role,
lifecycle id, kind, and both the start-side and close-side values. Repeating a
close, including an idempotency-key replay, MUST resolve to the entry already on
disk instead of appending a second one.

### INV-003 (RSV-3): the ledger is append-only across review re-runs

The ledger module MUST expose no delete or update operation. Starting, closing
and recording a new lifecycle for the same story, stage and role MUST leave
existing entries byte-identical and MUST NOT reduce the entry count.

### INV-004 (RSV-6): staleness and violation stay type-separated

A commit made after the close, outside the review window, MUST NOT append a
ledger entry, and `gate:review_surface_integrity` MUST stay passed at zero
entries. Post-close drift remains the concern of the existing freshness
machinery.

### C-001 (RSV-5): the gate is resolved by acknowledgement, never by re-running

`pr prepare` MUST emit `gate:review_surface_integrity`. With one or more
unacknowledged entries the gate status MUST be `failed`, and re-running the
review MUST NOT change that. The only resolution path is an accepted decision
record whose source is `gate:review_surface_integrity:<violation-id>`, and after
acknowledgement the entry MUST remain in the artifact.

### C-002 (RSV-2): a moved surface on a completed close appends a typed entry

When the close-time head sha or surface digest differs from the start-time value
and `close_reason` is `completed`, the close MUST append one entry to
`.vibepro/reviews/<story-id>/surface-violations.json` with
`kind: "review_surface_mutated_during_review"` and
`evidence_class: "violation"`, listing the moved field names in `changed_fields`.
Uncommitted working-tree edits MUST be detected, and the default close form the
CLI actually emits MUST record the entry.

### C-003 (RSV-7): absent reads clean, unreadable fails closed

A lifecycle entry without `closed_head_sha`, and a story with no ledger file at
all, MUST read as zero violations without throwing, and the gate MUST pass. A
ledger that exists but cannot be read — malformed JSON, or `entries[]` that is
not an array — MUST be rejected with
`VIBEPRO_REVIEW_SURFACE_LEDGER_UNREADABLE`, MUST report `readable: false` with
one counted violation, and a `review close` over it MUST throw rather than
silently drop the record. An unreadable ledger and a deleted ledger are
indistinguishable, so both block.

### C-004 (RSV-8): pointers detect a well-formed rewrite

`review close` MUST stamp `surface_violation_id` and accumulate
`surface_violation_ids[]` on the lifecycle entry. Reconciliation MUST report
every pointer with no matching ledger entry as
`review_surface_violation_entry_missing` under its own `missing:<violation-id>`
id, so replacing the ledger with `{"entries": []}` exchanges one counted
violation for another rather than clearing the count. Lifecycles that predate
detection MUST be reported as `unevaluated_lifecycle_count` so a passing gate
never claims "no mutation occurred" about something nobody evaluated.

### C-005 (RSV-9): appends are serialized and close reasons are closed-set

Appending MUST run under a story-level lock so two closes recording different
violations for the same story both survive. An unrecognized `--close-reason`
MUST be rejected rather than coerced to `completed`. Generated close command
templates MUST emit the reason that matches their purpose. An unreadable ledger
MUST be acknowledgeable through an accepted decision on
`gate:review_surface_integrity:ledger_unreadable`, so the block has an exit.

### C-006: inherited behavior left unchanged

Review dispatch gating and recorder lineage resolution are inherited unchanged.
This Story adds close-time snapshot recording and the ledger; it does not alter
how a role decides to stop before dispatch (`isStop(authorization)`), how a
non-dispatch decision is refused
(`authorization.action && authorization.action !== 'dispatch'`), when a recorder
lineage envelope is omitted (`!supplied && !runAuthority`), or how a lifecycle
without a dispatch authorization id is treated
(`!startedEntry?.dispatch_authorization_id`). These branches are declared as
`inherited_behavior` on the clause rather than restated as new requirements.

## Scenarios

- `S-001`: Given a review workflow in the started state, when the review surface
  changes between start and close and the close reason is completed, then the
  flow transitions to violation recorded and one append-only entry is added to
  the ledger.
- `S-002`: Given a review workflow whose close was clean, when an unrelated
  commit lands after the close, then no ledger entry is appended and the review
  workflow state machine keeps its existing transitions and statuses.

## Verification

- `test/review-surface-violation-ledger.test.js` covers the snapshot recording,
  both close paths, mismatch appending, append-only survival across re-runs,
  derived-id replay, empty-ledger substitution, unreadable-ledger rejection,
  close-reason rejection, and the locked concurrent append.
- `test/independent-review-orchestrator.test.js` covers the runtime-stop close
  reason mapping that keeps abandoned reviews from being labelled completed.
- `test/e2e/story-vibepro-review-surface-violation-ledger-acceptance.spec.ts`
  covers RSV-1..RSV-9 end to end against the CLI.

## Operations

- **Release note**: `vibepro review violations [repo] --id <story-id> [--json]`
  is a new read-only subcommand that exits 2 while unacknowledged entries exist;
  `gate:review_surface_integrity` is a new required gate node; `review close`
  now rejects an unrecognized `--close-reason` instead of coercing it to
  `completed`.
- **Rollout**: no flag and no migration. Stories with no ledger file read as
  zero violations, so existing branches see no status change. Lifecycles closed
  before this change carry no `surface_detection` and are counted as
  unevaluated, not as clean.
- **Rollback**: revert the commits on this branch as a set. `src/agent-review.js`,
  `src/independent-review-orchestrator.js`, `src/pr-manager.js` and `src/cli.js`
  all import `src/review-surface-violations.js`, so a partial revert leaves a
  dangling import or a gate reading a ledger no writer maintains. Ledger files
  already written stay on disk as inert JSON that nothing reads after the revert.
- **Observability**: `review close` renders `closed_head_sha` and
  `closed_surface_digest` in its summary; `pr-prepare.json` exposes
  `pr_context.agent_reviews.surface_violations`; the ledger itself is the
  durable record at `.vibepro/reviews/<story-id>/surface-violations.json`.

## Residual risk

- **Endpoint sampling.** Detection compares only the start and close snapshots.
  A change made and reverted inside the review window leaves both ends equal and
  is not detected.
- **Coordinated tampering.** Editing the ledger and every matching lifecycle
  pointer together leaves no inconsistency. This design makes a single-file edit
  visible; it is not cryptographic tamper-evidence.
- **Directory-level erasure.** The ledger lives under `.vibepro/reviews/<story-id>/`,
  which is untracked and not promoted by canonical audit. Deleting that
  directory removes the ledger and the lifecycle pointers together.
- **`.vibepro/` is excluded from the surface digest.** Artifacts a review writes
  are correctly not counted as review-surface changes, which also means editing
  the ledger is not itself detected as a surface change; RSV-8's pointer
  reconciliation is the separate control for that path.
