---
story_id: story-vibepro-automation-cost-defaults
title: Automation Cost Defaults Architecture
---

# Architecture

## Decision

Automation-owned runtime identifiers are adapter inputs, not product-value
judgments. VibePro should accept them at the CLI boundary and pass them into the
existing session-cost collector.

## Flow

```mermaid
flowchart TD
  Env["VIBEPRO_SESSION_ID / CODEX_SESSION_ID"] --> CLI["audit session-cost / execute merge"]
  Memory["VIBEPRO_AUTOMATION_MEMORY"] --> CLI
  CLI --> Collector["session-cost collector"]
  Collector --> Merge["cost_accounting_collection"]
```

## Boundaries

- Explicit CLI options override env defaults.
- Env defaults only select telemetry inputs.
- Value interpretation remains in the daily audit automation.

