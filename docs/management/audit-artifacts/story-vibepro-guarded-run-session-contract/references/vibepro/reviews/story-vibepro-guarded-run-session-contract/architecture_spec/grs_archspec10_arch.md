# Architecture boundary review #10

PASS

- Closed DI includes `readdir`; the factory rejects unknown keys.
- `runCli` accepts only `io.guardedRunDependencies` through the same factory and cannot replace the constructed service.
- Forbidden agent/runtime dispatch, shell/action execution, waiver, and merge capabilities are excluded from imports and injection.
- Gate DAG authority, managed/repository/source-fallback authority resolution, mirror recovery, migration, and legacy-command boundaries remain coherent and fail closed.
