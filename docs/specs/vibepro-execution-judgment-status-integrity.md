---
story_id: story-vibepro-execution-judgment-status-integrity
title: Execution and Judgment Status Integrity Spec
---

# Spec

## Required Behavior

- `EJSI-001`: merged Storyの execution state MUST mark `agent_review_recorded` as passed when the current review summary shows no unmet required reviews for the gate stage.
- `EJSI-002`: merged Storyの execution state MUST mark `pr_created` as passed when `pr-create.json` exists with a real PR URL, and also when merge artifacts prove the PR was already merged.
- `EJSI-003`: `completion_status=merged` MUST NOT coexist with `execution_dag` nodes that still claim `pr_created=pending` or `agent_review_recorded=pending`.
- `EJSI-004`: `review record` with `--agent-closed` MUST preserve or synthesize lifecycle closure so `review-summary.json` can report a closed lifecycle consistent with recorded provenance.
- `EJSI-005`: synthesized lifecycle entries MUST be explicitly machine-readable and bound to the same story/stage/role/git state as the review result.
- `EJSI-006`: a judgment axis with non-empty `missing_evidence[]` MUST NOT be emitted as `active_passed`.
- `EJSI-007`: `active_accepted_followup` MUST require both a recorded accepted decision and unresolved evidence that is explicitly safe to defer.
- `EJSI-008`: when required evidence is partially matched but `missing_evidence[]` is still non-empty and no accepted follow-up exists, the axis MUST be `active_needs_evidence`.
- `EJSI-009`: judgment axis gate status and PR body status text MUST be derived from the same strict axis status so they cannot disagree.

## Data Shape

- review lifecycle entries MAY include a synthesized flag or provenance source that explains they were reconstructed from `review-result-<role>.json`.
- execution DAG nodes remain the same ids, but their statuses MUST reflect the latest merged/pr-created/review-complete artifacts.

## Scenarios

- `S-001`: Given a merged Story has `pr-merge.json` and a gate-stage `review-summary.json` with no unmet/stale/timed-out/blocked required reviews, when `vibepro execute status` or `vibepro execute reconcile` rebuilds execution state, then the workflow state transition moves the Story to `completion_status=merged` with both `agent_review_recorded` and `pr_created` marked `passed`.
- `S-002`: Given `review record --agent-closed` receives a closed agent provenance for the current HEAD but no matching lifecycle start artifact exists, when the review result is recorded, then the review lifecycle transitions from missing-start evidence to a synthesized closed lifecycle entry that stays bound to the same story/stage/role/git state.
- `S-003`: Given a judgment axis still has unresolved `missing_evidence[]`, when PR prepare renders `judgment_axes[]`, PR body, and Gate DAG summary, then the workflow status transition keeps the axis at `active_needs_evidence` or `active_accepted_followup`, never `active_passed`, until the missing evidence is closed or an accepted defer decision exists.

## Non Goals

- Replacing `review start` / `review close` with implicit-only lifecycle tracking.
- Introducing a new human approval phase.
