---
story_id: story-vibepro-roi-measurement-loop-closure
title: VibePro ROI Measurement Loop Closure Spec
parent_design: vibepro-roi-measurement-loop-closure
diagrams:
  - kind: flow
    mermaid: |
      flowchart LR
        Merge["execute merge"] --> Local["read local .vibepro/gate-outcomes/ledger.json"]
        Local --> Filter["filter entries for merged story_id"]
        Filter --> Central["merge into docs/management/roi-ledger/ledger.json by entry_key"]
        Central --> Commit["same temp-worktree commit as audit persistence"]
        Commit --> Report["roi_ledger_promotion summary"]
        CentralLedger["central ledger"] --> Usage["usage report --gate-roi"]
        Usage --> Ritual["monthly gate-tuning ritual"]
  - kind: threat_model
    mermaid: |
      flowchart LR
        Actor["execute merge (post-merge automation, no interactive review)"] --> Surface["temp-worktree write path to docs/management/roi-ledger/ledger.json"]
        Surface --> Asset["central ROI ledger (tracked, base-branch, read by monthly gate-tuning ritual)"]
        Threat1["Corrupt/malformed central ledger silently overwritten"] --> Surface
        Threat2["Duplicate/forged entry_key inflates gate ROI counts"] --> Surface
        Threat3["Promotion commit diverges from canonical audit commit (extra unreviewed push)"] --> Surface
        Surface --> Control1["RML-CONTRACT-004: corrupt central ledger -> status failed, never overwritten"]
        Surface --> Control2["RML-CONTRACT-002: entry_key dedupe, existing entry always wins"]
        Surface --> Control3["RML-CONTRACT-001: promotion writes inside the same temp-worktree commit as canonical audit persistence, no extra commit/push"]
---

# Spec

## Public Contract

ROI ledger promotion is an additive behavior of `execute merge` and an
additive read surface of `usage report`. Local ledger recording semantics,
the `vibepro-gate-outcome-ledger-v3` entry schema, and canonical audit
persistence are unchanged.

```text
execute merge  -> summary gains roi_ledger_promotion { status, promoted_count, duplicate_count, central_ledger_path }
usage report --gate-roi [--json]  -> per-gate counts, classification distribution, unclassified_count
```

Central ledger: `docs/management/roi-ledger/ledger.json`, wrapping the
unchanged entry schema with `{ schema_version, model, updated_at, entries }`,
entries sorted by `entry_key`.

## Contracts

### RML-CONTRACT-001: Promotion rides the existing persistence commit

Ledger promotion MUST write the central ledger inside the same temp-worktree
commit that persists canonical audit artifacts. It MUST NOT create an
additional commit or push.

### RML-CONTRACT-002: Entry-key dedupe

The central ledger MUST contain at most one entry per `entry_key`. When a
promoted entry's `entry_key` already exists, the existing entry MUST be kept
and the promotion counted as `duplicate_count`.

### RML-CONTRACT-003: Deterministic serialization

Central ledger serialization MUST sort entries by `entry_key` and produce
byte-identical output for identical logical content.

### RML-CONTRACT-004: Absent local ledger never fails the merge

When the local ledger is missing or has no entries for the merged story,
`roi_ledger_promotion.status` MUST be `no_entries` and the merge MUST
continue. A corrupt central ledger MUST yield `status: failed` with a merge
warning; the promotion MUST NOT silently overwrite an unparseable central
ledger.

### RML-CONTRACT-005: Gate-roi report exposes gaps honestly

`usage report --gate-roi` MUST report `unclassified_count` explicitly and
MUST NOT convert missing classification data into zeroes or omit it.

## Scenarios

- `RML-S-1`: Given a story whose local ledger holds N entries, when
  `execute merge` completes, then all N entries exist in the central ledger
  and `promoted_count` is N.
- `RML-S-2`: Given the central ledger already contains an `entry_key` being
  promoted, when promotion runs, then the entry count does not increase and
  `duplicate_count` reflects it.
- `RML-S-3`: Given no local ledger file, when `execute merge` completes, then
  the merge succeeds and `roi_ledger_promotion.status` is `no_entries`.
- `RML-S-4`: Given a populated central ledger, when
  `usage report --gate-roi --json` runs, then it reports per-gate counts,
  classification distribution, and `unclassified_count`.
- `RML-S-5`: Given identical logical content, when the central ledger is
  regenerated, then the file bytes are identical.
- `RML-S-6`: Given a corrupt central ledger, when promotion runs, then the
  status is `failed`, a merge warning is recorded, and the corrupt file is
  not overwritten.

## Verification

- Focused tests cover promotion, dedupe, `no_entries`, corrupt-central
  handling, deterministic serialization, and the `--gate-roi` report shape.
- `npm run typecheck` and the full `npm test` suite pass with no new
  failures.
