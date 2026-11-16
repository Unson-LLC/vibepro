---
story_id: story-vibepro-release-safety-case-study
title: 誤ったリリースを公開前に止めた事例をVitePressで公開する
status: active
view: dev
period: 2026-08
category: product
artifact_profile: feature_packet
feature_slug: release-safety-case-study
architecture_docs:
  - ../../../architecture/story-vibepro-release-safety-case-study.md
spec_docs:
  - ../../../specs/story-vibepro-release-safety-case-study.md
parent_design: vibepro-release-safety-case-study
source:
  type: operator_request
  title: "VibeProのマーケティングに使えるリリース安全事例を保存する"
reason: "alternatives considered: (a) docs/marketingへの内部メモだけではVitePressの公開対象外となり利用者へ届かず、(b)一般的な機能紹介では今回の判断過程と実測を失うため退け、(c)日本語の公開ケーススタディとして事実・VibeProの寄与・限界を分けて掲載する。compatibility impact: 日本語VitePressのページとナビゲーションを追加するだけで、CLI、Gate、release workflow、既存URLは変更しない。rollback plan: 新規ページとナビゲーション項目を取り除けば公開面を元に戻せる。boundary and scope: PR #450から#452と公開workflowで確認できた事実、日本語ケースページ、VitePress導線、公開面の回帰テストに限定し、英語版、製品コード変更、再リリース、成果効果の一般化は含めない。"
created_at: 2026-08-11
updated_at: 2026-08-11
---

# 誤ったリリースを公開前に止めた事例をVitePressで公開する

## 背景

Issue #449の修正をnpmへ届ける作業中、beta版のGitHub Releaseが通常版として扱われる既存不具合が見つかった。公開を止めて修正した後、独立レビューで最初の修正案に別の回帰リスクも見つかり、再修正してから`0.2.0-beta.6`を公開した。

この経緯は、VibeProの価値を機能一覧より具体的に説明できる。一方で、VibePro自身が不具合を自動検出したと誤読させず、工程とエージェントの判断がどう組み合わさったかを事実に沿って示す必要がある。

## User Story

**As a** AIエージェントによる開発の安全性を評価する開発者や責任者

**I want** 実際のリリースで何を発見し、なぜ止め、どう直したかを確認したい

**So that** VibeProが速さだけでなく、誤った公開判断を止める工程として役立つかを判断できる

## Acceptance Criteria

- [x] RSCS-1: 日本語VitePressに、PR #450から#452と公開workflowを根拠にしたケーススタディが公開対象として追加される。
- [x] RSCS-2: 本文は確認済みの時刻・変更・公開結果と、VibeProの寄与に関する解釈を混同しない。
- [x] RSCS-3: 「VibeProが自動検出した」と主張せず、工程が発見・停止判断・独立レビューを再現可能にした範囲を説明する。
- [x] RSCS-4: 日本語ナビゲーションから事例ページへ到達でき、VitePressの公開ビルドにページが含まれる。
- [x] RSCS-5: ページ、ナビゲーション、根拠リンク、誇張防止表現を対象にした回帰テストとVitePressビルドが成功する。

## 対象外

- 英語版ケーススタディ
- VibeProの製品コード、Gate、レビュー方式、公開workflowの変更
- 今回の一例から、VibePro利用時の一般的な不具合削減率や開発速度を推定すること
- `0.2.0-beta.6`の再公開
