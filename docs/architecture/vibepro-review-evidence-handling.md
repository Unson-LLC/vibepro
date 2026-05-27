---
story_id: story-vibepro-review-evidence-handling
title: VibePro Review Evidence Handling Architecture
---

# Architecture

## Decision

Add a single exported constant `EVIDENCE_HANDLING_BLOCK` in `src/agent-review.js` (or a small sibling module) that holds the markdown text. Both `renderReviewRequestMarkdown` and `renderParallelDispatchMarkdown` interpolate the same constant, ensuring the rule cannot drift between the two artifacts.

## Boundaries

- The constant owns: the exact wording of the evidence-handling rule.
- The renderers own: placement (before `## Instructions` in request, at the top of dispatch coordinator instructions).
- No new lifecycle, plan, or result schema fields are added.

## Placement

- In `review-request-<role>.md`: section heading `## Evidence Handling`, inserted between `## Mandatory Review Lenses` and `## Instructions`.
- In `parallel-dispatch.md`: section heading `## Evidence Handling`, inserted between `## Coordinator Instructions` and `## Mandatory Review Lenses`.

## Reasoning

The Codex `guardian/policy_template.md` separates "evidence" from "instructions" as a load-bearing distinction. VibePro's review artifacts today embed user-controlled text (story text, decision records, PR body) into the same markdown that contains the reviewer's instructions. Without an explicit framing, a prompt-injection-style attempt embedded in story text could slip past the reviewer. Centralizing the rule in one constant ensures both consumer artifacts surface the same expectation.

## Failure Modes

- Reviewer ignores the block → no automatic enforcement; the system documents the expectation and provides a finding-id namespace for audit.
- Future renderer is added without consuming the constant → covered by test: any markdown artifact emitted under `.vibepro/reviews/<id>/<stage>/` for a known role must contain the canonical phrase.
