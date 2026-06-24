---
summary: "Architecture for requiring Journey context when UI experience files change."
read_when:
  - Changing PR Gate DAG UI readiness
  - Changing Journey Map PR integration
  - Debugging Journey Context Gate behavior
---

# UI Journey Context Gate

UI changes are not only visual changes. They can alter the user's path through
the product, CTA priority, empty/error/loading states, and the meaning of the
next step. For that reason, VibePro treats Journey context as a required input
when `pr prepare` detects UI experience source changes.

## Boundary

`gate:journey_context` is a PR readiness gate, not a replacement for Flow
Verification, Visual QA, or E2E tests.

- Journey Context answers which Journey step the changed Story belongs to, and
  whether that step has conflicts or blocking open questions.
- Flow Verification proves the runtime path still works.
- Visual QA proves the visible surface was reviewed.
- E2E proves executable user behavior.

## Activation

The gate appears only when `hasUiExperienceSourceChange(fileGroups)` is true.
Non-UI code, docs-only changes, and backend-only changes do not get Journey
friction.

## Status Rules

- `needs_evidence`: UI changed but no latest Journey Map exists.
- `needs_review`: the current Story is not placed on a Journey step, or an
  affected Journey conflict exists.
- `needs_evidence`: the current Story is in the walking skeleton and the
  walking skeleton still has blocking coverage gaps.
- `passed`: the current Story is placed, and no affected conflict or blocking
  Journey question remains.
- `accepted_followup`: an explicit decision record for `gate:journey_context`
  accepts the remaining Journey context gap.

## DAG Placement

The gate sits after `gate:path_surface_matrix` and before `gate:requirement`.
That makes Journey context part of requirement readiness for UI changes, while
leaving the later runtime proof gates to verify actual behavior.
