---
story_id: story-regression-risk-gate
title: regression-risk Gate エスカレーション Spec
story_ref: docs/stories/story-regression-risk-gate.md
architecture_ref: docs/architecture/vibepro-regression-risk-gate-architecture.md
---

# Spec: regression-risk Gate エスカレーション

## 入力

`classifyChangeRisk({ fileGroups, storySource, networkContracts, regressionRisk })`

- `regressionRisk`: `scanRegressionRisk` の戻り値（`{ status, hotspots: [{ file, fan_in, coverage_pct, risk_tier, priority }], summary }`）。`null` 可。

## 振る舞い

1. `regressionRisk.hotspots` のうち、変更されたソース（`fileGroups.source.files`）に含まれるものだけを `regression_hotspots` として抽出する。
2. 抽出結果に `priority === 'critical'` が1つでもあれば、`profile` を `workflow_heavy` に強制する（`regression_escalated = true`）。
3. `risk_tier === 'high'`（または critical）が1つでもあれば、`risk_surfaces` に `regression_blast_radius` を追加し、理由文を1行加える。
4. 上記いずれも無ければ、従来の分類結果をそのまま返す（`regression_escalated = false`、`regression_hotspots = []`）。

## 不変条件

- `regressionRisk` が `null`・`hotspots` 空・変更ファイルと交差なし のいずれでも、従来挙動と完全に一致する。
- 出力は「影響リスク（ブラスト半径）」であり「欠陥確率の予測」ではない。

## CLI

```bash
vibepro pr prepare <repo> --base <ref> --story-id story-regression-risk-gate
```

`pr-prepare.json` の `pr_context.change_classification` に `regression_hotspots` / `regression_escalated` / `risk_surfaces`（必要時 `regression_blast_radius`）が現れる。

## 受け入れテスト

- `test/change-risk-regression.test.js`
  - critical hotspot → `workflow_heavy` 強制
  - high hotspot → サーフェス追加・強制なし
  - 非該当 hotspot → 無影響
  - regressionRisk 無し → 後方互換
