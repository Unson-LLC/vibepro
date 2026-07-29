# Runtime contract review — 0d55e3b6

- status: needs_changes
- finding: high `OCR-RUNTIME-CONTAINMENT-FAILURE`

The owner deadline calls cancellation exactly once, but treated every terminal
result as successful containment. The production coordinator can return
`failed/orphaned_agent` after normal and force cancellation both fail; the owner
incorrectly replaced that with `waiting_for_runtime/runtime_probe_timeout`.

Required repair: preserve failed terminal results, especially `orphaned_agent`
and `runtime_terminal_race`, and add a production-shaped regression.

Other inspected contracts passed: operator cancellation fencing, repair and
current-HEAD rebind, independent read-only review, and external authority seams.
Targeted existing tests: 129 passed, but the failed-terminal shape was missing.
