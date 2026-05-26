---
story_id: story-vibepro-human-reviewable-pr-body
title: PR本文を人間がマージ判断しやすい構造にする
status: active
architecture_docs:
  - ../../../architecture/vibepro-human-reviewable-pr-body.md
specs:
  - ../../../specs/vibepro-human-reviewable-pr-body.md
---

# PR本文を人間がマージ判断しやすい構造にする

## 背景

VibePro は Story / Spec / Gate / Agent Review の証跡を豊富に残せるが、PR本文の主役が証跡になりすぎると、人間レビュアーが最初に「何を判断すればよいか」を掴みにくい。

## 目的

PR本文の先頭で、このPRで決めたいこと、レビュー入口、スコープ外、検証済み項目、未解決Gateを判断できるようにする。
Gate DAG、Agent Review、split plan、実行メタデータは消さずに、初読の判断を邪魔しない監査ログとして後段に分離する。

## 受け入れ基準

- PR本文の先頭に「このPRで決めたいこと」が出る
- PR本文の先頭に「このPRで閉じる問い」が出る
- PR本文の上部にStory/正本/差分/証跡/分割判断を人間向けに圧縮した「判断グラフ」が出る
- GitHub remote が取得できる場合、判断グラフ内の正本・主要差分ファイルがGitHub上の該当ファイルリンクになる
- PR本文の上部に「変更内容」「なぜこの変更か」「レビューしてほしい観点」「検証」「リスク・確認事項」「明示的にやらないこと」が出る
- 差分が Runtime / Contract Docs / Capability Map / Tests などレビュアー向けに分類される
- 「明示的にやらないこと」が本文に出る
- Gate / Agent Review / split plan は監査ログとして後段にまとまる
- Gate evidence が pass の検証コマンドは `[x]` として表示される
- 未解決Gateや `needs_clean_branch` は機械的警告だけでなく、人間向けの判断文として表示される
- PR本文の上部には Gate DAG、Agent Review、Explore Evidence、split plan、runtime などの詳細監査ログを出さない
- `needs_clean_branch` などの内部ステータスは、上部では「差分範囲の説明または分割判断が必要」のような判断文に変換される
