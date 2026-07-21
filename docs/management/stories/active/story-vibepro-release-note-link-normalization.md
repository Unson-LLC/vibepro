---
story_id: story-vibepro-release-note-link-normalization
title: Release noteのrepo-root docsリンクをcanonical source URLへ正規化する
status: active
parent_design: vibepro-release-note-link-normalization
reason: PR本文のrepo-root相対`docs/...`リンクをrelease pageへそのまま複製すると、日英ページの階層を基準に解決されVitePress buildを停止する。`docs/management`は公開site routeでもないため、投影境界でcanonical GitHub source URLへ正規化すれば、内部Storyも参照可能で生成先の階層に依存しない。rollbackは正規化commitをrevertし、対象PR本文を絶対URLへ直してlive PR payloadからdocsだけを再投影する。
---

# Release noteのrepo-root docsリンクをcanonical source URLへ正規化する

## Intent

PR本文でStoryや設計文書をrepo-root相対の`docs/...`リンクとして参照しても、post-merge release historyとVitePress buildが壊れないようにする。

## Current reality

PR #350のChange Summaryにある`docs/management/...md`リンクが、`docs/releases/`と`docs/ja/releases/`へ無変換で投影された。その結果、VitePressは各release page配下の`docs/management/...`として解決し、dead linkでbuildを停止する。

## Invariants and boundaries

- 正規化対象はinline Markdownのリンク先が`docs/`で始まるrepo-root docs参照だけとする。
- reference-style definitionはlink/image用途をdefinitionだけで判別できないため推測変換せず、VitePress buildへfail-closedする。
- 外部URL、site-root相対、anchor、`mailto:`、inline code、blockquote/list container内のfenced code、link title内のMarkdown風文字列は変更しない。未閉鎖fenceはcontainer終了後のproseまで巻き込まない。不正Unicodeを含むangle destinationは例外で全projectionを落とさず原文保持する。
- Markdown escapeとHTML entityはVitePress parserと同じdestination意味へdecode/normalizeしてからcanonical URL化し、escape表現そのものをpathへ混入させない。
- Markdown rendererは`project`、`reproject`、`release-body`だけで初期化し、`plan`と`publish-npm`の実行境界へ持ち込まない。
- raw HTMLとVue interpolationを無害化する既存契約を維持する。
- 日英release historyとCHANGELOGは同じ決定的なnote本文を保持する。

## Acceptance Criteria

- 通常の`docs/<path>`リンクはGitHub blob URLへ、画像はraw URLへ正規化される。angle-wrapped destinationの空白、Markdown escape、HTML entityもVitePressが解釈する参照先を保って正規化される。
- code span/fence・link title内の同じ文字列と、外部・anchor・既にroot-relativeなリンク、不正なangle destinationは保持される。
- 生成済みPR #350のrelease noteが正規化済みになり、`npm run docs:build`が成功する。
- 同一eventの再投影は引き続きPR番号markerで冪等である。

## Failure modes and rollback

- reference-styleを含め、Markdown destinationが正規化対象外の形なら変更せず、VitePress buildが最終検査として止める。
- canonical URLはGitHub providerと既定branchの可用性に依存する。projectorはnetwork fetchをせず、VitePress buildはURL構文を検査するが外部到達性は保証しない。provider障害時はrelease workflowを停止する。既定branch変更時はroot定数に加えて`.github/workflows/post-merge-release.yml`のbase条件、checkout、pull/reset/push refを同じbranchへ更新してから再投影する。
- 正規化が誤った場合は関数と生成済みリンクをrevertし、PR本文を絶対URLへ修正する。既定branchのclean checkoutで`gh api repos/Unson-LLC/vibepro/pulls/<PR番号> --jq '{pull_request:.}' > /tmp/vibepro-release-pr.json`、`node scripts/post-merge-release.mjs reproject --event /tmp/vibepro-release-pr.json`、`npm run docs:build`を順に実行し、release docs差分だけをreviewしてcommit/pushする。`reproject`はlive PR本文を再取得したpayloadからdocs projectionだけを更新し、npm publishやversion historyを再実行しない。

## Done evidence

- focused projector test、typecheck、VitePress buildがcurrent HEADでpassする。
- 独立reviewが対象境界と既存sanitizationの維持を確認する。
