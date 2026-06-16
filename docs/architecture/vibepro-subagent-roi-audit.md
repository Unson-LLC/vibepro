---
story_id: story-vibepro-subagent-roi-audit
title: VibePro Subagent ROI Audit Architecture
---

# Architecture: VibePro Subagent ROI Audit

## 判断

Subagent ROIは `usage report` の監査ビューとして実装する。Agent Review Gateのpass/block判定には介入せず、review artifactsから「価値が出たか」「無駄が多いか」を後から測れるようにする。

## 入力

- `.vibepro/reviews/<story>/<stage>/review-summary.json`
- `.vibepro/reviews/<story>/<stage>/review-result-<role>.json`
- `.vibepro/reviews/<story>/<stage>/lifecycle.json`
- 任意の `--log` / `--codex-log` / `--claude-log`

## 出力

`vibepro usage report --subagent-roi` は以下を返す。

- `subagent_roi.summary`: 全体のreview数、high/medium/low value数、accepted/resolved finding数、duplicate/false positive数、elapsed minutes、tokens/cost
- `subagent_roi.by_story`: story単位のROI集計
- `subagent_roi.by_review`: role review単位のvalue score、value signals、waste signals、cost
- `log_signals.subagent_activity_mentions`: Codex/Claude logに現れたspawn/wait/close activity

## Scoring

Value scoreは0から100の範囲で返す。accepted/resolved finding、block/needs_changes、high severity、reconstructable inputs、judgment_delta、strong provenance、closed lifecycleを加点する。duplicate、false positive、stale、timeout、weak provenance、pass-only-no-delta、高elapsedを減点する。

## 境界

token/costは任意入力であり、既存artifactでは欠落し得る。欠落時は `token_missing_review_count` として表示し、elapsed/cost tierで代替観測する。外部ログはsubagent activityの存在確認に使い、ROI scoreの正本にはしない。
