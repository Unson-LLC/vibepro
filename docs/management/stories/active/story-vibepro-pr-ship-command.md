---
story_id: story-vibepro-pr-ship-command
title: "VibePro PR shipコマンドでGate解消からPR作成までを一本道にする"
source:
  type: local-analysis
  id: VP-VALUE-003
  title: "強いGateがあるが、利用者が正しいコマンド列を手で踏む必要がある"
architecture_docs:
  - docs/architecture/vibepro-pr-ship-command.md
spec_docs:
  - docs/specs/vibepro-pr-ship-command.md
status: active
created_at: 2026-06-02
updated_at: 2026-06-02
---

# Story: VibePro PR shipコマンドでGate解消からPR作成までを一本道にする

## ユーザーストーリー

- ユーザー: VibeProでAI支援実装をPRまで進める人
- したいこと: `verify`, `review`, `pr prepare`, `pr create` の次に何をすべきかをVibeProに一本道で案内・実行してほしい
- 目的: Gateは強いのに、コマンド順序のミスや raw `gh pr create` への回避で価値が落ちることを防ぐ

## 背景

現状のVibeProは `execute next` で次アクションを返せるが、実際の運用では複数コマンドを人間またはエージェントが手でつなぐ。ログ上も、Agent Review後に `review status` / `pr prepare` / `pr create` を繰り返す必要があり、摩擦が高い。

## 受け入れ基準

- [x] `vibepro pr ship <repo> --story-id <id> --base <ref> --head <branch>` を追加する、または `vibepro execute next --run-safe` として同等機能を提供する
- [x] 安全に自動実行できる操作は実行し、subagent dispatch、waiver、mergeなど明示判断が必要な操作は止めて理由と次コマンドを出す
- [x] `pr ship` は必ず `pr prepare` を再実行し、最新Gate DAGを正にする
- [x] required Agent Reviewが未完了なら、必要な `review prepare` / `review start` / `review record` 手順をまとめて表示する
- [x] readyになった場合のみ `vibepro pr create` に進む
- [x] raw `gh pr create` は候補コマンドに出さない
- [x] `--dry-run` では実行予定の安全操作・停止理由・必要な人間判断をJSONで返す

## 実装メモ

- 対象候補: `src/cli.js`, `src/execution-state.js`, `src/pr-manager.js`, `src/agent-review.js`
- MVPでは `pr prepare` と `execute next` の結果を統合するだけでよい
- subagent実行そのものはVibeProが担わず、dispatch instructionsとrecord commandsをまとめる
