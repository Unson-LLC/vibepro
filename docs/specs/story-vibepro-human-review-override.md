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
  - kind: threat_model
    mermaid: |
      flowchart LR
        U["Untrusted stale or incomplete review evidence"] --> V{"Validate recommendation, source, reviewer, reason, and HEAD"}
        V -->|invalid| B["Fail closed before PR creation or merge"]
        V -->|current accepted waiver| L["Record matched decision in lifecycle artifact"]
    rationale: A stale, malformed, cross-story, or reviewer-less decision must not cross either lifecycle trust boundary.
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

## Acceptance coverage

- AC-1: PR creation rejects `split_pr` without a current accepted waiver containing reason and reviewer.
- AC-2: merge re-evaluates `split_pr` and `block` rather than trusting an existing PR.
- AC-3: the accepted waiver is bound to the current HEAD and selected Story.
- AC-4: `proceed` preserves the existing lifecycle route.
- AC-5: CLI replay covers allowed and fail-closed state transitions and their artifacts.

## References

- code_refs: `src/human-review-override.js`, `src/pr-manager.js`, `src/merge-manager.js`
- test_refs: `test/human-review-override.test.js`, `test/e2e/story-vibepro-human-review-override-main.spec.ts`
