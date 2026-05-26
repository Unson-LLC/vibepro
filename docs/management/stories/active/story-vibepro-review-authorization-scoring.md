---
story_id: story-vibepro-review-authorization-scoring
title: VibePro should score user authorization alongside risk for Agent Review
architecture_docs:
  - docs/architecture/vibepro-review-authorization-scoring.md
spec_docs:
  - docs/specs/vibepro-review-authorization-scoring.md
---

# Story: VibePro should score user authorization alongside risk for Agent Review

## Background

VibePro already classifies *change risk* through `src/change-risk-classifier.js`, but it has no explicit measurement of *how clearly the user has authorized the change*. The OpenAI Codex guardian policy template separates these two axes — `risk_level` and `user_authorization` — and combines them in an outcome matrix. That separation makes it possible to allow a high-risk change when the user has explicitly re-approved after seeing the risk, while still blocking the same change when authorization is vague.

VibePro today treats role-mode policy as the only authorization signal. Stories with explicit `decision record` evidence and stories that vaguely touch the same surfaces end up treated identically by `pr-prepare.json`. Reviewers cannot tell which PRs deserve fast-track vs. extra human attention from the readiness artifacts alone.

## Acceptance Criteria

- A new module `src/authorization-scoring.js` exports a pure function that returns `authorization_level`, `signals`, and `review_outcome_recommendation` from `riskProfile`, `storySource`, and `decisions` inputs.
- Authorization level honors the spec definitions for `high`, `medium`, `low`, `unknown`, including the invariant that vague stories cannot reach `high`/`medium`.
- The decision matrix in the spec is implemented exactly; all 16 cells are covered by unit tests.
- `signals` lists the concrete evidence used (acceptance-criteria surface match, decision record reference, etc.), so reviewers can audit the score.
- Empty inputs resolve to `authorization_level = unknown` and never throw.
- The existing `change-risk-classifier` output and contract are unchanged; the new module is a layered consumer.
- Tests cover: each level detection path, all 16 matrix cells, invalid decision source handling, empty input.

## Out of Scope (separate stories)

- Wiring the recommendation into `pr-manager.js` `pr-prepare.json` artifact composition.
- Surfacing the score in `review-cockpit.html` and `parallel-dispatch.md`.
- Evidence-handling discipline (treating PR body / diff comments as untrusted) — tracked separately.
- Investigation-guidelines "read-only checks first" lifecycle field — tracked separately.
