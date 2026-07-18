# Next Best Action Controller Spec

## Contract

`selectNextBestAction(input)` accepts `checkpoint_reason`, a bounded `state_delta`, candidate actions, an optional previous decision, `no_progress_count`, and `policy_version`. Candidates require `policy_allowed=true`, `dependency_ready=true`, an action classification, and machine-readable metrics.

The output records all NBA-S-2 metrics. Unknown measurements use the literal `unknown`. The selection is deterministic for the same normalized input and policy. A previous decision with the same checkpoint, state fingerprint, and policy is returned with `reused=true`.

`selectSafeActionCandidate(state, options)` is the Safe Action integration surface. It derives policy and dependency eligibility from the canonical registry and action journal; callers provide estimates and checkpoint context, not action authority.

## Invariants

- `INV-NBA-1`: forbidden or dependency-blocked actions are never ranked.
- `INV-NBA-2`: unknown cost is never normalized to numeric zero.
- `INV-NBA-3`: no-progress count of two or more permits only explicit escape actions.
- `INV-NBA-4`: decision records contain bounded inputs and reason codes, not raw transcripts.
- `INV-NBA-5`: the controller recommends among existing authorities and never executes or authorizes an action.

## Verification

`test/next-best-action-controller.test.js` covers NBA-S-1 through NBA-S-8, including deterministic ranking, unknown preservation, material checkpoint reuse, cheaper uncertainty reduction, and no-progress escape.
