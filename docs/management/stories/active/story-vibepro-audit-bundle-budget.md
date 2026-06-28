---
story_id: story-vibepro-audit-bundle-budget
title: Canonical Audit Bundle Budget
status: active
parent_design: vibepro-audit-bundle-budget
spec: ../../../specs/vibepro-audit-bundle-budget.md
architecture: ../../../architecture/vibepro-audit-bundle-budget.md
---

# Canonical Audit Bundle Budget

## Problem

The previous compact replay work reduced raw source audit lines, but the persisted canonical surface still duplicated the same decision and cost data across `audit-index.json`, `audit-bundle.json`, and `audit-replay-bundle.json.gz`.

That makes VibePro look expensive even after pruning raw artifacts, and it weakens daily value audits because audit cost is driven by redundant storage rather than senior-engineering judgment.

## Acceptance Criteria

- `audit-bundle.json` is a compact manifest that points to `audit-index.json`, `decision-summary.md`, and the compressed replay bundle instead of embedding duplicated decision/cost bodies.
- Canonical cost accounting counts the persisted compact bundle manifest, not an in-memory bundle with duplicated index content.
- Replay remains handoff-ready from canonical artifacts.
- The canonical artifact/code ratio for this story is below the configured `3.0` budget when generated from current evidence.

## Verification

- `node --test test/canonical-audit-self-contained.test.js`
- `node --test test/canonical-audit-self-contained.test.js test/traceability-usage-report.test.js`
- `npm run typecheck`
