---
story_id: story-vibepro-automation-runtime-cost-ingestion
title: Automation Runtime Cost Ingestion
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: vibepro-daily-automation-runtime-cost
parent_design: vibepro-automation-runtime-cost-ingestion
architecture_docs:
  - docs/architecture/vibepro-automation-runtime-cost-ingestion.md
spec_docs:
  - docs/specs/vibepro-automation-runtime-cost-ingestion.md
created_at: 2026-06-28
updated_at: 2026-06-28
---

# Story

Daily VibePro value audits should measure whether VibePro spends too much agent time and token
budget relative to implementation value. The previous automation-readable contract made canonical
audit artifacts readable, but `session_cost` still stayed unavailable unless an operator manually
passed exact session windows.

VibePro should let the existing Codex session-cost collector use the daily automation memory as a
window source. That keeps the value judgment in the daily automation while making VibePro able to
produce bounded token/time evidence from the same audit window.

## Acceptance Criteria

- [x] `AUTCOST-AC-001`: `vibepro audit session-cost` accepts `--automation-memory <path>` and uses
  the latest daily window from that memory when explicit `--window-start/--window-end` are absent.
- [x] `AUTCOST-AC-002`: Explicit `--window-start/--window-end` remain authoritative over automation
  memory.
- [x] `AUTCOST-AC-003`: `vibepro execute merge --session-id <id>` forwards `--automation-memory` to
  the session-cost collector and records automation-memory provenance in `cost_accounting_collection`.
- [x] `AUTCOST-AC-004`: Missing or unparsable automation memory is reported as unavailable/partial
  without fabricating token or elapsed-time values.
- [x] `AUTCOST-AC-005`: CLI help exposes the new option so daily automation can use the public
  command surface instead of local conventions.

## Non Goals

- Automatically deciding which session belongs to a story.
- Making `execute merge` judge whether VibePro delivered enough value.
- Replacing the daily Codex automation's cross-repository value analysis.
