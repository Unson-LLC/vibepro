---
title: "Next Best Action Controller Spec"
status: accepted
created_at: 2026-07-19
updated_at: 2026-07-19
related_stories:
  - story-vibepro-next-best-action-controller
parent_design:
  - vibepro-autonomy-roadmap-rebaseline
---

# Next Best Action Controller Spec

## Contract

`selectNextBestAction(input)` accepts `checkpoint_reason`, a bounded `state_delta`, candidate actions, an optional previous decision, `no_progress_count`, and `policy_version`. Candidates require `policy_allowed=true`, `dependency_ready=true`, an action classification, and machine-readable metrics.

The output records all NBA-S-2 metrics. Unknown measurements use the literal `unknown`. The selection is deterministic for the same normalized input and policy. A previous decision with the same checkpoint, state fingerprint, and policy is returned with `reused=true`.

`selectSafeActionCandidate(state, options)` is the Safe Action integration surface. It derives policy and dependency eligibility from canonical action registries and the action journal; callers provide estimates, checkpoint context, and canonical escape IDs, not action objects or action authority. Guarded Run persists the bounded recommendation through its authority-first state path before canonical execution and exposes the same record on readback.

## Invariants

- `INV-NBA-1`: forbidden or dependency-blocked actions are never ranked.
- `INV-NBA-2`: unknown cost is never normalized to numeric zero.
- `INV-NBA-3`: no-progress count of two or more permits only explicit escape actions.
- `INV-NBA-4`: decision records contain bounded inputs and reason codes, not raw transcripts.
- `INV-NBA-5`: the controller recommends among existing authorities and never executes or authorizes an action.

## Scenarios

- `NBA-S-1`: Given the Safe Action registry contains forbidden or dependency-blocked actions, when a checkpoint requests a recommendation, then only policy-allowed and dependency-ready actions enter the ranking.
- `NBA-S-2`: Given a recommendation is produced, when its decision record is inspected, then every comparison metric is present and unavailable measurements remain `unknown`.
- `NBA-S-3`: Given the normalized state, policy version, and candidates are unchanged, when selection is repeated, then the selected action and ordering are deterministic.
- `NBA-S-4`: Given cost or risk measurements are unavailable, when candidates are ranked, then unknown values are not converted to zero or treated as free evidence.
- `NBA-S-5`: Given the checkpoint, material state fingerprint, and policy version are unchanged, when the controller runs again, then it reuses the previous bounded decision.
- `NBA-S-6`: Given an expensive validation and a cheaper uncertainty-reducing action are both eligible, when expected value is compared, then the cheaper uncertainty reduction is preferred.
- `NBA-S-7`: Given two consecutive checkpoints report no progress, when another recommendation is requested, then only an explicit stop, ask, or re-plan escape action can be selected.
- `NBA-S-8`: Given a recommendation is persisted, when its payload is inspected, then it contains bounded metrics and reason codes without raw transcripts and does not execute or authorize the action.
- `NBA-S-9`: Given a Guarded Run is already `cancelled` or `pr_ready`, when orchestration or cancellation is requested again, then the existing terminal state is returned without another controller selection or action execution; repeated cancellation is idempotent.

## Verification

`test/next-best-action-controller.test.js` covers NBA-S-1 through NBA-S-8, including rejection of non-canonical escape IDs. `test/guarded-run-session.test.js` verifies authority persistence and public readback. `test/e2e/story-vibepro-next-best-action-controller-acceptance.spec.ts` replays both suites as one acceptance boundary.
