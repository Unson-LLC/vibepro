---
story_id: story-vibepro-must-have-diagram-gate
title: "MUST-HAVE設計図のSPEC強制Gate"
source:
  type: product-feedback
  id: VP-DIAG-001
  title: "状態遷移・DB設計など動的設計が SPEC で抜け落ちる"
architecture_docs:
  - ../../architecture/vibepro-must-have-diagram-gate.md
spec_docs:
  - ../../specs/vibepro-must-have-diagram-gate.md
status: active
created_at: 2026-05-29
updated_at: 2026-05-29
---

# Story: MUST-HAVE設計図のSPEC強制Gate

## User Story

**As a** VibProでStory→Architecture→SPEC→Codeを進めるAI/人間
**I want to** 変更内容に応じて必須となる設計図(ER/状態遷移/シーケンス/業務フロー/C4/配置/脅威/DFD)が
SPECに含まれているかをGateで強制したい
**So that** 動的設計(状態遷移・DBスキーマ・非同期パイプライン・認証フロー)の設計漏れによる
事故 (FK破壊、不正状態、idempotency漏れ、PII漏洩、二重発火) を構造的に防げる

## Background

現状のVibePro SPECはテキストclause(invariant/scenario/contract/sla)のみで、
mermaid/SVG/図への参照が一切ない。Issue #100 と並ぶ構造的欠落:

- **完了後の不変条件は書ける**: clauseは "X が常に成立する" 系を表現できる
- **作る前の設計が書けない**: ER関係、状態遷移、actor間メッセージング、業務フローは表現不能

結果として、DB schema変更時にcascade事故、status enum拡張時の不正遷移、webhook導入時の
idempotency漏れ、認証変更時の脅威モデル未検討といった「動的設計の設計漏れ」が SPEC を
通過してしまう。

業界標準 (UML / C4 / arc42 / IPA基本設計書 / OWASP SAMM) を横断調査した結果、
変更タイプ別に MUST-HAVE な8種の設計図が特定できた。これを VibePro DAG で
"必要そうだから書く" nice-to-have ではなく、"トリガーが発火したら書かないと
Gate がブロックする" must-have として強制する。

## Acceptance Criteria

- [ ] `src/spec-schema.json` に `diagrams[]` フィールドが追加され、`kind` enum と
      `mermaid` 必須項目を持つ
- [ ] `src/diagram-requirement-resolver.js` が新規ファイルとして存在し、
      change signals (story diff / schema diff / code diff) から
      `required_diagrams[]` を返す
- [ ] 以下のトリガー検出が動作する:
  - [ ] DB schema変更 (prisma/schema.prisma 差分、SQL migration追加) → `er` 必須
  - [ ] status enum追加 / state machine定義 → `state` 必須
  - [ ] webhook route / 3rd party SDK / queue producer 追加 → `sequence` 必須
  - [ ] multi-step user flow (3+ステップ Story.AC) → `flow` 必須
  - [ ] 新規 service / package境界 / 外部system追加 → `c4_context` 必須
  - [ ] IaC差分 / 新規region・queue・cache → `deployment` 必須
  - [ ] auth/authz/PII/決済/暗号 変更 → `threat_model` 必須
  - [ ] 非同期パイプライン / cron / event-driven処理追加 → `dfd` 必須
- [ ] `src/spec-validator.js` が `diagrams` 配列の構造、mermaid構文の基本形、
      `kind` enum、entity↔clause整合 (図中のエンティティ名がclauseに登場するか) を検証する
- [ ] PR prepare 時に `required_diagrams` と `spec.diagrams[].kind` の差集合が
      空でない場合、 `gate:design_diagrams` が `blocked` となる
- [ ] 既存 SPEC (diagrams未定義) は backward compatible で validation通過 (空配列扱い)
- [ ] `src/spec-prompt-template.md` に diagrams 出力ルールが追記される
- [ ] テストが追加され、各トリガーで期待通りの `required_diagrams` が返ることを検証する

## Out of Scope

- mermaid render結果の視覚的正しさ評価 (構文OKまで)
- 図の自動生成 (AI 側 = Claude/Codex が SPEC 作成時に書く)
- nice-to-have 図 (Use Case / Class / Object / Communication / Timing / Package)

## Implementation Notes

- 対象: `src/spec-schema.json`, `src/spec-validator.js`, `src/spec-prompt-template.md`,
  新規 `src/diagram-requirement-resolver.js`, gate DAG 接続箇所
- 既存 clause 構造には触れない (純粋に diagrams 配列を追加)
- mermaid のフル構文検証は重いので、 `^(erDiagram|sequenceDiagram|stateDiagram|flowchart|C4Context|C4Container)` 程度の prefix チェックに留める
