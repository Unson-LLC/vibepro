---
story_id: story-vibepro-ci-evidence-fast-lane
title: CI Evidence Reuse & Risk-Tiered Fast Lane Architecture
---

# アーキテクチャ

## 判断

監査固定費の2大要素（フルスイートの重複実行、一律 review subagent）を、品質装置を外さずに削る。
原則は2つ:

1. **証拠の同一性**: 「同じテストスイートを、同じ HEAD で、CI が実行して成功した」は、ローカル再実行と同じ事実を証明する。重複実行は監査価値を足さないので、CI 結果を HEAD 束縛つきで evidence 化して片方を不要にする。取り込みは事実の転記であり、観測の捏造ではない — head SHA 一致・conclusion 一致・取得元 run URL の3点を必ず記録する。
2. **リスク比例**: gate 側には既に surface / risk profile 判定（docs_only route、change risk classification、judgment surface profile）がある。一律で review subagent を要求するのをやめ、低リスク変更では Agent Review Gate を **typed N/A**（既存の bug_physics と同じ「waiver とは区別される明示的非適用」）にする。非適用は判定根拠つきで gate-dag に残り、usage report で常時カウントされるため、fast lane の濫用がそのまま監査対象になる。**ソースを変更する light 変更は fast lane の対象外**とし、review を維持する — 軽微でもソースコードの挙動変更には review 価値があるため、fast lane は docs-only と非ソース light（config / test / docs）に限定する。失格信号は changeClassification.risk_surfaces だけでなく、secret/credential safety surface・新規ネットワーク/API 呼び出し・high-risk engineering route も含め、いずれか1つでも検出されたら適用しない。

実測根拠（2026-06-12、PR #177〜#179）: 監査固有コスト約3〜4割のうちフルスイート重複が約10分/story、
review subagent が3〜6分/story。4回の review は blocking finding 0件で、実装を実際に修正させたのは
gate 側だった。fast lane は「review が無価値」ではなく「review コストをリスクが正当化する変更に集中させる」措置。

## 入力

- gh CLI による PR / HEAD の check 結果（statusCheckRollup: name, status, conclusion, head SHA, run URL）
- 現在の git HEAD（束縛検証用）
- pr prepare の既存判定: prRoute（docs_only 等）、changeClassification（profile / risk_surfaces）
- check 名 → verification kind のマッピング（デフォルト + CLI 上書き）

## 出力

- `vibepro verify import-ci`: verification-evidence.json への command entry 追加
  - command: 取得元を示す文字列（CI run 参照を含む）
  - artifact: 取得した check rollup JSON（保存ファイル）→ artifact_check verified
  - observation: check 名 / conclusion / run URL / head SHA → observation_check recorded
  - git_context: 記録時 HEAD（既存の binding 機構をそのまま使用）
- pr prepare: 低リスク判定時に `gate:agent_review` を typed N/A 化する fast lane ノード
  - gate-dag に `fast_lane` ノード（status not_applicable、判定根拠: route / profile / surfaces の実値）
  - pr-prepare.json の gate_status に fast_lane フラグ
- usage report: `value_signals.fast_lane_story_count` と story 別フラグ

## 境界

- import-ci は head SHA 不一致・failure・pending を pass として記録する経路を持たない（拒否はエラーとして可視）
- CI のフルスイート結果は generic command 規律に従い、judgment spine の focused 証拠に化けない。spine が要求する surface 固有の観測（focused test / artifact replay / scenario）は引き続きローカルで取る — これらは秒〜十秒オーダーで、削減対象の固定費ではない
- fast lane は risk surface が1つでもあれば発動しない。境界判定は既存の changeClassification を使い、この story で判定器自体は変更しない
- fast lane でも human-review.json は生成され、人間の最終判断面は残る
- CI 応答の真正性検証（署名・attestations)は scope 外。脅威モデル上、gh 認証済み API の応答改竄は「ローカルテスト出力の改竄」と同等の信頼前提に置く
