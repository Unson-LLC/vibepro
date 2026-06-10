---
story_id: story-vibepro-verification-evidence-roi
title: Verification Evidence ROI Architecture
---

# Architecture

検証の厳密性を二層に分離する。決定的で安価な突き合わせ（claim と artifact の整合性）は record 時に常に行い、高価な検証の再実行はリスク分類に比例させる。

- artifact 突き合わせは `verification-evidence.js` の record 経路に閉じる。テストの実行・再実行は行わず、既に生成された machine-readable 出力の読み取りとパースのみを行う。未知の形式は `unrecognized` として記録し、ブロックしない（false positive で生成コストを増やさない）。
- 行数収集は `pr-manager.js` の git state 収集（`collectGitState`）に閉じる。`git diff --numstat` の結果を per-file stats として classifier に渡す。
- low-risk 判定の拡張は `change-risk-classifier.js` に閉じる。既存の `low_risk_evidence_change` という change_type と `canReuseLowRiskEvidence` の消費側セマンティクスは変えず、分類の入力条件だけを広げる。
- unit / typecheck / build は CI が ground truth として再実行するため、record 時の突き合わせは虚偽申告の検出に焦点を絞る。reuse 拡張も CI が下流で再検証する前提で、ローカルの再取得コストだけを削る。
