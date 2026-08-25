---
story_id: story-vibepro-production-verification-scope
title: "ACのローカル検証と本番観測を分離して表示する"
status: active
source:
  type: program_blocker
  title: "ローカルテストpassが本番未観測のACをverifiedへ昇格させる"
architecture_docs:
  - docs/architecture/story-vibepro-production-verification-scope.md
created_at: 2026-08-26
updated_at: 2026-08-26
---

# ACのローカル検証と本番観測を分離して表示する

## Problem

accepted Specのテスト参照とpass済み検証があると、現行traceabilityはACを`verified`と表示する。本番観測が必要なACでも、production evidenceが`not_collected`である事実を構造化して保持・表示できないため、ローカル成立を本番成立へ誤昇格できる。

## User Story

**As a** VibeProのPR証跡を読む実装ownerとreviewer

**I want** ACごとに必要な検証範囲と各範囲の観測状態を機械可読に確認したい

**So that** ローカルテストと本番観測を混同せず、未収集を未収集のまま判断できる

## Acceptance Criteria

- [x] VPVS-AC-001: accepted Specが`local_test`と`production`を要求するACでは、各範囲の状態と総合状態をtraceability JSONへ構造化して出力する。
- [x] VPVS-AC-002: `local_test=verified`でも`production=not_collected`、`partial`、missingのいずれかなら、ACはnativeに`mapped-but-unverified`となり`verified`へ昇格しない。
- [x] VPVS-AC-003: PR本文はStory本文の語句検索に依存せず、各ACの構造化総合状態、必要範囲、`production` evidence stateを直接表示する。
- [x] VPVS-AC-004: scopeを持たない既存のpass済みverification evidenceは`local_test`として読み、既存ACの`verification_status=verified`互換を維持する。
- [x] VPVS-AC-005: `verify run`と`verify record`は検証範囲とevidence stateを公開契約として記録でき、矛盾する`status=pass/evidence_state`を拒否する。

## Implementation Tasks

1. accepted Spec clauseの`verification.required_scopes`とverification evidence commandの`scope/evidence_state`を定義する。
2. AC単位のscope集約とfail-closedな総合状態を実装する。
3. PR本文rendererを構造化状態から描画する。
4. 修正前に失敗するtraceability/PR/CLI契約テストを追加し、関連回帰を実行する。

## Done Evidence

- `node --test test/production-verification-scope.test.js`
- `node --test test/accepted-spec-traceability.test.js test/pr-artifact-consistency.test.js test/verification-evidence.test.js test/verification-runner.test.js`
- `npm run typecheck`
- `npm test`
