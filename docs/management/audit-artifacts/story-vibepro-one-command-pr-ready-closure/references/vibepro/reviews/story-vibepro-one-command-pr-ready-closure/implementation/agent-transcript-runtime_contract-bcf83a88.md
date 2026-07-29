# Independent Final Review: runtime_contract

- Agent: `/root/runtime_final_bcf`
- Reviewed HEAD: `bcf83a880285ebf4ba9eb2b20bbe2d2f8a617244`
- Status: `needs_changes`

## Summary

The guarded one-command path correctly bounds PR/merge/waiver/external authority,
delegates in the managed worktree, preserves typed runtime/review stops, and
rebinds Gate evidence to authoritative HEAD. However operator cancellation is
not contained while an implementation runtime is active: execute cancel only
writes a cancelled Run state, while the original orchestrator keeps polling the
provider and can later overwrite the terminal cancellation and continue the plan.

## Finding

### high: OCR-RUNTIME-CANCEL-001

`src/one-command-pr-ready-closure.js:417-439` polls an active implementation
dispatch without rereading Run authority or accepting a cancellation signal.
`src/guarded-run-session.js:1081-1099` transitions and persists the Run to
`cancelled` but does not invoke the available runtime cancellation boundary.
When the original orchestration returns, the stale executor can overlay and
persist its in-flight result without a terminal-state or compare-and-swap guard
(`src/guarded-run-session.js:354-365,446-450,1650-1654`).

Required repair: cancel the active dispatch, prevent a stale executor from
overwriting terminal cancellation, and add a race test proving no later
poll/action/state overwrite after operator cancellation.

## Mandatory lenses

- `regression_guard`: needs changes because concurrent operator cancellation is
  not covered by the existing cancellation tests.
- `path_surface_coverage`: needs changes because the active provider-dispatch
  path was not exercised.

## Evidence

- Focused review tests: 28/28 passed at reviewed HEAD.
- Full suite: 1794/1794 passed at reviewed HEAD.
- Architecture conformance: 71 violations, equal to origin/main baseline 71,
  with no new reverse CLI dependency.
