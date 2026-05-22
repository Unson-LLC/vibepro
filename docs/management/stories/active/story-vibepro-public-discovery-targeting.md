---
story_id: story-vibepro-public-discovery-targeting
title: "public-discoveryの公開対象判定と抑止を正確にする"
source:
  type: github_issue_group
  id: "#47 #48 #49 #50"
  title: "public-discovery false positives from verification files, private routes, metadata inheritance, and missing suppressions"
architecture_docs:
  - ../../architecture/vibepro-public-discovery-targeting.md
spec_docs:
  - ../../specs/vibepro-public-discovery-targeting.md
status: active
view: dev
horizon: month
period: 2026-05
created_at: 2026-05-22
updated_at: 2026-05-22
---

# Story: public-discoveryの公開対象判定と抑止を正確にする

## User Story

**As a** VibeProでAI検索/LLMO向けの公開ページ診断を回すユーザー
**I want to** VibeProが公開SEO対象、private/auth/internal/demo/verificationを区別し、Next.js metadata継承と抑止理由を理解する
**So that** 実際に改善すべき公開入口だけに集中でき、検証ファイルやprivate app導線を誤って最適化しない

## Background

Aitle dogfood run `llmo-public-discovery-fix6-20260522T034240Z` で、Google verification file、demo page、auth/private app route、metadataをlayoutから継承しているApp Router pageが public-discovery のLLMO findingsとして出続けた。

これは公開発見診断としてはノイズが大きく、ユーザーが正しく維持すべきファイルを編集したり、private app画面をSEO対象として扱ったりする原因になる。

## Acceptance Criteria

- [ ] Google Search Console等のverification HTMLはmetadata/schema/E-E-A-T/content findingsを出さない
- [ ] demo/test/sandbox/playground routeは公開SEO対象として扱わない
- [ ] `(auth)` / `(app)` / auth-only / private app / internal routeは標準ではpublic LLMO targetから除外する
- [ ] App Routerのroot layout / route-group layout / parent layout metadataを継承contextとして扱う
- [ ] page-localにmetadataがなくても親metadataがある場合は、missing title/description/social/schemaを出さない
- [ ] scanned routeごとにtarget classificationをJSON evidenceへ残す
- [ ] `.vibepro/public-discovery-suppressions.json` で理由付きsuppressionを管理できる
- [ ] suppressed findingsは通常countから除外し、suppressed sectionとwarningに記録する
- [ ] suppressionのunknown kind / unmatched entryはwarningとして出す

## Implementation Notes

- 対象: `src/public-discovery-scanner.js`, `src/check-packs.js`
- public-discoveryは「全page.tsxを見る」ではなく「公開発見対象を分類してからLLMOルールを適用する」
- 抑止はsilent skipではなく、理由・対象finding・期限をJSON/Markdownに残す
