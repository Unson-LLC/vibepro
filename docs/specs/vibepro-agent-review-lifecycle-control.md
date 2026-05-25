---
story_id: story-vibepro-agent-review-lifecycle-control
title: VibePro Agent Review Lifecycle Control Spec
---

# Spec

## Required Behavior

- `vibepro review start . --id <story-id> --stage <stage> --role <role> --agent-system codex|claude_code --agent-id <id>` records a lifecycle entry.
- Lifecycle entries are stored at `.vibepro/reviews/<story-id>/<stage>/lifecycle.json`.
- Each entry includes `role`, `agent_id`, `system`, `status`, `started_at`, `timeout_ms`, `closed_at`, `close_reason`, and replacement metadata.
- `vibepro review close` marks the matching lifecycle entry as `closed` or `replaced`.
- `vibepro review status` includes lifecycle totals and role-level lifecycle status.
- Running lifecycle entries older than `timeout_ms` are reported as `timed_out` without mutating historical start evidence.
- A timed-out role must not be treated as pass; status must recommend close and replacement.
- `review record --agent-closed` updates the matching lifecycle entry to `closed` when agent id/system/role match.

## Invariants

- `INV-LIFE-1`: VibePro never claims to execute subagents. It records and gates coordinator-managed subagent lifecycle.
- `INV-LIFE-2`: A running or timed-out subagent must be visible in status output and cannot be silently ignored.
- `INV-LIFE-3`: Replacement is explicit evidence, not an overwrite of the original timed-out lifecycle.
- `INV-LIFE-4`: Existing review result provenance remains the source of pass/fail truth.
- `INV-LIFE-5`: Lifecycle state must be valid JSON and written atomically.

## Non Goals

- VibePro does not spawn Codex or Claude Code subagents by itself.
- VibePro does not kill external processes directly.
