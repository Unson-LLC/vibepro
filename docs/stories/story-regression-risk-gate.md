---
story_id: story-regression-risk-gate
title: regression-risk の critical hotspot を触る変更で PR Gate DAG を自動エスカレーション
status: active
view: dev
period: 2026-W23
architecture_ref: docs/architecture/vibepro-regression-risk-gate-architecture.md
spec_ref: docs/specs/vibepro-regression-risk-gate-spec.md
---

# Story: regression-risk Gate エスカレーション

## 背景

VibePro には `vibepro check regression-risk` があり、Graphify のコールグラフから「ブラスト半径（fan-in）」の大きいモジュールを検出し、実カバレッジがあるときは「高ブラスト半径 × 低カバレッジ」を `critical` として優先度付けする。

しかしこの出力は診断レポートに留まっており、PR の Gate DAG には影響していなかった。せっかく「変更すると回帰が広範囲に及ぶ危険なモジュール」を特定できても、その変更が通常の軽い PR と同じ Gate で通過できてしまう。検出結果を「見るだけ」から「実際にゲートを止める」へ昇格させる必要がある。

## ユーザー価値

VibePro で AI にコードを任せる開発者として、回帰リスクの高いモジュール（コールグラフ上の大きなハブ）を触る変更のときに、PR Gate が自動的に重くなってほしい。そうすれば、危険な変更だけに強いレビュー・検証ゲートが適用され、安全な変更は軽いまま素早く出荷できる。

## 受け入れ基準

- [ ] `vibepro pr prepare` が変更ファイルと regression-risk hotspot を突き合わせる
- [ ] 変更ファイルが `critical` hotspot（高ブラスト半径 + 低カバレッジ）のとき、gate profile が `workflow_heavy` に強制エスカレーションされる
- [ ] 変更ファイルが `high` ブラスト半径のとき、`regression_blast_radius` リスクサーフェスと理由が追加される
- [ ] 触れた hotspot が `change_classification.regression_hotspots` に証跡として記録される
- [ ] カバレッジが無いときは `critical` が発生しないため誤エスカレーションしない（後方互換）

## スコープ外

- 回帰「確率」の予測（静的グラフが出すのはブラスト半径＝影響範囲であり、欠陥確率ではない）
- カバレッジ計測の実行（プロジェクト側のテスト設定の責務）
