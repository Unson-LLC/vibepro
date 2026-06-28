---
story_id: story-vibepro-budget-policy-semantics
title: Canonical Audit Budget Policy Semantics
status: active
parent_design: vibepro-budget-policy-semantics
spec: ../../../specs/vibepro-budget-policy-semantics.md
architecture: ../../../architecture/vibepro-budget-policy-semantics.md
---

# Canonical Audit Budget Policy Semantics

## Problem

The compact canonical audit bundle reduced persisted evidence from fake-heavy
raw copies to a replayable manifest/index bundle, but the cost policy still
uses the old normal threshold of `artifact_code_ratio = 1`.

That makes a repaired story with `artifact_code_ratio = 2.639` look like a
cost risk even though the product policy target is "2-3 evidence lines per
product changed line is acceptable; above 3 is heavy".

## Acceptance Criteria

- Normal canonical audit budget treats `artifact_code_ratio <= 3` as within
  policy.
- `artifact_code_ratio > 3` remains a hard cost-risk signal.
- Fixed `canonical_artifact_lines` does not mark a story as exceeded when the
  relative 3x budget permits the persisted canonical line count.
- Canonical compact promotion recomputes `budget_status` with the same
  effective budget used by standalone cost summaries.

## Verification

- `node --test test/evidence-cost-budget.test.js`
- `node --test test/canonical-audit-self-contained.test.js`
- `npm run typecheck`
