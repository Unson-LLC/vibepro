---
story_id: story-vibepro-release-notes-history
title: "公開リリースノートをPR履歴から遡って整備する"
status: active
view: dev
period: 2026-07
created_at: 2026-07-16
updated_at: 2026-07-16
parent_design: vibepro-release-notes-history
architecture_docs:
  - ../../../architecture/vibepro-release-notes-history.md
spec_docs:
  - ../../../specs/vibepro-release-notes-history.md
reason: >-
  CHANGELOGだけを公開する案では利用者が変化の意味や根拠PRを追えず、PRを全件列挙する案では依存更新や
  中間PRに重要な変化が埋もれる。正式なGitHub/npmリリースとmain上の開発マイルストーンを分離し、
  月次の主要テーマと根拠PRを日英で公開する。既存URLとnpm契約は変えず、問題時は新しいrelease routeと
  navigationだけを戻せる。内部Story/Spec/Architectureは引き続きpublic buildから除外する。
---

# 公開リリースノートをPR履歴から遡って整備する

## User Story

**As a** VibeProの導入・更新・評価を判断する利用者

**I want to** 正式公開版と、その後にmainへ入った主要変更を時系列で読める

**So that** 現在使える版、開発中の機能、変更の根拠を混同せずに判断できる

## Scope

- GitHubのマージ済みPR 281件（2026-07-16取得）を月別に集計する
- GitHub Release、npm registry、git tagを正式公開版の正本として扱う
- 2026年1月・5月・6月・7月の主要な変化を、根拠PR付きで日英公開する
- `/releases/` と `/ja/releases/` を公開navigationとbuild contractへ追加する
- version historyから詳細なrelease notesへ導線を追加する
- 集計値、主要リンク、日英ページ対応をテストで固定する

## Acceptance Criteria

- [ ] VRNH-AC-001: Release Notes indexが正式公開版と開発マイルストーンの違いを説明する
- [ ] VRNH-AC-002: 281 merged PR、うちmain向け273件という取得時点の集計と取得日を表示する
- [ ] VRNH-AC-003: 2026年1月・5月・6月・7月のページが日英で存在し、主要PRへ直接リンクする
- [ ] VRNH-AC-004: GitHub internal betaとnpm alpha/betaの公開日・版を開発マイルストーンと分ける
- [ ] VRNH-AC-005: Navigation、sidebar、version historyからRelease Notesへ到達できる
- [ ] VRNH-AC-006: Public build contractが日英10 routeを必須公開面として検証する
- [ ] VRNH-AC-007: 自動テストが集計値、根拠リンク、言語対応、公開route登録のdriftを検出する

## Non Goals

- 新しいnpm版やGitHub Releaseの公開
- 全281 PRの本文を転載すること
- PRタイトルだけから互換性やbreaking changeを推測すること
- 既存CHANGELOGをrelease notesの代わりに廃止すること
