---
story_id: story-vibepro-decision-record-evidence-summary
title: VibePro Decision Record Evidence Summary Architecture
parent_design: vibepro-decision-record-evidence-summary
---

# Architecture

## Decision

Store the verification-evidence summary inline on the decision object inside
`decision-records.json`, rather than as a sibling artifact file
(e.g. `.vibepro/decisions/<id>/evidence-summary.json`). This follows the
existing convention in `decision-records.js` where all decision provenance
(`git_context`, `redaction`, `secret_exposure`, `artifact`) is embedded directly
in the decision entry rather than split across files — keeping retrieval to a
single hop for downstream consumers like `pr-manager.js`'s existing
`readDecisionRecordsIfExists()` / `decision_records` PR context, and any
external repo's handoff flow that already reads `decision-records.json`.

`recordDecision()` performs a best-effort read of the same story's
`verification-evidence.json` (already written by `src/verification-evidence.js`
via `verify record`) at record time and snapshots it into
`decision.verification_evidence_summary` when `status === 'accepted'`.

## Boundaries

- `src/verification-evidence.js` owns `verification-evidence.json`'s schema and
  writing; `decision-records.js` only reads it, and only via `readFile` +
  `JSON.parse` (no new coupling/export needed between the two modules beyond
  path conventions already shared via `getWorkspaceDir()`).
- `pr-manager.js`'s existing `decisionRecords` PR context wiring requires no
  changes: the new field simply flows through as part of each decision object.

## Why no ADR is required

This adds one derived, read-only field to an existing artifact using the
existing "embed provenance inline" convention already used for
`git_context`/`redaction`/`secret_exposure`. It reads an existing sibling
artifact (`verification-evidence.json`) that is already produced within the
same PR-evidence responsibility area; it does not introduce a new external
integration, storage location, or cross-service boundary.
