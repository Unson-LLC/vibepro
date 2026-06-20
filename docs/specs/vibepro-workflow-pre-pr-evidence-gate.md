---
story_id: story-vibepro-workflow-pre-pr-evidence-gate
title: Workflow Pre-PR Evidence Gate Spec
diagrams:
  - kind: state
    mermaid: |
      stateDiagram-v2
        [*] --> PRPrepare
        PRPrepare --> NeedsEvidence: no runtime probe and no executable E2E replay
        NeedsEvidence --> ReadyForPR: current E2E records markers and existing e2e spec target
        NeedsEvidence --> ReadyForPR: Flow Verification has passing runtime probe
        ReadyForPR --> PostPRPreview: PR created
        PostPRPreview --> PreviewSmoke: hosted preview exists
    rationale: "State diagram for the pre-PR workflow evidence loop and the post-PR preview smoke boundary."
  - kind: flow
    mermaid: |
      flowchart TD
        Change["workflow_heavy change"] --> Prepare["vibepro pr prepare"]
        Prepare --> Replay{"current replay evidence?"}
        Replay -->|"Flow Verification probe passed"| Ready["workflow replay gate passed"]
        Replay -->|"E2E observation has markers + existing e2e spec target"| Ready
        Replay -->|"zero probes or fake target"| Actions["emit flow_design.runtime_probes[] or explicit E2E record action"]
        Ready --> Create["vibepro pr create"]
        Create --> HostedPreview["hosted preview available after PR"]
        HostedPreview --> Smoke["preview smoke evidence"]
    rationale: "Flow diagram for pre-PR evidence choices and why preview smoke is post-PR evidence."
---

# Spec

## Required Behavior

- `preview:preview_smoke` MUST NOT be added as a PR-final required review because it usually depends on a hosted preview that exists after PR creation.
- UI preview policy MAY still require `preview:human_usability` before PR creation.
- `gate:workflow_flow_replay` MUST accept current `verify record --kind e2e` evidence only when its structured observation includes both `flow_replay` and `scenario_clause_e2e`, its target is an existing E2E spec/test file under an `e2e` path, and the command includes that full target path.
- Explicit E2E replay evidence MUST be current-head bound and passing; marker-only evidence, missing target files, non-E2E target files, route-like target files, and basename-only command matches MUST remain unresolved.
- A Flow Verification run with zero passing runtime probes MUST remain unresolved.
- When zero-probe or missing replay evidence blocks workflow-heavy readiness, the Gate DAG MUST include a concrete action to configure `.vibepro/config.json` `flow_design.runtime_probes[]` or record explicit current E2E replay evidence.
- Basic Auth Flow Verification MUST keep secret values out of evidence while preserving the `basic_auth_env` variable-name provenance.

## Scenarios

- `S-001`: Given a workflow-heavy story with no configured runtime probes, when `vibepro verify flow` runs, then the workflow state transition remains `needs_evidence` and setup guidance tells the operator to register `flow_design.runtime_probes[]`.
- `S-002`: Given a workflow-heavy story with current E2E verification evidence whose observation records workflow state transition replay through `flow_replay` and `scenario_clause_e2e`, whose target is an existing E2E spec file, and whose command includes that full target path, when `vibepro pr prepare` runs, then `gate:workflow_flow_replay` passes without requiring hosted preview smoke.
- `S-003`: Given marker-only, observation-free, missing-target, non-E2E-target, route-target, or basename-only E2E evidence, when `vibepro pr prepare` evaluates workflow state transition replay, then workflow replay remains unresolved.
- `S-004`: Given `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` are present for Flow Verification, when evidence is written, then credential values are not persisted and only the environment variable provenance is stored.
