---
story_id: story-vibepro-phase-checkpoints
title: Phase Checkpoint Spec
---

# Spec

## Command

```bash
vibepro checkpoint <story|implementation-start|test-plan|implementation-complete|verification|pr> [repo] --story-id <id> --base <ref>
```

The command MAY accept `--head`, `--task`, `--group`, `--strict`, `--allow-extra-files`, `--language`, and `--json` in the same style as `pr prepare`.

## Output

The JSON output has:

- `stage`
- `status`: `passed` or `blocked`
- `story_id`
- `required_gate_ids`
- `required_review_stages`
- `findings[]`
- `next_actions[]`
- `gate_dag_summary`
- `artifacts`

## Blocking Rules

Unresolved gate statuses include:

- `candidate`
- `missing`
- `transient`
- `implicit`
- `inferred_empty`
- `needs_evidence`
- `needs_setup`
- `needs_review`
- `needs_changes`
- `contradicted`
- `stale`
- `block`
- `failed`
- `not_generated`

Agent Review stages block unless the stage status is `pass`.
