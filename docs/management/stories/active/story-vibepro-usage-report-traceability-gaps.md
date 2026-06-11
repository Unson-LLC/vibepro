---
story_id: story-vibepro-usage-report-traceability-gaps
title: "usage reportでtraceability欠損storyをfirst-class signalにする"
view: dev
period: 2026-06
source:
  type: value-audit
  id: VP-VALUE-AUDIT-2026-06-10-TRACEABILITY
  title: "Merged storyでもPR/review/merge artifactsが欠けると監査価値が落ちる"
related_stories:
  - story-vibepro-usage-report
architecture_docs:
  - ../../../architecture/vibepro-usage-report-traceability-gaps.md
spec_docs:
  - ../../../specs/vibepro-usage-report-traceability-gaps.md
status: active
created_at: 2026-06-11
updated_at: 2026-06-11
---

# usage reportでtraceability欠損storyをfirst-class signalにする

## User Story

**As a** VibeProの価値監査をする開発者  
**I want to** traceabilityが欠けたStoryを`usage report`で直接見つけたい  
**So that** merged済みなのにhandoffや再監査が再構成できないStoryを、手grepではなく製品上の改善対象として扱える

## 背景

`vibepro usage report` はStory/Gate/Reviewの集計面として価値を出し始めている。一方で、監査では「Story/Specはあるが `.vibepro/pr/<story-id>` がない」「merge artifactが古い」「review summaryはあるがrequired roleやprovenanceが欠ける」といった欠損を、まだ人間が横断的に読んで判断している。

これは単なる表示改善ではない。VibeProがPR品質を担保したと言えるかは、merged後にStory-to-PR-to-review-to-mergeの鎖を再構成できるかで決まる。

## Scope

- `vibepro usage report` のStory別シグナルに traceability 欠損を追加する
- `.vibepro/pr/*`, `.vibepro/reviews/*`, execution state, merge artifacts, Story docs を横断する
- human-readable と JSON の両方で、欠損種別と該当Storyを出す

## 受け入れ基準

- [ ] Story docが存在するのに `.vibepro/pr/<story-id>` がないStoryを `traceability_missing_pr_artifact` として表示する
- [ ] merged/closed相当のStoryで `pr-merge.json` が存在しない、またはHEAD/PR番号/merged stateがstaleな場合に `traceability_stale_merge_artifact` として表示する
- [ ] review summaryやreview resultが存在するがrequired role、status、agent provenance、closed lifecycleのいずれかが欠ける場合に `traceability_incomplete_review_evidence` として表示する
- [ ] JSON出力に `value_signals.traceability_gap_count`, `traceability_gap_rate`, `traceability_gaps[]` を含める
- [ ] human-readable reportでは、Story ID、欠損種別、確認したartifact path、次に見るべきコマンドを1行で出す
- [ ] traceability欠損はPR作成可否を直接blockしないが、監査上のfirst-class value/fake-value signalとして扱う
- [ ] 既存の`stale_evidence` / `story_source_mismatch` / `raw_pr_bypass_suspected`の表示を壊さない
- [ ] テストは「merged story with no pr dir」「stale merge artifact」「review role missing」「clean traceability」の4ケースを含む

## 非目標

- GitHub APIだけで過去PRを完全復元すること
- 欠損artifactを自動生成して監査上の穴を埋めたことにすること
- Storyをmerged/closedへ移動する運用フロー全体をこのStoryで作り替えること
