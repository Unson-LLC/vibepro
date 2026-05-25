---
story_id: story-vibepro-decision-record-gate
title: VibePro Decision Record Gate Spec
story_ref: docs/management/stories/active/story-vibepro-decision-record-gate.md
---

# Spec: VibePro Decision Record Gate

## CLI

```bash
vibepro decision record [repo] \
  --id <story-id> \
  --type <needs_review|noise|waiver|secret_exposure> \
  --summary <text> \
  [--source <gate-or-finding-id>] \
  [--source-status <status>] \
  [--reason <text>] \
  [--artifact <path>] \
  [--reviewer <name>] \
  [--status <open|accepted|rejected|superseded>] \
  [--secret-location <ref> --secret-action <redacted|rotated|revoked|false_positive>] \
  [--from-stdin] \
  [--json]

vibepro decision status [repo] --id <story-id> [--json]
```

## Artifact

Decision records are stored at:

```text
.vibepro/pr/<story-id>/decision-records.json
```

The artifact is machine-readable source-of-truth for human/AI classification decisions.

## Required Fields

- `--type noise` requires `--reason`.
- `--type waiver` requires `--reason`.
- `--type secret_exposure` requires `--secret-location` and `--secret-action`.
- `secret_exposure` records must never persist raw secret values; summaries and reasons are redacted before writing.

## PR Gate

`vibepro pr prepare` must:

- read `decision-records.json` when present.
- write/refresh the artifact so `human-review.json` can always point to it.
- include `pr_context.decision_records.summary`.
- include a required `gate:decision_record` node in the Gate DAG.
- treat `status: open` decision records as `needs_review` and blocking.
- treat accepted/rejected/superseded records as closed audit evidence, not as chat-only memory.
