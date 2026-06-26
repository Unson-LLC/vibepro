---
story_id: story-vibepro-reporting-gate-precision
title: "Reporting Gate Precision"
---

# Architecture: Reporting Gate Precision

## Decision

Keep `agent_workflow` strict for real agent/review/gate orchestration changes, but introduce a narrow read-only reporting exception for `src/usage-report.js` changes.

## Rationale

`usage report` summarizes VibePro artifacts after the fact. Its domain language naturally contains words such as agent, review, gate, artifact, lifecycle, and interval. Those words describe telemetry, not orchestration behavior. Treating that reporting surface as workflow-heavy creates false blocks and encourages rule-violating GitHub fallbacks.

## Boundaries

- Applies only when every changed source file is `src/usage-report.js`.
- Does not apply to `src/agent-review.js`, `src/pr-manager.js`, review dispatch, lifecycle mutation, gate construction, merge orchestration, queues, workers, or scheduled jobs.
- Keeps public contract review active when output/schema text changes.

## Alternatives Considered

- Waive each usage-report PR manually: rejected because it normalizes bypassing VibePro gates.
- Lower all agent workflow evidence requirements: rejected because real agent workflow changes still need strong replay evidence.
- Add reporting surface: selected because it preserves strict workflow gates while removing false positives for read-only metrics.

## Rollback

Revert the reporting-surface helper and scheduler keyword narrowing. Existing workflow-heavy evidence gates remain unchanged for true workflow changes.
