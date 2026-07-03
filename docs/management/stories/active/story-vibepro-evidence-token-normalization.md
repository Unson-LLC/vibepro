---
story_id: story-vibepro-evidence-token-normalization
title: "Gate evidence classifier normalizes canonical token variants"
status: active
view: dev
period: 2026-07
source:
  type: github_issue
  id: 267
  title: "Gate evidence classifier should normalize token variants like negative_path and negative path"
related_stories:
  - story-vibepro-engineering-judgment-spine-evidence
  - story-vibepro-verification-observation-artifacts
  - story-vibepro-risk-adaptive-gate-dag
parent_design: vibepro-evidence-token-normalization
architecture_docs:
  - docs/architecture/vibepro-evidence-token-normalization.md
spec_docs:
  - docs/specs/story-vibepro-evidence-token-normalization.md
created_at: 2026-07-03
updated_at: 2026-07-03
---

# Story

VibePro Gate evidence classification should treat canonical evidence concepts as stable
workflow vocabulary, not as spelling-sensitive regex trivia.

When a user records observation data with `negative_path`, `negative-path`, or
`negative path`, the classifier should resolve all three to the same `negative_path`
evidence kind. The same normalization is required for boundary, parser, auth, and
permission failure-mode evidence.

## User Story

**As a** VibePro user recording verification evidence<br>
**I want** canonical evidence tokens to work with underscores, hyphens, or spaces<br>
**So that** Gate readiness reflects the semantic evidence I already recorded instead of
forcing another `verify record` run for spelling-only changes

## Scope

- Normalize common token variants before evidence classification.
- Apply the same canonical token handling to observed key/value pairs, scenario strings,
  target strings, and failure-mode coverage scoring.
- Keep existing natural-language matching behavior.
- Make Gate feedback point users toward accepted canonical evidence terms when a failure
  mode remains missing.

## Acceptance Criteria

- [ ] `negative_path`, `negative-path`, and `negative path` classify as `negative_path`.
- [ ] `boundary_condition`, `boundary-condition`, and `boundary condition` classify as `boundary_condition`.
- [ ] `parse_failure`, `parse-failure`, and `parse failure` cover the `parse_failure` failure mode.
- [ ] `auth_denied` / `auth denied` and `permission_denied` / `permission denied` keep working.
- [ ] Observation keys, observation values, scenario strings, and target strings participate in the same normalization path.
- [ ] Regression tests cover at least `negative_path`, `boundary_condition`, and `parse_failure`.

## Non Goals

- Replacing the full evidence classifier with a semantic parser.
- Treating arbitrary underscored text as trusted evidence without an allowlist.
- Weakening current-git binding or artifact freshness gates.
