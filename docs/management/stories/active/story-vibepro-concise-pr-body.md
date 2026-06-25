---
story_id: story-vibepro-concise-pr-body
title: GitHub PR本文を1画面の判断ブリーフに絞る
status: active
source:
  type: github_issue
  id: 227
architecture_docs:
  - docs/architecture/vibepro-concise-pr-body.md
spec_docs:
  - docs/specs/vibepro-concise-pr-body.md
---

# Story: GitHub PR本文を1画面の判断ブリーフに絞る

## Background

`vibepro pr create` が生成するPR本文は、Gate DAG / Agent Review / split-plan / 実行メタデータを詳細展開し、GitHub本文上限とLLM文脈の両方を圧迫している。Issue #227 では `pr-body.md` が 84KB になり、GitHub GraphQL の本文上限でPR作成が失敗した。

PR本文は監査ログの保管場所ではなく、人間がマージ判断を始めるための入口である。詳細証跡は `.vibepro/pr/<story-id>/` に残し、GitHub本文には短い判断ブリーフと証跡参照だけを載せる。

## Acceptance Criteria

- PR本文は `What`, `Why`, `How to review`, `Verification`, `VibePro` の短い構造で生成される。
- GitHub本文には Gate DAG / Agent Review / split-plan / 実行メタデータの詳細全文を展開しない。
- `VibePro` セクションには Gate状態、Execution状態、Scope、`.vibepro/pr/<story-id>/` 配下の主要artifact参照が残る。
- `check self-dogfood` は詳細Gate見出しではなく、短い判断ブリーフ、Verification、`.vibepro` 証跡参照をVibePro本文の条件として扱う。
- 既存の `.vibepro/pr/<story-id>/` artifact生成、Gate DAG判定、Agent Review判定、PR作成経路は維持される。

## Non-goals

- Gate DAGやAgent Reviewの生成を削除しない。
- Gate未完了をPR本文短縮で隠さない。
- GitHub本文内に全文監査ログを残す互換性を維持しない。
