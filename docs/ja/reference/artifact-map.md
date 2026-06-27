# 生成物の対応表

VibeProはreview可能な証跡を `.vibepro/` に保存します。

| Path | 目的 |
| --- | --- |
| `.vibepro/graphify/` | 取り込んだGraphify graphとreport |
| `.vibepro/pr/<story-id>/pr-prepare.json` | PR readinessの機械可読な正本 |
| `.vibepro/pr/<story-id>/pr-body.md` | 簡潔なGitHub PR本文案 |
| `.vibepro/pr/<story-id>/gate-dag.html` | Gate依存グラフ |
| `.vibepro/pr/<story-id>/review-cockpit.html` | 人間レビュー用cockpit |
| `.vibepro/pr/<story-id>/split-plan.html` | PR分割とmerge order計画 |
| `.vibepro/reviews/` | Agent review lifecycleと結果 |
| `.vibepro/verification-artifacts/` | 検証とCI証跡 |
| `.vibepro/executions/` | managed executionとmerge監査状態 |

## `pr_context`

`pr-prepare.json` には `pr_context` が入ります。

重要なfield:

- `graph_context`: Graphify artifactがある場合のimpact scope
- `code_topology_context`: 任意の `codebase-memory-mcp` topology文脈
- `code_topology_context.available`: provider結果が現在の変更ファイルに使える形で一致したか
- `code_topology_context.reason`: providerがavailable、unavailable、unmatchedになった理由
- `code_topology_context.investigation_files`: review時に読む候補の関連ファイル
- `code_topology_context.signals`: Engineering Judgmentの補助証跡として使う `code_topology:*` activation signal

これらは監査文脈です。必要な証明は、test、replay、inspection、CI、review、明示的なdecisionから来ます。
