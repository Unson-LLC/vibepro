---
story_id: story-vibepro-bounded-artifact-view
title: Bounded Artifact Projection View Architecture
---

# Architecture

## Decision

`vibepro pr prepare` now has two output families:

- Full durable evidence: `--json` keeps the complete `pr-prepare.json` shape for tools, replay, and audit storage.
- LLM handoff projections: `--summary-json` and `--view <name>` emit bounded views designed for first-pass agent input.

The projection path lives outside canonical audit compaction. Canonical audit compaction controls what is persisted and replayed. Bounded LLM views control what is read by default during handoff.

## Boundaries

- `src/cli.js` owns the CLI switches and output routing.
- `src/canonical-audit.js` owns projection shaping because it already knows which artifact fields are useful for audit summaries and which fields are verbose evidence.
- `README.md`, `README.ja.md`, and init/help text own operator guidance.

## View Model

- `canonical-summary`: default bounded handoff summary with readiness counts, top blockers, verification summary, traceability hints, and artifact refs.
- `readiness`: PR creation readiness and next commands.
- `blocking-gates`: blocking gate list without full gate DAG traversal data.
- `gate-evidence`: gate DAG status summary for targeted gate inspection.
- `traceability`: Story/source/PR traceability surface.
- `design-ssot`: design SSOT reconciliation surface.
- `senior-gap`: senior engineering gap judgment surface.

## Invariants

- Full JSON output stays available via `--json`.
- Bounded views must not include raw diagnostics, full Gate DAG nodes/edges, raw command output, or full registry inventories.
- Every bounded view must include a `full_artifact_ref` or artifact refs so deeper audit remains possible.
- Missing evidence remains visible as missing evidence; projection must not turn unresolved gates into pass.
- Existing canonical accounting reuse remains unchanged: when the current audit accounting signature matches the previous signature, canonical audit cost accounting may reuse the prior compact evidence path instead of forcing a new full-read path.
