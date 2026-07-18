---
story_id: story-vibepro-pr-driven-continuous-release
title: PRマージからマニュアル・VitePress・npmまで完全自動でリリースする
status: active
parent_design: vibepro-pr-driven-continuous-release
source:
  type: operator_request
  id: pr-driven-continuous-release-2026-07-18
created_at: 2026-07-18
updated_at: 2026-07-18
reason: "ADR unnecessary: alternatives were a manual release PR, post-release changelog edits, and commit-log AI summarization; merged PR metadata is the deterministic source; ordinary merges remain compatible because npm publication requires a version increase; rollback disables the workflow and reverts generated docs while npm versions stay immutable; the boundary is PR metadata, release-note docs, Cloudflare Pages, GitHub Release, npm, dist-tags, and recovery."
---

# Story: PRマージからマニュアル・VitePress・npmまで完全自動でリリースする

## User Story

**As a** VibeProを開発・利用するユーザー
**I want to** PRをmainへマージするだけで、PR本文の変更説明がマニュアルへ反映され、VitePressと必要なnpmバージョンが自動公開される
**So that** リリースノート転記、GitHub Release作成、npm publish、ドキュメント公開を人手で繰り返さず、利用者が常に公開版と一致する説明を読める

## Background

現在のnpm公開はGitHub Releaseの `published` イベントから実行されるが、リリースノートとマニュアル更新は同じライフサイクルへ接続されていない。PR本文には変更内容、理由、検証、リスクがすでに記載されるため、別のリリース準備PRを設けず、マージ済みPRの本文を変更説明の正本として各公開面へ配布する。

## Acceptance Criteria

### PR本文を正本にしたリリースノート

- [ ] mainへマージされたすべてのPRについて、PR番号、title、author、merge commit、merged_at、PR URL、PR本文の利用者向け変更説明を含むリリースノートが決定的に生成される。
- [ ] commit logからAIが変更内容を推測せず、VibePro PR本文の安定セクション（変更概要、互換性・破壊的変更、利用者に必要な操作）を使用する。
- [ ] 任意セクションが空の場合は `なし` へ正規化し、再処理しても同一PRが重複しない。

### マニュアル更新とVitePressデプロイ

- [ ] すべてのmain向けPRマージで、日英のVitePressリリース履歴・索引・CHANGELOGを自動更新する。
- [ ] リリースノート生成後にVitePress buildとCloudflare Pages deployを自動実行する。
- [ ] docs-only PRもnpm versionを変更せず上記まで完了し、bot commitによる無限ループを起こさない。

### version変更時のGitHub Releaseとnpm公開

- [ ] マージ前後の `package.json` versionを比較し、SemVerが増加したPRだけGitHub Releaseとnpm公開へ進む。
- [ ] Releaseのtag/title/body、npm version/gitHeadは同一の対象commitと生成済みノートへ結び付く。
- [ ] npm versionとdist-tagの収束を確認してからGitHub Releaseを公開し、package公開失敗時にRelease/docsだけを先行させない。
- [ ] prerelease/stableを判定して `alpha`、`beta`、`latest` を明示的に設定・検証し、version変更なしではRelease/npmを実行しない。

### 完全自動・回復可能なリリース

- [ ] 正常系で人間の承認、リリース準備PR、手動Release、手動npm publishを必要としない。
- [ ] 既に公開済みならversion、gitHead、dist-tagを照合して残処理を再開し、registry検証には上限付きretry/backoffを行う。
- [ ] docs deploy、Release、npmの状態と修復操作をActions summaryへ記録し、secretを本文・ログ・生成物へ出さない。
- [ ] 失敗時に公開済みnpm versionを削除・上書きしない。
- [ ] PR本文とtitleを含むPR由来の表示値はraw HTMLとVue interpolationを無効化してから公開面へ投影する。
- [ ] 複数PRが短時間にマージされても別PRのpending workflowを置換せず、deploy直前に最新mainを取り込んで全PRのノートを公開する。
- [ ] npm公開とGitHub Releaseの不可逆区間をpackage単位の2時間atomic leaseで直列化し、自動・手動workflowを90分以内に打ち切ることで古いrunのread-write interleaveとlive ownerのlease失効を防ぐ。

## Non-goals

- 人間による毎回の転記・承認、commit logからの変更説明推測、version不変PRのnpm publish、公開済みversionの上書き、内部artifactやsecretの公開は行わない。

## Success Indicators

- PRマージからVitePress、version変更時のGitHub Release・npm・dist-tag検証まで追加の人間操作0回で完了する。
- 公開マニュアル、Release、npm packageのversion、commit、変更説明が相互追跡でき、再実行が重複なく収束する。
