---
story_id: story-vibepro-audit-replay-budget
title: Canonical Audit Replay Budget Spec
related_architecture:
  - ../architecture/vibepro-audit-replay-budget.md
---

# Canonical Audit Replay Budget Spec

## Contracts

- `CARB-CONTRACT-001`: Compact replay bundle `artifacts[]` MUST omit full artifact `data` and text `content`.
- `CARB-CONTRACT-002`: Compact replay bundle `artifacts[]` MUST keep `kind`, `source`, `digest`, `audit_digest`, scoped line counts, audit scope, and a bounded `summary`.
- `CARB-CONTRACT-003`: `audit replay` MUST continue to return `handoff_replay_status=ready` only after compressed hash, expanded hash, schema version, and story id pass.
- `CARB-CONTRACT-004`: Compact canonical `cost_summary` MUST expose both persisted `artifact_lines` and `raw_source_artifact_lines`.
- `CARB-CONTRACT-005`: `artifact_code_ratio` MUST be based on persisted canonical audit lines after compaction, not raw pre-compaction `.vibepro` source lines.

## Scenarios

- `CARB-S-001`: Given over-budget `.vibepro` evidence, when compact canonical promotion runs, then replay stores only digest-backed manifests and summary fields.
- `CARB-S-002`: Given a compact replay bundle without full artifact bodies, when `vibepro audit replay` runs, then it reconstructs the high-level verdict from `decision_index`.
- `CARB-S-003`: Given raw source artifacts are large, when the canonical cost summary is written, then the raw source line count remains visible but does not drive the canonical artifact/code ratio.

## Verification

- `test/canonical-audit-self-contained.test.js` covers compact replay pruning, replay success, and compact cost accounting.
