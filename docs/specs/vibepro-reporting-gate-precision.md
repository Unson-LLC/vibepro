---
story_id: story-vibepro-reporting-gate-precision
title: "Reporting Gate Precision"
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        Diff["PR diff"] --> Classify["PR Gate classification"]
        Classify --> UsageReport{"Only src/usage-report.js source?"}
        UsageReport -->|yes| Reporting["reporting surface"]
        UsageReport -->|no| Workflow["normal workflow/source surface"]
        Reporting --> Evidence["focused test + runtime path evidence"]
        Workflow --> WorkflowEvidence["workflow replay evidence remains required when applicable"]
        Evidence --> GateDag["Gate DAG"]
        WorkflowEvidence --> GateDag
    rationale: "The change narrows false workflow classification for read-only usage-report metrics while preserving workflow-heavy gates for real orchestration changes."
---

# Spec: Reporting Gate Precision

- `RGP-CONTRACT-001`: Source diffs limited to `src/usage-report.js` MUST NOT activate `agent_workflow` solely because Story/Spec text mentions agent, subagent, review, gate, artifact, Codex, or Claude telemetry.
- `RGP-CONTRACT-002`: Common Judgment Spine MUST use surface `reporting` for read-only usage-report metric changes.
- `RGP-CONTRACT-003`: Reporting surface current-reality evidence MUST require `focused_test` and `runtime_path_evidence`, not workflow-only `flow_replay`, `artifact_replay`, or `scenario_clause_e2e`.
- `RGP-CONTRACT-004`: Scheduler blueprint detection MUST NOT treat lifecycle metric wording such as `interval` as scheduled-job infrastructure by itself.
- `RGP-CONTRACT-005`: Story text containing `ADR-unnecessary:` MUST satisfy Architecture Gate as an explicit ADR-unnecessary decision.

## Scenarios

- `RGP-S-001`: Given a usage-report-only metrics PR with focused verification, when `vibepro pr prepare` runs, then the Gate DAG has reporting-surface current reality and no workflow flow replay gate.
- `RGP-S-002`: Given a real agent workflow source path, when `vibepro pr prepare` runs, then the existing workflow evidence requirements still apply.
