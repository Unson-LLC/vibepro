---
story_id: story-vibepro-human-reviewable-pr-body
title: Human-reviewable PR body spec
parent_design: vibepro-manual-pr-flow-alignment
---

# Human-reviewable PR body spec

## Status

Superseded for GitHub PR body rendering by `docs/specs/vibepro-concise-pr-body.md`.

The requirements below are historical context for the older verbose PR body. Current GitHub PR bodies MUST follow the concise `What` / `Why` / `How to review` / `Verification` / `VibePro` contract and MUST NOT expand full Gate DAG, Agent Review, split-plan, runtime metadata, or lifecycle dumps into the body.

## Requirements

- `vibepro pr prepare` MUST render a concise GitHub body with `What`, `Why`, `How to review`, `Verification`, and `VibePro`.
- The concise brief MUST include Story, review entry points, Gate status, scope decision, changed file count, verification summary, and artifact references.
- The concise brief MUST NOT include the legacy `### 判断グラフ` section as a full PR body graph.
- When the target repository has a GitHub `origin` remote, source-of-truth and primary changed file references SHOULD render as GitHub file links for the PR head ref.
- When no supported GitHub remote exists, source and artifact references MUST fall back to plain repository-relative paths instead of emitting broken links.
- The human-facing top section MUST NOT render expanded audit-log sections in the GitHub body.
- The PR body MUST render a reviewer-oriented change map with Runtime, Contract Docs, Capability Map, Tests, and Repo Control categories when applicable.
- The PR body MUST render explicit non-goals so reviewers can keep the review scope narrow.
- The PR body MUST keep Gate DAG, Gate Enforcement, Agent Review, split plan, verification evidence, PR create, and PR merge evidence discoverable through `.vibepro/pr/<story-id>/` artifact references.
- Gate DAG, Gate Enforcement, Agent Review, Explore Evidence, split plan, and runtime metadata MUST remain in artifacts instead of rendering after `## 監査ログ`.
- The human-facing top section MUST NOT expose raw internal scope labels such as `needs_clean_branch`; it MUST translate them into an actionable reviewer decision.
- The human-facing top section SHOULD translate `split_recommended` into whether the current PR can still be reviewed or whether split/scope explanation is required.
- Verification commands MUST render `[x]` only when the matching Gate status is `passed` or `pass`.
- Verification commands with missing, failed, stale, or needs-evidence Gates MUST remain unchecked.

## Non-goals

- VibePro does not auto-waive failed or missing Gates.
- VibePro does not hide scope or split warnings.
- VibePro does not require product-specific vocabulary to produce a reviewable PR body.
