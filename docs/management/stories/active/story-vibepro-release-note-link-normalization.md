---
story_id: story-vibepro-release-note-link-normalization
title: Release noteのrepo-root docsリンクをcanonical source URLへ正規化する
status: active
parent_design: vibepro-release-note-link-normalization
reason: PR本文のrepo-root相対`docs/...`リンクをrelease pageへそのまま複製すると、日英ページの階層を基準に解決されVitePress buildを停止する。`docs/management`は公開site routeでもないため、投影境界でcanonical GitHub source URLへ正規化すれば、内部Storyも参照可能で生成先の階層に依存しない。rollbackは正規化関数と生成済み2リンクのrevertで完結する。
---

# Release noteのrepo-root docsリンクをcanonical source URLへ正規化する

## Intent

PR本文でStoryや設計文書をrepo-root相対の`docs/...`リンクとして参照しても、post-merge release historyとVitePress buildが壊れないようにする。

## Current reality

PR #350のChange Summaryにある`docs/management/...md`リンクが、`docs/releases/`と`docs/ja/releases/`へ無変換で投影された。その結果、VitePressは各release page配下の`docs/management/...`として解決し、dead linkでbuildを停止する。

## Invariants and boundaries

- 正規化対象はMarkdownのリンク先が`docs/`で始まるrepo-root docs参照だけとする。
- 外部URL、site-root相対、anchor、`mailto:`、inline code、fenced codeは変更しない。
- raw HTMLとVue interpolationを無害化する既存契約を維持する。
- 日英release historyとCHANGELOGは同じ決定的なnote本文を保持する。

## Acceptance criteria

- 通常の`docs/<path>`リンクはGitHub blob URLへ、画像はraw URLへ正規化される。
- code span/fence内の同じ文字列と、外部・anchor・既にroot-relativeなリンクは保持される。
- 生成済みPR #350のrelease noteが正規化済みになり、`npm run docs:build`が成功する。
- 同一eventの再投影は引き続きPR番号markerで冪等である。

## Failure modes and rollback

- Markdown destinationが正規化対象外の形なら変更せず、VitePress buildが最終検査として止める。
- 正規化が誤った場合は関数と生成済みリンクをrevertし、PR本文を絶対URLへ修正して再投影できる。

## Done evidence

- focused projector test、typecheck、VitePress buildがcurrent HEADでpassする。
- 独立reviewが対象境界と既存sanitizationの維持を確認する。
