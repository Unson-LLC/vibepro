---
story_id: story-vibepro-agent-model-policy-preflight
title: Agent model policy preflight architecture
---

# Architecture

## Decision

Enforce model policy at `review start`, not at `review record`.

`review start` is the coordinator-facing lifecycle boundary that should be executed immediately before subagent dispatch. When a resolved role model policy exists, VibePro compares that intended policy with the supplied actual launch metadata:

- `model` -> `--agent-model`
- `reasoning_effort` -> `--agent-reasoning-effort`
- `cost_tier` -> `--agent-cost-tier`

If any configured field differs or is omitted, `review start` fails before writing lifecycle evidence. This prevents the wasteful pattern of running a high-cost model first and only discovering the mismatch after the fact.

## Override Boundary

Some roles may intentionally require a higher-cost run for release confidence. The override path is explicit:

```bash
vibepro review start . \
  --id <story-id> \
  --stage gate \
  --role release_risk \
  --agent-system codex \
  --agent-id <id> \
  --agent-model gpt-5.5 \
  --agent-reasoning-effort high \
  --agent-cost-tier high \
  --allow-model-policy-override \
  --model-policy-override-reason "release manager requested high-confidence rerun"
```

The lifecycle entry records `model_policy_preflight.status = "overridden"`, the mismatch list, intended policy, actual launch metadata, and override reason.

## Boundaries

- VibePro remains a control plane and evidence system; it does not execute subagents.
- Direct Codex/Claude Code usage outside `vibepro review start` remains outside this enforcement boundary.
- `review record` continues to store actual provenance. It does not fabricate actual model usage from intended policy.
- No model name pricing table is introduced; enforcement is exact policy matching, not cost estimation.
