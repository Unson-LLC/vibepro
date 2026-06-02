---
story_id: story-vibepro-oss-engineering-judgment-pr-message
title: OSS向けEngineering Judgment PRメッセージ
status: active
architecture_docs:
  - ../../../architecture/vibepro-oss-engineering-judgment-pr-message.md
specs:
  - ../../../specs/vibepro-oss-engineering-judgment-pr-message.md
---

# OSS向けEngineering Judgment PRメッセージ

## 背景

VibeProのPR本文はEngineering Judgment DAGを表示できるが、route名とDAG名だけでは、VibeProの内部を知らないOSSレビュアーが「なぜその判断になったのか」を追いにくい。

PR本文は、内部分類の説明ではなく、優れたエンジニアが変更を読むときの判断過程を開示する必要がある。すなわち、何を入力として見たか、どのシグナルからどのDAGを選んだか、そのDAGが何を確認させたか、どの証跡がマージ境界になるかを、最初のレビュー画面で読めるようにする。

## 目的

`vibepro pr prepare` が生成するPR本文で、Engineering Judgment DAGをOSSレビュアー向けの判断過程として表現する。

## 受け入れ基準

- PR本文の上部に `Engineering Judgment の判断過程` が出る
- 判断過程は、判断した入力、判断シグナル、選んだDAGが要求した確認、証跡とマージ境界を分けて表示する
- route名やDAG名だけでなく、なぜそのrouteを選んだかをシグナルの説明で表示する
- route-specific judgment gates の理由が、人間のレビュー観点として読める
- 必須Gateの状態と未解決Gateが、マージ判断の境界として表示される
- 既存の `判断グラフ` と監査ログは残り、詳細確認できる
