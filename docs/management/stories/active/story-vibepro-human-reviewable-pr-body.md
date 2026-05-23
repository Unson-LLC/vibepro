---
story_id: story-vibepro-human-reviewable-pr-body
title: PR本文を人間がマージ判断しやすい構造にする
status: active
---

# PR本文を人間がマージ判断しやすい構造にする

## 背景

VibePro は Story / Spec / Gate / Agent Review の証跡を豊富に残せるが、PR本文の主役が証跡になりすぎると、人間レビュアーが最初に「何を判断すればよいか」を掴みにくい。

## 目的

PR本文の先頭で、このPRで決めたいこと、レビュー入口、スコープ外、検証済み項目、未解決Gateを判断できるようにする。

## 受け入れ基準

- PR本文の先頭に「このPRで決めたいこと」が出る
- 差分が Runtime / Contract Docs / Capability Map / Tests などレビュアー向けに分類される
- 「明示的にやらないこと」が本文に出る
- Gate / Agent Review / split plan は監査ログとして後段にまとまる
- Gate evidence が pass の検証コマンドは `[x]` として表示される
- 未解決Gateや `needs_clean_branch` は機械的警告だけでなく、人間向けの判断文として表示される
