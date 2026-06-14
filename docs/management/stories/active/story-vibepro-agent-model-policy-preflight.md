---
story_id: story-vibepro-agent-model-policy-preflight
title: Agent model policy preflight enforcement
architecture_docs:
  - docs/architecture/vibepro-agent-model-policy-preflight.md
spec_docs:
  - docs/specs/vibepro-agent-model-policy-preflight.md
status: active
horizon: now
view: dev
period: 2026-06
category: ops
---

# Agent model policy preflight enforcement

## Background

VibePro already publishes intended model policy for Agent Review roles and records actual model metadata after dispatch. That makes model usage auditable, but it does not prevent a coordinator from starting a low-cost review role with a high-cost model.

The useful enforcement point is before the subagent run starts. VibePro still should not execute Codex or Claude Code directly, but it does own the `review start` lifecycle entry. If a coordinator records lifecycle start before dispatch, VibePro can reject a mismatched model policy before a costly subagent is launched.

## Outcome

`vibepro review start` fails before writing lifecycle evidence when a role has `model_policy` and the supplied `--agent-model`, `--agent-reasoning-effort`, or `--agent-cost-tier` does not match the resolved policy. An explicit, reasoned override remains possible for exceptional release-risk cases.

## Acceptance Criteria

- `review start` compares actual agent model metadata against the resolved role/default model policy before creating lifecycle evidence.
- A mismatch fails before `.vibepro/reviews/<story>/<stage>/lifecycle.json` is created or appended.
- A reasoned override is available with `--allow-model-policy-override --model-policy-override-reason <text>`.
- Override lifecycle entries preserve the mismatch details and reason for audit.
- Repositories without model policy keep existing `review start` behavior.

## Non Goals

- VibePro does not spawn Codex or Claude Code subagents.
- VibePro does not infer model prices or maintain a vendor pricing table.
- VibePro does not prevent direct tool/CLI usage outside the VibePro `review start` path.
