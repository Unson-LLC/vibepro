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

- [x] `vibepro execute start <repo> --story-id <id>` は、設定が `required` または `preferred` の場合にVibePro管理worktreeを作成または再利用する
- [x] 管理worktreeのstateには `story_id`, `base_ref`, `branch`, `path`, `created_from_sha`, `current_head_sha`, `status` が保存される
- [x] Execution DAGには `worktree_created`, `branch_bound`, `verification_recorded`, `agent_review_recorded`, `pr_prepare_ready`, `pr_created` が含まれる
- [x] workflow state transition scenarioとして、`missing` または `created` の管理worktreeから `branch_bound`, `head_bound`, `verification_recorded`, `agent_review_recorded`, `pr_prepare_ready`, `pr_created` へ進む状態遷移を明示し、E2E証跡で再生できる
- [x] workflow-heavy gateの既存Flow Verification経路では、`BASIC_AUTH_USER && BASIC_AUTH_PASSWORD` は環境変数由来の一時認証情報として扱い、平文を保存せず既存の認証env処理を維持する
- [x] 既存のworktree非対応リポジトリ、CI、一時checkout、OSS利用者向けに互換モードの回帰テストがある

## MVP優先順位

このStoryは最終的にmerge/cleanupまで扱うが、最初の実装単位は「管理worktreeで作業が始まったか」を証跡化することに絞る。

1. `execute start` が管理worktreeを作成または再利用し、stateにpath/branch/base/headを保存する
2. `execute status/next/reconcile` が管理worktree状態と次アクションを返す
3. `verify record` / `review record` / `pr prepare` / `pr create` がstateの管理worktreeと現在cwdの一致を検証できる
4. `preferred` modeでは警告のみ、`required` modeでは拒否する
5. その後に `execute merge` と `execute cleanup` を追加する

初回リリースでは `preferred` を安全な導入モードにし、VibePro自身のself-dogfood設定で `required` を検証する。

## 後続Story候補

- `managed_worktree=required` では、VibePro管理worktree外からの `task execute`, `verify record`, `review record`, `pr prepare`, `pr create`, `execute merge` を拒否する
- `managed_worktree=preferred` では、管理worktree外の実行を許可するが Gate DAG / PR body / execution state に `gate:managed_worktree` の警告または `needs_review` を残す
- `managed_worktree=disabled` では従来互換として管理worktree強制を行わない
- `pr prepare` はverification/review/evidenceが同じ管理worktreeのHEADとdirty fingerprintに束縛されているかを確認する
- `execute merge` はPR URL、CI状態、required review、base freshness、Gate DAG、未push commit、dirty状態を確認し、条件未達ならmergeを拒否する
- mergeまたはclose後、`execute cleanup` が管理worktreeを安全に削除し、未cleanup状態をExecution DAGに残す
- emergency bypassは設定または明示フラグで可能だが、理由、実行者、対象command、timestampをdecision recordとして残す
