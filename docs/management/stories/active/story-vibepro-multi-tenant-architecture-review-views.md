---
story_id: story-vibepro-multi-tenant-architecture-review-views
title: "テナント設計を境界ビューと3つの専門レビューで判断できるようにする"
status: completed
view: dev
period: 2026-08
category: quality
artifact_profile: feature_packet
feature_slug: multi-tenant-architecture-review-views
source:
  type: github_issue
  title: "Issue #466: Multi-tenant Architecture Contract"
  url: "https://github.com/Unson-LLC/vibepro/issues/466"
related_stories:
  - story-vibepro-multi-tenant-contract-applicability
  - story-vibepro-multi-tenant-evidence-scanners
architecture_docs:
  - docs/architecture/story-vibepro-multi-tenant-architecture-contract.md
spec_docs:
  - docs/specs/story-vibepro-multi-tenant-architecture-contract.md
reason: >-
  alternatives considered: 汎用security/data/deployment表だけでは、同一tenant keyが解決・実行・配備・移行を横断する関係をレビューできないため、専用ビューとreview lensを導入する。compatibility impact: multi_tenant_architecture適用時だけPR要約へ追加する。rollback plan: 専用projectionとPR要約を外せる。boundary: 判断材料の表示を扱い、新しいreview lifecycleやGateは追加しない。
created_at: 2026-08-15
updated_at: 2026-08-16
---

# テナント設計を境界ビューと3つの専門レビューで判断できるようにする

## User Story

**As a** マルチテナント設計を承認する設計・セキュリティ・運用レビュー担当者
**I want** 同じContractと検査証拠を役割別のビューで確認できること
**So that** 巨大な共通チェックリストを読み解かず、越境・配備・移行の判断をレビュー証跡として残せる

## 開始状況

- 現行Architectureビューはstructure、runtime、data、security、deploymentの汎用集約である。
- Architecture review roleは`architecture_boundary`、`spec_consistency`、`regression_risk`で、Issue #466の3視点を表さない。
- 認証・DB・セキュリティテンプレートに組織欄はあるが、actorからdata scopeまでの一貫した境界を示さない。

## Scope

- system context、tenant resolution、trust/data boundary、runtime execution、deployment variants、migration/rollbackの6ビューを生成する。
- `tenant_architecture`、`security_boundary`、`operations_and_migration`の軽量review lensをPR証拠要約へ追加する。
- reviewerがContract、finding、negative evidence、未確認点を同じ参照から確認できるようにする。
- actor→workspace→tenant→connection→project→tool→data scopeをテンプレートと出力へ明示する。

## Acceptance Criteria

- [x] MTAR-AC-001: 6つの専用ビューがContractとGraph/scanner証拠から生成される。
- [x] MTAR-AC-002: shared、dedicated、customer-managedの差がdeployment variantsビューで比較できる。
- [x] MTAR-AC-003: tenant resolutionビューからcanonical key、取得元、曖昧・欠落時の動作を追える。
- [x] MTAR-AC-004: trust/data boundaryビューからsharing、partition、credential、data owner、residue policyを追える。
- [x] MTAR-AC-005: 適用StoryのPR証拠要約に3つの専門review lensが追加される。
- [x] MTAR-AC-006: 契約findingと未確認点がreview lensの近くに表示され、役割名だけでpassを生成しない。
- [x] MTAR-AC-007: 非適用Storyでは専用ビュー・review roleを要求しない。
- [x] MTAR-AC-008: 日本語テンプレートから不要な製品固有名を除き、同じContract項目を記入・確認できる。

## 実装タスク

1. 6ビューと3 review roleの入力・出力契約をSpecへ定義する。
2. shared/dedicated/customer-managedの期待projection fixtureを先に作る。
3. Story/Architecture reportの専用ビューを実装する。
4. PR prepareへ3 review lensを接続する。
5. Architecture/ADRテンプレートと日本語表示を更新し、非適用回帰を確認する。

## Non Goals

- 図の見た目だけを品質判定すること。
- reviewerの判断をscannerで代替すること。
- 新しいreview lifecycleエンジンの導入。
- Architecture finalやPRをこのStory単独でblockすること。

## 依存と完了証拠

- Contract StoryとEvidence Scanner Storyの成果物を入力とする。
- 完了時には3配備形態のfixtureで6ビューと3 review planを再生成できること。

## 完了証拠

- 3配備fixtureから6ビューとdeployment比較を再生成する受け入れテストを追加した。
- PR本文へcoverage、scanner状態、lens別finding、未確認点を隣接表示する回帰テストを追加した。
