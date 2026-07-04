---
story_id: story-vibepro-design-input-judgment
title: Design Input Judgment Architecture
parent_design: vibepro-design-input-judgment
---

# Architecture

Design Input Judgment splits Engineering Judgment evidence into two lifecycle positions:

- design input: before Architecture/Spec are treated as settled
- pre-implementation: during PR readiness and final consistency gates

## Decision

Add a diagnosis phase to `runDiagnosis` and expose it through:

```bash
vibepro story diagnose <repo> --id <story-id> --phase design-input
vibepro story diagnose <repo> --id <story-id> --pre-architecture
```

`--pre-architecture` is an alias for `--phase design-input`. Existing diagnosis calls remain `pre_implementation` by default for compatibility.

The diagnosis run records:

```json
{
  "phase": "design_input",
  "design_input_judgment": {
    "phase": "design_input",
    "feeds": ["architecture", "spec", "implementation_plan"]
  }
}
```

`pr prepare` reads the latest Story run and creates two PR context surfaces:

- `design_input_judgment`: evidence that diagnosis informed Architecture/Spec.
- `pre_implementation_judgment`: the current PR prepare Engineering Judgment route and axes.

Gate DAG adds `gate:design_input_judgment` between Story Source Integrity and Engineering Judgment Route. The node is `required: false` so it behaves as release decision warning, not a hard PR blocker. It becomes `needs_review` when workflow-heavy or cross-surface Architecture/Spec changes lack design-input evidence.

## Boundary

This does not replace Architecture Readiness or Pre-Spec Readiness. Those remain the final promotion gates. Design Input Judgment records whether the judgment happened early enough to be useful as input.

This also does not require Architecture/Spec to exist before diagnosis. In design-input mode, absent Architecture/Spec is valid because the output is meant to feed them.

## Release Operations

- `release_note`: CLI users can now run `vibepro story diagnose <repo> --id <story-id> --pre-architecture` to record early design-input diagnosis evidence; existing `story diagnose` calls remain pre-implementation diagnosis by default.
- `rollout_plan`: Ship as an additive CLI/workflow guidance change. Existing diagnosis commands keep the `pre_implementation` default, while new Story-start guidance points workflow-heavy stories to `--pre-architecture` before Architecture/Spec promotion.
- `rollback_instruction`: Reverting this change removes the design-input phase, `--pre-architecture` alias, PR context split, and warning gate; existing diagnosis evidence without `diagnosis_phase` remains readable as pre-implementation evidence.
- `observability_evidence`: PR prepare exposes `design_input_judgment_status` in the Gate DAG summary, and diagnosis evidence stores `diagnosis_phase` for audit review.

## Tradeoffs

- The warning gate avoids breaking existing PR readiness flows while still surfacing the order gap.
- The first implementation records compact design-input evidence from diagnosis rather than duplicating the full PR Engineering Judgment classifier before a diff exists.
- Future work can make Architecture/Spec writers consume `design_input_judgment` directly before final promotion.
