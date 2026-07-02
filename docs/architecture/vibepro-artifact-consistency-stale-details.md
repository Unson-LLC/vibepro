---
story_id: story-vibepro-artifact-consistency-stale-details
title: Artifact Consistency Stale Detail Contract Architecture
parent_design: vibepro-artifact-consistency-stale-details
status: active
---

# Artifact Consistency Stale Detail Contract Architecture

## Context

Artifact Consistency already blocks PR creation when recorded verification or agent review artifacts are stale for the current git state. The gap in this Story is the review contract: downstream users can see that the gate is blocked, but cannot reliably identify the stale artifact, root cause, and exact VibePro command sequence from the gate payload and PR preparation summary.

## Public Contract

`vibepro pr prepare` keeps the existing Artifact Consistency contract stable and adds detail fields only when stale artifacts are present.

- Existing `gate:artifact_consistency.status`, `reason`, `artifacts`, `inconsistent_artifacts`, and stale counts remain compatible with existing JSON consumers.
- New `stale_artifact_details` and `stale_artifact_groups` fields are additive. Consumers that only read `inconsistent_artifacts` continue to work.
- Each stale detail exposes the artifact identity, stale reason, root cause, blocking status, and remediation command sequence.
- Remediation commands are advisory output for humans and automation planners. `pr prepare` does not run verification, dispatch agents, close reviews, or record evidence automatically.
- Verification remediation always points back to `vibepro verify record` for the same Story and verification kind, followed by `vibepro pr prepare`.
- Agent review remediation always points back to the review prepare/start/close/record lifecycle for the same Story, stage, and role, followed by `vibepro pr prepare`.

## Boundary

The change is limited to PR preparation evidence reporting. It does not change verification execution, agent dispatch, review lifecycle ownership, git binding semantics, or the critical blocking status of stale evidence.

## Rollback

Rollback is a source revert of the stale detail output changes followed by `vibepro pr prepare`. Because all new fields are additive and no persisted runtime state is migrated, reverting restores the previous Artifact Consistency payload without data repair.
