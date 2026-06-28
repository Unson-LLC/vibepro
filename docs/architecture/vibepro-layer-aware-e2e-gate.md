---
story_id: story-vibepro-layer-aware-e2e-gate
title: Layer-aware E2E Gate architecture
---

# Architecture

## Decision

Keep E2E Gate strict when the change touches browser, runtime flow, visual QA, or E2E infrastructure. Stop treating an available package-level E2E command as proof that every Story acceptance criterion needs Playwright coverage.

## Boundary

`shouldRequireE2eGate` remains the single gate selection point. It now requires E2E for:

- UI-facing source changes.
- `tests/e2e`, `test/e2e`, or `e2e` test changes.
- Playwright config changes.
- Flow Verification or Visual QA evidence.
- change-classification profiles that imply runtime flow or browser interaction.

It does not require E2E for unit-layer contract, source-contract, Story/Spec, or lightweight test-only changes just because `package.json` exposes a `test:e2e` script.

## Impact

This preserves high-signal E2E enforcement and removes fake E2E demands for browser-free acceptance criteria. Unit and integration evidence remain current-head bound through the existing verification evidence model.
