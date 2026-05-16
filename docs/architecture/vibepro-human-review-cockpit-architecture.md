---
story_id: story-vibepro-human-review-cockpit
title: VibePro Human Review Cockpit Architecture
story_ref: docs/stories/vibepro-human-review-cockpit-story.md
spec_ref: docs/specs/vibepro-human-review-cockpit-spec.md
---

# Architecture: VibePro Human Review Cockpit

## 方針

`review-cockpit.html` は、PR準備成果物を読むためのレポートではなく、人間が判断して次アクションへ進むためのControl Planeとして扱う。

## 責務境界

- `pr-prepare.json`
  - PR準備の機械可読な正本
  - Story、Requirement Consistency、Gate DAG、split-plan、next_commands を保持する
- `human-review.json`
  - 人間レビュー判断の機械可読な記録テンプレート
  - 推奨判断、選択肢、未解決Gate、実行コマンド、レビュー記録欄を保持する
- `review-cockpit.html`
  - `pr-prepare.json` と `human-review.json` の人間向け投影
  - 判断、実行、証跡確認、コピー操作を1画面にまとめる
- `pr-body.md`
  - GitHub PR本文として残す
  - Cockpitの代替ではなく、PRプラットフォームに貼る要約

## データ流

1. `pr prepare` が既存の PR 準備文脈を構築する
2. Gate DAG、split-plan、scope から推奨判断を算出する
3. `human-review.json` を生成する
4. `review-cockpit.html` を構造データから直接生成する
5. manifest と `pr-prepare.json` に Cockpit / human-review の参照を保存する

## 判断モデル

- 未解決Gateがある場合は `add_evidence` を推奨する
- 差分が広い、repo-controlが混ざる、split-planが分割推奨の場合は `split_pr` を推奨する
- Gateが揃い、分割不要なら `proceed` を推奨する
- `waive_with_reason` は選択可能だが理由必須とする
- `block` は常に選択可能にする
