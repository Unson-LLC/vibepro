---
story_id: story-vibepro-session-efficiency-audit
title: Session Worktree Efficiency Audit
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: vibepro-value-audit-active-session-cost-gap
parent_design: vibepro-session-efficiency-audit
architecture_docs:
  - docs/architecture/vibepro-session-efficiency-audit.md
spec_docs:
  - docs/specs/vibepro-session-efficiency-audit.md
created_at: 2026-06-27
updated_at: 2026-06-27
---

# Story

Value audits need to measure the cost of VibePro-managed work even before a PR is merged. The
previous canonical audit path could read merge artifacts, but it could not reconstruct an active
Codex session's worktree, `.vibepro` artifacts, token delta, elapsed time, and changed-line buckets
from the session evidence that auditors actually cite.

VibePro should expose a deterministic audit command that accepts a story id and Codex session id,
resolves the active worktree from process metadata when present, reads Codex JSONL token/time
events, counts story artifacts, and allocates token cost by changed-line bucket without turning
missing evidence into zero.

## Acceptance Criteria

- [ ] `SESS-AUDIT-AC-001`: `vibepro audit session-cost` is a public CLI command documented in help.
- [ ] `SESS-AUDIT-AC-002`: The command resolves the observed worktree from
  `$CODEX_HOME/process_manager/chat_processes.json` before falling back to session metadata or the
  CLI repo path.
- [ ] `SESS-AUDIT-AC-003`: The command reads Codex session JSONL `token_count` events and reports
  token deltas for either a bounded window or the full session.
- [ ] `SESS-AUDIT-AC-004`: The command reports elapsed time from bounded windows, task/final events,
  or the last observed event, with `partial` status when no final answer exists.
- [ ] `SESS-AUDIT-AC-005`: The command counts `.vibepro/pr/<story-id>` artifact lines and summarizes
  `pr-prepare` / verification status from the observed worktree.
- [ ] `SESS-AUDIT-AC-006`: The command buckets changed lines into `src/`, `test/`,
  story/spec/architecture docs, audit/evidence artifacts, and other.
- [ ] `SESS-AUDIT-AC-007`: The command emits a cost-breakdown table model that apportions token
  delta by changed-line ratio when token counts are available and marks tokens as unconfirmed
  otherwise.

## Non Goals

- Creating or merging the audited product PR.
- Rewriting historical canonical audit bundles.
- Inferring a precise story window when the caller provides neither `--window-start` nor
  `--window-end`.
