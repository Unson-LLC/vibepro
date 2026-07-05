---
story_id: story-vibepro-journey-curate-command
title: Journey Curate Command Spec
parent_design: vibepro-ui-journey-e2e-producer-contracts
---

# Spec

## Invariants

### JCC-INV-1: Closure before write

`journey curate` MUST NOT write a curated Journey while any conflict or open
question from the machine-derived context pack is neither resolved nor
explicitly deferred. Partial input yields a report of unhandled items and no
file write.

### JCC-INV-2: Schema compatibility

The curated Journey written by `curate` MUST conform to the existing
`.vibepro/journeys/<journey-id>.json` schema, and `journey status` MUST report
it as curated through the existing read path. Hand-authored curated files
remain valid.

### JCC-INV-3: Deferrals are preserved, not dropped

An explicitly deferred open question MUST pass the closure check and MUST be
carried into the curated artifact together with its deferral reason.

## Contracts

### JCC-CONTRACT-1: Judgment-only input

The `--input` file (JSON or YAML) carries only human judgment: conflict
rulings, open-question answers or deferrals, and the next-slice choice.
Structural content (walking skeleton, segments) is carried forward from the
machine context pack by the command.

### JCC-CONTRACT-2: Rejection output is actionable

When the closure check fails, the command output MUST list each unhandled
conflict and open question with an identifier the operator can reference in
the next `--input` revision.

### JCC-CONTRACT-3: Missing context pack guidance

When no machine-derived context pack exists, `curate` MUST exit without
writing and name `vibepro journey derive .` as the next command.

### JCC-CONTRACT-4: Diagnose guidance

`story diagnose` journey_context output MUST include
`vibepro journey curate .` among next actions when the Journey state is
`machine_derived`.

### JCC-CONTRACT-5: Flow verifier compatibility boundary

This story shares the UI/Journey producer branch with `verify flow`; therefore
the existing `BASIC_AUTH_USER && BASIC_AUTH_PASSWORD` runtime branch remains a
compatibility boundary. Journey curation MUST NOT serialize Basic Auth
credentials into curated Journey artifacts, handoff context, or PR evidence.

## Scenarios

### JCC-S-1: Full resolution produces a curated Journey

Given a derived context pack and an input resolving every conflict and open
question, `journey curate` writes `.vibepro/journeys/<journey-id>.json` and
`journey status` returns curated.

### JCC-S-2: Partial resolution is rejected

Given an input leaving at least one conflict or open question unhandled,
`journey curate` writes nothing and lists the unhandled items.

### JCC-S-3: Explicit deferral passes

Given an input marking an open question as deferred with a reason, the closure
check passes and the deferral is present in the curated artifact.

### JCC-S-4: No context pack

Given a repository where `journey derive` has not run, `journey curate` exits
with guidance naming `vibepro journey derive .`.

### JCC-S-5: Diagnose next action

Given a Story whose Journey state is `machine_derived`, `story diagnose` shows
`vibepro journey curate .` as a next action.

## Anti-patterns

### JCC-AP-1: Silent auto-resolution

Do not have `curate` invent resolutions for conflicts or open questions; the
command validates and assembles judgment, it does not make judgment.

### JCC-AP-2: Parallel curation model

Do not introduce a second curated-journey format or a separate authority; all
reads and writes go through the existing journey-map primitives.

## Verification

- Node regression tests cover JCC-S-1 through JCC-S-5 (story acceptance
  criterion JCC-S-6).
- `npm run typecheck` validates edited modules.
- `vibepro pr prepare` emits a Gate DAG for this story with
  `dag_connectivity=passed`.
