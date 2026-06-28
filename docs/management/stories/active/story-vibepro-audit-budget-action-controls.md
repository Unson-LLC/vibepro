---
story_id: story-vibepro-audit-budget-action-controls
vibepro_story_id: story-vibepro-runtime-cost-gap-closure
title: Audit Budget Action Controls
parent_design: vibepro-runtime-cost-gap-closure
status: active
---

# Story

When canonical audit artifacts become heavier than the product change, the
daily value audit needs a machine-readable action, not just a warning. VibePro
should expose budget-control recommendations in `automation_value_audit`.

## Acceptance Criteria

- [x] `ABC-AC-001`: `automation_value_audit` includes `cost_controls`.
- [x] `ABC-AC-002`: Budget exceeded artifacts recommend summary canonical
  persistence for routine value audits.
- [x] `ABC-AC-003`: Missing session cost recommends merge-time runtime cost
  collection with session id or inference.
- [x] `ABC-AC-004`: Decision summary renders the cost-control status.

## Verification

- `test/canonical-audit-self-contained.test.js`
