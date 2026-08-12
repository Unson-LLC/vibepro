---
story_id: story-vibepro-anonymized-value-cases
title: 実運用で価値が出た4件を匿名事例として公開する
status: active
view: dev
period: 2026-08
category: product
artifact_profile: feature_packet
feature_slug: anonymized-value-cases
architecture_docs:
  - ../../../architecture/story-vibepro-anonymized-value-cases.md
spec_docs:
  - ../../../features/anonymized-value-cases/02_functional_spec.md
parent_design: vibepro-anonymized-value-cases
source:
  type: operator_request
  title: "既存のGit、PR、ローカル実行記録を基に、実際の価値が出た例を匿名化してケース化する"
reason: "alternatives considered: (a)実名と公開PRをそのまま載せる案は取引先や運用対象を推測できるため退け、(b)抽象的な機能紹介だけにする案は実際に起きた失敗と判断を失うため退け、(c)業種、社名、製品名、リポジトリ、URL、日付、固有の件数を外し、問題、介入、確認結果、主張の限界を残した匿名事例として公開する。compatibility impact: 日本語VitePressの事例ページとナビゲーションを追加し、言語切替の404を避ける英語案内ページだけを置く。CLI、Gate、既存の事例URLは変更しない。rollback plan: 新規の事例一覧、匿名事例4ページ、英語案内ページ、ナビゲーション変更、専用テストを戻せば従来の公開面へ戻せる。boundary and scope: 前ターンでGit、PR、Story、Spec、Codexローカル記録を照合した4件の匿名要約に限定し、実名、原典リンク、顧客成果の一般化、売上や工数削減の推定は含めない。"
created_at: 2026-08-11
updated_at: 2026-08-11
---

# 実運用で価値が出た4件を匿名事例として公開する

## 背景

VibeProの公開事例は、VibePro自身のリリースを安全にした一件だけだった。ほかのリポジトリには、根拠不足の回答を止める、処理完了前の誤判断を止める、大量更新の対象を安定させる、再起動後も実行結果を失わない、という実装と検証の記録が残っている。

これらはVibeProの使い道を説明できる一方、実名、業種、製品名、公開PR、固有の数値を組み合わせると運用主体を推測できる。公開ページでは識別情報を外し、何が起き、何を変え、どこまで確認できたかだけを残す。

## User Story

**As a** AIエージェントを実運用へ入れる開発者や責任者

**I want** VibeProを使った実際の変更を、関係者を特定できない形で読みたい

**So that** 機能一覧ではなく、失敗を止めた場面から導入価値を判断できる

## Acceptance Criteria

- [x] AVC-1: 日本語VitePressに匿名事例の一覧と4件の詳細ページが追加される。
- [x] AVC-2: 匿名事例4ページから社名、製品名、リポジトリ名、PR番号、原典URL、日付、固有の件数を除く。
- [x] AVC-3: 各事例は「起きていたこと」「変更」「VibeProの寄与」「確認できたこと」「まだ言えないこと」を分ける。
- [x] AVC-4: 顧客成果、売上、工数削減、不具合削減率を推定せず、実装、検証、マージ、一部の本番反映という確認境界を明記する。
- [x] AVC-5: 日本語ナビゲーションの「事例」から一覧へ入り、既存のリリース安全事例を含む全事例へ移動できる。各事例の言語切替先は、存在する英語案内ページを返す。
- [x] AVC-6: 匿名化禁止語、導線、構成、主張境界、内部Specの公開除外を対象にした回帰テストとVitePressビルドが成功する。

## 対象外

- 原典となった企業、サービス、リポジトリ、PRの公開
- 顧客への掲載許諾が必要な実名ケーススタディ
- 匿名事例本文の英訳（英語面は日本語版への案内だけを置く）
- VibeProの製品コード、Gate、レビュー方式の変更
- 導入効果の一般化や投資対効果の算出
