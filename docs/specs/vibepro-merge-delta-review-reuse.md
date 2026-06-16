---
story_id: story-vibepro-merge-delta-review-reuse
title: VibePro merge-delta review reuse Spec
---

# Spec

## Required Behavior

- `MDRR-001`: When a review result is recorded for a different HEAD, VibePro MAY reuse it only if the recorded dirty fingerprint still matches the current dirty fingerprint.
- `MDRR-002`: Reuse MUST require at least one concrete file path in `inspection.inputs` or review artifacts.
- `MDRR-003`: Paths under `.vibepro/` MUST NOT count as reviewed implementation inputs for reuse.
- `MDRR-004`: VibePro MUST compute the changed path set between the recorded review HEAD and the current HEAD.
- `MDRR-005`: If the changed path set does not overlap the recorded inspected file set, the review status MUST remain passing with `binding_status=reused_merge_delta`.
- `MDRR-006`: If the changed path set overlaps any recorded inspected file, the review MUST remain stale.
- `MDRR-007`: If no concrete inspected file surface is recorded, the review MUST remain stale across HEAD changes.
- `MDRR-008`: If the changed path set cannot be resolved between the recorded review HEAD and the current HEAD, the review MUST remain stale.
- `MDRR-009`: PR prepare and review status artifacts MUST explain whether review evidence was reused or invalidated by the merge delta.

## Scenarios

- `S-001`: Given a passing `implementation:runtime_contract` review inspected `src/runtime.js`, when the current HEAD only adds `docs/base-sync.md`, then review status keeps the role passing and marks the binding as `reused_merge_delta`.
- `S-002`: Given the same review inspected `src/runtime.js`, when the current HEAD changes `src/runtime.js`, then review status marks the role stale and names the touched reviewed file.
- `S-003`: Given a legacy review has no inspected file input, when HEAD changes, then VibePro keeps the existing stale behavior.
- `S-004`: Given a review artifact references a recorded HEAD that git cannot resolve, when HEAD changes, then VibePro keeps the review stale instead of treating the unresolved diff as an empty merge delta.

## Non Goals

- Automatic merge conflict interpretation.
- Replacing full rerun behavior for auth, data, runtime, or security-impacting file changes that overlap inspected inputs.
