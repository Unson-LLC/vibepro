---
title: VibePro Design System Domain Inference Spec
status: active
created_at: 2026-06-02
---

# VibePro Design System Domain Inference Spec

## Invariants

- `INV-1`: Generic Design System commands MUST NOT default to hotel-specific routes.
- `INV-2`: Hotel discovery semantics MUST require strong positive hotel/travel evidence.
- `INV-3`: Negated mentions such as "do not use hotel/map/booking metaphors" MUST NOT count as positive hotel evidence.
- `INV-4`: Non-hotel product evidence MUST produce product-local generic roles rather than `HotelCard`, `MapPricePin`, or `AIPhoneCTA`.
- `INV-5`: Business entity evidence such as `project`, `company`, `product`, `template`, `customer`, `account`, or `user` MUST be treated as product workflow evidence, not hotel discovery evidence.

## Scenarios

- `S-1`: A SalesTailor-like operational SaaS with routes such as `/dashboard`, `/projects`, `/companies`, and `/admin/templates` derives `primary_domain: product_workflow`.
- `S-2`: A brief that explicitly rejects hotel/map/booking metaphors stays in the generic product workflow lane.
- `S-3`: A Japanese hotel discovery brief with location search, hotel cards, map exploration, and AI phone availability confirmation derives `primary_domain: hotel_discovery`.
- `S-4`: When routes are omitted, discovered app routes are used. If no route can be discovered, the fallback route is generic `/`, not `/hotel/[hotel_id]`.
- `S-5`: Components such as `ProjectListTable` and `CompanyManagementGrid` produce product-local role names and responsibilities before static generic fallback roles are appended.

## Verification

- Unit/CLI tests cover `design-system derive`.
- Unit/CLI tests cover `design-modernize derive-system`.
- Tests assert the absence of hotel-specific roles in non-hotel fixtures and the preservation of hotel-specific roles in explicit hotel fixtures.
