---
story_id: story-vibepro-subagent-review-autonomy
title: Subagent Review Autonomy Architecture
---

# Architecture

Agent Review Gateは、VibePro CLIがsubagentを直接起動する機能ではなく、Coordinatorに渡す実行契約として扱う。

`review prepare` は roleごとのrequestと `parallel-dispatch.md` を生成する。Coordinator runtimeがCodex/Claude Code subagentを使える場合は、そのartifactを読んで並列dispatchし、`review record --execution-mode parallel_subagent` で証跡を戻す。

## Decisions

- VibePro自体はsubagent runnerを内蔵しない。
- Gate文言は「ユーザー許可待ち」ではなく「dispatch required」として出す。
- `manual_review` は記録可能だが required Agent Review Gate のpass条件にはしない。
