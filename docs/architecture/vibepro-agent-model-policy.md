---
story_id: story-vibepro-agent-model-policy
title: VibePro Agent Model Policy Architecture
---

# Architecture

## Decision

Keep VibePro as a coordinator contract, not a subagent runner. VibePro should not execute Codex or Claude Code, but it should resolve and publish cost-aware model guidance in the review artifacts it already generates.

The config surface is:

```json
{
  "agent_reviews": {
    "defaults": {
      "model_policy": {
        "model": "gpt-5.5",
        "reasoning_effort": "medium",
        "cost_tier": "medium"
      }
    },
    "roles": {
      "gate_evidence": {
        "model_policy": {
          "model": "gpt-5.5",
          "reasoning_effort": "high",
          "cost_tier": "high"
        }
      }
    }
  }
}
```

## Boundaries

- Agent Review owns model policy normalization, default/role override resolution, and generated review artifact guidance.
- VibePro records intended and actual model metadata as lifecycle/review provenance.
- VibePro does not translate policy into direct `codex exec` or Claude Code launch commands because the coordinator runtime owns subagent execution.
- PR readiness must not fail solely because no model policy is configured.

## State

No new workspace artifact is required. `.vibepro/config.json` remains the policy source of truth. Generated `review-plan.json`, `parallel-dispatch.md`, review request files, lifecycle entries, and review results include the resolved or recorded model metadata for auditability.
