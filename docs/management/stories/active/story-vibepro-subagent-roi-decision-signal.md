---
story_id: story-vibepro-subagent-roi-decision-signal
title: subagent ROIをpass確認ではなく意思決定シグナルにする
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-19-SUBAGENT-ROI-SIGNAL
related_stories:
  - story-vibepro-subagent-roi-audit
architecture_docs:
  - docs/architecture/vibepro-subagent-roi-decision-signal.md
spec_docs:
  - docs/specs/vibepro-subagent-roi-decision-signal.md
---

# Story

VibeProの `usage report --subagent-roi` はsubagent reviewを集計できるようになった。
一方、2026-06-19の価値監査では、実行結果が `total_reviews: 4`、
`high_value_review_count: 0`、`value_score_average: 42`、`token_missing_review_count: 4`
となり、すべてのreviewがほぼ同じmedium valueに寄っていた。

この状態では、「subagentを使った事実」は見えるが、どのreviewがmerge判断を改善し、
どのreviewがpass確認だけだったのかをsenior engineerが判断しにくい。

VibeProは、ROIをreview presenceの集計ではなく、accepted/resolved finding、判断変更、
重複、false positive、token/cost欠落を含む意思決定シグナルとして出す必要がある。

## Acceptance Criteria

- `usage report --subagent-roi` は `accepted_finding` または `resolved_finding` があるreviewを
  high value candidateとして明示する。
- `pass` かつ finding/disposition/judgment_delta が無いreviewは `pass_only_no_decision_signal`
  などのwaste signalを持つ。
- findingがあるがdispositionが無いreviewは、価値未確定として `undisposed_finding` を強調する。
- token/costが未記録のreviewは `token_missing` として表示し、合計costを `0` と誤読させない。
- story別集計は「継続すべきrole」「削減候補role」「追加証跡が必要なrole」をmachine-readableに返す。
- human-readable reportは、単なるscore順ではなく、次の運用判断に直結する分類で表示する。

## Non Goals

- ROI scoreをPR gateのpass/block条件にすること。
- token/costを必須入力にして既存artifactを無効化すること。
- LLMの出力品質を自動で真偽判定すること。
