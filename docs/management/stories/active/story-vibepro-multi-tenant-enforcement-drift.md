---
story_id: story-vibepro-multi-tenant-enforcement-drift
title: "未解決のテナント境界を最終Specで拒否しPRへ明示する"
status: active
view: dev
period: 2026-08
category: quality
artifact_profile: feature_packet
feature_slug: multi-tenant-enforcement-drift
source:
  type: github_issue
  title: "Issue #466: Multi-tenant Architecture Contract"
  url: "https://github.com/Unson-LLC/vibepro/issues/466"
related_stories:
  - story-vibepro-multi-tenant-contract-applicability
  - story-vibepro-multi-tenant-evidence-scanners
  - story-vibepro-multi-tenant-architecture-review-views
architecture_docs:
  - docs/architecture/story-vibepro-multi-tenant-architecture-contract.md
spec_docs:
  - docs/specs/story-vibepro-multi-tenant-architecture-contract.md
reason: >-
  alternatives considered: すべてのneeds_reviewを全Storyで拒否する案は非適用Storyを壊すため却下し、適用済みmulti_tenant_architectureの契約errorだけを最終Specでfail-closedにする。compatibility impact: 既存Spec検証を維持し、下書きは警告として保存できる。rollback plan: 加算的なSpec検証とPR要約を外せる。boundary: 最終SpecとPRでの可視化を扱い、旧Gate DAGや実装着手判定は追加しない。
created_at: 2026-08-15
updated_at: 2026-08-15
---

# 未解決のテナント境界を最終Specで拒否しPRへ明示する

## User Story

**As a** マルチテナント変更を出荷する責任者
**I want** 越境リスクや未解決の重要境界がある最終Specを受理せず、PR証拠要約へ状態を明示すること
**So that** 一般テストの成功やscannerの検査不能を安全の証明として出荷しない

## 開始状況

- 汎用Architecture ReadinessはGraph node/edgeの存在や限定された失敗状態を確認する。
- Architecture品質の一部は文書キーワードで充足判定される。
- テナント専用blocker、negative evidence、Contract driftのGateはない。

## Scope

- `multi_tenant_architecture`判断軸へ専用required evidenceとblocking criteriaを追加する。
- tenant identity/resolution、propagation、state/sandbox isolation、credential/fallback、canonical owner、deployment/migrationのcritical boundaryを定義する。
- 最終Specでは契約errorを拒否し、下書きでは同じ不足をwarningとして保持する。
- Contract、Graph metadata、検証範囲の状態をPR証拠要約へ投影する。
- cross-tenant fallbackやraw secret artifactを契約違反として扱う。

## Acceptance Criteria

- [ ] MTEG-AC-001: canonical tenant identityまたはresolution policy欠落時に最終Specを拒否する。
- [ ] MTEG-AC-002: 必須伝播面、resource境界、credential scope、canonical data owner欠落時に最終Specを拒否する。
- [ ] MTEG-AC-003: cross-tenant deny-and-auditのnegative scenarioがない場合、最終Specを受理しない。
- [ ] MTEG-AC-004: 適用Storyのcritical scannerが`needs_review`/`inconclusive`なら、確認済みpassへ丸めない。
- [ ] MTEG-AC-005: ContractとGraph/Spec/実装のtenant key、sharing mode、deployment modeの不一致をdriftとして報告する。
- [ ] MTEG-AC-006: migration/export/delete/residencyを扱う変更ではrollbackまたはoperator action欠落を最終Specで拒否する。
- [ ] MTEG-AC-007: critical cross-tenant findingを下書きの警告から最終Specのerrorへ昇格し、迂回できない。
- [ ] MTEG-AC-008: 非適用Storyと既存一般scannerの`inconclusive`集約挙動を不要に変更しない。

## 実装タスク

1. critical/non-critical findingとfinal/draft別の扱いをSpecへ固定する。
2. vacuum pass、keyword-only、stale Contract、cross-tenant negative evidence欠落の失敗テストを先に作る。
3. Spec validatorへfinal/draftの状態別判定を接続する。
4. Contract/Graph metadata/evidence状態をPR本文へ追加する。
5. error/warning表示とfinal/draftの回帰テストを追加する。

## Non Goals

- 全scannerの`inconclusive`を一律blockすること。
- scannerを人間の設計判断の代替にすること。
- self-hosted/customer-managedを常に推奨すること。
- 旧Gate DAG、実装着手判定、独自waiver機構の追加。

## 依存と完了証拠

- Contract、Evidence Scanner、Architecture Review Viewsの3 Storyに依存する。
- 完了時には各段階のblock/pass、drift、非適用を同じfixture系列で再現できること。
