---
story_id: story-vibepro-verification-observation-artifacts
title: Verification Observation Artifacts Architecture
---

# アーキテクチャ

## 判断

検証証跡の信頼性は「何を走らせたか（command）」ではなく「何が観測されたか（observation）」で決まる。observation を summary 自由文から構造化フィールドへ移し、artifact の機械可読出力から自動抽出することで、「summary に正しい単語を書く」ことと「実際に観測した」ことの距離を縮める。欠落は hard block ではなく `observation_check` として機械可読に露出し、usage report の value signal で監査対象にする（artifact_check と同じ非破壊パターン）。

## 入力

- `vibepro verify record` の CLI 引数（`--target` / `--scenario` / `--observed key=value`）
- `--artifact` の機械可読出力（vitest/jest、Playwright、generic status JSON の `observed` オブジェクトと実測カウント）
- `.vibepro/pr/<story-id>/verification-evidence.json`（既存 command entries）

## 出力

- verification-evidence.json の command entry に追加されるフィールド:
  - `observation: { targets: string[], scenarios: string[], values: { [key]: string } }`
  - `observation_check: { status: recorded | partial | missing | not_applicable, reason }`
- `usage report` の `value_signals.verification_observation_missing_story_count` と story 別フラグ
- judgment evidence 分類（pr-manager の classifyVerificationEvidenceItem）が observation テキストを照合に含めることで、spine/path-surface gate の証拠判定が構造化データに接続される

## 境界

- observation 欠落は warning + signal であり、verify record を失敗させない（必須化の hard block は採用実績を見て別 story で判断）
- artifact からの自動抽出は認識可能なフォーマットに限定し、推測で値を作らない
- 過去の evidence への遡及付与はしない。observation なしの既存 entry は `observation_check` なしのまま読める
