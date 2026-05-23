---
story_id: story-vibepro-human-reviewable-pr-body
title: Human-reviewable PR body spec
---

# Human-reviewable PR body spec

## Requirements

- `vibepro pr prepare` MUST render `## このPRで決めたいこと` before `## 概要`.
- The decision brief MUST include Story, human merge decision, review entry points, Gate status, scope decision, and changed file count.
- The PR body MUST render a reviewer-oriented change map with Runtime, Contract Docs, Capability Map, Tests, and Repo Control categories when applicable.
- The PR body MUST render explicit non-goals so reviewers can keep the review scope narrow.
- The PR body MUST keep Gate DAG, Gate Enforcement, Agent Review, split plan, and evidence sections available as audit logs.
- Verification commands MUST render `[x]` only when the matching Gate status is `passed` or `pass`.
- Verification commands with missing, failed, stale, or needs-evidence Gates MUST remain unchecked.

## Non-goals

- VibePro does not auto-waive failed or missing Gates.
- VibePro does not hide scope or split warnings.
- VibePro does not require product-specific vocabulary to produce a reviewable PR body.
