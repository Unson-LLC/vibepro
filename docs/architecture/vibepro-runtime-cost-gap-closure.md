---
story_id: story-vibepro-runtime-cost-gap-closure
title: Runtime Cost Gap Closure Architecture
---

# Architecture

## Decision

Treat runtime-cost closure as an adapter and evidence-contract problem:

- automation defaults connect daily jobs to VibePro commands;
- session inference bridges story/window to Codex JSONL when evidence is strong;
- budget controls make audit overhead actionable in canonical artifacts.

## Flow

```mermaid
flowchart TD
  Env["env / CLI defaults"] --> Collector["session-cost collector"]
  Window["automation memory window"] --> Collector
  JSONL["Codex JSONL candidates"] --> Selection["session_selection"]
  Selection --> Collector
  Collector --> Merge["execute merge cost_accounting_collection"]
  Merge --> Canonical["automation_value_audit"]
  Canonical --> Controls["cost_controls"]
```

## Boundaries

- `execute merge` records evidence and provenance.
- Daily automation remains responsible for cross-repository value judgment.
- Ambiguous attribution and missing runtime data stay explicit.

