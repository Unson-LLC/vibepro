# Agent Review

VibePro stores a lightweight review result for a Story. Roles are optional and can be supplied when preparing the review. `prepare` describes the review request; `record` stores the verdict and concrete evidence.

```bash
vibepro review prepare . --id <story-id> --role reviewer
```

Prepare several roles with `--roles reviewer,security` or by repeating `--role`. Record a result with:

```bash
vibepro review record . \
  --id <story-id> --role reviewer \
  --status pass --summary "Reviewed the Story, Spec, and changed surface" \
  --inspection-input src/example.js \
  --artifact .vibepro/verification/unit.json
```

Use `--from-stdin` when the review result comes from standard input. Valid statuses are `pass`, `needs_changes`, `block`, and `runtime_failed`. Supply `agent-system` and `agent-id` when the result came from a separate review runner.

```bash
vibepro review record . --id <story-id> --role reviewer \
  --status needs_changes --summary "Input validation has a concrete gap" \
  --inspection-input src/example.js --agent-system codex --agent-id reviewer-1
```

```bash
vibepro review status . --id <story-id>
```

A passing record requires an existing inspection input outside `.vibepro`. Reviews become stale when inspected content changes. Missing or stale review records alone do not block PR preparation. Concrete unresolved findings recorded as `needs_changes` or `block` remain blocking until resolved.

Older stage, lifecycle, cost, and strict-head settings are ignored by the lightweight review. PR preparation presents the Story, Spec, verification, and review records as evidence for human review.

After fixing a finding, inspect the final changed surface and record the review again.
