# Gate Outcome ROI Ledger Architecture

## Context

The gate outcome ROI ledger measures how previously blocked gates are resolved
without changing PR blocking behavior. It records resolved gate outcomes under
`.vibepro/gate-outcomes/ledger.json`, updates the ledger during `pr prepare`,
and reports distributions from `usage report`.

## Decision

Add the ledger as a local VibePro audit artifact, not as a new enforced gate.
`pr prepare` compares the previous and current Gate DAG, classifies newly
resolved gates, and writes measurement entries. `usage report` aggregates those
entries with the existing period filter.

## Alternatives Considered

- Add a new blocking gate for ROI quality. Rejected because this story is about
  reducing fixed cost and measuring existing gates before enforcement changes.
- Store outcomes in git history as committed audit docs. Rejected because the
  measurement should be local and period-filtered like other usage artifacts.
- Only report current Gate DAG counts. Rejected because ROI requires the
  resolution outcome, not just the current blocked/passed state.

## Compatibility Impact

The public contract change is additive. Existing `pr prepare` output gains a
`gate_outcome_ledger` field, `usage report` gains a Gate Outcome ROI section,
and `pr prepare --outcome` is an optional override for ambiguous classification.
Existing command defaults, gate statuses, PR creation blocking rules, and report
callers remain backward compatible.

## Boundary

The boundary is measurement and reporting. The ledger can classify outcomes as
`source_fix`, `evidence_added`, `rewording_only`, `waiver`, or `unclassified`,
but it does not make pass/fail decisions for PR gates. Responsibility stays in
the PR lifecycle and usage reporting surfaces; it does not alter agent review,
verification freshness, or merge policy authority.

## Rollback Plan

Rollback is a normal revert of `src/gate-outcome-ledger.js` plus the additive
call sites in `src/pr-manager.js`, `src/usage-report.js`, and `src/cli.js`.
Since the artifact is local under `.vibepro/gate-outcomes/`, stale ledger files
can be ignored or deleted after rollback without affecting source behavior.

## Accepted Followups

No blocking followups are accepted for this story. Future stories may use the
ledger data to tune demotion thresholds or expand reports, but those decisions
should be driven by collected outcome distributions.
