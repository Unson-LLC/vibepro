---
story_id: story-vibepro-pr-freshness-gate-dag
title: PR作成前にmain最新化とprepare再生成をDAG Gate化する
view: dev
period: 2026-05
architecture_docs:
  - ../../architecture/vibepro-pr-freshness-gate-dag.md
spec_docs:
  - ../../specs/vibepro-pr-freshness-gate-dag.md
status: active
created_at: 2026-05-26
updated_at: 2026-05-26
---

# PR作成前にmain最新化とprepare再生成をDAG Gate化する

## 背景

VibeProのPR本文、Gate DAG、verification evidence、Agent Reviewは現在HEADとbase refに依存する生成物である。PR作成直前に `origin/main` が進んでいると、古いPR body rendererや古い差分分類でPRが作られ、人間レビューに必要な最新ルールが反映されない。

## 方針

- `vibepro pr prepare/create` はPR branchが現在のbase refを含んでいるかをGate DAGで明示する。
- base refがHEADの祖先でない場合は `gate:pr_freshness` を `needs_rebase` にする。
- `needs_rebase` はcritical gateとしてPR作成を止める。
- pass条件は、fetch済みのbase refをfeature branchが含み、その状態で `pr prepare` が再生成されていること。

## 受け入れ基準

- [ ] `gate-dag.json` に `gate:pr_freshness` が出る
- [ ] feature branchがbase refを含む場合、`gate:pr_freshness` は `passed`
- [ ] base refが進み、feature branchが含まない場合、`gate:pr_freshness` は `needs_rebase`
- [ ] `needs_rebase` はcritical unresolved gateとしてPR createを止める
- [ ] required actionに `git fetch origin`, rebase, verification再記録, `vibepro pr prepare` 再実行が出る
- [ ] 既存のUnit/Integration/Agent Review gateと併存する
