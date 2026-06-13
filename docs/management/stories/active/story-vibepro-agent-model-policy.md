---
story_id: story-vibepro-agent-model-policy
title: Agent Review dispatch should expose cost-aware model policy
architecture_docs:
  - docs/architecture/vibepro-agent-model-policy.md
spec_docs:
  - docs/specs/vibepro-agent-model-policy.md
---

# Story: Agent Review dispatch should expose cost-aware model policy

## Background

VibePro turns ambiguous work into Story, Architecture, Spec, tasks, gates, and role-scoped Agent Review requests. When that harness has already narrowed the work, coordinators should not have to run every Codex or Claude Code subagent on a high-cost model.

Today VibePro records `--agent-model` as review provenance, but it does not give repositories a policy for which model or reasoning effort should be used for each Agent Review role. That leaves cost decisions to ad hoc coordinator behavior.

## Acceptance Criteria

- Repositories can configure a default Agent Review model policy in `.vibepro/config.json`.
- Repositories can configure role-level model policy overrides.
- `review prepare` resolves the effective model policy for each role.
- `parallel-dispatch.md` and per-role review requests show the effective model and reasoning guidance.
- `review start` can record the intended model and reasoning effort in lifecycle evidence.
- `review record` can record the actual model and reasoning effort used by the subagent.
- Existing behavior remains unchanged when no model policy config is present.
