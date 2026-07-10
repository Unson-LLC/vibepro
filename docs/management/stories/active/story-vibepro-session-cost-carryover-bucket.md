---
story_id: story-vibepro-session-cost-carryover-bucket
title: Session cost accounting should not count compaction replay as audit evidence
architecture_docs:
  - docs/architecture/vibepro-session-cost-carryover-bucket.md
spec_docs:
  - docs/specs/vibepro-session-cost-carryover-bucket.md
parent_design: vibepro-session-cost-carryover-bucket
---

# Story: Session cost accounting should not count compaction replay as audit evidence

## Background

Codex session JSONL files emit a top-level `type: "compacted"` entry whenever the
runtime compacts context. Its `payload.replacement_history` re-quotes prior
goal/permissions/system text (and sometimes prior user messages) verbatim so the
model can resume after compaction. `session-efficiency-audit.js`'s
`extractSessionTranscriptText()` / `collectSessionTextFields()` already walks into
`replacement_history` and extracts that re-quoted text like any other transcript
text, and `classifySessionExposureText()` then classifies it into whichever bucket
its content pattern-matches (frequently `audit_evidence`, `story_spec_architecture_docs`,
or `test`, since permissions/goal text commonly mentions `.vibepro/`, `docs/`, or
`test/`). This inflates the `audit_evidence`/`test` buckets with carryover replay
text that is not fresh evidence-gathering or reasoning, distorting the
"used-for-decision evidence" token metrics reported in `audit_evidence_tokens`.

## Acceptance Criteria

- Transcript text originating from a `compacted`/`compaction`/`context_compacted`
  entry's replacement history is classified into a new `replayed_context` bucket,
  never into `audit_evidence`, `story_spec_architecture_docs`, `src_code`, or `test`.
- The `replayed_context` bucket is reported alongside existing buckets in
  `artifact_token_accounting.buckets` with the same shape (estimated_tokens,
  event_count, ratio_of_classified_exposure, ratio_of_session_tokens,
  matched_signals).
- Non-compaction transcript text keeps its existing classification behavior
  unchanged.
- Add regression coverage: a session transcript containing a `compacted` entry
  whose replacement history repeats goal/permissions text that would otherwise
  pattern-match `audit_evidence`/`test` is bucketed as `replayed_context` instead.

## Delivery Note

The implementation (`SESSION_EXPOSURE_BUCKETS` `replayed_context` entry,
`COMPACTION_REPLAY_ENTRY_TYPES`, and the `summarizeSessionExposureEntry()`
early-classification branch in `src/session-efficiency-audit.js`) and its
regression test (`SCCB-SCENARIO-001` in `test/session-efficiency-audit.test.js`)
were already merged to `main` via PR #309, alongside the unrelated
`story-vibepro-session-time-cwd-normalization` fix, because both changes were
authored in the same working tree before the two stories were split into
separate branches. This PR completes the story record retroactively (Story,
Spec, Architecture docs, and a formal VibePro Gate/PR trail) for that already-shipped
code so the Story→Architecture→Spec→TDD→Code→Gate→PR workflow has a record for
this change, without re-shipping the same code twice.
