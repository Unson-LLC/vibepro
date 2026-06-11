---
story_id: story-vibepro-review-judgment-delta-handoff
title: Review Judgment Delta Handoff Architecture
---

# アーキテクチャ

## 判断

review resultは単なる判定ではなく、次のengineerが判断を再構成するhandoff artifactである。`inspection.summary` は一行要約として有用だが、実際に見た入力の一覧と、懸念から結論への判断差分がないと、再review時に同じ調査を繰り返しやすい。

## 入力

- `review record --inspection-summary`
- `review record --inspection-evidence`
- `review record --inspection-input`
- `review record --judgment-delta`
- subagent result JSON fields: `inspection_inputs`, `judgment_delta`

## 出力

- `review-result-<role>.json`
  - `inspection.summary`
  - `inspection.evidence`
  - `inspection.inputs[]`
  - `judgment_delta[]`
- `review-summary.json` / `review status --json`
  - roleごとの同じhandoff fields
- `review-summary.md`
  - role行に短い `inputs=...` と `judgment_delta=...` を表示

## 境界

このStoryはhandoff情報を保存・表示するだけで、review gateのpass/fail条件は変更しない。品質判定は引き続きAgent Review Gate、Review Inspection Required Gate、Artifact Consistency Gateに委ねる。
