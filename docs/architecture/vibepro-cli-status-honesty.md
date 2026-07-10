---
story_id: story-vibepro-cli-status-honesty
title: VibePro CLI Status Honesty Architecture
parent_design: vibepro-cli-status-honesty
---

# Architecture

## Decision

Fix both honesty defects at the point where the dishonest value is produced,
without adding new artifacts or commands:

1. **execute merge reconcile** lives inside `executeMerge()`
   (`src/merge-manager.js`), branching immediately after the existing
   `gh pr view` result is parsed. When `state === 'MERGED'`, the function
   skips the precondition-blocking and `gh pr merge` steps and instead
   verifies the external merge (merged-view fetch + `git merge-base
   --is-ancestor <mergeCommit> origin/<base>`), then flows into the exact
   same post-merge pipeline (pr-merge artifact, traceability promotion,
   canonical audit promotion/persistence) used by a tool-executed merge,
   finishing with `status: 'merged_externally'`. Reusing the shared pipeline
   guarantees the external-merge record is indistinguishable in completeness
   from an internal one — no parallel "reconcile" artifact schema.
2. **design-ssot init totals** are computed inside `initDesignSsot()`
   (`src/design-ssot.js`), which already holds the full post-write registry in
   memory. It returns a `registry_summary` built by the existing
   `buildRegistrySummary()` helper over all normalized roots; `src/cli.js`
   renders that instead of its current hardcoded
   `summary: { design_root_count: 1, ... }` literal.

## Boundaries

- `merge-manager.js` keeps sole ownership of merge status vocabulary; the new
  terminal status `merged_externally` and blocked reason
  `pr_merged_externally_unverified` are additive. No consumer switches on an
  exhaustive status enum (verified: `pr-merge.json` consumers read
  `merge_commit_sha`/`status` opportunistically), so additive values are safe.
- OPEN-PR behavior is untouched: the reconcile branch is entered only on
  `prView.state === 'MERGED'`, which today always ends in
  `blocked:pr_not_mergeable` (dead-end), so no currently-succeeding path
  changes shape.
- `design-ssot.js` owns registry reading/writing and now also owns the totals
  it reports; `cli.js` becomes a pure presenter for init output.

## Why no ADR is required

Both changes correct presentation/terminal-state logic inside existing
modules using existing helpers (`gitIsAncestor`, `buildPrViewArgs`,
`buildRegistrySummary`) and existing artifact schemas. No new storage,
integration, or cross-module boundary is introduced.
