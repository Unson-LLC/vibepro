---
story_id: story-vibepro-merge-delta-review-reuse
title: VibePro merge-delta review reuse Architecture
---

# Architecture

## Decision

Keep HEAD-bound review evidence as the default, but add a narrow reuse path for base-sync and merge-only changes whose delta is outside the reviewer's recorded inspected files.

The implementation lives in Agent Review binding, not in PR creation. Review status already owns the question "is this result current enough to satisfy a required role?" so it is the right boundary for `reused_merge_delta`.

## Data Flow

1. `review record` stores `git_context.head_sha` and optional `inspection.inputs`.
2. `review status` sees a HEAD mismatch.
3. Before marking the role stale, it compares `git diff --name-only <recorded>..<current>` with the normalized inspected file inputs.
4. If there is no overlap and the dirty fingerprint still matches, the role remains passing with `binding_status=reused_merge_delta`.
5. If diff resolution fails, there is overlap, missing file inputs, or dirty fingerprint drift, the role remains stale.

## Boundaries

- `.vibepro/` artifacts are excluded from the inspected implementation surface.
- The first version does not infer semantic equivalence when a reviewed file changes.
- Unresolvable recorded HEADs fail closed; VibePro does not treat `git diff` failures as an empty merge delta.
- Provenance and lifecycle requirements remain unchanged; reuse only affects freshness binding.

## Tradeoff

This avoids full review reruns for clearly unrelated merge deltas without weakening the high-risk path. The cost is that reviewers must record concrete file inputs for reuse to work; vague summaries still force a rerun.
