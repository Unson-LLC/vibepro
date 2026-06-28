---
story_id: story-vibepro-runtime-cost-gap-closure
title: Runtime Cost Gap Closure
parent_design: vibepro-runtime-cost-gap-closure
status: active
architecture_docs:
  - docs/architecture/vibepro-runtime-cost-gap-closure.md
  - docs/architecture/vibepro-automation-cost-defaults.md
  - docs/architecture/vibepro-session-attribution-inference.md
  - docs/architecture/vibepro-audit-budget-action-controls.md
spec_docs:
  - docs/specs/vibepro-runtime-cost-gap-closure.md
  - docs/specs/vibepro-automation-cost-defaults.md
  - docs/specs/vibepro-session-attribution-inference.md
  - docs/specs/vibepro-audit-budget-action-controls.md
---

# Story

Close the remaining runtime-cost value-audit gaps as one execution story while
keeping the three product stories separately reconstructable:

- `story-vibepro-automation-cost-defaults`
- `story-vibepro-session-attribution-inference`
- `story-vibepro-audit-budget-action-controls`

## Acceptance Criteria

- [x] `RCGC-AC-001`: Daily automation can supply runtime cost defaults through
  env or explicit CLI flags.
- [x] `RCGC-AC-002`: VibePro can infer a Codex session for a story/window when
  confidence is sufficient, and refuses ambiguous inference.
- [x] `RCGC-AC-003`: Canonical automation audit artifacts expose budget-control
  actions for heavy audit evidence.
- [x] `RCGC-AC-004`: Runtime cost absence remains explicit and never becomes
  zero.

## Verification

- `npm run typecheck`
- `node --test test/session-efficiency-audit.test.js test/canonical-audit-self-contained.test.js`
- `node --test --test-name-pattern "AUTCOST|session-cost|execute merge dry-run keeps absent|execute merge dry-run preserves partial|canonical audit" test/vibepro-cli.test.js`

