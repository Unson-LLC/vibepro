---
story_id: story-vibepro-session-cost-source-health-fail-soft
title: Session Cost Source Health Fail-Soft
status: active
view: dev
period: 2026-07
source:
  type: value_audit_followup
  id: vibepro-value-audit-session-cost-parse-failure
parent_design: vibepro-session-cost-source-health-fail-soft
architecture_docs:
  - docs/architecture/vibepro-session-cost-source-health-fail-soft.md
spec_docs:
  - docs/specs/vibepro-session-cost-source-health-fail-soft.md
created_at: 2026-07-30
updated_at: 2026-07-30
reason: "alternatives considered: repair the mutable process-manager file before every audit (hides source corruption and requires external mutation), catch every session-cost failure at the CLI boundary (returns too little structured evidence to identify the failed source), or make process-manager ingestion fail-soft while preserving session metadata and CLI-repo fallback; selected source-local fail-soft parsing with explicit health. compatibility impact: successful process-manager resolution is unchanged and the process_manager object gains additive source-health fields on degraded input. rollback plan: revert the source-health result wrapper and focused fixtures; no persisted data migration is required. boundary and scope: this Story fixes missing, empty, malformed, and wrong-shape process-manager input only; token boundary semantics and active-time accounting remain separate follow-ups."
---

# Story

The daily VibePro value audit could not produce token accounting because
`$CODEX_HOME/process_manager/chat_processes.json` existed as a zero-byte file. The optional
process-manager source threw before session JSONL parsing and before the documented session metadata
fallback, so one corrupt auxiliary source made the entire audit unavailable.

VibePro should isolate that failure, continue from session metadata or the CLI repository, and
report the process-manager source health explicitly. A missing or corrupt process-manager source is
not evidence that no work happened.

## Acceptance Criteria

- [x] `SCSH-AC-001`: Missing, empty, malformed, and non-array process-manager input does not abort
  `audit session-cost`.
- [x] `SCSH-AC-002`: When session JSONL contains `session_meta.cwd`, degraded process-manager input
  falls back to that cwd and reports `observed_worktree_source=session_meta`.
- [x] `SCSH-AC-003`: The JSON result reports process-manager status, reason, source path, and parse
  diagnostics without exposing file contents.
- [x] `SCSH-AC-004`: A valid matching process-manager entry retains precedence over session
  metadata.
- [x] `SCSH-AC-005`: Focused unit tests reproduce zero-byte and malformed JSON inputs and prove
  token accounting remains available.

## Non Goals

- Changing bounded-window token snapshot semantics.
- Replacing window-bound elapsed time with active engineering time.
- Repairing or rewriting `chat_processes.json`.
