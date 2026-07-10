---
story_id: story-vibepro-agent-review-independence-provenance
title: Agent Review provenance must expose reviewer/implementer session identity
architecture_docs:
  - docs/architecture/vibepro-agent-review-independence-provenance.md
spec_docs:
  - docs/specs/vibepro-agent-review-independence-provenance.md
parent_design: vibepro-agent-review-independence-provenance
---

# Story: Agent Review provenance must expose reviewer/implementer session identity

## Background

The Agent Review Gate requires `parallel_subagent` provenance with strong
correlation evidence (agent id, session/thread id or transcript), but nothing
in the recorded provenance distinguishes a genuinely independent reviewer from
the implementing session reviewing its own work. In practice (stories merged
as PR #309/#311/#314), the implementing agent performed the role reviews
itself and recorded them with transcript-backed provenance — auditable in
content, but indistinguishable in `review-result-*.json` from an independent
subagent review. An auditor reading the gate evidence cannot tell whether the
review independence assumption held.

## Acceptance Criteria

- `vibepro review record` accepts `--reviewer-identity
  <same_session|separate_session|unknown>` and
  `--implementation-session-id <id>`, and every recorded review's
  `agent_provenance` gains a `reviewer_identity` object:
  `relation` (`same_session` | `separate_session` | `unknown`),
  `reviewer_session_id`, `implementation_session_id`, and `source`
  (`cli_flag` | `derived_session_ids` | `undeclared`).
- When `--reviewer-identity` is not given but both an implementation session
  id and a reviewer session id are recorded, the relation is derived by
  equality; with insufficient data it is `unknown`.
- Review records written before this change (no `reviewer_identity` field)
  are treated as `unknown` — no behavior change, no new blocking.
- `vibepro pr prepare`'s `gate:agent_review` node exposes a
  `reviewer_independence` block listing reviews whose relation is
  `same_session`, with `enforcement: "warning_only"`; the gate's pass/fail
  status is never changed by reviewer identity, and a same-session review adds
  an explicit warning to the gate node and a note in `gate_status`
  (`agent_review_independence`).
- An invalid `--reviewer-identity` value fails fast with the allowed values.
