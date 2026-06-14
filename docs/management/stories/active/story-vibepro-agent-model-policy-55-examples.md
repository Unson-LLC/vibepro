---
story_id: story-vibepro-agent-model-policy-55-examples
title: Agent model policy examples use 5.5 generation
status: active
horizon: now
view: dev
period: 2026-06
---

# Story

VibePro model policy examples should not teach coordinators to select a previous-generation model family when the project standard is the `gpt-5.5` generation. Cost control should be expressed through role policy, reasoning effort, and explicit override evidence, not by quietly downgrading the model generation in the documented happy path.

## Acceptance Criteria

- AC-1: Committed model policy docs and tests no longer use previous-generation model strings as the standard policy example.
- AC-2: The model policy architecture example uses `gpt-5.5` and keeps `reasoning_effort` / `cost_tier` as the cost-control fields.
- AC-3: The review policy provenance test uses `gpt-5.5` as the expected resolved model.
- AC-4: The preflight mismatch test still rejects high-effort/high-tier execution before lifecycle creation.
- AC-5: No runtime model translation table is introduced; VibePro still performs exact policy matching.

## References

- Architecture: `docs/architecture/vibepro-agent-model-policy.md`
- Spec: `docs/specs/vibepro-agent-model-policy-55-examples.md`
