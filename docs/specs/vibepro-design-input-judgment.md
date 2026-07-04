---
story_id: story-vibepro-design-input-judgment
title: Design Input Judgment Spec
parent_design: vibepro-design-input-judgment
---

# Spec

## Commands

```bash
vibepro story diagnose <repo> --id <story-id> [--phase design-input|pre-implementation] [--pre-architecture]
```

## Contract

- `DIJ-CONTRACT-001`: `story diagnose --pre-architecture` MUST record diagnosis phase `design_input`.
- `DIJ-CONTRACT-002`: `story diagnose --phase design-input` MUST behave the same as `--pre-architecture`.
- `DIJ-CONTRACT-003`: diagnosis evidence MUST include `diagnosis_phase`.
- `DIJ-CONTRACT-004`: design-input diagnosis MUST include `design_input_judgment`.
- `DIJ-CONTRACT-005`: non-design-input diagnosis MUST include `pre_implementation_judgment`.
- `DIJ-CONTRACT-006`: PR prepare MUST expose `pr_context.design_input_judgment`.
- `DIJ-CONTRACT-007`: PR prepare MUST expose `pr_context.pre_implementation_judgment`.
- `DIJ-CONTRACT-008`: Gate DAG MUST include `gate:design_input_judgment`.
- `DIJ-CONTRACT-009`: `gate:design_input_judgment` MUST warn when workflow-heavy or cross-surface Architecture/Spec changes have no design-input diagnosis evidence.
- `DIJ-CONTRACT-010`: workflow guidance and next commands MUST recommend design-input diagnosis before final Architecture/Spec on workflow-heavy or cross-surface stories.

## Scenarios

- `DIJ-SCENARIO-001`: Given a selected Story, when an agent runs `story diagnose --pre-architecture`, then the manifest run and evidence file record `phase=design_input`.
- `DIJ-SCENARIO-002`: Given Architecture/Spec and implementation files change together without design-input diagnosis, when `pr prepare` runs, then `gate:design_input_judgment` is `needs_review` and `required=false`.
- `DIJ-SCENARIO-003`: Given design-input diagnosis exists for the Story, when `pr prepare` runs, then `gate:design_input_judgment` is `passed`.
- `DIJ-SCENARIO-004`: Given Story plan or repo status has no prior run, when next commands are shown, then the first diagnosis command includes `--pre-architecture`.

## Verification

- `test/design-input-judgment.test.js` covers diagnosis phase evidence and PR Gate DAG behavior.
- Existing Architecture/PR readiness tests cover that the new warning node does not regress final readiness gates.
