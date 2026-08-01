---
story_id: story-vibepro-merge-gate-stop-reason-diagnosis
title: Merge Gate Authorization Diagnosis Architecture
parent_design: story-vibepro-merge-waiver-propagation
---

# Architecture

## Decision

Split "is merge authorized?" from "why was merge authorization denied?".

`buildMergeGateAuthorization` keeps its fail-closed allow/deny semantics
unchanged. A new module `src/merge-gate-diagnosis.js` owns two responsibilities
that were previously implicit inside `executeMerge`:

1. **Context resolution** — binding `pr-prepare.json`, `pr-create.json` and the
   routed `gate-dag.json` to the current HEAD, then producing the exact inputs
   `buildMergeGateAuthorization` consumes. `executeMerge` and the new read-only
   `--explain` path share this single resolver so the two can never disagree.
2. **Denial classification** — mapping `(gate_authorization.reason, artifact
   binding facts, gate surface)` to a `cause` and a `stop_reason` that names the
   real failure class.

`stop_reason: gate_not_ready` becomes reserved for the case where gate evidence
itself is unresolved or critical. Artifact-binding failures, gate-status
resolution failures and waiver-quality failures get their own stop reasons.

## Boundaries

- `src/merge-gate-diagnosis.js` owns artifact-to-HEAD binding, denial
  classification, blocking-gate collection, and next-action derivation. It is
  pure: it takes already-read JSON artifacts plus the current HEAD sha and
  performs no I/O.
- `src/merge-gate-authorization.js` is unchanged. Allow/deny authority stays
  where it is; the diagnosis layer never widens authority.
- `src/merge-manager.js` reads artifacts, calls the resolver, records
  `merge.gate_authorization_diagnosis`, and substitutes `diagnosis.stop_reason`
  for the five literal `'gate_not_ready'` sites. It also exposes
  `explainMergeGateAuthorization` — a read-only entry point that performs no
  `git fetch`, no `gh` invocation and no artifact write.
- `src/merge-public-projection.js` allow-lists the diagnosis keys and the new
  reconciliation reasons so the public JSON view does not collapse them into
  `merge_reconciliation_required`.
- `src/cli.js` only dispatches `--explain` and selects JSON or human output.

## Why not the alternatives

Keeping `gate_not_ready` and adding a side field was rejected: the misdirection
is that a reader trusts `stop_reason` to describe gate evaluation. Enriching
`warnings` only was rejected because the public projection deliberately
collapses warnings to a single fixed sentence to prevent leaking command output,
so warning text cannot be the diagnostic channel.

## Failure Handling

- An unrecognised `gate_authorization.reason` degrades to cause
  `gate_authorization_denied` with stop reason `gate_authorization_denied`
  rather than silently reverting to `gate_not_ready`; the raw authorization
  reason is always carried in the diagnosis.
- A malformed artifact is reported as binding status `unreadable` with cause and
  stop reason `artifact_unreadable`, which outranks every other classification:
  no downstream cause is trustworthy while an input could not be parsed. This
  applies to `--explain` only. `executeMerge` still throws on a malformed
  lifecycle artifact, because a merge must never proceed on input it could not
  parse, and that fail-closed behaviour is separately tested.
- `--explain` reports the diagnosis for the current on-disk state only. It never
  mutates state, so it is safe to run while a merge is blocked.
