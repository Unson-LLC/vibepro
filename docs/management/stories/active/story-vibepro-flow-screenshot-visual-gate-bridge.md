---
story_id: story-vibepro-flow-screenshot-visual-gate-bridge
title: "verify flow のスクリーンショットを Visual QA Gate に自動接続する"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "verify flow が撮影済みのスクリーンショットを visual_qa 用に手動で再記録するのは二度手間"
related_stories:
  - story-vibepro-visual-evidence-gate-ux
  - story-vibepro-verification-observation-artifacts
spec_docs:
  - docs/specs/story-vibepro-flow-screenshot-visual-gate-bridge.md
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Story

`vibepro verify flow` は Playwright 実行時にすでに `.vibepro/verification/<run-id>/screenshots/` へフルページスクリーンショットを保存している。しかし `gate:visual_qa` はこれを認識せず、ユーザーが別途 `verify record` で `visual_qa` / `screenshot` マーカーを手書きしないと解消しない。撮影済みの視覚証跡をゲートへ自動接続し、UI 変更の二度手間をなくす。

## User Story

**As a** UI 変更の PR を準備する VibePro ユーザー<br>
**I want** `verify flow` が成功時にスクリーンショット付き検証証跡を `visual_qa` / `screenshot` マーカー付きで自動記録すること<br>
**So that** 同じスクリーンショットをマーカー文字列とともに手で再記録せずに `gate:visual_qa` を解消できる

## Scope

- `verify flow` の成功 run がスクリーンショットを保存した場合、current-head 束縛の verification evidence（kind: e2e）に `visual_qa` と `screenshot: <path>` の scenario マーカーを自動付与して記録する。
- 自動記録される scenario マーカーは story-vibepro-visual-evidence-gate-ux で正規化済みの語彙（`visual_qa` / `screenshot`）のみを使う。
- flow run が失敗（fail / エラー検出）した場合は visual 証跡を記録しない。
- `pr prepare` は自動記録された flow 由来の証跡で `gate:visual_qa` を ready for review にできる。

## Acceptance Criteria

- [ ] FSB-S-1: スクリーンショットを保存した passing な `verify flow` run の後、`pr prepare` の `gate:visual_qa` が追加の手動 `verify record` なしで ready for review になる。
- [ ] FSB-S-2: 失敗した flow run はスクリーンショットが存在しても `gate:visual_qa` を解消しない。
- [ ] FSB-S-3: スクリーンショットが 1 枚も保存されなかった passing な flow run は visual マーカー付き証跡を生成しない。
- [ ] FSB-S-4: `.vibepro/qa/<qa-id>/` の residual artifacts が存在する場合、flow 由来の証跡より residual analysis が引き続き優先される。
- [ ] FSB-S-5: 自動記録された証跡には provenance（flow run id、screenshot paths）が含まれ、`gate:visual_qa` のゲート詳細から参照できる。
- [ ] FSB-S-6: テストで passing+screenshots / failing / screenshots なし / residual 優先の各分岐を固定する。

## 既存挙動（inherited behavior）

- Residual analysis precedence over verification fallback is unchanged.
- Manual `verify record` with explicit `visual_qa` and `screenshot` markers remains an existing supported path and is unchanged.
- `gate:visual_qa` activation conditions for UI source changes are unchanged.

## Non Goals

- スクリーンショットの画素比較・視覚差分の算出（story-vibepro-visual-residual-local-runner が扱う）。
- flow probe の自動発見やルート探索の拡張。
- residual artifacts フォーマットの変更。
