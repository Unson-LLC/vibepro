---
story_id: story-vibepro-agent-review-independence-provenance
title: VibePro Agent Review Independence Provenance Architecture
parent_design: vibepro-agent-review-independence-provenance
---

# Architecture

## Decision

Record reviewer identity inside the existing `agent_provenance` object of each
review result (`src/agent-review.js`, `buildAgentProvenance()`), not as a new
sibling artifact or a new lifecycle field. `agent_provenance` is already the
audited unit that `validateAgentProvenance()` grades and that
`buildStageSummary()` copies verbatim into stage summaries consumed by
`pr-manager.js` — adding `reviewer_identity` there makes the identity visible
at every existing surface (review-result JSON, stage summary, pr-prepare gate
node) with a single write site.

Enforcement is deliberately warning-only. `validateAgentProvenance()` is NOT
changed: a same-session review still yields `verified_agent` when its
lifecycle/correlation evidence is complete, because retroactively failing
existing workflows would break every single-agent operator overnight. Instead
`buildAgentReviewGate()` (`src/pr-manager.js`) aggregates
`reviewer_identity.relation === 'same_session'` across stage-summary roles
into a `reviewer_independence` block plus a gate-node warning, and
`buildPrPrepareGateStatus()` surfaces the same note as
`gate_status.agent_review_independence` so PR-readiness readers see it without
opening the gate DAG.

## Boundaries

- `agent-review.js` owns computing/persisting `reviewer_identity` (flag
  parsing, session-id derivation). `pr-manager.js` only reads it from the
  stage summaries it already receives; no new module coupling.
- `cli.js` stays a flag-passthrough (`--reviewer-identity`,
  `--implementation-session-id`).
- Absent field (all pre-existing review records) normalizes to
  `relation: 'unknown'`, which produces no warning — full backward
  compatibility with recorded artifacts and their schemas.

## Why no ADR is required

This adds one embedded provenance field and one derived warning using the
exact conventions already in place for `agent_provenance` grading and gate
node construction. No new storage, command, integration, or enforcement
semantics (warning-only) are introduced.
