---
story_id: story-vibepro-merged-artifact-reconcile-backfill
title: Merged Artifact Reconcile Backfill Architecture
---

# Architecture

## Decision

Merged execution status should be a derived view over PR, review, verification, and merge artifacts. Reconcile exists to recompute that view for historical artifacts after status logic changes.

## Reconcile Flow

The scanner selects merged stories and reads their local or canonical VibePro artifacts. Fact extraction derives PR creation, review lifecycle, verification, and merge closure state from concrete files. The writer emits a before/after report and updates only statuses that can be justified by artifact facts.

## Fail-Closed Rule

If facts are incomplete, reconcile does not mark the story passed. It emits `needs_evidence` with the missing fact so audits can distinguish real gaps from repairable stale state.

## Boundary

This story does not query all historical GitHub PRs and does not track the entire `.vibepro` history. Existing artifacts remain the replay source; synthesized lifecycle entries are explicitly labeled when used.

## Implementation Note

The implementation adds `execute reconcile --all-merged` as a batch wrapper over single-story reconcile. It discovers merged Stories from local PR merge artifacts, canonical audit bundles, and merged Story docs, then emits a before/after report with evidence references.
