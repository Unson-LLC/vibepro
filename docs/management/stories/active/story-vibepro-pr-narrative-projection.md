---
story_id: story-vibepro-pr-narrative-projection
title: 保存済みPR説明を生成PR本文へ確実に投影する
status: active
artifact_profile: feature_packet
feature_slug: pr-narrative-projection
reason: 保存済み説明をPR本文へ投影する。要求文への状態埋め込みや投稿後の手修正は状態と表示を分岐させるため採用しない。既存の固定骨格と説明検証を維持し、説明がない場合は従来本文へ戻せる。
architecture_docs:
  - docs/architecture/story-vibepro-pr-narrative-projection.md
spec_docs:
  - docs/features/pr-narrative-projection/02_functional_spec.md
---

# Story

VibePro利用者として、`vibepro report write --kind pr-body` で検証・保存した説明が、次の `vibepro pr prepare` で生成される `pr-body.md` に表示されてほしい。

そうすれば、現在の実行状態やレビュー焦点をAcceptance Criteriaの要求文へ埋め込まず、GitHub上の判断資料として読める。

## 現状のギャップ

説明の保存と検証は成功するが、最小コア版の `preparePullRequest` は説明を読まず、`renderPrBody` も専用欄を描画しない。このため保存成功とユーザー可視表示が分断されている。

## Acceptance Criteria

- AC-001: `pr prepare` は対象Storyの検証済み `pr-body` 説明を読み、生成する `pr-body.md` の専用欄へ投影する。
- AC-002: `summary`、`review_focus`、`risks_synthesis`、`open_questions` を固定見出しとTalking Point ID付きで表示する。
- AC-003: 説明が存在しない場合は空の専用欄を増やさず、従来のPR本文を維持する。
- AC-004: 生成PR本文を直接読む回帰テストで、保存済み説明の表示と未保存時の非表示を固定する。
- AC-005: 保存済み説明が現在のStory・HEAD・検証・レビュー状態と一致しない場合、古い本文は表示せず更新が必要だと明示する。
- AC-006: 説明スロットは単一行かつ280文字以内の平文だけを許可し、Markdown構造を注入できる入力を保存時に拒否する。

## Tasks

- [ ] 失敗するPR生成回帰テストを追加する。
- [ ] 保存済み説明をPR準備経路へ接続する。
- [ ] 固定骨格内へ説明スロットを描画する。
- [ ] 対象テストとVibePro Gateを通す。
- [ ] 保存説明の鮮度拘束とMarkdown境界を回帰テストで固定する。
