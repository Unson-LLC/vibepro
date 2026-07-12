---
title: Evidence decision ledger spec
status: active
parent_design:
  - vibepro-artifact-value-ledger
---

# Evidence decision ledger spec

## EDL-001

Given canonical evidence entries, when the ledger is built, then every entry exposes `decision_id`, `consumer_gate`, and `decision_changed`.

## EDL-002

Given no observed decision delta, when the ledger is summarized, then the delta is counted as unconfirmed rather than unchanged or unused.

## EDL-003

Given legacy consumers, when fields are added, then existing `consumer`, `decision_supported`, and `decision_bound_count` remain unchanged.

## Diagrams

### threat_model

```mermaid
flowchart LR
  A[Canonical artifact inventory] --> B[Ledger builder]
  B --> C[Bounded evidence ledger]
  C --> D[PR and merge gates]
  X[Unobserved decision delta] -->|must remain null| C
```
