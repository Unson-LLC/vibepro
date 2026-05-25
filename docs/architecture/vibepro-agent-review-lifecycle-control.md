---
story_id: story-vibepro-agent-review-lifecycle-control
title: VibePro Agent Review Lifecycle Control Architecture
---

# Architecture

## Decision

Add a lifecycle ledger next to existing Agent Review artifacts:

`.vibepro/reviews/<story-id>/<stage>/lifecycle.json`

This ledger is separate from review result artifacts. A review result says what the subagent concluded. A lifecycle entry says whether the coordinator started, timed out, closed, or replaced the subagent session.

## State Model

Lifecycle entry statuses:

- `running`
- `timed_out`
- `closed`
- `replaced`

`timed_out` is derived from `started_at + timeout_ms` at read time. It does not rewrite `started_at`.

## Commands

- `review start` records a dispatch.
- `review close` records closure or replacement.
- `review status` summarizes lifecycle and returns next actions.
- `review record --agent-closed` opportunistically closes matching lifecycle entries.

## Gate Integration

Agent Review Gate continues to require valid review results. Lifecycle state adds operational guardrails:

- running entries are visible;
- timed-out entries produce close/replace guidance;
- closed evidence is auditable;
- replacement does not erase the original stuck subagent.
