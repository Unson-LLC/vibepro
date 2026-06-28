---
story_id: story-vibepro-execute-merge-cost-accounting
title: Execute Merge Cost Accounting Ingestion
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: vibepro-value-audit-merge-cost-accounting-gap
parent_design: vibepro-execute-merge-cost-accounting
architecture_docs:
  - docs/architecture/vibepro-execute-merge-cost-accounting.md
spec_docs:
  - docs/specs/vibepro-execute-merge-cost-accounting.md
created_at: 2026-06-28
updated_at: 2026-06-28
---

# Story

Canonical audit artifacts can now store token and elapsed-time accounting, and `audit session-cost`
can measure Codex session cost. The remaining gap is that `execute merge` does not ingest either
explicit cost accounting or session-cost output, so merged canonical artifacts still report
`token_accounting=unavailable` and `elapsed_time_accounting=unavailable`.

VibePro should let `execute merge` attach measured cost accounting to the merge result before
canonical audit promotion, without guessing which local session belongs to a PR.

## Acceptance Criteria

- [x] `EMCOST-AC-001`: `vibepro execute merge` accepts `--cost-accounting <json>` and records the
  provided token and elapsed-time accounting on the merge artifact.
- [x] `EMCOST-AC-002`: `vibepro execute merge` accepts `--session-id <id>` and uses the existing
  Codex session-cost collector only when explicitly requested.
- [x] `EMCOST-AC-003`: Missing, unreadable, or partial cost inputs stay machine-readable and are not
  converted to zero.
- [x] `EMCOST-AC-004`: Successful merge canonical audit promotion persists measured token/time values
  into `audit-bundle.json`, `audit-index.json`, `decision-summary.md`, and canonical `pr-merge.json`.
- [x] `EMCOST-AC-005`: The public CLI help documents the cost-accounting inputs.

## Non Goals

- Guessing the current Codex or Claude Code session automatically.
- Adding a Claude Code collector adapter.
- Making missing cost accounting a merge blocker.
