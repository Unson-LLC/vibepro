---
story_id: story-vibepro-audit-replay-budget
title: Canonical Audit Replay Budget
status: active
parent_design: vibepro-audit-replay-budget
related_architecture:
  - ../../architecture/vibepro-audit-replay-budget.md
related_specs:
  - ../../specs/vibepro-audit-replay-budget.md
---

# Canonical Audit Replay Budget

## User Value

VibePro daily value audits need enough canonical evidence to reconstruct senior-engineer judgment, but they must not store or count full raw artifacts that are outside the audit purpose. A small code change should not produce a replay bundle that dominates the work being audited.

## Acceptance Criteria

- `CARB-AC-001`: Compact canonical replay stores artifact manifests and minimal summaries, not full artifact `data` or text `content`.
- `CARB-AC-002`: `audit replay` still verifies bundle hashes and reconstructs PR prepare, merge, verification, review, and traceability verdicts from the decision index.
- `CARB-AC-003`: Compact `cost_summary.artifact_lines` measures the persisted canonical audit surface, while raw source artifact line count remains separately visible.
- `CARB-AC-004`: Regression tests prove replay bundle expanded lines are substantially lower than the raw source artifact line count.

## Non Goals

- Do not remove `audit-replay-bundle.json.gz`.
- Do not make replay a security boundary.
- Do not persist full `.vibepro` raw artifacts in canonical history.
