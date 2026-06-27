# Agent Review

Agent review records role-based review evidence before PR creation or merge.

```bash
vibepro review prepare . --id <story-id>
vibepro review record . --id <story-id> --role <role> --status passed --summary "<summary>"
vibepro review status . --id <story-id>
```

Review records must be current for the diff being prepared. Stale, missing, blocked, or manually shut down review lifecycles can keep PR readiness in `needs_review`.
