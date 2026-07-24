---
story_id: story-vibepro-one-command-pr-ready-closure
status: completed
artifact_kind: execution_topology_replay_plan
gate: gate:judgment_axis_execution_topology
---

# Execution Topology Replay Plan

This planning artifact closes the missing planning surface for
`gate:judgment_axis_execution_topology`. It does not claim fresh evidence by
itself. After this commit, the current-head E2E, verification record, and
independent review must bind the checks below to the new HEAD.

## Replay Surface

The replay follows the production-shaped guarded run:

`diagnose -> prepare_artifacts -> implement -> verify -> review -> repair -> final_prepare`

The operator process is `vibepro execute run . --story-id
story-vibepro-one-command-pr-ready-closure --until pr-ready --autonomy guarded`.
`src/cli.js` only creates the outer composition root. `src/guarded-run-session.js`
owns durable Run state, cancellation authority, HEAD rebind, and typed stop
persistence. `src/safe-action-orchestrator.js` owns DAG order and retry
eligibility. `src/one-command-pr-ready-closure.js` owns the action callbacks.
`src/agent-runtime-connectors.js` and `src/agent-runtime-adapter.js` own
provider dispatch and polling. `src/independent-review-orchestrator.js` owns the
read-only review lifecycle.

## Flow Replay Checkpoints

Record `flow_replay` evidence only when the replay proves these transitions:

- `diagnose` reads the injected readiness snapshot and cannot mark the Run
  ready.
- `prepare_artifacts` writes only missing planning artifacts or returns a
  bounded `waiting_for_human` descriptor; malformed descriptors fail closed.
- `implement` starts only after a provider advertises both `workspace_write` and
  `local_workspace_only`; otherwise it stops before mutation with provider,
  missing capability, and recovery command persisted in the same Run.
- `verify` consumes current-head PR preparation output and cannot treat missing
  environment evidence as pass.
- `review` uses the independent review owner and a separate read-only identity.
- `repair` runs only after `needs_changes`, advances to a new HEAD, invalidates
  the old verify/review suffix, and replays verify plus review before
  `final_prepare`.
- `final_prepare` returns `pr_ready` only from a current-head
  `pr-prepare.json` where `gate_status.ready_for_pr_create=true`.

## Artifact Replay Checkpoints

Record `artifact_replay` evidence only when these persisted artifacts can be
read back and correlated:

- Run state: `.vibepro/executions/story-vibepro-one-command-pr-ready-closure/state.json`
  or the concrete run state under `runs/<run-id>/state.json` contains the active
  node, terminal code, provider selection, dispatch id, and managed worktree
  HEAD.
- Verification evidence: `.vibepro/evidence/story-vibepro-one-command-pr-ready-closure/evidence.json`
  and `.vibepro/pr/story-vibepro-one-command-pr-ready-closure/verification-evidence.json`
  reference the same current HEAD and include `flow_replay`,
  `scenario_clause_e2e`, `artifact_replay=current_head`, and failure-mode
  markers for timeout, parse_failure, provider_failure, retry_or_async_failure,
  evidence_lifecycle_regression, and workflow_state_regression.
- Gate authority: `.vibepro/pr/story-vibepro-one-command-pr-ready-closure/pr-prepare.json`
  and `gate-dag.json` agree on the head SHA, dirty fingerprint, and unresolved
  gate set after the verification record is refreshed.
- Review lifecycle:
  `.vibepro/reviews/story-vibepro-one-command-pr-ready-closure/<stage>/lifecycle.json`
  has a prepared, authorized, started, closed, and recorded event for every
  required role, with inspection inputs that point at real Story, Spec, source,
  and test surfaces rather than only generated request files.

## Deadlock And Evidence-Loss Risks

- Process restart can resume only from the first incomplete suffix; completed
  nodes are idempotent and may be replayed only through their stored checkpoint.
- Cancellation wins over in-flight dispatch completion. A stale poll result may
  record containment, but it may not overwrite `cancelled` or continue the DAG.
- Runtime timeout and quota stops are typed terminal or resumable states. Retry
  requires the same Run id and must preserve the provider order selected at Run
  creation.
- Repair convergence is bounded. Repeated `needs_changes` cannot loop forever;
  it stops with the repair-convergence code and preserved review findings.
- Any HEAD change after planning invalidates strict-head verification and all
  adjudication verdicts. The verification and review refresh must happen after
  this artifact commit.
- Generated `.vibepro` PR, review, and QA files are operational evidence and are
  not a substitute for current-head verification artifacts.

## Current Verification And Review Binding Plan

After this planning commit, refresh evidence in this order:

1. Run `node --test test/e2e/story-vibepro-one-command-pr-ready-closure-runtime.spec.ts`.
2. Record the result with `vibepro verify record` using scenarios
   `flow_replay`, `scenario_clause_e2e`, `path_surface:review_surface`, and
   observed `artifact_replay=current_head`.
3. Run the current-head unit and integration/typecheck commands named by
   `.vibepro/pr/story-vibepro-one-command-pr-ready-closure/gate-dag.json`.
4. Run `vibepro review prepare`, authorize, start, close, and record the gate
   review roles with inspection inputs covering this file, the existing test
   plan, `docs/architecture/story-vibepro-one-command-pr-ready-closure.md`,
   `src/guarded-run-session.js`, `src/one-command-pr-ready-closure.js`,
   `src/agent-runtime-adapter.js`, `src/agent-runtime-connectors.js`,
   `src/independent-review-orchestrator.js`, and
   `test/e2e/story-vibepro-one-command-pr-ready-closure-runtime.spec.ts`.
5. Rerun `node bin/vibepro.js pr prepare . --story-id
   story-vibepro-one-command-pr-ready-closure --summary-json` and treat
   `gate_status.ready_for_pr_create` as the only PR-ready authority.
