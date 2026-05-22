---
story_id: story-vibepro-network-contract-gate
title: UI改修に伴うAPI契約破壊をVibeProが検知する
status: active
---

# UI改修に伴うAPI契約破壊をVibeProが検知する

## Background

example travel appの詳細検索無限スクロール対応で、既存のServer Action呼び出しが存在しないHTTP API呼び出しへ置換され、Vercel previewで `POST /api/detail-search` が404になった。type-checkは通り、UI中心の診断でも検知できなかった。

これはexample travel app固有の問題ではなく、UI改修時に「既存のserver function contractをHTTP API contractへ変える」汎用リスクである。

## User Story

As a VibePro user,
I want VibePro to detect newly introduced `/api/...` client calls that do not have matching Next.js API routes or runtime network evidence,
so that UI changes cannot silently break API contracts while type-check and superficial UI checks still pass.

## Acceptance Criteria

- 差分内または診断対象内の `fetch('/api/...')`、template literal、axios/wrapper系API client callを検出できる。
- Next.js App Router `app/api/**/route.ts` と Pages Router `pages/api/**` のroute実体を照合できる。
- 対応routeが存在しないAPI client callはCritical findingとして検出する。
- 既存server function呼び出しからHTTP API呼び出しへの置換を高リスク変更としてPR gateに表示する。
- Playwright flow verification中のAPI 4xx/5xx、HTML response、console error、unhandled runtime error、既知UIエラー文言をfail扱いにする。
- PR prepare / HTML reportにNetwork Contract Findingsを表示し、壊れたAPI path、導入ファイル、原因commit候補を確認できる。
- example travel app PR #322相当の `/api/detail-search` route不在をregression testで検出し、PR #323相当のroute追加後はmissing route findingが消える。
