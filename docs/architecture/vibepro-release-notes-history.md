---
story_id: story-vibepro-release-notes-history
title: VibePro Release Notes History Architecture
parent_design: vibepro-release-notes-history
---

# Architecture

## 判断

公開情報を二層に分ける。`reference/version-history` は「どの版を実行しているか」を示す版・チャネルの正本、`releases/` は「何が変わったか」を説明する読者向け履歴とする。

release notesはGitHubのmerged PR一覧を母集団にするが、正式リリースとは呼ばない。正式公開版はGitHub Release、git tag、npm registryで確認できたものだけを掲載する。PR履歴は月次の開発マイルストーンとして再構成し、各主張を代表PRへリンクする。依存更新や監査artifactの追記は集計には含めるが、利用者が判断する主要変更からは除外する。

## 情報境界

- Authority: GitHub merged PR、GitHub Release/tag、npm registry、repository `main`
- Snapshot: 2026-07-16、merged PR 281件、main target 273件
- Public surface: 日英index + 4 monthly pages、navigation、sidebar、version history link
- Private surface: Story / Architecture / Spec、取得時の作業artifact

## 互換性とrollback

CLI、package、runtime契約は変更しない。既存のversion-history URLも維持する。rollbackは新規release routeとnavigation entryを除去するだけで完了し、npm版や既存manual routeには影響しない。
