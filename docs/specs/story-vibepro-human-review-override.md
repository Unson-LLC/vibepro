---
title: Human review override spec
status: active
parent_design: story-vibepro-human-review-override
diagrams:
  - kind: flow
    mermaid: |
      flowchart LR
        R["split_pr or block"] --> D{"Current HEAD accepted decision has reason and reviewer?"}
        D -->|no| B["Block PR creation and merge"]
        D -->|yes| A["Allow requested lifecycle operation"]
        P["proceed"] --> A
    rationale: PR creation and merge must evaluate the same current-HEAD override transition and fail closed for missing or stale decisions.
---

# Human review override spec

## HRO-001

Given `split_pr` or `block`, when PR creation or merge is requested, then a current-HEAD accepted decision sourced as `human-review:<recommendation>` must contain non-empty `reason` and `reviewer`.

## HRO-002

Given another recommendation, when the policy is evaluated, then existing PR and merge behavior is unchanged.

## HRO-003

Given an accepted override, when either operation records its lifecycle artifact, then the matched decision is included as `human_review_override`.

## Workflow state transition scenario

Given the recommendation is `split_pr` or `block`, when a current-HEAD accepted override with reason and reviewer is recorded, then PR creation and merge transition from blocked to allowed. Given the decision is missing or stale, when either entry point evaluates the transition, then it remains blocked.

## References

- code_refs: `src/human-review-override.js`, `src/pr-manager.js`, `src/merge-manager.js`
- test_refs: `test/human-review-override.test.js`, `test/e2e/story-vibepro-human-review-override-main.spec.ts`
