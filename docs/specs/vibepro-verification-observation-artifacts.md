---
story_id: story-vibepro-verification-observation-artifacts
title: Verification Observation Artifacts Spec
---

# 仕様

## 必須挙動

- `vibepro verify record` は `--target <path>`（複数可）、`--scenario <text>`（複数可）、`--observed <key=value>`（複数可）を受け取り、command entry に `observation: {targets[], scenarios[], values{}}` を保存する。
- `--observed` は `key=value` 形式以外をエラーにする。value は文字列として保存する。
- artifact が generic status JSON で `observed` オブジェクトを持つ場合、その内容を `observation.values` へ自動 merge する。CLI の `--observed` が同じ key を持つ場合は CLI 指定を優先する。
- artifact が vitest/jest 形式の場合は numFailedTests / numPassedTests / success を、Playwright 形式の場合は stats.expected / stats.unexpected を `observation.values` に自動抽出する。
- `observation_check` の判定:
  - pass claim で targets / scenarios / values がすべて空 → `missing`（warning 付き、記録は成功）
  - 一部のみ → `partial`
  - targets があり、scenarios または values がある → `recorded`
  - pass/fail 以外の claim（needs_setup 等） → `not_applicable`
- `vibepro usage report` は pass command に observation 欠落（`observation_check.status = "missing"`）を含む story を `value_signals.verification_observation_missing_story_count` でカウントし、story 別フラグを立てる。
- judgment evidence 分類（classifyVerificationEvidenceItem）は observation の targets / scenarios を照合テキストに含める。
- observation を持たない既存の verification-evidence.json は引き続き読める（後方互換）。

## 非目標

- observation 欠落による verify record の hard block。
- 非JSON証跡（スクリーンショット等）の構造化。
- 記録済み evidence への遡及付与。
