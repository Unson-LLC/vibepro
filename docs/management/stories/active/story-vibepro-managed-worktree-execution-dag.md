---
story_id: story-vibepro-managed-worktree-execution-dag
title: "VibePro管理worktreeのExecution DAGで開発からmergeまで隔離する"
architecture_docs:
  - docs/architecture/vibepro-managed-worktree-execution-dag.md
spec_docs:
  - docs/specs/vibepro-managed-worktree-execution-dag.md
status: active
created_at: 2026-06-02
updated_at: 2026-06-02
---

# Story: VibePro管理worktreeのExecution DAGで開発からmergeまで隔離する

## ユーザーストーリー

- ユーザー: VibeProでAI支援開発を進める人
- したいこと: VibeProにStoryごとの管理worktreeを作成させ、そのworktree内で実装、検証、PR作成、merge、cleanupまでをExecution DAGとして管理したい
- 目的: ルートcheckoutのdirty fileや別Storyの差分がPR対象・Gate証跡・merge判断へ混ざらず、最後まで監査可能な開発経路を強制できる

## 背景

現在のVibeProは Gate DAG、checkpoint、execution state、PR prepare/create、dirty worktree検出を持っている。一方で、開発作業そのものをVibePro管理worktreeへ隔離し、同じDAGでPR作成後のmerge/cleanupまで追跡する制御面はない。

このため、AIエージェントが既存checkoutで作業した場合、未関係dirty、staged diff、生成物、別Storyの変更がPR scopeやverification evidenceへ混ざるリスクが残る。VibeProの通常開発では、管理worktreeをデフォルト経路にし、例外は明示設定とwaiver証跡で扱う必要がある。

## 受け入れ基準

- [ ] `vibepro execute start <repo> --story-id <id>` は、設定が `required` または `preferred` の場合にVibePro管理worktreeを作成または再利用する
- [ ] 管理worktreeのstateには `execution_id`, `story_id`, `base_ref`, `branch`, `worktree_path`, `created_from_sha`, `head_sha`, `status`, `dag_nodes` が保存される
- [ ] Execution DAGには `worktree_created`, `branch_bound`, `implementation_started`, `implementation_complete`, `verification_recorded`, `pr_prepare_ready`, `pr_created`, `merge_ready`, `merged_or_closed`, `worktree_cleaned` が含まれる
- [ ] `managed_worktree=required` では、VibePro管理worktree外からの `task execute`, `verify record`, `review record`, `pr prepare`, `pr create`, `execute merge` を拒否する
- [ ] `managed_worktree=preferred` では、管理worktree外の実行を許可するが Gate DAG / PR body / execution state に `gate:managed_worktree` の警告または `needs_review` を残す
- [ ] `managed_worktree=disabled` では従来互換として管理worktree強制を行わない
- [ ] `pr prepare` はverification/review/evidenceが同じ管理worktreeのHEADとdirty fingerprintに束縛されているかを確認する
- [ ] `execute merge` はPR URL、CI状態、required review、base freshness、Gate DAG、未push commit、dirty状態を確認し、条件未達ならmergeを拒否する
- [ ] mergeまたはclose後、`execute cleanup` が管理worktreeを安全に削除し、未cleanup状態をExecution DAGに残す
- [ ] emergency bypassは設定または明示フラグで可能だが、理由、実行者、対象command、timestampをdecision recordとして残す
- [ ] 既存のworktree非対応リポジトリ、CI、一時checkout、OSS利用者向けに互換モードの回帰テストがある

## 実装メモ

- 対象候補: `src/execution-state.js`, `src/cli.js`, `src/pr-manager.js`, `src/verification-evidence.js`, `src/agent-review.js`, `src/repo-status.js`
- 既存の `story-vibepro-execution-state-control` を拡張し、Execution Stateを単なる再開用viewからworktree-awareな制御DAGへ進化させる
- 既存の `story-vibepro-worktree-pr-scope-isolation` はPR scope混入対策、このStoryは開発環境隔離とmerge/cleanup制御を扱う
- デフォルト設定は `required` を目標にする。ただし導入リリースでは移行互換として `preferred` を一時デフォルトにする選択肢をSpecで明示する
