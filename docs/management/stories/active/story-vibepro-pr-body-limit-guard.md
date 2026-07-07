---
story_id: story-vibepro-pr-body-limit-guard
title: GitHub PR本文の65,536文字制限をVibeProのPR作成前に吸収する
status: active
parent_design: vibepro-pr-body-limit-guard
source:
  type: github_issue
  id: "227"
architecture_docs:
  - docs/architecture/vibepro-pr-body-limit-guard.md
spec_docs:
  - docs/specs/story-vibepro-pr-body-limit-guard-spec.md
---

# Story

VibeProのPR bodyは人間が判断する短いbriefであり、詳細なGate DAG、Agent Review、監査ログは `.vibepro/pr/<story-id>/` artifactを正本にする。

## 理想

`vibepro pr create` はGitHubへ送る直前にPR本文サイズを検査し、GitHubの65,536文字制限を超える本文をそのまま `gh pr create --body-file` に渡さない。

本文が長すぎる場合でも、生成済みの `pr-body.md` は監査正本として残し、GitHub投稿用にはartifact参照中心の短い本文を使う。`pr-create.json` には、元本文と投稿本文のサイズ、圧縮有無、投稿に使ったbody fileが残る。

## 現状のギャップ

`vibepro pr create` は `pr prepare` が生成した `pr-body.md` を無条件で `gh pr create --body-file` または `gh pr edit --body-file` に渡している。`renderPrBody` は簡潔化されているが、waiver追記や将来のartifact詳細混入でGitHub制限を超えた場合、VibePro側のartifactには投稿失敗の理由がサイズ制限として明示されない。

## Acceptance Criteria

- `vibepro pr create` はGitHub投稿前に `pr-body.md` の文字数とbyte数を計測する。
- 生成本文が65,536文字以内なら従来の `pr-body.md` をそのまま投稿し、`pr-create.json` にwithin-limit metadataを記録する。
- 生成本文が65,536文字を超える場合、投稿用の `pr-body.github.md` を生成し、`gh pr create` と既存PR refreshの `gh pr edit` はその短縮本文を使う。
- 短縮本文は詳細監査ログを本文に展開せず、`.vibepro/pr/<story-id>/pr-body.md`、`pr-prepare.json`、`decision-index.json`、`gate-dag.json` へのartifact参照を含む。
- `pr-create.json` は圧縮有無、元本文サイズ、投稿本文サイズ、生成本文file、投稿本文file、圧縮戦略を記録する。

## Tasks

- [x] PR作成前にGitHub本文サイズを検査する。
- [x] 制限超過時にartifact参照版の投稿本文を生成する。
- [x] `pr-create.json` にbody limit metadataを記録する。
- [x] 回帰テストで長文本文の短縮とartifact記録を固定する。
