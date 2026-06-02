---
story_id: story-vibepro-readable-journey-markdown
title: Readable Journey Markdown Spec
---

# Readable Journey Markdown Spec

## Invariants

- `INV-RJM-1`: Journey Markdown MUST render a Japanese decision summary before raw Patton table or evidence bindings.
- `INV-RJM-2`: The first decision layer MUST include current conclusion, experience flow, release slices, and next judgment.
- `INV-RJM-3`: The first decision layer MUST NOT require reading long Story ID lists to understand Journey state.
- `INV-RJM-4`: Raw Story IDs and evidence bindings MUST remain available in an audit section, but reader-facing labels MUST prefer Japanese terms.
- `INV-RJM-5`: Existing Journey JSON fields MUST remain backward compatible; display-only story labels MAY be added to improve Markdown readability.

## Scenarios

- `S-RJM-1`: When walking skeleton is covered and no conflicts/open questions exist, Markdown says the minimum experience is established.
- `S-RJM-2`: When `next_slice` is empty, Markdown says the next growth area is undefined and should be selected.
- `S-RJM-3`: Evidence binding rows use reader-facing labels such as `仕様`, `対象面`, and `検証` instead of exposing only raw internal type names.

## Anti-Patterns

- `AP-RJM-1`: Do not make Story ID enumeration the first thing a human must read.
- `AP-RJM-2`: Do not hide Gate evidence or traceability to make the summary prettier.
- `AP-RJM-3`: Do not change JSON schema just to improve Markdown readability.

## Verification

- `V-RJM-1`: `test/journey-map.test.js` asserts Japanese summary headings, release slice judgment, audit log presence, and Japanese evidence label translation.
- `V-RJM-2`: `node --test test/journey-map.test.js` passes.
- `V-RJM-3`: `npm run typecheck` passes.
