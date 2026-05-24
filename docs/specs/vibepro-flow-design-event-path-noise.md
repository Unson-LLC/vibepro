---
story_id: story-vibepro-flow-design-event-path-noise
title: Flow Design Event Path Noise Spec
---

# Flow Design Event Path Noise Spec

## Invariants

- `INV-FLOW-NOISE-1`: `silent_noop_return` MUST be emitted only for an event handler or a function directly invoked by an event handler.
- `INV-FLOW-NOISE-2`: Pure value helpers, formatters, selectors, and ID generators MUST NOT be treated as silent UI noops only because they return early.
- `INV-FLOW-NOISE-3`: Early returns with nearby disabled/loading/error affordances MUST be marked as mitigated and MUST NOT block the UI gate.
- `INV-FLOW-NOISE-4`: Test/spec/mock files MUST NOT contribute production `interactive_contract_hits` review findings.
- `INV-FLOW-NOISE-5`: Flow Design must retain real user-operation findings such as handler bodies with no visible effect and visible buttons without click/navigation/disabled contracts.
- `INV-FLOW-NOISE-6`: Diagnostic Engine filtering for this story is limited to `VP-FLOW-002` silent noop findings; non-flow branches such as authorization order, network, security, database, and webhook checks MUST keep existing behavior.

## Regression Fixture

For an AI search client:

- `createId()` returning `crypto.randomUUID()` is not a UI noop.
- `confidenceLabel()` returning label strings is not a UI noop.
- `getLatestCarousel()` returning a selected carousel is not a UI noop.
- `submit()` with `if (!normalizedMessage || isLoading) return` remains a user-operation guard finding.
- A `*.test.tsx` mock `<button>{children}</button>` does not produce a production interactive contract finding.
