---
story_id: story-vibepro-review-inspection-first
title: VibePro Review Inspection First Architecture
---

# Architecture

## Decision

Treat the read-only inspection report as additional fields on the existing `review-result-<role>.json` artifact, sourced from two new CLI flags. Introduce a dedicated `INVESTIGATION_GUIDELINES_BLOCK` constant in `src/agent-review.js`, mirroring the pattern established by `EVIDENCE_HANDLING_BLOCK`, and interpolate it into the generated review request markdown so subagents see the expectation before they form a verdict.

## Boundaries

- `src/cli.js` owns flag parsing and forwards `inspectionSummary` / `inspectionEvidence` to `recordAgentReview`.
- `src/agent-review.js` owns: the constant text, schema of the `inspection` block in the result JSON, and template insertion.
- `getAgentReviewStatus` owns surfacing the recorded `inspection` block in the latest result per role.

## Schema additions

```json
// review-result-<role>.json
{
  "schema_version": "0.1.0",
  // ... existing fields ...
  "inspection": {
    "summary": "ran tests in test/foo.test.js, read src/foo.js:30-90; no destructive paths",
    "evidence": "path/to/inspection.log"
  }
}
```

## Failure Modes

- Neither flag supplied → `inspection = { summary: null, evidence: null }`; no error.
- Only `--inspection-evidence` supplied with no `--inspection-summary` → `summary: null, evidence: "<ref>"`; valid but the reviewer is encouraged to also describe what was inspected.
- Future enforcement (require inspection for high-risk roles) is left to a follow-up story; the field is captured now so policy can be layered later without schema migration.

## Reasoning

The Codex `guardian/policy_template.md` Investigation Guidelines insist on read-only checks before destructive operations. VibePro's review subagents are already told "do not edit files", but their reasoning trail is invisible — a `pass` from a subagent that never ran a test or read the actual code is indistinguishable from a `pass` based on real inspection. Capturing inspection as a first-class field gives reviewers, coordinators, and humans an audit hook.
