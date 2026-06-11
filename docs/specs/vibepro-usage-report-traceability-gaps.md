---
story_id: story-vibepro-usage-report-traceability-gaps
title: Usage Report Traceability Gaps Spec
---

# 仕様

## 必須挙動

- `vibepro usage report` はStory doc、PR artifacts、review summaries、execution state、merge artifactを横断してStory traceabilityを評価する。
- Story docが存在するが `.vibepro/pr/<story-id>` 配下のPR artifactがない場合、Storyに `traceability_missing_pr_artifact` gapを付与する。
- merged/closed/done相当のStoryで `pr-merge.json` がない場合、またはmerge artifactのHEAD/PR stateが現在のPR artifactと矛盾する場合、`traceability_stale_merge_artifact` gapを付与する。
- review summaryが存在するがrequired role、status、agent provenance、closed lifecycleのいずれかを確認できない場合、`traceability_incomplete_review_evidence` gapを付与する。
- JSON出力の `value_signals` に `traceability_gap_count`, `traceability_gap_rate`, `traceability_gaps[]` を含める。
- human-readable reportはTraceability Gaps sectionを表示し、Story ID、gap kind、artifact path、推奨確認コマンドを含める。
- traceability gapは観測signalであり、usage report自身はGate判定やPR作成可否を変更しない。

## 非目標

- 欠損artifactを自動生成すること。
- GitHub APIで過去PRを完全復元すること。
- Story lifecycle運用をこの機能だけで定義し直すこと。
