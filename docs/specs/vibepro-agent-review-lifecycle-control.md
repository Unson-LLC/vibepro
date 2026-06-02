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
- `vibepro review status` default text output shows next commands and current required blocking roles before optional/history information.
- `vibepro review status --json` includes `required_current`, `optional`, `history`, and `blocking_summary` while preserving the existing `stages` array.
- `blocking_summary.items` uses the same required PR-final Agent Review roles as the latest `vibepro pr prepare` artifacts when they exist.
- A `vibepro pr prepare` artifact is current only when its recorded `git.head_sha` matches the `review status` current git HEAD.
- If the latest `pr prepare` artifact is missing or stale, `review status` must not use its `pr_context.agent_reviews.required_reviews` or `unmet_required_reviews` as current PR-final truth; it must fall back to configured required review roles, expose `pr_prepare_freshness`, and recommend rerunning `vibepro pr prepare`.
- Optional roles, non-current stages, closed/replaced lifecycle entries, and audit-only stale results are hidden from default text output and are shown with `--all` or `--history`.
- `blocking_summary.next_commands` contains one to three commands and favors `review prepare`, `review record`, and rerunning `pr prepare`.

## Invariants

- `INV-LIFE-1`: VibePro never claims to execute subagents. It records and gates coordinator-managed subagent lifecycle.
- `INV-LIFE-2`: A running or timed-out subagent must be visible in status output and cannot be silently ignored.
- `INV-LIFE-3`: Replacement is explicit evidence, not an overwrite of the original timed-out lifecycle.
- `INV-LIFE-4`: Existing review result provenance remains the source of pass/fail truth.
- `INV-LIFE-5`: Lifecycle state must be valid JSON and written atomically.
- `INV-LIFE-6`: Review status must not invent a separate PR readiness truth; current blocking roles come from the latest PR prepare Agent Review requirement summary when available.
- `INV-LIFE-7`: A stale PR prepare artifact is audit evidence only; it cannot define the current required review set after HEAD changes.

## Non Goals

- VibePro does not spawn Codex or Claude Code subagents by itself.
- VibePro does not kill external processes directly.
