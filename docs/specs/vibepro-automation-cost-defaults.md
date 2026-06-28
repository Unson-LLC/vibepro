---
story_id: story-vibepro-automation-cost-defaults
title: Automation Cost Defaults Spec
parent_design: vibepro-runtime-cost-gap-closure
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart TD
        Env["VIBEPRO_SESSION_ID / VIBEPRO_AUTOMATION_MEMORY"] --> CLI["CLI defaults"]
        CLI --> Collector["session-cost collector"]
        Missing["Missing env"] --> Unknown["not_requested / unavailable"]
        Unknown --> Collector
---

# Spec

## Invariants

- `ACD-INV-001`: Env defaults may supply missing cost metadata, but explicit CLI
  options remain authoritative.
- `ACD-INV-002`: Missing env values must remain `not_requested` or
  `unavailable`; they must not become zero cost.

## Contracts

- `ACD-CONTRACT-001`: `VIBEPRO_SESSION_ID`, `CODEX_SESSION_ID`, and
  `CLAUDE_SESSION_ID` are accepted session-id defaults in that order.
- `ACD-CONTRACT-002`: `VIBEPRO_AUTOMATION_MEMORY` is accepted as the automation
  memory default for `audit session-cost` and `execute merge`.
- `ACD-CONTRACT-003`: `execute merge` records collection provenance when the
  defaults are used.

## Scenarios

- `ACD-SCENARIO-001`: Given only env defaults, merge-time cost collection uses
  the same collector as explicit CLI options.
- `ACD-SCENARIO-002`: Given explicit flags and env defaults, explicit flags win.

## Anti-Patterns

- `ACD-AP-001`: Do not treat absent runtime metadata as `0` tokens or `0 ms`.
- `ACD-AP-002`: Do not make daily value judgment inside `execute merge`.

## Verification

- `ACD-VERIFY-001`: CLI regression covers help exposure and env/default
  collection behavior.
