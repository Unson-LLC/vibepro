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

## Review Status Focus

`vibepro review status` はPR作成を止めている current required role を最初に表示する。PR Gateの正本は最新の `pr prepare` が生成した Agent Review summary であり、status command側で別のrequired判定を作らない。

通常表示は次を優先する。

1. 次に実行すべき `review prepare` / `review record` / `pr prepare`
2. PR-final required roleのblocking summary
3. current required role一覧

Optional role、古いstage、closed/replaced lifecycle、staleな監査履歴は `--all` または `--history` で表示する。JSONは互換の `stages` を維持しつつ、`required_current`、`optional`、`history`、`blocking_summary` を分ける。
