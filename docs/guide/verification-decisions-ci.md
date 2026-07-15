# Verification, Decisions, and CI

Verification records must describe an observable result for the current change.

```bash
vibepro verify record . \
  --id <story-id> \
  --kind typecheck \
  --status pass \
  --command "npm run typecheck" \
  --artifact <status-artifact> \
  --target "src" \
  --scenario "all shipped JavaScript parses" \
  --observed "exit_code=0"
```

`--kind` is required and accepts `unit`, `integration`, `e2e`, `typecheck`, or `build`. `--status` accepts `pass`, `fail`, or `needs_setup`. Preserve a durable status artifact and structured observations when the gate must rely on the result.

Record residual risk as an attributable decision, not by changing a failed result to pass:

```bash
vibepro decision record . \
  --id <story-id> --type waiver \
  --summary "<accepted residual risk>" \
  --reason "<why>" --artifact <evidence> \
  --reviewer <identity> --status accepted
```

After the PR's CI finishes:

```bash
vibepro verify import-ci . --id <story-id> --pr <number>
vibepro pr prepare . --story-id <story-id> --base origin/main --summary-json
vibepro pr create . --story-id <story-id> --base origin/main
```

CI is evidence only when it is tied to the reviewed commit and imported successfully. Authentication failure, missing checks, or an unknown mapping remains explicit and must not be converted to an empty successful result.
