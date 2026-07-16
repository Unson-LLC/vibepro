# Unit and integration review #3

PASS

- Deterministic fixtures inject clock, randomness, bootstrap, Gate readiness, artifact I/O including `readdir`, and Git identity without ESM monkeypatching.
- Exact initial defaults and advisory-budget semantics are asserted, including `attempt: 1` to `attempt: 2` past `max_attempts: 1` and unchanged `iteration`.
- Authority, mirror failure/repair, restart, migration, typed errors, state transitions, path validation, and legacy CLI compatibility have implementable unit/integration coverage.
- Closed factory keys, unknown-key rejection, and the absence of whole-service replacement or forbidden capabilities are statically tested.
