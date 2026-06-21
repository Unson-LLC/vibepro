---
story_id: story-vibepro-engineering-judgment-evidence-strength
title: Engineering Judgment Evidence Strength Spec
---

# Spec

## Required Behavior

- `EJES-001`: Every matched Engineering Judgment evidence item MUST include `strength` and `strength_reason`.
- `EJES-002`: Allowed strength values are `declared`, `supporting`, and `strong`.
- `EJES-003`: High-risk judgment subchecks and axes MUST evaluate minimum required strength, not just presence.
- `EJES-004`: `test files in diff` and broad full-suite pass evidence MUST NOT by themselves satisfy high-risk `current_reality`, `failure_modes`, or `done_evidence`.
- `EJES-005`: Verification claims without machine-readable artifact or durable raw artifact MUST NOT classify as `strong`.
- `EJES-006`: Human-facing artifacts MUST expose why counted evidence was `strong` versus only `supporting`.

## Scenarios

- `EJES-S1`: Given a workflow-heavy PR has only full-suite `npm test` plus a handwritten summary, when evidence is classified, then `current_verification` is at most `supporting`.
- `EJES-S2`: Given a focused replay test and durable artifact path are present for the current HEAD, when evidence is classified, then the replay evidence is `strong`.
- `EJES-S3`: Given only `test files in diff` exist for a public contract change, when subcheck evaluation runs, then the public-contract subcheck remains unresolved.

## Non Goals

- One global numeric evidence score.
- Treating optional Graphify context as strong proof of correctness.
