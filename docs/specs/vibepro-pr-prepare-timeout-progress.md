---
story_id: story-vibepro-pr-prepare-timeout-progress
title: PR Prepare Timeout and Progress Spec
---

# Spec

## CLI

```bash
vibepro pr prepare [repo] --story-id <id> --base <ref> [--stage-timeout-ms <ms>] [--progress] [--json]
vibepro pr create [repo] --story-id <id> --base <ref> --head <branch> [--stage-timeout-ms <ms>] [--progress] [--json]
```

`--json` mode MUST emit progress to stderr, not stdout.

`--progress` MAY be used in non-JSON mode to show the same stderr progress.

## Progress Format

stderr lines use this stable prefix:

```text
[vibepro pr prepare] start <stage> timeout_ms=<ms>
[vibepro pr prepare] done <stage> duration_ms=<ms>
[vibepro pr prepare] timeout <stage> duration_ms=<ms>: <message>
[vibepro pr prepare] failed <stage> duration_ms=<ms>: <message>
```

## Preparation Diagnostics

`pr-prepare.json` includes:

```json
{
  "diagnostics": {
    "pr_prepare_stages": [
      {
        "name": "collect_git_state",
        "status": "completed",
        "started_at": "ISO-8601",
        "finished_at": "ISO-8601",
        "duration_ms": 123,
        "timeout_ms": 600000
      }
    ]
  }
}
```

## Timeout Error

Timeout errors use:

- `code`: `VIBEPRO_PR_PREPARE_STAGE_TIMEOUT`
- `stage`: timed-out stage name
- `elapsed_ms`
- `timeout_ms`

The human error message MUST mention `--stage-timeout-ms`.
