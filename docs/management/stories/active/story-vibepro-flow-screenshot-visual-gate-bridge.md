---
story_id: story-vibepro-flow-screenshot-visual-gate-bridge
title: "verify flow のスクリーンショットを Visual QA Gate の residual 導線に接続する"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "verify flow が撮影済みのスクリーンショットを visual_qa 用に手動で再記録するのは二度手間"
related_stories:
  - story-vibepro-visual-evidence-gate-ux
  - story-vibepro-verification-observation-artifacts
parent_design: vibepro-flow-screenshot-visual-gate-bridge
architecture_docs:
  - docs/architecture/vibepro-flow-screenshot-visual-gate-bridge.md
spec_docs:
  - docs/specs/story-vibepro-flow-screenshot-visual-gate-bridge.md
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Story

`vibepro verify flow` は Playwright 実行時にすでに `.vibepro/verification/<run-id>/screenshots/` へフルページスクリーンショットを保存している。しかし screenshot の存在だけでは visual residual の判定や目視完了を証明できない。撮影済みの視覚証跡を residual runner へ接続し、UI 変更で必要な Visual QA 証跡を prose ではなく artifact-backed にする。

## User Story

**As a** UI 変更の PR を準備する VibePro ユーザー<br>
**I want** `verify flow` が成功時に保存済みスクリーンショットの所在と residual 必須理由を明示すること<br>
**So that** screenshot の存在や prose だけで `gate:visual_qa` を解消せず、`verify visual` の residual artifact で安全に gate を解消できる

## Scope

- `verify flow` の成功 run がスクリーンショットを保存した場合、`auto_visual_evidence.status=not_recorded` と `reason=visual_residual_required` を出し、保存済み screenshot path を示す。
- 自動で `visual_qa` / `screenshot` scenario マーカーを記録しない。Visual QA Gate の pass は `verify visual` の residual artifact、または明示的な artifact-backed verification evidence に委ねる。
- flow run が失敗（fail / エラー検出）した場合は visual 証跡を記録しない。
- `pr prepare` は flow screenshot の存在だけでは `gate:visual_qa` を ready for review にしない。

## Acceptance Criteria

- [ ] FSB-S-1: スクリーンショットを保存した passing な `verify flow` run の後、`auto_visual_evidence` は `visual_residual_required` を示し、`pr prepare` の `gate:visual_qa` は residual artifact なしでは ready for review にならない。
- [ ] FSB-S-2: 失敗した flow run はスクリーンショットが存在しても `gate:visual_qa` を解消しない。
- [ ] FSB-S-3: スクリーンショットが 1 枚も保存されなかった passing な flow run は visual マーカー付き証跡を生成しない。
- [ ] FSB-S-4: `.vibepro/qa/<qa-id>/` の residual artifacts が存在する場合、flow 由来の証跡より residual analysis が引き続き優先される。
- [ ] FSB-S-5: not-recorded detail には provenance（flow run id、screenshot paths）が含まれ、次に `verify visual` へ進むための入力を参照できる。
- [ ] FSB-S-6: テストで passing+screenshots / failing / screenshots なし / residual 優先の各分岐を固定する。

## 既存挙動（inherited behavior）

- Residual analysis precedence over verification fallback is unchanged.
- Manual `verify record` with explicit `visual_qa` and `screenshot` markers remains an existing supported path and is unchanged.
- `gate:visual_qa` activation conditions for UI source changes are unchanged.

## Non Goals

- スクリーンショットの画素比較・視覚差分の算出（story-vibepro-visual-residual-local-runner が扱う）。
- flow probe の自動発見やルート探索の拡張。
- residual artifacts フォーマットの変更。
