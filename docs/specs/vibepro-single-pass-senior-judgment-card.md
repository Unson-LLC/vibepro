---
story_id: story-vibepro-single-pass-senior-judgment-card
title: Single-Pass Senior Judgment Card Spec
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
parent_design: vibepro-single-pass-senior-judgment-card
---

# Single-Pass Senior Judgment Card Spec

## Invariants

- `INV-SJC-1`: The decision card MUST summarize merge-readiness relevant status without requiring another review artifact.
- `INV-SJC-2`: The card MUST keep artifact value and session attribution separate.
- `INV-SJC-3`: The card MUST preserve residual risk counts instead of hiding them behind a pass status.

## Verification

- `V-SJC-1`: `test/senior-gap-judgment.test.js` verifies card fields and summary output.
