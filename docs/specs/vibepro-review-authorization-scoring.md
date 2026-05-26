---
story_id: story-vibepro-review-authorization-scoring
title: VibePro Review Authorization Scoring Spec
---

# Spec

## Required Behavior

- VibePro derives an `authorization_level` for an Agent Review run from explicit, evidence-bound signals: story acceptance criteria, decision records (`decision record`), prior subagent review outcomes, and explicit user re-approvals captured via `decision record --type accepted`.
- `authorization_level` is one of `high`, `medium`, `low`, `unknown`.
  - `high`: user explicitly re-approved the action after a concrete risk was surfaced (decision record of type `accepted` referencing the gate/finding) OR the story's acceptance criteria name the same risk surface with explicit go-ahead language.
  - `medium`: story explicitly scopes the change to the affected risk surfaces and lists matching acceptance criteria, but no post-risk approval is recorded.
  - `low`: change touches a risk surface that is not named in the story background, acceptance criteria, or any decision record.
  - `unknown`: no story or decision evidence is available for the change (e.g., ad-hoc PR with no `--story-id`).
- VibePro combines `authorization_level` with the existing `risk_profile` from `change-risk-classifier` and emits a `review_outcome_recommendation` in `{ allow, require_human_review, block }` using a fixed decision matrix.
- The recommendation is advisory: PR readiness still honors role-mode policy from `agent_reviews.roles.<role>.mode`. The recommendation is surfaced as a new artifact and a new field on PR preparation, never as a silent gate downgrade.

## Decision Matrix

| risk_profile \\ authorization_level | high | medium | low | unknown |
|---|---|---|---|---|
| `light` | allow | allow | allow | allow |
| `ui_interaction` | allow | allow | require_human_review | require_human_review |
| `api_contract` | allow | require_human_review | require_human_review | block |
| `workflow_heavy` | allow | require_human_review | block | block |

## Invariants

- `INV-RAS-1`: A vague story statement that does not name the affected risk surface MUST NOT produce `high` or `medium`.
- `INV-RAS-2`: A `high` score requires a decision record whose `source` references a concrete gate or finding ID surfaced earlier in the run.
- `INV-RAS-3`: `review_outcome_recommendation` MUST NOT be `allow` for `workflow_heavy` risk profiles when authorization is `low` or `unknown`.
- `INV-RAS-4`: Scoring is a pure function of the supplied evidence inputs; it MUST NOT read repository state directly.
- `INV-RAS-5`: When inputs are empty/absent, authorization_level resolves to `unknown` (never to `high`).

## Non Goals

- VibePro does not auto-grant required roles. The recommendation cannot bypass `gate:agent_review` role mode policy.
- VibePro does not score author identity, branch name, or commit message patterns as authorization signals.
- VibePro does not attempt NLP intent extraction beyond keyword/risk-surface co-occurrence checks against the same risk surface labels emitted by `change-risk-classifier`.
