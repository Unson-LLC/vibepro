---
story_id: story-vibepro-review-inspection-first
title: VibePro review record should capture read-only inspection evidence before judgment
architecture_docs:
  - docs/architecture/vibepro-review-inspection-first.md
spec_docs:
  - docs/specs/vibepro-review-inspection-first.md
---

# Story: VibePro review record should capture read-only inspection evidence before judgment

## Background

OpenAI Codex's guardian policy template insists on "read-only checks first" — before recommending a destructive or release-impacting outcome, the reviewer should attempt evidence-based inspection rather than relying on assumptions.

VibePro's review subagents are already told not to edit files, but the trail of *what they actually inspected* is invisible in the recorded result. A `pass` from a subagent that ran tests and read the relevant files is recorded identically to a `pass` from one that skimmed only the diff summary.

## Acceptance Criteria

- `vibepro review record` accepts `--inspection-summary <text>` and `--inspection-evidence <ref>` flags.
- Recorded `review-result-<role>.json` includes an `inspection` object with `summary` and `evidence` fields (null when omitted).
- `renderReviewRequestMarkdown` includes an `## Investigation Guidelines` section between `## Evidence Handling` and `## Instructions`.
- The Investigation Guidelines block tells the subagent to perform read-only inspection (read files, run tests, query state) before recommending block/needs_changes, and to report it via the new flags.
- A new exported constant `INVESTIGATION_GUIDELINES_BLOCK` centralizes the text.
- `getAgentReviewStatus` surfaces the most-recent `inspection` block per role.
- Tests cover: flag plumbing, schema persistence, placement in the request markdown, status surface.

## Out of Scope

- Enforcing inspection (rejecting records where summary is empty for high-risk roles) — follow-up story.
- Auto-deriving inspection summaries from agent transcripts.
