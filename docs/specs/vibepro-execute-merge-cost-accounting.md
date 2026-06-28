---
story_id: story-vibepro-execute-merge-cost-accounting
title: Execute Merge Cost Accounting Ingestion Spec
parent_design: vibepro-execute-merge-cost-accounting
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        Explicit["--cost-accounting JSON"] --> Merge["execute merge"]
        Session["--session-id"] --> SessionAudit["audit session-cost collector"]
        SessionAudit --> Merge
        Merge --> Result["merge.cost_accounting"]
        Result --> Canonical["canonical audit promotion"]
        Canonical --> Summary["cost_summary token/time"]
---

# Spec

## Contracts

- `EMCOST-CONTRACT-001`: `execute merge` MUST accept optional `costAccountingPath` and read JSON from
  that path relative to the repo root when the path is not absolute.
- `EMCOST-CONTRACT-002`: The cost JSON MAY be direct accounting fields, a `cost_accounting` object, or
  a `vibepro_session_efficiency_audit` artifact.
- `EMCOST-CONTRACT-003`: `execute merge` MUST accept optional `sessionId` and call the existing Codex
  session-cost collector only when `sessionId` is provided.
- `EMCOST-CONTRACT-004`: The merge result MUST expose `cost_accounting.token_accounting` and
  `cost_accounting.elapsed_time_accounting` before canonical audit promotion.
- `EMCOST-CONTRACT-005`: If explicit cost input cannot be read, the merge result MUST preserve
  `status=unavailable` with the read error reason and MUST NOT report zero tokens or zero elapsed
  time.
- `EMCOST-CONTRACT-006`: `execute merge` MUST record a `cost_accounting_collection` summary so
  auditors can distinguish `not_requested`, `available`, and `unavailable`.
- `EMCOST-CONTRACT-007`: CLI help MUST surface `--cost-accounting <json>` and `--session-id <id>`.

## Scenarios

- `EMCOST-SCENARIO-001`: Given `--cost-accounting merge-cost.json` with token and elapsed-time
  accounting, when `execute merge` succeeds, then canonical audit cost summaries show those measured
  values as available.
- `EMCOST-SCENARIO-002`: Given `--session-id <id>`, when the Codex session-cost collector finds JSONL
  token/time data, then `merge.cost_accounting` uses that collector output.
- `EMCOST-SCENARIO-003`: Given no cost input, when `execute merge` succeeds, then canonical audit keeps
  token/time accounting unavailable rather than fabricating cost.

## Verification

- `EMCOST-VERIFY-001`: CLI regression covers successful `execute merge --cost-accounting` and asserts
  the values persist in merge, canonical bundle, canonical index, decision summary, and remote
  canonical `pr-merge.json`.
- `EMCOST-VERIFY-002`: Existing session-cost tests continue to cover explicit Codex JSONL collection.
