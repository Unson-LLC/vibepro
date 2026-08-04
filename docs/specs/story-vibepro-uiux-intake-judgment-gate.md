---
story_id: story-vibepro-uiux-intake-judgment-gate
title: uiux intake applicability judgment gate contract
parent_design: vibepro-uiux-structured-intake
status: active
---

# uiux intake applicability judgment gate contract

Pointer document for the registered Spec artifact
`.vibepro/spec/story-vibepro-uiux-intake-judgment-gate/spec.json`.

## Clauses

- INV-001: `gate:uiux_intake_judgment` is always present and required in the
  `pr prepare` gate DAG and reports `needs_evidence` when the story has neither
  an intake coverage artifact nor an accepted `intake_not_applicable`/waiver
  decision. The gate fails closed on the absence of the judgment, not on the
  absence of the intake itself.
- SCN-002: an intake coverage artifact under `.vibepro/uiux/<story-id>/` or
  `.vibepro/design-modernize/<story-id>/` resolves the gate with
  `resolved_by=intake_coverage_artifact`.
- SCN-003: `vibepro decision record --type intake_not_applicable` requires
  `--reason`; an accepted record resolves the gate with
  `resolved_by=intake_not_applicable_decision`.
- INV-004: a corrupt or unparsable coverage artifact does not satisfy the gate
  and does not crash `pr prepare`.
- SCN-005: an accepted waiver with `--source gate:uiux_intake_judgment`
  resolves the gate; the recovery action names both honest closures.
