---
story_id: story-vibepro-verification-observation-artifacts
title: "verify recordに観測対象と実観測値の構造化記録を追加しpass claimの証拠品質を上げる"
view: dev
period: 2026-06
source:
  type: value-audit
  id: VP-VALUE-AUDIT-2026-06-12-VERIFICATION-OBSERVATION
  title: "pass claimの多くがartifact_check missingで「何が観測されたか」の機械可読証拠が薄い"
related_stories:
  - story-vibepro-traceability-autobind-backfill
  - story-vibepro-engineering-judgment-surface-evidence
architecture_docs:
  - ../../../architecture/vibepro-verification-observation-artifacts.md
spec_docs:
  - ../../../specs/vibepro-verification-observation-artifacts.md
status: active
created_at: 2026-06-12
updated_at: 2026-06-12
---

# verify recordに観測対象と実観測値の構造化記録を追加しpass claimの証拠品質を上げる

## User Story

**As a** VibeProの検証証跡を後から監査する開発者
**I want to** 各 verify record に「どのファイル・どのシナリオ・どんな実測値を観測したか」が構造化JSONで残ってほしい
**So that** pass/fail と command 文字列だけの「何を走らせたか」記録ではなく、「何が観測されたか」を機械可読に再構成できる

## 背景

2026-06-12 監査時点で、pass claim の多くが `artifact_check.status = "missing"` だった。
現在の `vibepro verify record` は kind / status / command / 任意 summary / 任意 artifact のみで、
観測の中身（対象ファイル、対象シナリオ、実観測値）は summary の自由文に依存している。
judgment spine / path surface の証拠分類も summary 文字列の正規表現照合に依存しており、
「summary に正しい単語を書く」ことと「実際に観測した」ことの距離が fake-value の温床になる。

## Scope

- `verify record` に `--target <path>`（複数可）、`--scenario <text>`（複数可）、`--observed <key=value>`（複数可）を追加し、command entry に構造化 `observation` を記録する
- 認識可能な artifact（vitest/jest、Playwright、generic status JSON）から実観測値を自動抽出して `observation.values` に merge する
- pass claim で observation が空の場合の `observation_check` 判定と warning を追加する
- usage report に observation 欠落の story 数 signal を追加する
- judgment evidence 分類が summary だけでなく observation の targets / scenarios も照合対象に含める

## 受け入れ基準

- [ ] `vibepro verify record` が `--target` / `--scenario` / `--observed key=value` を受け取り、verification-evidence.json の command entry に `observation: {targets[], scenarios[], values{}}` として保存する
- [ ] `--observed` の value は文字列として保存され、`key=value` 形式でない入力はエラーになる
- [ ] artifact が generic status JSON で `observed` オブジェクトを含む場合、その key/value が `observation.values` に自動 merge される（CLI 指定が優先）
- [ ] artifact が vitest/jest / Playwright 形式の場合、実測カウント（numFailedTests / numPassedTests / stats.expected / stats.unexpected 等）が `observation.values` に自動抽出される
- [ ] pass claim で observation の targets / scenarios / values がすべて空の場合、`observation_check.status = "missing"` が command entry に記録され warning が出る（記録自体は成功する）
- [ ] targets / scenarios / values の一部だけがある場合は `observation_check.status = "partial"`、targets と（scenarios または values）が揃えば `"recorded"` になる
- [ ] `vibepro usage report` の `value_signals` に `verification_observation_missing_story_count` が追加され、pass command に observation 欠落がある story がカウントされる
- [ ] judgment evidence 分類（classifyVerificationEvidenceItem）が observation の targets / scenarios のテキストも照合対象に含め、summary 自由文だけに依存しない
- [ ] 既存の verification-evidence.json（observation なし）を読んでもエラーにならず、既存テストが全て通る
- [ ] テストは「observation 記録」「key=value バリデーション」「artifact からの自動抽出」「observation_check 3状態」「usage report signal」「judgment 分類への寄与」を含む

## 非目標

- observation 欠落での verify record の hard block（既存フロー全体を即時に壊すため、まず機械可読 signal 化に留める）
- スクリーンショット・動画など非JSON証跡の構造化
- 過去に記録済みの verification-evidence.json への observation の遡及付与
