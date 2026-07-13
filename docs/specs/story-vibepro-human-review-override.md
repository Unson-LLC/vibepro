---
title: Human review override spec
status: active
parent_design: story-vibepro-human-review-override
---

# Human review override spec

## HRO-001

Given `split_pr` or `block`, when PR creation or merge is requested, then a current-HEAD accepted decision sourced as `human-review:<recommendation>` must contain non-empty `reason` and `reviewer`.

## HRO-002

Given another recommendation, when the policy is evaluated, then existing PR and merge behavior is unchanged.

## HRO-003

Given an accepted override, when either operation records its lifecycle artifact, then the matched decision is included as `human_review_override`.

## References

- code_refs: `src/human-review-override.js`, `src/pr-manager.js`, `src/merge-manager.js`
- test_refs: `test/human-review-override.test.js`
