---
story_id: story-vibepro-design-input-judgment
title: Design Input Judgment Spec
parent_design: vibepro-design-input-judgment
diagrams:
  - kind: state
    mermaid: |
      flowchart LR
        Story["Story selected"] --> DesignInput["design_input diagnosis"]
        DesignInput --> Architecture["Architecture input"]
        Architecture --> Spec["Spec input"]
        Spec --> Implementation["Implementation"]
        Implementation --> PreImplementation["pre_implementation diagnosis"]
        PreImplementation --> PrPrepare["PR prepare Gate DAG"]
    rationale: "State model for separating early design-input judgment from final PR-readiness judgment."
  - kind: flow
    mermaid: |
      flowchart LR
        Init["vibepro init / story select"] --> Diagnose["story diagnose --pre-architecture"]
        Diagnose --> Evidence["diagnosis_phase=design_input evidence"]
        Evidence --> Docs["Architecture and Spec use the evidence as design input"]
        Docs --> Code["Code and tests"]
        Code --> Prepare["pr prepare"]
        Prepare --> Gate["gate:design_input_judgment"]
    rationale: "Workflow flow for the intended order: diagnose first, then Architecture/Spec, then implementation and PR gates."
  - kind: threat_model
    mermaid: |
      flowchart LR
        Agent["AI agent"] --> EarlyEvidence["design-input evidence"]
        Agent --> LateEvidence["pre-implementation evidence"]
        LateEvidence --> Confusion["late judgment mistaken as design input"]
        EarlyEvidence --> Gate["PR context design_input_judgment"]
        Gate --> Reviewer["Reviewer can verify ordering"]
        Confusion --> Warning["gate:design_input_judgment needs_review when early evidence is absent"]
    rationale: "Threat model for the trust boundary between actual design-input judgment and post-hoc PR readiness evidence."
---

# Spec

## Commands

```bash
vibepro story diagnose <repo> --id <story-id> [--phase design-input|pre-implementation] [--pre-architecture]
```

## Invariants

- `DIJ-INV-001`: A later `pre_implementation` diagnosis MUST NOT overwrite, impersonate, or collapse the earlier `design_input` diagnosis in PR prepare artifacts.
- `DIJ-INV-002`: Workflow-heavy or cross-surface Architecture/Spec work MUST surface whether design-input evidence existed before final PR readiness.

## Contracts

- `DIJ-CONTRACT-001`: `story diagnose --pre-architecture` MUST record diagnosis phase `design_input`.
- `DIJ-CONTRACT-002`: `story diagnose --phase design-input` MUST behave the same as `--pre-architecture`.
- `DIJ-CONTRACT-003`: diagnosis evidence MUST include `diagnosis_phase`.
- `DIJ-CONTRACT-004`: design-input diagnosis MUST include `design_input_judgment`.
- `DIJ-CONTRACT-005`: non-design-input diagnosis MUST include `pre_implementation_judgment`.
- `DIJ-CONTRACT-006`: PR prepare MUST expose `pr_context.design_input_judgment`.
- `DIJ-CONTRACT-007`: PR prepare MUST expose `pr_context.pre_implementation_judgment`.
- `DIJ-CONTRACT-008`: Gate DAG MUST include `gate:design_input_judgment`.
- `DIJ-CONTRACT-009`: `gate:design_input_judgment` MUST warn when workflow-heavy or cross-surface Architecture/Spec changes have no design-input diagnosis evidence.
- `DIJ-CONTRACT-010`: `gate:design_input_judgment` MUST require a readable design-input evidence artifact; a manifest run summary alone is not sufficient.
- `DIJ-CONTRACT-011`: workflow guidance and next commands MUST recommend design-input diagnosis before final Architecture/Spec on workflow-heavy or cross-surface stories.
- `DIJ-CONTRACT-012`: diagnosis evidence MUST preserve `code_quality.authorization_order_risks` across both design-input and pre-implementation phases; phase splitting MUST NOT remove existing authorization-order findings from evidence, summaries, or Brainbase import state.

## Scenarios

- `DIJ-SCENARIO-001`: Given the VibePro workflow state is Story selected, when an agent runs `story diagnose --pre-architecture`, then the workflow state transitions to design_input and the manifest run plus evidence file record `phase=design_input`.
- `DIJ-SCENARIO-002`: Given the VibePro workflow status is Architecture/Spec and implementation files changed without design-input diagnosis, when `pr prepare` runs, then `gate:design_input_judgment` is `needs_review` and `required=false`.
- `DIJ-SCENARIO-003`: Given the VibePro workflow state already has design-input diagnosis for the Story, when `pr prepare` builds the Gate DAG, then `gate:design_input_judgment` transitions to `passed`.
- `DIJ-SCENARIO-004`: Given Story plan or repo status has no prior workflow run, when next commands are shown, then the first diagnosis command includes `--pre-architecture`.
- `DIJ-SCENARIO-005`: Given a workflow-heavy Story, when Architecture/Spec are prepared, then design-input diagnosis evidence is available before implementation and pre-implementation diagnosis remains a separate final workflow consistency check.
- `DIJ-SCENARIO-006`: Given diagnosis or PR prepare workflow evidence is replayed, when artifacts are inspected, then `design_input_judgment` and `pre_implementation_judgment` are not collapsed into one generic Engineering Judgment record.
- `DIJ-SCENARIO-007`: Given a design-input manifest run exists but its evidence artifact is missing, when `pr prepare` runs, then `gate:design_input_judgment` remains `needs_review` with artifact regeneration guidance.
- `DIJ-SCENARIO-008`: Given diagnosis detects authorization-order risks before bulk database work, when evidence is generated or imported to Brainbase, then `code_quality.authorization_order_risks` remains present regardless of whether the diagnosis phase is design-input or pre-implementation.

## Anti-patterns

- `DIJ-AP-001`: `evidence_lifecycle_regression`: A later pre-implementation diagnosis masquerades as the earlier design-input evidence or changes the PR context to hide the ordering gap.
- `DIJ-AP-002`: `workflow_state_regression`: The next-command workflow leads agents through final Architecture/Spec before the first lightweight design-input diagnosis.
- `DIJ-AP-003`: `manifest_only_false_pass`: A design-input run summary without its evidence artifact passes PR readiness.

## Failure Modes

- `DIJ-FM-001`: `evidence_lifecycle_regression` violates `DIJ-INV-001`, `DIJ-CONTRACT-006`, and `DIJ-CONTRACT-007`; covered by `DIJ-AP-001`.
- `DIJ-FM-002`: `workflow_state_regression` violates `DIJ-CONTRACT-011`; covered by `DIJ-AP-002`.
- `DIJ-FM-003`: `manifest_only_false_pass` violates `DIJ-CONTRACT-010`; covered by `DIJ-AP-003`.
- `DIJ-FM-004`: `authorization_order_signal_loss` violates `DIJ-CONTRACT-012` when lifecycle phase splitting drops existing `authorization_order_risks` evidence.

## Release Operations

- `release_note`: The new `--pre-architecture` alias is additive and documents the preferred Story-start workflow for workflow-heavy or cross-surface stories.
- `rollout_plan`: Release with CLI reference, README, workflow skill, Story, Architecture, Spec, unit tests, and executable E2E CLI replay coverage in the same PR so the guidance, artifacts, and gates stay traceable.
- `rollback_instruction`: Reverting this Story returns diagnosis to a single pre-implementation interpretation; no data migration is required.
- `observability_evidence`: Diagnosis summaries include `diagnosis_phase`, and PR prepare summaries include `design_input_judgment_status`.

## Verification

- `test/design-input-judgment.test.js` covers `DIJ-CONTRACT-001` through `DIJ-CONTRACT-010`, `DIJ-INV-001`, and `DIJ-AP-001` through `DIJ-AP-003`.
- `test/e2e/story-vibepro-design-input-judgment-flow.spec.ts` replays `DIJ-SCENARIO-001` through `DIJ-SCENARIO-007`, including acceptance criterion `AC-4` for split PR prepare artifacts.
- `test/vibepro-cli.test.js` covers `DIJ-CONTRACT-012` and `DIJ-SCENARIO-008` by asserting `code_quality.authorization_order_risks` remains in diagnosis evidence, summary output, Brainbase import summary, and Brainbase import state.
- Existing Architecture/PR readiness tests cover that the new warning node does not regress final readiness gates.
