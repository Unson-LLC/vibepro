---
title: Engineering Judgment Spine Evidence Spec
---

# Engineering Judgment Spine Evidence Spec

## Invariants

- `INV-EJS-1`: `gate:common_judgment_spine` MUST include sub-checks for intent, current reality, invariants, boundaries, failure modes, and done evidence.
- `INV-EJS-2`: Missing Story purpose or Acceptance Criteria MUST mark the `intent` sub-check as `needs_story`.
- `INV-EJS-3`: Workflow-heavy changes MUST NOT pass the common spine when invariant or done evidence is missing.
- `INV-EJS-4`: Light changes MUST NOT be blocked solely because heavy-route sub-check evidence is absent.
- `INV-EJS-5`: A non-passing common spine MUST be an unresolved critical PR gate.

## Acceptance Paths

- `AP-EJS-1`: Agent workflow route fixtures with Architecture evidence keep the common spine passing.
- `AP-EJS-2`: Workflow-heavy route fixtures without invariant/done evidence make the common spine `needs_evidence`.
- `AP-EJS-3`: The PR body evidence digest lists missing sub-check ids when the common spine is not passing.

## Verification

- `V-EJS-1`: `test/vibepro-cli.test.js` asserts the sub-check array on the Engineering Judgment DAG.
- `V-EJS-2`: `test/risk-adaptive-gate.test.js` asserts workflow-heavy missing evidence blocks the common spine.
