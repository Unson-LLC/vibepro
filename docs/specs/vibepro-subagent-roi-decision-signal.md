---
story_id: story-vibepro-subagent-roi-decision-signal
title: Subagent ROI Decision Signal Spec
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        Reviews["Review artifacts"] --> Classifier["ROI classifier"]
        Classifier --> Value["Value signals"]
        Classifier --> Waste["Waste signals"]
        Value --> Roles["Role recommendations"]
        Waste --> Roles
        Roles --> Report["usage report --subagent-roi"]
    rationale: "Subagent ROI must explain whether reviews changed merge judgment, not only whether reviews existed."
---

# Spec

## Contracts

- `SRDS-001`: `usage report --subagent-roi` MUST classify reviews with `accepted_finding` or `resolved_finding` as high-value candidates.
- `SRDS-002`: A pass-only review without finding, disposition, or judgment delta MUST expose a waste signal such as `pass_only_no_decision_signal`.
- `SRDS-003`: A review with findings but no disposition MUST expose `undisposed_finding` so value is treated as unresolved.
- `SRDS-004`: Missing token or cost evidence MUST be reported as `token_missing`; missing cost MUST NOT be interpreted as zero cost.
- `SRDS-005`: Story-level output MUST return machine-readable role recommendations: continue, reduce, or needs evidence.
- `SRDS-006`: Human-readable output MUST group reviews by operational decision category before showing any score ordering.

## Invariants

- ROI scoring is advisory and does not become a PR pass/block gate in this story.
- Existing review artifacts without token or cost fields remain readable.
- VibePro does not attempt to prove LLM finding truth automatically; it reports disposition and decision impact evidence.

## Verification

- Unit coverage uses fixtures for accepted finding, resolved finding, pass-only, undisposed finding, and missing token/cost.
- JSON report assertions cover value signals, waste signals, token missing state, and role recommendations.
- Human-readable report assertions verify operational grouping is visible before numeric score ordering.

## Implementation Scenarios

- Scenario `SRDS-S-001`: Given a parallel subagent review has an accepted finding and resolved finding evidence, `usage report --subagent-roi --json` marks it as `high_value_candidate`, includes `accepted_finding` and `resolved_finding`, and recommends the role under `continue`.
- Scenario `SRDS-S-002`: Given a pass-only parallel subagent review has no finding, disposition, or judgment delta, `usage report --subagent-roi --json` emits `pass_only_no_decision_signal` and recommends the role under `reduce`.
- Scenario `SRDS-S-003`: Given token/cost evidence is absent, `usage report --subagent-roi` emits `token_missing`/`cost_missing` and renders total cost as partial or unknown instead of treating missing cost as free.
