---
story_id: story-vibepro-merge-binding-stale-stop-reason
title: Clear stale decision-outcome-binding failure flags when rebinding succeeds
status: active
reason: The alternative of recomputing the whole reconciliation block on every binding pass was rejected because other reconciliation reasons (delivery, canonical audit persistence) are owned by their own code paths; the compatible boundary is that applyDecisionOutcomeBinding only removes the failure marker it itself sets. Rollback is reverting the single function change; artifacts written with the stale flag remain valid and self-heal on the next successful binding pass.
---

# Story: Clear stale decision-outcome-binding failure flags when rebinding succeeds

## Background

After PR #397 for story-vibepro-review-surface-violation-ledger merged (merge
commit e3ef7b96), `.vibepro/pr/story-vibepro-review-surface-violation-ledger/pr-merge.json`
kept `stop_reason: decision_outcome_binding_failed` and
`reconciliation.status: reconciliation_required` even though
`decision_outcome_binding.status` is `bound` and all 63 ledger entries exist in
`docs/management/roi-ledger/ledger.json` on origin/main.

Root cause: `applyDecisionOutcomeBinding` in `src/merge-manager.js` early-returns
on a non-failed binding without clearing the `reconciliation` reasons and
`stop_reason` that a previous failed pass set on the same merge object. The
function runs twice per merge (anticipated promotion, then post-persistence),
and also re-runs against a reloaded `pr-merge.json` on reconciliation reruns, so
a transient first-pass failure becomes a permanent stop flag that idempotent
successful reruns cannot clear.

## Acceptance Criteria

- When `applyDecisionOutcomeBinding` produces a non-failed binding (`bound` or
  `not_applicable`) on a merge whose `reconciliation.reasons` contains
  `decision_outcome_binding_failed`, that reason is removed.
- If no other reconciliation reasons remain, `reconciliation.status` becomes
  `reconciled`; if other reasons remain, it stays `reconciliation_required`.
- `stop_reason` is cleared to `null` only when it was
  `decision_outcome_binding_failed` and no reconciliation reasons remain;
  if other reasons remain it becomes `delivery_reconciliation_required`;
  a `stop_reason` set by other code paths is never touched.
- Failure behavior is unchanged: a failed binding still sets
  `reconciliation_required`, appends the reason, and sets `stop_reason`.
- Regression test covers the failed-then-successful sequence on one merge
  object, asserting the stale flags are cleared.

## Scope

- `src/merge-manager.js` `applyDecisionOutcomeBinding` only.
- Tests in `test/gate-outcome-ledger-central-promotion.test.js`.
