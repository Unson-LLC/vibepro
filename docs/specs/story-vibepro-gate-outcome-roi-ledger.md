---
story_id: story-vibepro-gate-outcome-roi-ledger
title: Gate Outcome ROI Ledger Spec
parent_design: vibepro-gate-outcome-roi-ledger
diagrams:
  - kind: outcome_ledger_flow
    mermaid: |
      flowchart LR
        Previous["previous gate DAG"] --> Diff["resolved gate diff"]
        Current["current gate DAG"] --> Diff
        Evidence["verification and review evidence"] --> Classify["per-gate outcome classifier"]
        Decisions["decision records"] --> Classify
        Git["changed surface"] --> Classify
        Diff --> Classify
        Classify --> Ledger[".vibepro/gate-outcomes/ledger.json"]
        Ledger --> Usage["usage report gate outcome ROI"]
---

# Spec

## Contracts

### GRL-CONTRACT-001: Resolved gate transitions are recorded

`pr prepare` MUST compare the previous and current gate DAG and record an entry
when a required gate moves from an unresolved status to a resolved status.

### GRL-CONTRACT-002: Outcome classification is per gate

The ledger MUST classify each resolved gate independently. Evidence and waiver
records only count for a gate when they reference that gate, its type, or its
label. A source change in the PR MUST NOT automatically classify unrelated
review, evidence, verification, spec, design, or lifecycle gates as `source_fix`.

### GRL-CONTRACT-003: Operator override is explicit and validated

`pr prepare --outcome <outcome>` MAY override automatic classification for the
current prepare run. The value MUST be one of `source_fix`, `evidence_added`,
`rewording_only`, `waiver`, or `unclassified`.

### GRL-CONTRACT-004: Ledger is measurement-only

The ledger MUST NOT alter gate DAG statuses, PR readiness, waiver behavior, or
existing blocking semantics. It is a reporting input only.

### GRL-CONTRACT-005: Usage report preserves existing cost telemetry

Adding gate outcome aggregation to `usage report` MUST NOT overwrite existing
evidence cost telemetry. Unavailable token and elapsed-time states MUST remain
explicitly unavailable instead of being rendered or serialized as zero.

## Scenarios

- `GRL-S-1`: Given a required source-sensitive gate resolves after source
  changes, then the ledger records `source_fix`.
- `GRL-S-2`: Given a required gate resolves after documentation/story text only
  changes, then the ledger records `rewording_only`.
- `GRL-S-3`: Given a required gate resolves through an accepted waiver decision
  that references that gate, then the ledger records `waiver` with the decision
  reference.
- `GRL-S-4`: Given a required review/evidence/lifecycle gate resolves through
  current verification or agent-review evidence that references that gate, then
  the ledger records `evidence_added`.
- `GRL-S-5`: Given mixed gate resolutions in one PR, then each gate receives its
  own outcome rather than inheriting one PR-wide classification.
- `GRL-S-6`: Given a ledger exists, when usage report runs, then gate outcome
  distributions and demotion candidates are rendered without changing evidence
  cost token/time provenance.

## Verification

- Unit coverage builds previous/current gate DAG pairs and asserts outcome
  classification, override validation, per-gate evidence matching, aggregation,
  and measurement-only behavior.
- Usage report coverage loads a gate outcome ledger alongside canonical audit
  cost telemetry and asserts unavailable token/time states remain unavailable.
