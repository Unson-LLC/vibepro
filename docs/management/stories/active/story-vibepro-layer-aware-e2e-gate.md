---
story_id: story-vibepro-layer-aware-e2e-gate
title: E2E Gate requires browser evidence only for browser/runtime acceptance layers
status: active
view: dev
period: 2026-06
parent_design: vibepro-layer-aware-e2e-gate
architecture_docs:
  - docs/architecture/vibepro-layer-aware-e2e-gate.md
spec_docs:
  - docs/specs/vibepro-layer-aware-e2e-gate.md
---

# Story

VibePro should decide the E2E Gate from the acceptance verification layer, not from the mere existence of a `test:e2e` script.

## Background

Some repositories always have a Playwright script, but a specific PR may only move source-contract or policy checks into unit tests. In those cases, requiring `tests/e2e/<story-id>-*.spec.ts` creates fake-value friction and can reintroduce the local runtime cost the Story is trying to remove.

## Architecture Decision

ADR-unnecessary: This narrows existing PR Gate classification inside `src/pr-manager.js`. It introduces no new persistence, runner, network boundary, worker, queue, or external side effect.

## Acceptance Criteria

- [ ] A repository-level `test:e2e` script alone does not make E2E Gate required.
- [ ] UI source changes still require E2E Gate.
- [ ] `tests/e2e`, `test/e2e`, `e2e`, and Playwright config additions/modifications still require E2E Gate; deleting or moving a browser-unnecessary E2E source-contract test to unit does not.
- [ ] Flow Verification and Visual QA evidence still require E2E Gate.
- [ ] Stale or unrelated Visual QA artifacts alone do not make E2E Gate required for non-UI/non-flow changes.
- [ ] Unit-layer source-contract acceptance coverage can close the PR without Story E2E coverage.
- [ ] PR creation critical instructions no longer force `tests/e2e/<story-id>-*.spec.ts` for non-browser/non-flow changes.
