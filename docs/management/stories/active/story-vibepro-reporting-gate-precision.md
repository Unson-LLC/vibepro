---
story_id: story-vibepro-reporting-gate-precision
title: "usage-report reporting changes do not trigger workflow-heavy PR gates"
status: active
architecture_docs:
  - docs/architecture/vibepro-reporting-gate-precision.md
spec_docs:
  - docs/specs/vibepro-reporting-gate-precision.md
---

# Story: usage-report reporting changes do not trigger workflow-heavy PR gates

## Problem

VibePro blocked a read-only `usage report --subagent-roi` change by classifying reporting terminology such as agent, subagent, review, gate, artifact, and interval as workflow orchestration or scheduled-job infrastructure.

That pushed a telemetry reporting PR into workflow replay, scheduler blueprint, and manual fallback pressure even though the implementation did not alter review dispatch, lifecycle state transitions, queues, workers, scheduled jobs, or merge orchestration.

## Acceptance Criteria

- [ ] A change limited to `src/usage-report.js` plus docs/tests is classified as read-only reporting, not `agent_workflow`.
- [ ] Common Judgment Spine uses a `reporting` surface for usage-report metrics and accepts focused test plus runtime-path evidence instead of workflow replay evidence.
- [ ] The architecture blueprint scheduler gate is not created from lifecycle `interval` wording alone.
- [ ] Story-level `ADR-unnecessary` is honored by Architecture Gate.
- [ ] Real agent workflow changes still require workflow replay evidence and keep existing agent_workflow route behavior.

## Workflow Evidence

- flow_replay: `node --test --test-name-pattern "usage-report metrics changes stay reporting-scoped" test/vibepro-cli.test.js` replays the PR prepare route for a usage-report metrics story and confirms no workflow replay gate is created.
- artifact_replay: The same test inspects generated Gate DAG artifacts and asserts the Common Judgment Spine surface is `reporting`, the Architecture Gate is satisfied, and scheduler blueprint is absent/not required.
- scenario_clause_e2e: Existing workflow tests still verify real `agent-workflow.js` changes remain workflow-gated.

## Architecture Decision

ADR-unnecessary: This is a precision change inside existing PR Gate classification. It introduces no new persistence, scheduler, queue, worker, network boundary, external side effect, or merge mechanism. The architecture evidence is recorded in `docs/architecture/vibepro-reporting-gate-precision.md`.

## Responsibility Authority

The change stays within VibePro PR Gate classification authority. It changes how existing gates classify read-only reporting diffs; it does not alter data ownership, secret handling, external-send authority, or deployment authority.
