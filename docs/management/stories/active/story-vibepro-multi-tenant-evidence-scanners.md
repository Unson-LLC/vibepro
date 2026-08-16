---
story_id: story-vibepro-multi-tenant-evidence-scanners
title: "テナント境界のGraph metadataと検証範囲を契約として照合する"
status: completed
view: dev
period: 2026-08
category: quality
artifact_profile: feature_packet
feature_slug: multi-tenant-evidence-scanners
source:
  type: github_issue
  title: "Issue #466: Multi-tenant Architecture Contract"
  url: "https://github.com/Unson-LLC/vibepro/issues/466"
related_stories:
  - story-vibepro-multi-tenant-contract-applicability
architecture_docs:
  - docs/architecture/story-vibepro-multi-tenant-architecture-contract.md
spec_docs:
  - docs/specs/story-vibepro-multi-tenant-architecture-contract.md
reason: >-
  alternatives considered: Graph metadataの存在だけを合格証拠にする案は、検査不能と安全を混同するため却下する。Contractを期待値、検証済み面を別の証拠として照合する。compatibility impact: 非適用Storyはnot_applicable、適用Storyで検査不能な場合はneeds_reviewを保持する。rollback plan: Spec validatorから加算的な照合を外せる。boundary: finding分類までを扱い、専用check packや旧Gate DAGは追加しない。
created_at: 2026-08-15
updated_at: 2026-08-16
---

# テナント境界のGraph metadataと検証範囲を契約として照合する

## User Story

**As a** Tenant Architecture Contractをレビューする開発者
**I want** テナント識別子が入口から状態・sandbox・外部接続まで伝播しているかを構造化findingで確認できること
**So that** 検証範囲が不明な状態を安全と誤認せず、確認すべき境界を特定できる

## 開始状況

- Graphifyはgraph artifactを取り込むが、tenant scopeやtrust zoneの意味を保持しない。
- minimal-coreでは専用check packやGate DAGを新設しない。
- 検証範囲が不明でも、一般テスト成功とは独立して`needs_review`を保持する必要がある。

## Scope

- Graph node/edgeへ`tenant_scope`、`tenant_key_source`、`trust_zone`、`sharing_mode`、`data_owner`、`classification`、`credential_scope`、`connection_mode`、`deployment_mode`を関連付ける。
- Contract内のGraph metadata、伝播面、検証済み面を比較し、不足・矛盾・未確認をfindingとして返す。
- tenant identity、queue/job、durable state、sandbox session、external connection、audit receiptの伝播を別々に扱う。
- 検証器のcoverageを`verified`または未確認として保存する。

## Acceptance Criteria

- [x] MTES-AC-001: 必須伝播面と検証済み面の欠落を位置付きで報告する。
- [x] MTES-AC-002: resource、credential、data、deploymentの契約不足が別findingとして出力される。
- [x] MTES-AC-003: Graph metadataのtenant entityとboundary edge欠落を報告する。
- [x] MTES-AC-004: cross-tenant negative testが確認できない場合、`cross_tenant_negative_evidence`をpassにしない。
- [x] MTES-AC-005: tenant key欠落、曖昧resolution、cross-tenant fallback、共有state key、sandbox residueのnegative fixtureを検出する。
- [x] MTES-AC-006: scannerが対象を確認できない場合は`needs_review`または`inconclusive`となり、検査済みpassと区別される。
- [x] MTES-AC-007: 非適用Storyでは専用findingを出さず`not_applicable`として理由を残す。
- [x] MTES-AC-008: Graphify不在だけで一般Storyをblockせず、適用Storyでは不足している証拠面を明示する。

## 実装タスク

1. Contract項目とGraph metadata/findingの対応表をSpecへ固定する。
2. positive、境界欠落、越境、検査不能fixtureを先に追加する。
3. Spec内Graph metadataの正規化と検証を実装する。
4. 責務別findingとcoverage集約をSpec検証へ追加する。
5. finding、coverage、状態のJSON/Markdown表示と回帰テストを追加する。

## Non Goals

- scanner結果だけによる安全証明。
- Graphifyの必須インストール化。
- 専用check pack、旧Gate DAG、PR作成の独自停止。
- 特定クラウド、データベース、メッセージ基盤への固定。

## 依存と完了証拠

- `story-vibepro-multi-tenant-contract-applicability`のContractを入力とする。
- 完了時には同じnegative fixtureから、期待するfinding、coverage、非pass状態を再現できること。

## 完了証拠

- Graph entity/edgeの構造化metadata、10 scanner、伝播面、negative scenarioを独立に照合する。
- 5種類のnegative fixtureと証拠欠落・検査不能テストでfinding codeとcoverageを固定した。
