---
story_id: story-vibepro-agent-review-lifecycle-control
title: VibePro should manage subagent review lifecycle without freezing sessions
architecture_docs:
  - docs/architecture/vibepro-agent-review-lifecycle-control.md
spec_docs:
  - docs/specs/vibepro-agent-review-lifecycle-control.md
---

# Story: VibePro should manage subagent review lifecycle without freezing sessions

## 背景

Agent Review Gate はVibeProの品質を上げる一方で、Codex / Claude Code のsubagent reviewが戻らない、閉じ忘れる、差し替え判断が曖昧になると、親セッションがフリーズしたように見える。

VibeProはsubagent runnerではないが、レビュー開始・timeout・close・replacementを証跡化し、次に取るべき操作を明示する必要がある。

## 受け入れ基準

- `vibepro review start` でrole単位のsubagent dispatch開始を記録できる。
- `vibepro review close` でsubagentのclose/shutdownを記録できる。
- `vibepro review status` がrunning / timed_out / closed / replaced を表示できる。
- timeoutしたsubagentがある場合、status / PR Gate が close and replace を次アクションとして示す。
- `review record --agent-closed` 時に該当lifecycleをclosedとして更新できる。
- review prepare のdispatch guidanceにtimeout / replacement policyが入る。
- 既存のreview prepare / record / status / PR Gate互換を壊さない。
