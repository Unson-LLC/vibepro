---
story_id: story-vibepro-review-inspection-first
title: VibePro Review Inspection First Spec
---

# Spec

## Required Behavior

- `vibepro review record` MUST accept two new optional flags:
  - `--inspection-summary <text>`: short description of the read-only inspection the reviewer performed before reaching its verdict (e.g., "ran `node --test test/foo.test.js` and read src/foo.js lines 30-90; no destructive paths").
  - `--inspection-evidence <ref>`: optional pointer to the inspection artifact (file path, log id, or transcript ref).
- Recorded review result JSON (`review-result-<role>.json`) MUST include an `inspection` object with `summary` and `evidence` fields when either flag is supplied; both fields are `null` when omitted.
- `renderReviewRequestMarkdown` MUST emit an `## Investigation Guidelines` section immediately before `## Instructions` (after `## Mandatory Review Lenses`; if Story B's `## Evidence Handling` section is also present, after it) that tells the subagent:
  - Before recommending `block` or `needs_changes` for destructive or release-impacting paths, perform a read-only inspection (read files, run tests, query state) sufficient to make the recommendation evidence-based, not assumption-based.
  - Report the inspection in the result via `--inspection-summary` and (when applicable) `--inspection-evidence`.
- The new fields are surfaced in `getAgentReviewStatus` output under each role's most-recent result, so coordinators and humans can see whether inspection was recorded.

## Invariants

- `INV-RIF-1`: The Investigation Guidelines section appears AFTER Mandatory Review Lenses and immediately BEFORE Instructions in the review request markdown.
- `INV-RIF-2`: Omitting both flags MUST keep `inspection` as `{ summary: null, evidence: null }` and never throw; existing review-record callers stay compatible.
- `INV-RIF-3`: When `--inspection-summary` is supplied, the text is stored verbatim (no trimming beyond the conventional whitespace strip).
- `INV-RIF-4`: The Investigation Guidelines text mentions read-only checks (files, tests, state) as concrete examples.

## Non Goals

- VibePro does not enforce that inspection is non-empty before allowing the record to succeed.
- VibePro does not auto-derive the inspection summary from agent transcripts.
- This story does not change role-mode policy or PR gate decision logic; the inspection field is captured for audit and surfaced in status, nothing more.
