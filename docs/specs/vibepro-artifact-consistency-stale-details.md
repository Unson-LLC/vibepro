---
story_id: story-vibepro-artifact-consistency-stale-details
title: Artifact Consistency Stale Detail Output Spec
status: final
parent_design: vibepro-artifact-consistency-stale-details
---

# Artifact Consistency Stale Detail Output Spec

## Requirements

- `pr prepare` must preserve the existing artifact consistency status model and compatibility fields.
- When artifact consistency is blocked, the gate payload must include `stale_artifact_details`.
- Each stale detail must include:
  - `artifact_path`
  - `artifact_type`
  - `status`
  - `stale_reason`
  - `root_cause`
  - `blocking`
  - `remediation_command`
  - `remediation_commands`
- Verification artifacts must recommend `vibepro verify record` for the same story and verification kind.
- Agent review artifacts must recommend the review prepare/start/close/record lifecycle for the same story, stage, and role.
- `gate_status.critical_unresolved_gates` must carry the detail fields so JSON consumers do not need to re-read Gate DAG nodes.
- The human `pr prepare` summary must render a compact stale artifact table when artifact consistency is blocked.

## Public Contract

- `AC-5`: Existing `inconsistent_artifacts` compatibility output MUST remain populated for stale Artifact Consistency results.
- `AC-5`: `stale_artifact_details` and `stale_artifact_groups` MUST be additive output fields; removing or renaming existing Artifact Consistency fields is out of scope for this Story.
- `AC-5`: Human-readable remediation commands MUST be derived from the stale artifact kind and MUST NOT imply that `pr prepare` executes verification or agent review side effects.

## Acceptance Tests

- A mixed stale verification and stale agent review fixture exposes two stale detail rows.
- The verification row names the verification artifact and includes a `vibepro verify record` command.
- The review row names the review artifact and includes `vibepro review prepare` and `vibepro review record` commands.
- Execution gate actions include artifact-specific remediation, not only a generic stale evidence message.
- Compatibility assertions confirm `inconsistent_artifacts` stays present while the new stale detail fields are emitted.
