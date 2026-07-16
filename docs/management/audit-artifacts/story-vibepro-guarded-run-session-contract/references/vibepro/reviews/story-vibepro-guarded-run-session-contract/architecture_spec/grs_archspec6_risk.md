# regression_risk review #6

status: needs_changes

1. Story `GRS-S-4` and the command matrix still stated unconditional byte-for-byte repeated cancel, conflicting with migration-first precedence.
2. Pre-existing divergent old managed copies need raw equality validation before migration; otherwise divergence detection and migration ordering conflict.

The managed authority-first migration failure/restart/repair path is otherwise well specified for initially matching copies.
