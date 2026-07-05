---
story_id: story-vibepro-visual-residual-local-runner
title: "外部 SaaS なしで residual analysis を生成するローカル視覚差分ランナー"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: ".vibepro/qa/ の residual artifacts が Percy/Chromatic 等の外部ツール出力の import 前提になっている"
related_stories:
  - story-vibepro-visual-evidence-gate-ux
  - story-vibepro-flow-screenshot-visual-gate-bridge
parent_design: vibepro-visual-residual-local-runner
architecture_docs:
  - docs/architecture/vibepro-visual-residual-local-runner.md
spec_docs:
  - docs/specs/story-vibepro-visual-residual-local-runner.md
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Story

`gate:visual_qa` の第一級証跡である residual analysis（`.vibepro/qa/<qa-id>/visual-residual.json` + `residual-analysis.md`）は、現状 Percy / Chromatic 等の外部ツールで差分を計算し JSON を手で配置する前提になっている。VibePro 自身は差分を計算しない。VibePro 内蔵の PNG 比較を使い、baseline と current の視覚差分をローカルで計測して gate が受理する residual artifacts を直接生成できるようにする。

## User Story

**As a** 外部の視覚回帰 SaaS を契約していない VibePro ユーザー<br>
**I want** `vibepro verify visual` が baseline スクリーンショットと現在の画面を比較して residual artifacts を `.vibepro/qa/<qa-id>/` に生成すること<br>
**So that** 目視と手書きマーカーに頼らず、数値つきの視覚差分証跡で `gate:visual_qa` を解消できる

## Scope

- `vibepro verify visual [repo] --base-url <url>`: 設定済み probe（`verify flow` と共通）を対象に現在のスクリーンショットを取得し、baseline と比較して meanAbsResidualPct を算出、`.vibepro/qa/<qa-id>/visual-residual.json` と `residual-analysis.md` を既存の gate 受理フォーマットで書き出す。
- baseline 管理: `--update-baseline` で現在のスクリーンショットを baseline として `.vibepro/qa/baseline/` に保存する。baseline 不在の probe は差分計算せず `baseline_missing` として報告する。
- 閾値は既存の residual threshold 設定に従い、超過時は residual-analysis.md に超過 probe と差分値を列挙する。
- 差分計算は VibePro の内蔵 PNG decoder と mean absolute RGBA residual を利用し、新規の外部サービス依存を追加しない。

## Acceptance Criteria

- [ ] VRL-S-1: baseline が存在し差分が閾値内のとき、生成された residual artifacts により `pr prepare` の `gate:visual_qa` が pass 側の判定になる。
- [ ] VRL-S-2: 差分が閾値を超えた probe があるとき、residual analysis は needs_review となり、対象 probe と差分値が residual-analysis.md に記載される。
- [ ] VRL-S-3: baseline が存在しない probe は `baseline_missing` として報告され、silent pass にならない。
- [ ] VRL-S-4: `--update-baseline` 実行直後は baseline 更新として review が必要になり、その後の再実行では当該 probe の差分が 0 近傍になる。
- [ ] VRL-S-5: 生成される visual-residual.json は既存の residual フォーマット検証を追加変更なしで通過する（外部ツール import 由来の artifacts と同一スキーマ）。
- [ ] VRL-S-6: テストで閾値内 / 閾値超過 / baseline 欠落 / baseline 更新の各状態を固定する。

## 既存挙動（inherited behavior）

- Importing externally generated residual artifacts into `.vibepro/qa/<qa-id>/` remains an existing supported path and is unchanged.
- Residual threshold configuration semantics are unchanged.
- Verification fallback with explicit `visual_qa` and `screenshot` markers is unchanged.

## Non Goals

- セマンティックレイアウト差分（semantic-layout-residual-pct）の自動算出。まずは画素 residual のみ。
- クロスブラウザ / 複数ビューポートのマトリクス実行。
- baseline の Git LFS / 外部ストレージ管理方針の決定。
