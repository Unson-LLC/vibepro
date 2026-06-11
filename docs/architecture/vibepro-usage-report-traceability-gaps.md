---
story_id: story-vibepro-usage-report-traceability-gaps
title: Usage Report Traceability Gaps Architecture
---

# アーキテクチャ

## 判断

traceability gapは、VibeProが「PRを安全に進めた」という主張を後から再構成できるかを測る監査signalとして扱う。Gate判定ではなくusage reportのvalue signalに閉じることで、既存PR flowを止めずにfake-valueを可視化する。

## 入力

- `docs/management/stories/**/*.md`
- `.vibepro/pr/<story-id>/pr-prepare.json`
- `.vibepro/pr/<story-id>/pr-create.json`
- `.vibepro/pr/<story-id>/gate-dag.json`
- `.vibepro/pr/<story-id>/pr-merge.json`
- `.vibepro/reviews/<story-id>/*/review-summary.json`
- `.vibepro/executions/<story-id>/state.json`

## 出力

Storyごとに `traceability_gaps[]` を持たせ、`value_signals.traceability_gaps[]` に横断一覧を出す。human-readable reportではTraceability Gaps sectionを独立させ、監査者が次に読むartifactと再実行コマンドを即座に分かるようにする。

## 境界

この機能はartifactの存在・鮮度・handoff可能性を観測するだけで、欠損を補完しない。欠損が見つかった場合は、該当Story/PRのartifact再生成、review record補完、または運用上のwaiver判断を別作業で行う。
