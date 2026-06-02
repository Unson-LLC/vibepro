---
story_id: story-vibepro-design-system-domain-inference
title: Design System domain inference must stay product-local
status: active
related_issue: https://github.com/Unson-LLC/vibepro/issues/138
architecture_docs:
  - ../../../architecture/vibepro-design-system-domain-inference.md
specs:
  - ../../../specs/vibepro-design-system-domain-inference.md
---

# Design System domain inference

## 背景

`design-system derive` と `design-modernize` は、任意の既存プロダクトからproduct-localなDesign System制約を作るための機能である。

しかし現状は、未指定routeの既定値やdomain推定がAitle/hotel discovery寄りになっている。SalesTailorのようなoperational SaaSでDesign Systemを導出した時に、`primary_domain: hotel_discovery` や `HotelCard` / `MapPricePin` / `AIPhoneCTA` が混入すると、後続のmodernize計画と実装指示が誤ったプロダクト意味論に基づいてしまう。

## 方針

- hotel discoveryは明示的なホテル/宿泊/空室確認などの強い肯定証拠がある場合だけ選ぶ。
- `map` だけ、または「hotel/map/booking metaphorsを使わない」のような否定文だけではhotel discoveryにしない。
- route未指定時はhotel固定の既定routeではなく、現行コードから発見したrouteを使う。
- `project` / `company` / `product` / `template` / `customer` / `account` / `user` のような業務エンティティ証拠は、hotelではなくproduct workflowの強い根拠として扱う。
- 汎用fallbackはoperational/product workflow向けに、route/component evidenceから役割名を作る。

## 受け入れ基準

- [ ] SalesTailor風のoperational SaaS fixtureで `design-system derive` が `hotel_discovery` を出さない
- [ ] `project` / `company` / `product` / `template` / `customer` / `account` / `user` を含むcomponent evidenceでは、product-localな業務エンティティroleを優先する
- [ ] 否定文に `hotel` / `map` / `booking` が含まれてもhotel discoveryに分類しない
- [ ] hotel discoveryの明示文脈では従来どおりhotel向けroleとCTAを出せる
- [ ] route未指定時に `/hotel/[hotel_id]` などのhotel既定routeをsource evidenceへ混入しない
- [ ] `design-modernize derive-system` と `design-system derive` の両方で同じdomain推定方針を使う
