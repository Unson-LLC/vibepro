---
story_id: story-vibepro-pr-artifact-size-budget
title: VibePro PR Artifact Size Budget Architecture
parent_design: vibepro-pr-artifact-size-budget
status: draft
---

# Architecture

## Decision

`pr prepare` keeps emitting full-fidelity JSON artifacts as the
machine-readable source of truth, and adds a post-emission budget pass: any
artifact exceeding a configurable per-file byte budget (default 16KB) gets a
generated bounded sibling `<name>.summary.json`, and the LLM handoff surfaces
(`pr-body.md` artifact references, `parallel-dispatch.md` read instructions,
bounded artifact view default resolution) reference the summary instead of
the full file. Gate evaluation is deliberately excluded: gates keep reading
full artifacts, so budget enforcement can never change a gate verdict.

This targets the measured leak — in salestailor's STR-144,
`design-ssot-reconciliation.json` is 101KB (~25k tokens if read by an LLM)
and `decision-index.json` is 41KB, with ~1.3MB total per story — without
degrading audit fidelity or retroactively failing existing repositories, which
rules out shrinking the artifacts themselves or hard-failing on size.

## Public Contract

- Config: `.vibepro/config.json` gains
  `budgets.pr_artifact_bytes` (number, default `16384`).
- Summary sibling shape:

```json
{
  "schema_version": "0.1.0",
  "kind": "artifact_summary",
  "source_artifact": "design-ssot-reconciliation.json",
  "source_bytes": 103424,
  "source_content_hash": "sha256:...",
  "conclusion": { "status": "...", "top_level_counts": {} },
  "highlights": [],
  "over_budget_reason": "source_bytes exceeds budget 16384",
  "full_artifact_path": "design-ssot-reconciliation.json"
}
```

- `pr-prepare.json` gains `artifact_budget`:
  `{ budget_bytes, over_budget: [{ artifact, bytes, summary_path,
  summary_status }] }`.
- Handoff rule: wherever a handoff document previously instructed reading an
  artifact inline, it references the summary path when one exists, with a
  one-line pointer to the full artifact for deep dives.

## Flow

```text
pr prepare
  -> emit full artifacts (unchanged)
  -> budget pass: stat each emitted JSON artifact
       within budget  => no summary, handoff references full path (unchanged)
       over budget    => extract conclusion fields + counts, write <name>.summary.json
  -> record artifact_budget in pr-prepare.json
  -> generate pr-body.md / parallel-dispatch.md with summary-aware references
```

Summary extraction is generic (top-level `status`-like fields, array lengths,
count fields) plus per-known-artifact extractors for the measured offenders
(`design-ssot-reconciliation.json`, `decision-index.json`) so their summaries
carry the actual decision-relevant conclusions.

## Boundaries

- Gate evaluation inputs never switch to summaries; only handoff documents
  and the bounded view default do.
- Summaries are derived, disposable views; the full artifact remains the
  source of truth and the summary embeds its content hash for staleness
  detection.
- The budget pass runs inside `pr prepare` only; no new command, watcher, or
  merge-time behavior.
- Summary generation failure degrades to full-path references (handoff must
  never dangle), reported as `summary_status: "failed"` in `artifact_budget`.

## Invariants

- For every over-budget artifact with a successful summary, the summary is at
  most 10% of the source bytes and contains `full_artifact_path`.
- Within-budget artifacts produce no sibling files and no handoff changes.
- Gate verdicts for a given repository state are identical before and after
  this change.
- `artifact_budget` reflects exactly the set of emitted artifacts that
  exceeded the configured budget at emission time.

## Rollback

Revert the budget pass and handoff reference changes in `src/pr-manager.js`
and the config default in one commit. Existing `.summary.json` files become
inert leftovers that the next `pr prepare` no longer regenerates; they can be
deleted with the story's `.vibepro/pr/` directory as usual.
