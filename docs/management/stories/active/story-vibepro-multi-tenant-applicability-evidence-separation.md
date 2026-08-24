---
story_id: story-vibepro-multi-tenant-applicability-evidence-separation
title: "非マルチテナント適用判定と実装証拠を分離する"
status: active
view: dev
period: 2026-08
category: quality
architecture_docs:
  - docs/architecture/story-vibepro-multi-tenant-applicability-evidence-separation.md
spec_docs:
  - docs/specs/story-vibepro-multi-tenant-applicability-evidence-separation.md
reason: >-
  alternatives considered: 非該当宣言だけで実装readyにすると証拠分離を失い、語彙判定だけを強めるとaccount等の弱い語で誤発火する。compatibility impact: multi-tenantの強いシグナルと既存の構造エラーはfail-closedを維持する。rollback plan: caller evidence投影とimplementation_readinessを除去すれば従来判定へ戻せる。boundary: 適用判定、Spec保存・検証、PR要約の同一投影だけを扱い、廃止済みGate DAGは復活させない。
created_at: 2026-08-24
updated_at: 2026-08-24
---

# 非マルチテナント適用判定と実装証拠を分離する

## User Story

**As a** 非マルチテナントStoryを検証する開発者
**I want** 明示的な非該当と実装検証済みを別状態として扱うこと
**So that** 弱い語の誤検知で止まらず、宣言だけで実装readyにもならない

## Acceptance Criteria

- MTNA-AC-001: 明示的な非該当は`not_applicable`として構造化され、単独の`account`等の弱い語で上書きされない。
- MTNA-AC-002: 強いmulti-tenantシグナルと非該当宣言の衝突は`needs_review`または`invalid`としてfail-closedになる。
- MTNA-AC-003: 非該当宣言だけではimplementation readinessを`ready`にしない。
- MTNA-AC-004: caller提供のfresh exact-HEAD証拠がstory/spec/implementationを全て覆う場合だけimplementation readinessを`ready`にする。
- MTNA-AC-005: 証拠欠落、stale、wrong HEAD、自己申告、面不足は`inconclusive`としてfail-closedになる。
- MTNA-AC-006: spec-store、spec-validator、pr-managerが同じ判定結果を投影する。

## Tasks

1. 誤検知・強シグナル・証拠鮮度の失敗テストを追加する。
2. 適用判定とimplementation readinessを分離する。
3. Spec保存・検証・PR準備へcaller evidenceとexpected HEADを明示伝播する。
4. 対象テストと全体回帰を実行する。

## Non Goals

- 廃止済みGate DAG、self-dogfood、review lifecycleの復活。
- package version、lockfile、公開経路の変更。
