# CI Integration

`vibepro gate check` lets an external repository's CI enforce VibePro Gate DAG
readiness without reimplementing gate or scoring logic. It is read-only: it
evaluates the same computation `pr prepare` uses and never writes to
`.vibepro/`.

## GitHub Actions example

```yaml
name: vibepro-gate-check

on:
  pull_request:

jobs:
  gate-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Run VibePro gate check
        run: |
          npx vibepro@beta gate check . --story-id "$STORY_ID" --ci --json
        env:
          STORY_ID: story-example
```

`vibepro gate check` exits `0` when every required gate is resolved and `1`
otherwise, so the step above fails the job automatically when the Gate DAG is
not ready for review. No separate `if` check or exit-code parsing is needed.

## Notes

- Omit `--story-id` to let `gate check` resolve the default story the same way
  `checkpoint` does.
- Add `--json` to consume the normalized report (`schema_version`, `story_id`,
  `overall_status`, `ready_for_pr_create`, `gates`, `unresolved_gate_count`,
  `critical_unresolved_gate_count`, `generated_at`) instead of parsing the
  human-readable summary.
- `gate check` does not modify `.vibepro/pr/<story-id>/` or
  `.vibepro/gate-outcomes/`; it is safe to run on every CI invocation without
  committing new artifacts.
