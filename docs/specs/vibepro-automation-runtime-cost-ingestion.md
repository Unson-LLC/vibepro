---
story_id: story-vibepro-automation-runtime-cost-ingestion
title: Automation Runtime Cost Ingestion Spec
parent_design: vibepro-automation-runtime-cost-ingestion
---

# Spec

## Contracts

- `AUTCOST-CONTRACT-001`: `audit session-cost` MUST accept `--automation-memory <path>`.
- `AUTCOST-CONTRACT-002`: When explicit window bounds are absent, automation memory MAY provide
  `window_start` and `window_end`.
- `AUTCOST-CONTRACT-003`: Explicit `--window-start` and `--window-end` MUST take precedence over
  automation memory values.
- `AUTCOST-CONTRACT-004`: Automation memory parsing MUST return explicit `available`, `partial`,
  `unavailable`, or `not_requested` status and MUST NOT convert missing cost into zero.
- `AUTCOST-CONTRACT-005`: `execute merge` MUST forward `--automation-memory` to the session-cost
  collector when `--session-id` is supplied.
- `AUTCOST-CONTRACT-006`: `cost_accounting_collection` MUST preserve automation-memory provenance
  so canonical audit readers can distinguish measured daily-window cost from full-session cost.

## Scenarios

- `AUTCOST-SCENARIO-001`: Given automation memory with a daily window and no explicit bounds, the
  session-cost collector uses only token_count events inside that window.
- `AUTCOST-SCENARIO-002`: Given `execute merge --session-id <id> --automation-memory <path>`, merge
  cost collection records the automation-memory window provenance.
- `AUTCOST-SCENARIO-003`: Given explicit bounds and automation memory, explicit bounds win.
- `AUTCOST-SCENARIO-004`: Given missing automation memory, cost remains unavailable/partial with a
  reason instead of zero values.

## Verification

- `AUTCOST-VERIFY-001`: `test/session-efficiency-audit.test.js` covers automation-memory window
  selection and bounded token/time deltas.
- `AUTCOST-VERIFY-002`: `test/vibepro-cli.test.js` covers `execute merge` propagation and help
  surface.
