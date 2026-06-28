---
story_id: story-vibepro-audit-bundle-budget
title: Canonical Audit Bundle Budget Spec
parent_design: vibepro-audit-bundle-budget
related_architecture:
  - ../architecture/vibepro-audit-bundle-budget.md
---

# Canonical Audit Bundle Budget Spec

## Contracts

- `CABB-CONTRACT-001`: Compact `audit-bundle.json` MUST NOT embed a full `decision_index`.
- `CABB-CONTRACT-002`: Compact `audit-bundle.json` MUST NOT embed a full `cost_summary` or `automation_value_audit`.
- `CABB-CONTRACT-003`: Compact `audit-bundle.json` MUST keep references to the authoritative index, decision summary, replay bundle, and raw artifact manifest.
- `CABB-CONTRACT-004`: `cost_summary.artifact_lines` MUST count the persisted canonical bundle manifest shape, not an internal pre-write object with duplicated fields.
- `CABB-CONTRACT-005`: `audit replay` MUST remain ready when the replay payload and canonical `audit-index.json` are present.

## Scenarios

- `CABB-S-001`: Given compact canonical promotion, when `audit-bundle.json` is written, then it stores manifest references rather than duplicating index bodies.
- `CABB-S-002`: Given compact canonical promotion, when cost accounting runs, then artifact/code ratio reflects the actual persisted compact surface.
- `CABB-S-003`: Given a later engineer runs replay, when the compressed replay bundle hash and schema match, then the handoff verdict is reconstructed from replay payload or canonical index.

## Verification

- `test/canonical-audit-self-contained.test.js` covers compact canonical bundle shape and budget accounting.
