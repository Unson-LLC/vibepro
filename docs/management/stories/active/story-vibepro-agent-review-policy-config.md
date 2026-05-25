---
story_id: story-vibepro-agent-review-policy-config
title: VibePro should let repositories configure Agent Review policy by phase
architecture_docs:
  - docs/architecture/vibepro-agent-review-policy-config.md
spec_docs:
  - docs/specs/vibepro-agent-review-policy-config.md
---

# Story: VibePro should let repositories configure Agent Review policy by phase

## Background

VibePro's Agent Review defaults are useful as a baseline, but different repositories do not need identical subagent review roles for every phase.

CLI-only changes should not be forced through UI-oriented review roles, risky source changes may need additional custom review roles, and long-running roles need configurable lifecycle timeout guidance.

## Acceptance Criteria

- Repositories can override stage roles through `.vibepro/config.json`.
- Repositories can mark roles as `required`, `optional`, or `disabled`.
- PR Agent Review requirements honor role mode.
- Roles can be activated only for matching changed-file patterns.
- `review prepare` and generated dispatch artifacts reflect configured roles.
- Custom configured roles can be recorded and summarized.
- Lifecycle start guidance uses configured default or role-level timeout values.
- Existing behavior remains unchanged when no `agent_reviews` config is present.
