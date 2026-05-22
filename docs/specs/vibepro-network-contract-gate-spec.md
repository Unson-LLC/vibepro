---
story_id: story-vibepro-network-contract-gate
title: Network Contract Gate Spec
---

# Network Contract Gate Spec

## Invariants

- `INV-NET-1`: Any static `/api/...` client call detected in runtime/UI source must resolve to a Next.js App Router or Pages Router API route unless explicitly marked dynamic and reviewed.
- `INV-NET-2`: A newly introduced `/api/...` client call without a matching route is a Critical finding and blocks PR readiness.
- `INV-NET-3`: Replacing a direct server function call with an HTTP API call is a high-risk contract change and must surface in PR prepare output.
- `INV-NET-4`: Type-check success does not satisfy Network Contract Gate when API client calls changed.
- `INV-NET-5`: Playwright flow verification must fail on API 4xx/5xx, API HTML responses, console/page errors, unhandled fetch failures, and known user-visible loading failure text.
- `INV-NET-6`: Adding Network Contract checks must preserve existing code-quality findings such as `authorizationOrderRisks.length > 0`.
- `INV-NET-7`: Flow verification runtime contract checks must preserve existing Basic Auth setup through `BASIC_AUTH_USER && BASIC_AUTH_PASSWORD`.

## Contracts

- App Router mapping: `/api/foo/bar` maps to `app/api/foo/bar/route.{ts,tsx,js,jsx}` or `src/app/api/foo/bar/route.{ts,tsx,js,jsx}`.
- Pages Router mapping: `/api/foo/bar` maps to `pages/api/foo/bar.{ts,tsx,js,jsx}` or `src/pages/api/foo/bar.{ts,tsx,js,jsx}`.
- Dynamic route segments such as `[id]`, `[...slug]`, and `[[...slug]]` may satisfy static paths when segment counts match.
- Template literal paths that cannot be statically resolved must be reported as review items, not silently ignored.
- PR prepare must include a `gate:network_contract` node and the markdown/HTML reports must include Network Contract details.

## Scenarios

- `S-NET-1`: A file changes from `searchHotelsDetail(actionParams)` to `fetch('/api/detail-search', { method: 'POST' })` and no `route.ts` exists. VibePro emits `VP-NET-001` Critical and Network Contract Gate is failed.
- `S-NET-2`: The matching `src/app/api/detail-search/route.ts` is added. The missing route finding disappears.
- `S-NET-3`: A flow verification sees `POST /api/detail-search` return 404. The generated Playwright spec fails and records runtime contract failure evidence.
- `S-NET-4`: The page shows `情報を取得できませんでした` while the flow otherwise renders. Flow verification fails.

## Anti-patterns

- Do not special-case example travel app paths or hotel search names in production logic.
- Do not treat `npm run type-check` as sufficient evidence for API route availability.
- Do not infer user-perceived success from a superficially rendered UI when network calls fail.
