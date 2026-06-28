---
story_id: story-vibepro-audit-budget-action-controls
title: Audit Budget Action Controls Architecture
parent_design: vibepro-runtime-cost-gap-closure
---

# Architecture

## Decision

Budget excess is a value-audit signal. It should be emitted in the canonical
automation contract so daily automation can compare audit burden against
implementation value without scraping prose.

## Flow

```mermaid
flowchart TD
  Cost["cost_summary"] --> Controls["automation_value_audit.cost_controls"]
  Controls --> Summary["decision-summary.md"]
  Controls --> Daily["daily value audit automation"]
```

## Boundaries

- Cost controls do not replace `budget_status`.
- Recommendations are stable machine-readable hints.
- Merge remains controlled by existing gate/review/CI checks.
