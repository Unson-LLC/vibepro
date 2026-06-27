---
story_id: story-vibepro-cost-telemetry-residual-closure
vibepro_story_id: story-vibepro-residual-risk-closure
title: Cost telemetry residual closure
status: active
parent_design: vibepro-residual-risk-closure
architecture_docs:
  - docs/architecture/vibepro-residual-risk-closure.md
spec_docs:
  - docs/specs/vibepro-residual-risk-closure.md
---

# Cost telemetry residual closure

## Background

PR prepare must keep missing session token accounting explicit, but missing telemetry should not automatically become residual risk when the PR body is already bounded by VibePro artifact policy.

This child Story keeps its own `story_id`; `vibepro_story_id` binds it to the shared residual-risk-closure PR execution Story.

## Acceptance Criteria

- [ ] Senior Gap Judgment preserves token_accounting and elapsed_time_accounting as not_collected_in_pr_prepare when exact session telemetry is absent.
- [ ] A bounded artifact policy closes the automatic cost_telemetry_unavailable residual risk.
- [ ] Explicit token and elapsed-time accounting, when supplied, is normalized and prevents the cost telemetry residual risk.
