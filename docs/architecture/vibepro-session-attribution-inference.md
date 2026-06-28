---
story_id: story-vibepro-session-attribution-inference
title: Session Attribution Inference Architecture
---

# Architecture

## Decision

Inference belongs in `session-cost`, not in the final value audit. The collector
can rank telemetry candidates, while automation still decides whether the
result is sufficient for value judgment.

## Flow

```mermaid
flowchart TD
  Window["automation window"] --> Candidates["Codex JSONL candidates"]
  Repo["repo cwd"] --> Candidates
  Story["story id reference"] --> Candidates
  Process["process_manager cwd"] --> Candidates
  Candidates --> Selection["session_selection"]
  Selection --> Cost["token/time accounting"]
```

## Boundaries

- Inference is opt-in.
- Top-score ties are ambiguous.
- Low-confidence results remain unavailable rather than zero.

