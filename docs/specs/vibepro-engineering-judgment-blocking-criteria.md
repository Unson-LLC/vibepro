---
story_id: story-vibepro-engineering-judgment-blocking-criteria
title: Engineering Judgment Blocking Criteria Spec
---

# Spec

## Required Behavior

- `EJBC-001`: active axis status resolution MUST evaluate blocker conditions before accepted-followup resolution.
- `EJBC-002`: When any blocker condition for an active axis is matched by current diff/evidence state, the axis MUST emit `status=active_blocked`.
- `EJBC-003`: `active_blocked` MUST map to Gate DAG `status=block`.
- `EJBC-004`: A blocked judgment axis MUST make PR readiness unresolved for PR creation unless an explicit blocker waiver is recorded for that gate source.
- `EJBC-005`: `accepted_followup` MUST NOT override a matched blocker condition.
- `EJBC-006`: A blocked axis artifact MUST include matched blocker identifiers, supporting evidence refs, and unresolved counter-evidence refs.
- `EJBC-007`: Human-facing artifacts MUST distinguish `block` from `needs_evidence`.

## Scenarios

- `EJBC-S1`: Given `security_boundary` is active and no negative-path or boundary-condition evidence exists for an auth boundary change, when blocker evaluation runs, then the axis becomes `active_blocked`.
- `EJBC-S2`: Given `public_contract` is active and only generic regression tests exist without reviewable old/new expectation, when blocker evaluation runs, then the axis becomes `active_blocked`.
- `EJBC-S3`: Given `release_ops` is active and current operator action is required but no rollback/operator evidence exists, when blocker evaluation runs, then the axis becomes `active_blocked`.
- `EJBC-S4`: Given blocker conditions are not matched but required evidence remains missing, when status resolution runs, then the axis remains `active_needs_evidence` or `active_accepted_followup`, never `active_blocked`.

## Non Goals

- Deriving blocker truth from unstructured prose alone.
- Making all active axes blocking by default.
