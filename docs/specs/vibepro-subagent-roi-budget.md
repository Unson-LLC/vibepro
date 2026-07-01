---
story_id: story-vibepro-subagent-roi-budget
title: Subagent ROI Budget Spec
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
parent_design: vibepro-subagent-roi-budget
---

# Subagent ROI Budget Spec

## Invariants

- `INV-SRB-1`: Required blocking gaps MUST recommend targeted subagent review.
- `INV-SRB-2`: Complete traceability plus present artifact value ledger MAY recommend `no_subagent_needed`.
- `INV-SRB-3`: Missing session attribution SHOULD recommend cost attribution before another subagent when no stronger signal exists.

## Verification

- `V-SRB-1`: Senior-gap tests verify the no-subagent-needed path when ledger and traceability are sufficient.
