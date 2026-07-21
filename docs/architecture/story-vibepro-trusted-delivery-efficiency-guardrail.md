# Trusted Delivery Efficiency Guardrail Architecture

## Decision

Introduce one pure policy module, `src/delivery-efficiency-guardrail.js`, as the shared contract for delivery budgets, review dispatch decisions, lifecycle debt, metric aggregation, and compatible finding batches. Existing owners remain authoritative: `validation-sequencing` owns freeze ordering, `agent-review` owns lifecycle persistence, `pr-manager` owns Gate DAG/readiness, `review-finding-repair-loop` owns repair execution, and `story-run-portfolio` owns cross-Story summaries.

The guardrail consumes snapshots from those owners and returns deterministic decisions. It does not spawn agents, cancel providers, run tests, waive gates, or mutate repository state.

## Components and boundaries

### Delivery efficiency policy

- Normalize machine-readable budgets for elapsed time, observed work, token/cost, subagent consumption, role dispatches, repair batches, and expensive verification.
- Preserve missing policy and missing measurements as `null`/`unknown`; never coerce them to zero.
- Evaluate each known measurement against its budget and return typed stops for exceeded or required-but-unknown dimensions.

### Review dispatch decision

- Require Story, stage, role, HEAD, surface digest, risk closure, expected judgment delta, evidence reuse, and budget snapshot.
- Build an idempotency key from Story/stage/role/HEAD/surface.
- Distinguish `preflight` from `final`; final dispatch requires source, Spec, tests, and review surface to be frozen.
- Reuse or block duplicate running, uncollected, or completed-pass lifecycle state instead of spawning.

### Lifecycle debt

- Classify timed-out, obsolete, orphaned, duplicate, and budget-exceeded work separately from correctness readiness.
- `agent-review` captures HEAD and surface digest when a lifecycle starts. If the current HEAD no longer matches, status inspection derives `orphaned_agent` and fails closed until the provider result is explicitly collected or cancellation is confirmed.
- Explicit close after a HEAD mutation persists `obsolete`, the terminal HEAD, the mutation reason, and cancellation confirmation; a stale running record is never silently treated as complete.
- `pr-manager` reads persisted lifecycle and repair-loop artifacts, evaluates the configured budget, and displays efficiency debt without changing required Gate semantics.

### Finding batch planner

- Group repairable findings only when role and normalized code/test surface match and none requires human architecture/security/policy judgment.
- Preserve conflicting, split-required, human-decision, and non-actionable findings as separate batches/checkpoints.
- `review-finding-repair-loop` dispatches and records one batch while retaining per-finding fingerprints and compatibility with one-finding plans.

### Story efficiency metrics

- Aggregate Trusted PR-ready elapsed, observed work, wait union, subagent wall-clock, agent consumption, dispatch/accepted-finding/full-suite/evidence-reuse counters, fresh/total token, and cost.
- Parallel review wall-clock is represented separately from summed agent consumption.
- `story-run-portfolio` runs the shared aggregator over raw run timestamps, overlapping review intervals, dispatch records, and attribution input before storing and summarizing the expanded attribution shape. Explicit measurements are retained when no aggregate can be derived.

## Data flow

1. Story/Run policy and current measurements enter the pure guardrail evaluator.
2. Before review dispatch, current freeze binding, lifecycle snapshots, decision value, and remaining budget produce `dispatch`, `reuse`, or a typed `stop`.
3. On HEAD mutation, `agent-review` derives an orphaned stop from the stale lifecycle; explicit close persists the obsolete terminal state and binding evidence.
4. Repair findings are converted into compatible batches; each batch receives one targeted verification and one independent re-review.
5. `pr-manager` and portfolio surfaces consume the persisted lifecycle, repair, policy, and measurement records and display correctness readiness and efficiency debt independently.

## Invariants

- Required/critical Gates, independent final review, current-HEAD binding, and fail-closed behavior cannot be relaxed by an efficiency decision.
- Unknown is not zero, free, pass, or waiver.
- The dispatch idempotency key includes Story, stage, role, HEAD, and surface digest.
- Final review never starts before the exact source/Spec/test/review surface binding is frozen.
- Provider-specific cancellation is out of scope; unconfirmed cancellation is an orphaned-agent stop.
- Changed lines are not a time, token, or value allocation basis.

## Compatibility and migration

- Existing callers without an efficiency policy continue in measurement-only mode; unknown fields remain explicit.
- Existing single-finding repair artifacts are accepted as one-item batches.
- Existing PR correctness readiness stays unchanged; the new efficiency debt is additive and cannot turn a failing Gate into pass.
- Rollback is removal of enforcement at integration points while retaining the pure summary output and existing Gate owners.

## Verification strategy

- Unit matrix for unknown budgets, budget stops, preflight/final barrier, same-key duplicate states, HEAD mutation, timeout/orphan, parallel timing, and unknown metrics.
- Repair-loop tests for compatible batching and separation of conflicting/human findings.
- Portfolio and PR-manager contract tests for additive metrics/debt and unchanged correctness readiness.
- Existing validation sequencing, review lifecycle, repair loop, portfolio, and PR manager suites plus the full test suite.

## Acceptance mapping

- TDEG-S-1/S-2/S-3/S-4/S-6/S-7: policy, dispatch, lifecycle functions in the guardrail module.
- TDEG-S-5: batch planner integrated into `review-finding-repair-loop`.
- TDEG-S-8: separate efficiency debt surfaced by `pr-manager`.
- TDEG-S-9: metrics aggregation integrated into `story-run-portfolio`.
- TDEG-S-10: performance artifacts compare equivalent risk class; no changed-line allocation.
- TDEG-S-11: dedicated E2E-style unit matrix across the pure orchestration contract.
- TDEG-S-12: existing contract suites and full suite remain green.
