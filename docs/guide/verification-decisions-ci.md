# Verification, Decisions, and CI

Record verification that belongs to the current change:

```bash
vibepro verify record . \
  --id <story-id> \
  --command "npm run typecheck" \
  --status passed
```

Record decisions when risk remains:

```bash
vibepro decision record . \
  --id <story-id> \
  --status waived \
  --reason "<why this risk is accepted>"
```

CI output is evidence only when it is tied to the commit, branch, or artifact being reviewed.
