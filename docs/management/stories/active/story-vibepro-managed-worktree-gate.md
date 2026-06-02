---
story_id: story-vibepro-managed-worktree-gate
title: "VibePro管理worktree外の実行をGate DAGで可視化・制御する"
source:
  type: local-analysis
  id: VP-VALUE-002
  title: "Gateは強いが、作業経路が管理worktreeだったかはまだPR判断に入っていない"
architecture_docs:
  - docs/architecture/vibepro-managed-worktree-gate.md
spec_docs:
  - docs/specs/vibepro-managed-worktree-gate.md
status: active
created_at: 2026-06-02
updated_at: 2026-06-02
---

# Story: VibePro管理worktree外の実行をGate DAGで可視化・制御する

## ユーザーストーリー

- ユーザー: VibeProでPR作成前の安全性を確認する人
- したいこと: VibePro管理worktree内で実行された検証・レビュー・PR準備かをGate DAGで見たい
- 目的: 既存checkoutのdirty file、別Storyの差分、古いHEADの証跡が安全なPR判断として扱われることを防ぐ

## 背景

現状の `pr create` はdirty fileとGate DAGを強く検査するが、証跡がVibePro管理worktree内で作られたかまでは制御していない。管理worktreeを導入しても、Gate DAGに出なければ人間のPR判断では見落としやすい。

## 受け入れ基準

- [x] `pr prepare` のGate DAGに `gate:managed_worktree` が出る
- [x] `execution.managed_worktree=required` では、管理worktree外の `verify record`, `review record`, `pr prepare`, `pr create` をblocking扱いにする
- [x] `execution.managed_worktree=preferred` では、管理worktree外の実行を `needs_review` としてPR body / Gate DAG / execution stateに表示する
- [x] `execution.managed_worktree=disabled` では `gate:managed_worktree` を `not_applicable` または省略する
- [x] emergency bypassには理由が必要で、decision recordとして保存される
- [x] PR body上部に「管理worktree: passed / needs_review / bypassed / disabled」が表示される
- [x] 既存の非worktree運用は `preferred` または `disabled` で回帰しない

## 実装メモ

- 対象候補: `src/pr-manager.js`, `src/execution-state.js`, `src/workspace.js`, `src/verification-evidence.js`, `src/agent-review.js`
- Gate DAGの正本は既存の `buildGateDag` に統合し、Execution DAGと二重判定にしない
- `gate:managed_worktree` はPR readinessの前提条件であり、実装品質そのものの評価ではない
