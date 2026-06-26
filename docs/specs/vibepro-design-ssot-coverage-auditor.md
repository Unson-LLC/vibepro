---
title: VibePro Design SSOT Coverage Auditor Spec
status: active
created_at: 2026-06-26
updated_at: 2026-06-26
related_stories:
  - story-vibepro-design-ssot-coverage-auditor
parent_design: vibepro-design-ssot-coverage-auditor
---

# VibePro Design SSOT Coverage Auditor Spec

## Invariants

- `DSSOT-COV-INV-001`: Coverage MUST use repo-committed Design SSOT registry sources, not generated `.vibepro/design-ssot/` snapshots.
- `DSSOT-COV-INV-002`: Coverage MUST distinguish repository-wide debt from changed-file PR risk.
- `DSSOT-COV-INV-003`: Changed unregistered design docs MUST be visible before PR creation.
- `DSSOT-COV-INV-004`: Historical unregistered docs MUST NOT block unrelated PRs.
- `DSSOT-COV-INV-005`: Coverage MUST be deterministic and must not block on LLM-only semantic claims.

## Contracts

- `DSSOT-COV-CONTRACT-001`: `vibepro design-ssot coverage [repo] [--base <ref>] [--json]` returns a coverage report.
- `DSSOT-COV-CONTRACT-002`: The report includes `coverage.summary` counts for total, registered, unregistered, changed, and changed-unregistered design docs.
- `DSSOT-COV-CONTRACT-003`: `design-ssot reconcile` includes the same coverage report under `coverage`.
- `DSSOT-COV-CONTRACT-004`: Changed unregistered design docs become `unregistered_changed_design_doc` action items with severity `needs_review`.
- `DSSOT-COV-CONTRACT-005`: `pr prepare` persists the coverage report through `design-ssot-reconciliation.json`.

## Scenarios

- `DSSOT-COV-S-001`: Given registered root and child docs, when coverage runs, then those docs count as registered.
- `DSSOT-COV-S-002`: Given an unregistered design doc exists but is unchanged, when coverage runs with `--base`, then it appears as coverage debt but no action item is created.
- `DSSOT-COV-S-003`: Given an unregistered design doc changed, when reconciliation runs with `--base`, then status is `needs_review`.
- `DSSOT-COV-S-004`: Given `pr prepare` runs for a Design SSOT story, then `design-ssot-reconciliation.json` contains `coverage.summary`.

## Anti-patterns

- `DSSOT-COV-AP-001`: Treating all historical unregistered docs as blockers.
- `DSSOT-COV-AP-002`: Counting generated `.vibepro` artifacts as registry authority.
- `DSSOT-COV-AP-003`: Hiding unregistered docs because no design root changed.

## Verification

- `DSSOT-COV-V-001`: Unit tests cover `design-ssot coverage`.
- `DSSOT-COV-V-002`: Unit tests cover changed unregistered design docs in reconciliation.
- `DSSOT-COV-V-003`: PR prepare tests cover coverage propagation into artifacts and Gate DAG.
