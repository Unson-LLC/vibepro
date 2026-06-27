---
story_id: story-vibepro-manual-pr-flow-alignment
title: VibePro manual PR flow alignment architecture
parent_design: vibepro-manual-pr-flow-alignment
---

# Architecture

## Decision

Treat VibePro manuals and skills as operating contracts for agents. They must describe the current PR lifecycle in the same layered model used by the CLI:

1. GitHub PR body: concise decision brief for human review.
2. `.vibepro/pr/<story-id>/` JSON artifacts: durable source of truth for readiness, decisions, evidence, PR create, and merge.
3. HTML artifacts: optional human review surfaces controlled by evidence depth.
4. `execute merge`: explicit merge boundary that persists canonical audit artifacts.

## Rationale

The concise PR body solved GitHub body limits and LLM context waste. If manuals still teach agents to treat the PR body as the audit log, the next implementation will reintroduce the same failure mode through process drift rather than code.

The fix is documentation alignment, not another rendering change: README and skills should make the evidence split explicit, and older architecture/spec documents should state that they are superseded for GitHub body rendering.

## Boundaries

- This changes docs and skills only.
- It does not alter `renderPrBody`, Gate readiness, Agent Review requirements, or merge enforcement.
- It preserves older design documents as history while removing their authority over the current GitHub body contract.

## Flow

```text
implementation
  -> vibepro pr prepare
  -> pr-prepare.json / decision-index.json / evidence-plan.json
  -> concise pr-body.md
  -> vibepro pr create
  -> CI checks
  -> vibepro verify import-ci
  -> vibepro pr prepare + pr create refresh
  -> vibepro execute merge
  -> pr-merge.json + canonical audit artifacts
```
