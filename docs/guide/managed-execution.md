# Managed Execution

Managed execution binds a Story, target, branch, worktree, base commit, and progress DAG so a long-running agent workflow can be inspected or resumed without mixing unrelated work.

```bash
vibepro execute start . \
  --story-id <story-id> \
  --target pr_create \
  --base origin/main

vibepro execute status . --story-id <story-id>
vibepro execute next . --story-id <story-id>
vibepro execute reconcile . --story-id <story-id>
```

Use the worktree path and next command returned by VibePro. Run the CLI through the installed `vibepro` binary or the repository's `node bin/vibepro.js` entrypoint.

## Resume Rules

1. Inspect execution status, the recorded branch, worktree, and head.
2. Confirm the worktree contains only the intended Story change.
3. Reconcile when external PR/CI/merge state may have changed.
4. Re-run head-bound verification, review, adjudication, and PR preparation after any commit.
5. Do not flatten an unavailable provider, failed CI import, or missing runtime into a successful empty result.

Managed execution records orchestration state under `.vibepro/executions/`; the repository and GitHub remain authoritative for code and PR state.
