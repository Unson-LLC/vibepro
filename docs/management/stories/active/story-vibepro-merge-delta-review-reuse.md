---
story_id: story-vibepro-merge-delta-review-reuse
title: Reduce redundant agent reviews for merge-only stale HEAD changes
status: active
source:
  type: github_issue
  id: "189"
  url: https://github.com/Unson-LLC/vibepro/issues/189
architecture_docs:
  - docs/architecture/vibepro-merge-delta-review-reuse.md
spec_docs:
  - docs/specs/vibepro-merge-delta-review-reuse.md
---

# Story

VibePro currently treats a review result as stale whenever the recorded HEAD differs from the current HEAD. That is safe, but expensive when the only change is a base-sync or merge-only update that does not touch the files the reviewer actually inspected.

For those cases, VibePro should reuse an already passing Agent Review result when the merge delta is outside the recorded inspection inputs. If the delta touches the reviewed files, the existing stale behavior must remain.

## Acceptance Criteria

- A passing review recorded for an earlier HEAD remains accepted when the current HEAD only changes files outside `inspection.inputs`.
- The reused review is visibly marked as `reused_merge_delta` in review status artifacts.
- A review is still stale when the merge delta touches a recorded inspection input.
- Reviews without concrete inspected file inputs are not reused across HEAD changes.
- Dirty worktree fingerprint changes still make review evidence stale.

## Non Goals

- Introduce a new review role or complete `merge_delta_review` DAG in this story.
- Automatically prove semantic equivalence for changed reviewed files.
- Reuse reviews whose provenance or lifecycle is incomplete.
