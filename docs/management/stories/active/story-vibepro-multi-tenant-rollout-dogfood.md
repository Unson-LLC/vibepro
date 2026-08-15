---
story_id: story-vibepro-multi-tenant-rollout-dogfood
title: "マルチテナント契約をfixtureとdownstream例で段階検証する"
status: active
view: dev
period: 2026-08
category: product
artifact_profile: feature_packet
feature_slug: multi-tenant-rollout-dogfood
source:
  type: github_issue
  title: "Issue #466: Multi-tenant Architecture Contract"
  url: "https://github.com/Unson-LLC/vibepro/issues/466"
related_stories:
  - story-vibepro-multi-tenant-contract-applicability
  - story-vibepro-multi-tenant-evidence-scanners
  - story-vibepro-multi-tenant-architecture-review-views
  - story-vibepro-multi-tenant-enforcement-drift
architecture_docs:
  - docs/architecture/story-vibepro-multi-tenant-architecture-contract.md
spec_docs:
  - docs/specs/story-vibepro-multi-tenant-architecture-contract.md
reason: >-
  alternatives considered: pooled fixtureだけではdedicated/customer-managedの境界差を検証できないため、同一スキーマの3配備fixtureを用意する。compatibility impact: VibePro本体では自己dogfoodせず通常のテストとGitHubフローを使う。rollback plan: downstreamは契約採用を取りやめられ、VibeProの非適用Storyには影響しない。boundary: customer-managed構成の再現までを扱い、mana-runtime実環境のreadbackは別Issue/Storyへ分離する。
created_at: 2026-08-15
updated_at: 2026-08-15
---

# マルチテナント契約をfixtureとdownstream例で段階検証する

## User Story

**As a** VibeProのマルチテナント契約を運用へ導入する責任者
**I want** fixture結果を確認し、customer-managed/BYOC構成を表す同じ公開契約を再現できること
**So that** fixtureだけの成功や誤検知を製品完成とせず、安全に運用へ移せる

## 開始状況

- Issue #466の機能は、契約・検証・レビュー・PR証拠要約としてminimal-coreへ導入する。
- `mana-runtime`はcustomer-managed/BYOCの境界を確認するdownstream候補だが、VibePro側のfixture成功だけでは実運用証拠にならない。
- secret bindingや設定の存在だけではtenant resolution、接続、状態分離、監査証跡の成功を証明しない。

## Scope

- Phase 1でContract、docs、fixtureを導入する。
- Phase 2で契約検証とreview lensを運用し、誤検知、検査不能、判断必要件数を測る。
- Phase 3はdownstream利用者が通常のSpec検証として採用する。
- `mana-runtime`を模したcustomer-managed fixtureでtenant resolution、connection routing、credential scope、data ownerを再現する。
- downstreamで見つかった製品固有の修正は、VibeProのGate実装へ混ぜず別Story候補として記録する。

## Acceptance Criteria

- [ ] MTRD-AC-001: Phase 1/2/3の開始条件、停止条件、rollback条件、責任者が文書化される。
- [ ] MTRD-AC-002: advisory runで適用件数、pass、needs_review、inconclusive、false positive、false negative候補を別々に集計できる。
- [ ] MTRD-AC-003: non-applicable CLI/copy-only fixtureが`not_applicable`となり、追加errorが0件であることを確認する。
- [ ] MTRD-AC-004: shared、dedicated、customer-managedのpositive fixtureと全negative fixtureが同じ公開契約で再実行できる。
- [ ] MTRD-AC-005: customer-managed fixtureでContract作成から6ビュー、3 review lens、Spec判定までを再現できる。
- [ ] MTRD-AC-006: 実リポジトリへの適用は別Storyとして、tenant identity、接続先、credential scope、state partition、receiptを個別にreadbackする。
- [ ] MTRD-AC-007: HTTP成功、認証成功、secret binding設定済みだけをE2E成功として扱わない。
- [ ] MTRD-AC-008: 導入後も既存のSpec検証とPR準備の回帰テストが通る。
- [ ] MTRD-AC-009: 未確認・製品固有不具合・後続改善がVibePro完成へ丸められず、別Story候補またはblockerとして残る。

## 実装タスク

1. rollout policyとadvisory計測項目、昇格・停止条件を定義する。
2. 全fixtureを同じContract/schema versionで再実行する統合テストを作る。
3. advisory結果を記録し、誤検知と検査不能を分類する。
4. downstream採用時の開始・停止条件を文書化する。
5. `mana-runtime`への実適用は別Story候補として残す。
6. rollback rehearsalと既存Story回帰を実行し、未確認点を分離して完了判定する。

## Non Goals

- `mana-runtime`固有のテナント実装をこのStoryで無断修正すること。
- 全リポジトリへの即時必須化。
- secret設定、CI成功、HTTP 200だけによる完了判定。
- customer-managed/BYOCを唯一の推奨配備形態にすること。

## 依存と完了証拠

- 前4 Storyの契約、検証、ビュー、最終Spec判定が利用可能であることを開始条件とする。
- このStoryの完了にはVibePro fixture証拠を必要とし、`mana-runtime`実環境readbackは別Storyの完了条件とする。
