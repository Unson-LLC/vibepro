# Checkpoints and Execution

VibePro checkpoints keep multi-step work auditable.

Typical checkpoints:

- Story selected or created.
- Architecture and Spec context checked.
- Implementation completed.
- Verification recorded.
- Review recorded.
- PR prepared.
- Merge or release decision recorded.

For managed execution, inspect `.vibepro/executions/` and the PR artifact directory before continuing from a paused or failed run.

```bash
vibepro execute status . --story-id <story-id>
vibepro execute next . --story-id <story-id>
vibepro execute reconcile . --story-id <story-id>
```

Reconciliation reads external state; it does not authorize a new release action. See [Managed Execution](/guide/managed-execution).
