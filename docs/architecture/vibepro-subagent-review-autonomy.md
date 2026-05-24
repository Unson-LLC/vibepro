---
story_id: story-vibepro-subagent-review-autonomy
title: Subagent Review Autonomy Architecture
---

# Architecture

Agent Review Gateは、VibePro CLIがsubagentを直接起動する機能ではなく、Coordinatorに渡す実行契約として扱う。

`review prepare` は roleごとのrequestと `parallel-dispatch.md` を生成する。Coordinator runtimeがCodex/Claude Code subagentを使える場合は、そのartifactを読んで並列dispatchし、`review record --execution-mode parallel_subagent` で証跡を戻す。

レビュー用subagentは、結果を受け取ったあと、`review record` の前にclose/shutdownする。VibeProは外部runtimeのsubagentを直接終了させるrunnerではないが、required Agent Review Gateのpass条件として `--agent-closed` lifecycle証跡を要求し、閉じ忘れを `unverified_agent` として扱う。

## Decisions

- VibePro自体はsubagent runnerを内蔵しない。
- Gate文言は「ユーザー許可待ち」ではなく「dispatch required」として出す。
- `manual_review` は記録可能だが required Agent Review Gate のpass条件にはしない。
- `parallel_subagent` は、subagent相関証跡とclose済みlifecycle証跡がそろって初めて required Agent Review Gate のpass条件を満たす。
