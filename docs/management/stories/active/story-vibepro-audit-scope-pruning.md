---
story_id: story-vibepro-audit-scope-pruning
title: Audit Scope Pruning
parent_design: vibepro-audit-scope-pruning
status: active
architecture_docs:
  - docs/architecture/vibepro-audit-scope-pruning.md
spec_docs:
  - docs/specs/vibepro-audit-scope-pruning.md
---

# Story

Canonical VibePro value audits should preserve the evidence needed to judge
whether senior engineering decisions were sound, without treating local debug
dumps, inactive gate detail, UI reports, or duplicated lifecycle state as audit
evidence.

## Acceptance Criteria

- [x] `ASP-AC-001`: Canonical audit promotion stores scoped audit summaries for
  PR lifecycle JSON instead of raw full dumps.
- [x] `ASP-AC-002`: Full local `.vibepro` artifacts remain available for debug,
  but canonical audit cost counts scoped audit evidence.
- [x] `ASP-AC-003`: Handoff references are resolved from raw source artifacts so
  pruning does not break replay/reference discovery.
- [x] `ASP-AC-004`: Debug inventories such as full design doc registries,
  inactive judgment axis detail, raw command output, and duplicated gate DAGs
  are excluded from canonical audit data.

## Verification

- `node --test test/canonical-audit-self-contained.test.js`

