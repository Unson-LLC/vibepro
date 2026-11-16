---
story_id: story-vibepro-pr-artifact-consistency
title: PR成果物一貫性アーキテクチャ
artifact_profile: feature_packet
feature_slug: pr-artifact-consistency
---

# アーキテクチャ

## 判断

`pr prepare` が同一HEADで組み立てた正規投影を、`pr-prepare.json`、`pr-body.md`、canonical `traceability.json` の全てへ渡す。各成果物が同じ入力を再解析する構造は採用しない。

## 入力

- Story文書のAcceptance Criteria節
- `buildClauseMapForPrepare` が計算した条項map
- canonical verification evidenceの `computed_observation.values`
- Story文書と同じfeature directoryにある人間作成 `06_tasks.md`
- artifact routingが指すgenerated `task_plan` JSON

## 正規化

### Acceptance Criteria

Markdown節parserを1実装に集約する。番号付き・大文字小文字variantを同じ見出しとして扱い、次の見出しで終了する。節が見つからない場合に文書全体の箇条書きへfallbackしない。既存のrequirement分析向け文字列配列は維持し、条項map向けにはIDと行番号を持つ詳細配列を追加する。

### 検証結果

`summary` はagent提供の自由記述として保持するが、件数の権威にはしない。`runner_direct` または同等の計算済み証跡が持つ `computed_observation.values` から `tests`、`pass`、`fail` を投影し、PR本文では先に表示する。自由記述は非権威情報であることを明示する。

### タスク権限

人間作成台帳とgenerated proposalを統合しない。各authorityについてpath、件数、status内訳、task IDを別オブジェクトに保持する。generated側では `execution_policy` と `mutates_repository` を保持し、`proposal_only` を実装承認として扱わない。

## 出力

- `pr-prepare.json.traceability`: `pr prepare` が計算した条項mapとsummary
- canonical `traceability.json`: 上記と同一の条項map、status、summary
- `pr-prepare.json.verification.commands[].computed_counts`: 計算済み tests/pass/fail
- `pr-prepare.json.task_authorities`: 人間台帳とgenerated proposalの分離投影
- `pr-body.md`: 計算済み件数と二つのtask authorityを明示

## 決定的修復

`pr prepare` の再実行では、そのrunで計算した条項mapをcanonical sidecar writerへ必ず渡す。既存sidecarの古い条項をfallbackで温存しない。これにより消費側の手編集なしで同じHEADから同じ結果へ修復できる。

## 互換性とrollback

- 既存の `task_context`、verification `summary`、traceability schemaの既存キーは削除しない。
- 新しい詳細配列とauthority投影を読まない消費者は従来どおり動作する。
- 本Storyの共有parser、PR投影、sidecar伝播、回帰テストを単一commitとしてrevertすれば従来挙動へ戻る。

## 境界

- Gateのblocking方針、task生成ロジック、STAYe成果物、npm公開は変更しない。
- `06_tasks.md` は読み取り専用の人間authorityであり、VibeProが書換えない。
- generated proposalは診断結果の提案であり、人間taskのdone根拠へ昇格させない。
