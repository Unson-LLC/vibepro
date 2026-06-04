---
title: Review Inspection Required Gate Spec
---

# Review Inspection Required Gate Spec

## Invariants

- `INV-RIR-1`: `gate:review_inspection_required` MUST be present in the PR Gate DAG.
- `INV-RIR-2`: High-risk recorded review roles MUST include inspection summary and inspection evidence.
- `INV-RIR-3`: Missing high-risk inspection fields MUST set the gate to `needs_inspection`.
- `INV-RIR-4`: `needs_inspection` MUST be an unresolved critical PR gate.
- `INV-RIR-5`: Light changes MUST NOT be blocked solely by missing inspection evidence.

## Verification

- `V-RIR-1`: `test/vibepro-cli.test.js` records a high-risk pass without inspection evidence and asserts the PR Gate blocks it.
