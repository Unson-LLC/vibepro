---
story_id: story-vibepro-audit-budget-action-controls
title: Audit Budget Action Controls Spec
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart TD
        Cost["cost_summary"] --> Controls["cost_controls"]
        MissingCost["Missing token/time"] --> RuntimeAction["collect_runtime_cost_before_merge"]
        HeavyEvidence["Budget exceeded"] --> SummaryAction["prefer_summary_canonical_artifacts"]
        Controls --> DailyAudit["daily automation input"]
---

# Spec

## Invariants

- `ABC-INV-001`: Cost controls are advisory automation inputs, not merge
  blockers.
- `ABC-INV-002`: Budget recommendations must include concrete next actions.
- `ABC-INV-003`: Runtime cost absence must be explicit.

## Contracts

- `ABC-CONTRACT-001`: `automation_value_audit.cost_controls.status` is
  `within_controls` or `action_required`.
- `ABC-CONTRACT-002`: `cost_controls.recommendations[]` includes stable ids.
- `ABC-CONTRACT-003`: Decision summary includes cost-control status and
  recommended evidence depth.

## Scenarios

- `ABC-SCENARIO-001`: Artifact budget exceeded yields
  `prefer_summary_canonical_artifacts`.
- `ABC-SCENARIO-002`: Missing token/time cost yields
  `collect_runtime_cost_before_merge`.
- `ABC-SCENARIO-003`: Evidence-heavy changes yield
  `split_or_shrink_evidence_heavy_story`.

## Anti-Patterns

- `ABC-AP-001`: Do not turn advisory cost controls into a hidden merge block.
- `ABC-AP-002`: Do not hide budget excess behind generic `partial` status.

## Verification

- `ABC-VERIFY-001`: Canonical audit tests assert cost-control status and
  recommendations.
