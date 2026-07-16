# Regression risk review

Status: needs_changes

1. `runCli(io.guardedRunSession)` can replace the whole Run service and bypass the closed dependency set. Inject only the factory's closed dependencies; do not accept service replacement on the production CLI path.
2. A fresh Run starts at attempt 1 with max_attempts 1, while explicit resume increments attempt. Define whether limits are advisory here or choose/enforce compatible defaults and test the boundary.
