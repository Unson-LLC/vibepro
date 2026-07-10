---
story_id: story-vibepro-decision-record-evidence-summary
title: Accepted decision records should carry a 1-hop verification-evidence summary
architecture_docs:
  - docs/architecture/vibepro-decision-record-evidence-summary.md
spec_docs:
  - docs/specs/vibepro-decision-record-evidence-summary.md
parent_design: vibepro-decision-record-evidence-summary
---

# Story: Accepted decision records should carry a 1-hop verification-evidence summary

## Background

`vibepro decision record` writes `decision-records.json` (`src/decision-records.js`).
Each decision already stores a single optional `artifact` reference, but nothing
records which verification artifacts (from `verify record`'s
`.vibepro/pr/<story>/verification-evidence.json`, written by
`src/verification-evidence.js`) actually backed an `accepted` decision. A downstream
consumer (another repo's handoff/PR-prep flow, or `pr-manager.js`'s own
`decision_records` context) currently has to separately open
`verification-evidence.json` and cross-reference timestamps/story ids to
reconstruct "what evidence was used" — there is no single-hop answer stored
alongside the decision itself.

## Acceptance Criteria

- When `recordDecision()` produces a decision whose `status` is `accepted`, the
  decision gains a `verification_evidence_summary` field listing every recorded
  verification command's `path` (artifact path, or the evidence file itself when
  no per-command artifact was recorded), `type` (verify `kind`), and `result`
  (verify `status`), read from the same story's `verification-evidence.json`.
- A decision whose `status` is not `accepted` (`open`, `rejected`, `superseded`)
  has `verification_evidence_summary: null` — unchanged from today's behavior of
  omitting evidence-basis metadata.
- The summary is retrievable directly from `decision-records.json` in one hop
  (no need to open/parse `verification-evidence.json` separately downstream).
- If no `verification-evidence.json` exists yet for the story, an accepted
  decision gets `verification_evidence_summary: { entries: [], count: 0 }`
  rather than an error.
