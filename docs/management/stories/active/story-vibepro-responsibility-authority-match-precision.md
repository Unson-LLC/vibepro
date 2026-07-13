---
story_id: story-vibepro-responsibility-authority-match-precision
title: Responsibility Authorityの共有risk surface誤一致を防ぐ
view: dev
period: 2026-07
architecture_docs:
  - docs/architecture/vibepro-responsibility-authority-match-precision.md
spec_docs:
  - docs/specs/vibepro-responsibility-authority-match-precision.md
status: active
created_at: 2026-07-13
updated_at: 2026-07-13
---

# Responsibility Authorityの共有risk surface誤一致を防ぐ

## 背景

`pr prepare` の変更分類が `queue_worker` や `service_orchestration` を返すと、同じrisk surfaceを持つ責務がpathやsymbolの一致なしにすべて解決される。SalesTailor STR-146では、実際に変更した責務は1件なのに9件が一致し、無関係な証跡34件を要求してPRを止めた。

risk surfaceはPR全体の粗い分類であり、責務IDを一意に識別する情報ではない。一方、既存registryはpath/symbolを持たないrisk-only責務を許しているため、その互換性は維持する必要がある。

## User Story

**As a** VibeProで横断責務のPR gateを運用する開発者
**I want to** 共有risk surfaceを責務固有のpath/symbol一致の補強として扱いたい
**So that** 関係する契約だけを再検証し、無関係な証跡要求でPRを止めない

## Acceptance Criteria

- [ ] pathまたはsymbolを宣言した責務は、共有risk surfaceだけでは一致しない。
- [ ] path/symbolが一致した責務では、一致したrisk surfaceを `matched_by` の補強情報として残す。
- [ ] path/symbolを宣言しないrisk-only責務は、既存互換としてrisk surface単独で一致する。
- [ ] Domain Contractは責務IDを列挙しただけでは一致しないが、条項自身のpath/symbolが直接一致すれば責務を解決する。
- [ ] symbol一致は変更されたproduction source行だけを対象とし、Story文面・未変更行・test-onlyファイルから責務を拡張しない。
- [ ] high-riskだが登録authorityの直接一致がない変更は、quiet successではなく `no_registered_authority` を維持する。
- [ ] unit regression、typecheck、current-head verificationで修正を証明する。

## Out of Scope

- risk surface classifier自体の分類ルール変更。
- Responsibility Authority Registry schemaの破壊的変更。
- SalesTailor固有のretry実装変更。
