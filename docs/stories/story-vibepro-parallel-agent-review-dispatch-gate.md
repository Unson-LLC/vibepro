---
story_id: story-vibepro-parallel-agent-review-dispatch-gate
title: 並列サブエージェントレビュー指示とGate連携
view: dev
period: 2026-05
architecture_docs:
  reason: 既存Agent Review Gateの運用導線強化であり、runner実行基盤を追加しないため
---

# 並列サブエージェントレビュー指示とGate連携

## 背景

VibeProには `review prepare` / `review record` / `gate:agent_review` があり、レビュー結果をPR Gateで必須化できる。

一方で、実運用では「サブエージェントを並列でレビューさせる」具体的な指示導線が弱く、レビューGateがあっても人間やCoordinatorがどの単位で何を並列依頼すべきか迷う。

runnerは不要。VibeProがサブエージェントを直接起動するのではなく、Coordinatorがそのまま並列投入できるrole別プロンプトと記録コマンドを生成し、それをGateに接続する。

追加の実運用課題として、`gate:agent_review` が `needs_review` を出していても、Coordinatorがそれを「任意のレビュー残り」と解釈して `vibepro review prepare` / 並列dispatch / `review record` を実行しないケースがあった。VibeProはrunnerにはならないが、Agent Review Gateが出た時点で「明示的な並列サブエージェントレビュー実行指示」として読める出力にする必要がある。

## 方針

- `vibepro review prepare` は stage 内のroleごとにレビュー依頼を生成する。
- さらに `parallel-dispatch.md` を生成し、Coordinatorがサブエージェントを並列起動できる形にする。
- 各roleには対応する `vibepro review record` コマンドを明示する。
- `vibepro pr prepare` の Agent Review Gate は、未記録・stale・blockのreviewを止めるだけでなく、parallel dispatch導線もJSON/PR本文に出す。
- `gate-dag.json/html` では `review:prepare:<stage>`、`review:<stage>:<role>`、`review:record:<stage>:<role>` を独立Gateノードとして表示し、並列レビュー実行と記録完了がPR前のDAG上で見えるようにする。
- `gate_status.agent_review_instruction` と `next_required_actions` に、Coordinatorが次に実行する `review prepare` / dispatch / `review record` / `pr prepare` の手順を出す。
- Claude Code向けSkillsとCodex向けAGENTS instructionsの両方で、Agent Review Gate未解決時は明示的な並列サブエージェントレビュー指示として扱う。
- `review record` には Codex / Claude Code のサブエージェント provenance を残し、手入力 `pass` と実際の並列サブエージェントレビューを区別する。
- VibeProはrunnerではなく、レビュー依頼・記録・Gate判定の制御基盤に徹する。

## 受け入れ基準

- [x] `review prepare` が `parallel-dispatch.md` を生成する
- [x] `review-plan.json` に `parallel_dispatch` とrole別 `record_commands` が入る
- [x] role別 review request に、Coordinatorが使う `review record` コマンドが入る
- [x] Agent Review Gateに `parallel_dispatch` が入り、未充足時のreasonがparallel dispatchを案内する
- [x] Gate DAGに review prepare / role review / review record のノードと依存edgeが出る
- [x] Agent Review Gateは引き続き、現在のgit状態に紐づいたreview recordがpassになるまでPRを止める
- [x] `pr prepare` の `gate_status.agent_review_instruction` が、Agent Review Gateを任意ではなく必須の並列サブエージェントレビュー指示として表示する
- [x] `gate_status.next_required_actions` が `vibepro review prepare` と `parallel-dispatch.md` を含む次アクションを表示する
- [x] bundled Claude Code skills と Codex AGENTS instructions が、Agent Review Gate未解決時の prepare / dispatch / record / rerun 手順を明文化する
- [x] `review record` は Codex / Claude Code のサブエージェント provenance を記録できる
- [x] provenance のない `pass` は監査証跡には残るが、`gate:agent_review` を通さない
- [x] Codex は `--agent-system codex`、Claude Code は `--agent-system claude_code` で同じschemaに記録できる
