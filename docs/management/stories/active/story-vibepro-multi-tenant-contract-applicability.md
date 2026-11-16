---
story_id: story-vibepro-multi-tenant-contract-applicability
title: "マルチテナントStoryの適用判定とTenant Architecture Contractを確立する"
status: completed
view: dev
period: 2026-08
category: quality
artifact_profile: feature_packet
feature_slug: multi-tenant-contract-applicability
source:
  type: github_issue
  title: "Issue #466: Multi-tenant Architecture Contract"
  url: "https://github.com/Unson-LLC/vibepro/issues/466"
related_stories: []
architecture_docs:
  - docs/architecture/story-vibepro-multi-tenant-architecture-contract.md
spec_docs:
  - docs/specs/story-vibepro-multi-tenant-architecture-contract.md
reason: >-
  alternatives considered: 汎用security/data項目の追加だけでは、テナント識別、伝播、配備形態を一つの契約として追跡できないため、Story別のmulti_tenant_architecture判定と機械可読Contractを追加する。compatibility impact: 既存Storyは明示的な適用シグナルがない限り対象外とする。rollback plan: Spec validatorとPR要約から新判定を外せる加算的導入とする。boundary: 適用判定とContract検証を扱い、旧Gate DAGやreview lifecycleは追加しない。
created_at: 2026-08-15
updated_at: 2026-08-16
---

# マルチテナントStoryの適用判定とTenant Architecture Contractを確立する

## User Story

**As a** 複数テナントを共有・専有・顧客管理環境へ配備するシステムを設計する開発者
**I want** Storyの意味からマルチテナント設計の適用要否が正しく判定され、テナント境界を機械可読な契約として保存できること
**So that** 設計文書の言い回しに依存せず、後続のSpec検証・レビュー・PR証拠要約が同じ境界を参照できる

## 開始状況

- `tenant` という語は汎用的なbusiness system分類に使われるが、`multi_tenant_architecture`判断軸は存在しない。
- Architecture成果物はMarkdownとreadiness JSONが中心で、テナント境界の構造化契約はない。
- キーワードだけのStoryや非マルチテナントCLIへ専用Gateを出してはいけない。

## Scope

- Storyのtitle、background、policy、受け入れ基準、Specから適用候補を抽出する。
- tenant/organization/workspace/account/customerと、shared/dedicated/BYOC、tenant別credential・endpoint・project・tool・memory・storage、queue/job/workflow/sandbox、migration/export/delete/residencyの組み合わせを評価する。
- `multi_tenant_architecture`を`ready`、`invalid`、`needs_review`、`not_applicable`として明示する。
- Tenant Architecture Contractにtenancy model、tenant identity、resolution、propagation、resource sharing、trust zone、credential scope、data owner、failure semantics、deployment mode、migration/rollbackを保存する。
- Story単位でContractを書き、読み、レビュー対象として参照できるようにする。

## Acceptance Criteria

- [x] MTCA-AC-001: マルチテナントの意味を持つStoryで`multi_tenant_architecture`軸が有効になる。
- [x] MTCA-AC-002: copy-only、一般CLI、単に`tenant`という語を含むだけのStoryでは専用軸が有効にならない。
- [x] MTCA-AC-003: 判定が曖昧な場合はpassや対象外に丸めず`needs_review`になる。
- [x] MTCA-AC-004: Contractはtenancy model、canonical tenant key、`resolved_from`、resolution point、欠落・曖昧時の動作を保持する。
- [x] MTCA-AC-005: Contractは必須伝播面、共有方式、trust zone、partition key、residue policy、credential scope、data owner、connection/deployment mode、migration/rollbackを保持する。
- [x] MTCA-AC-006: ContractをStory IDから保存・読込でき、壊れた値や必須項目欠落はfail-closedで報告される。
- [x] MTCA-AC-007: shared、dedicated、customer-managedのpositive fixtureと、copy-only/CLIの対象外fixtureで判定を固定する。
- [x] MTCA-AC-008: 既存の判断軸とIssue #128/#327/#423の適用・誤発火抑制テストを維持する。

## 実装タスク

1. positive、negative、対象外Story fixtureと期待判定を先に定義する。
2. `multi_tenant_architecture`適用判定の構造化シグナルと曖昧性ルールを設計する。
3. Tenant Architecture Contractのスキーマ、validator、保存・読込経路を実装する。
4. Story/Architecture/PR文脈からContractの状態を参照できるようにする。
5. 対象テスト、既存判断軸回帰、Story mapで証拠を残す。

## Non Goals

- テナント境界scannerの実装。
- 専門レビュー役割やArchitectureビューの追加。
- 旧Gate DAG、実装着手判定、PR作成の独自ブロック。
- Cloudflare、Slack、Brainbaseなど特定製品名のハードコード。

## 依存と完了証拠

- このStoryが後続4 Storyの前提となる。
- 完了時にはStory入力、Contract JSON、判定結果を同じfixtureから再現できること。

## 完了証拠

- `test/multi-tenant-architecture.test.js`と`test/multi-tenant-architecture-acceptance.test.js`で適用、非適用、曖昧性、保存・読込、3配備fixtureを固定した。
- Contractはaccepted Specの`multi_tenancy`へ保存し、保存前の最終検証失敗時は上書きしない。
