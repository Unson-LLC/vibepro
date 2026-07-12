---
title: Evidence decision ledger spec
status: active
parent_design:
  - vibepro-artifact-value-ledger
---

# Evidence decision ledger spec

## EDL-001

Given canonical evidence entries, when the ledger is built, then every entry exposes `decision_id`, `consumer_gate`, and `decision_changed`.

`pr prepare --evidence-decision-usage '<json>'` accepts an artifact-keyed map. A supplied `false` is persisted as confirmed unused; omitted keys remain `null` and are counted as unconfirmed. Bounded senior-gap summaries preserve all three decision-use counts.

## EDL-002

Given no observed decision delta, when the ledger is summarized, then `null` is counted as unconfirmed while an explicit `false` is counted as confirmed unused, and both metrics propagate to bounded summary, usage report, and senior-gap synthesis surfaces.

## EDL-003

Given legacy consumers, when fields are added, then existing `consumer`, `decision_supported`, and `decision_bound_count` remain unchanged.

## EDL-004

Given optional session evidence, when the ledger is built, then the `sessions.length > 0` branch preserves the existing replay summary without changing canonical artifact decision-use totals, and an empty session set remains valid.

```yaml
inherited_behavior:
  condition: "sessions.length > 0"
  classification: unchanged
  files:
    - src/evidence-reuse.js
```

## Diagrams

### threat_model

```mermaid
flowchart LR
  A[Canonical artifact inventory] --> B[Ledger builder]
  B --> C[Bounded evidence ledger]
  C --> D[PR and merge gates]
  X[Unobserved decision delta] -->|must remain null| C
```
