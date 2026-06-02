---
story_id: story-regression-risk-gate
title: regression-risk Gate エスカレーション Architecture
story_ref: docs/stories/story-regression-risk-gate.md
spec_ref: docs/specs/vibepro-regression-risk-gate-spec.md
reason: 既存の change-risk-classifier / pr-manager の責務内に収まる加点的変更で、新しい境界・依存方向の追加はないため ADR は不要
---

# Architecture: regression-risk Gate エスカレーション

## 方針

regression-risk の検出ロジック（`regression-risk-scanner`）と PR リスク分類（`change-risk-classifier`）は既に存在する。本変更は両者を「分類の入力」として接続するだけで、新しいサブシステムや依存方向は追加しない。

## 責務境界

- `src/regression-risk-scanner.js`
  - Graphify グラフ + 任意カバレッジから hotspot を算出する（既存・本変更では非改変）
- `src/change-risk-classifier.js`
  - 既存の入力（fileGroups / storySource / networkContracts）に `regressionRisk` を追加で受け取る
  - 変更ファイル ∩ hotspot を計算し、`critical` なら `workflow_heavy` へ強制エスカレーション、`high` なら `regression_blast_radius` サーフェスを追加
  - 触れた hotspot を `regression_hotspots` として返す
- `src/pr-manager.js`
  - `vibepro pr prepare` 実行時に `scanRegressionRisk` を呼び、その結果を `classifyChangeRisk` に渡すだけ（オーケストレーションのみ）

## 依存方向

`pr-manager` → `regression-risk-scanner`（読み取り） / `pr-manager` → `change-risk-classifier`（分類）。
`change-risk-classifier` は scanner に直接依存せず、データ（hotspot 配列）だけを受け取る純粋関数を維持する。これによりユニットテストが I/O なしで書ける。

## 不変条件

- カバレッジ非存在時は scanner が `critical` を生成しないため、本接続は何もエスカレーションしない（後方互換）。
- `change-risk-classifier` は副作用を持たない（ディスク・ネットワークアクセスなし）。

## ADR 判断

既存責務の内側の加点的変更であり、新しい境界・永続化・外部契約の追加がないため、独立した ADR は作成しない（本ファイルを軽量アーキテクチャ判断として残す）。
