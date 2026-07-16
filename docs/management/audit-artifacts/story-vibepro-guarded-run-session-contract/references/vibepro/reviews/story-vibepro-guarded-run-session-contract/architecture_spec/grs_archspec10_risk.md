# Regression risk review #10

PASS

Whole-service replacement is removed; `runCli` can only pass the factory's closed dependency set, with unknown-key rejection and static forbidden-surface coverage. Advisory budget semantics are explicit and tested, including `attempt: 1` to `attempt: 2` beyond `max_attempts: 1`. No remaining authority bypass, semantic contradiction, or legacy `execute start/status/next/reconcile/merge` regression is evident across the Story, Architecture, Spec, and Test Plan.
