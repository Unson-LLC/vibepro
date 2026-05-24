---
story_id: story-vibepro-subagent-review-autonomy
title: Subagent Review Autonomy Spec
---

# Spec

## Required Behavior

- `vibepro review prepare` must generate `parallel-dispatch.md`.
- The plan must set `coordinator_behavior.expected = "dispatch_parallel_subagents"`.
- The plan must set `user_confirmation_required_by_vibepro = false`.
- The plan must set `coordinator_behavior.subagent_lifecycle = "close_before_record"` and `closure_required_for_pass = true`.
- `vibepro pr prepare` must mark required missing reviews as `gate:agent_review = needs_review`.
- A passing required role must have Codex or Claude Code `parallel_subagent` provenance with correlation evidence.
- A passing required role must include closed lifecycle evidence, recorded with `--agent-closed`.
- A required role recorded without closed lifecycle evidence must be treated as `unverified_agent`.
- `manual_review` provenance may be recorded but must not satisfy required Agent Review Gate.
