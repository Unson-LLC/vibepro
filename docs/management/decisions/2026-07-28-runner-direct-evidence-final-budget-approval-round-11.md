---
decision_id: 2026-07-28-runner-direct-evidence-final-budget-approval-round-11
story_id: story-vibepro-runner-direct-evidence
type: budget_override_approval
status: accepted
approver: sato_keigo
approved_at: 2026-07-28
supersedes: 2026-07-28-runner-direct-evidence-budget-approval-round-8
---

# Final budget approval (round 11): story-vibepro-runner-direct-evidence

## What this supersedes

The round-8 record stated: no third raise; if the branch does not converge within 18 /
9,000,000, hand it back rather than self-certify. This record supersedes that clause by a
later owner decision. The round-8 record is not edited.

## State at the time of this approval

Measured by the coded guard (`dispatch-authorizations.json`, entry 17):

- subagent dispatches: **17 of 18** — one slot left, while a post-fix re-review needs two
- subagent wall clock: **7,234,847 of 9,000,000 ms**
- Review history: rounds 5, 6, 8, 9 and 10 each found the same class — "the fix closed the
  reported instance, not the class" — at a new location. This is the fifth recurrence, the
  condition the parent Story's CEA-S-6 defines as requiring a human adjudication stop.

What changed in round 10, and why this is not round 9 again: for the first time, the
independent differential reviewer **executed** the core closure and confirmed it holds —
both producers filtered, the sink assert, receipt gating not caller-reachable, the
remediation replay runnable, the probe derived from the real writer. The remaining defects
are narrow and enumerated: the newline fold misses U+2028/U+2029, the forbidden-key set has
one member where 14 sibling provenance keys should join it, `artifact_derived_keys` records
an inverse provenance claim, two Spec bullets overstate, one warning is misphrased.

## Question put to the owner

Three options, presented with the guard's measured numbers and the five-round recurrence
stated plainly: (1) final raise and finish — fix, one combined re-review, adjudication,
`pr create`; (2) stop clean at the reviewed head 30590e45 per the round-8 rule; (3) commit
the fixes and stop with unreviewed commits, as round 7 did.

## Owner's answer

Option 1: **最終増額して完走** (final raise, run it to completion).

## What is changed under this approval

Scoped to this Story in `.vibepro/config.json`
`budgets.delivery_efficiency_by_story["story-vibepro-runner-direct-evidence"]`:

| Dimension | Default | Round 8 | Round 11 |
|---|---|---|---|
| `max_subagent_count` | 6 | 18 | 22 |
| `max_agent_consumption_ms` | 1800000 | 9000000 | 11400000 |

22 covers the 17 spent plus a two-role combined re-review, two adjudication judges, and one
slot of headroom. 11,400,000 ms adds forty minutes to the measured 7,234,847.

## What this approval does not authorize

- Merging the PR; `vibepro execute merge` remains a separate explicit owner action.
- Waiving any gate; a `not_demonstrated` or `judged_unsound` adjudication verdict blocks.
- Any further raise. If round 11 does not reach `pr create` within these limits, the branch
  is handed back with a delivery-stop record, and the five-round recurrence itself becomes
  primary evidence for the sibling Stories (`finding-class-recurrence-breaker`,
  `derived-mutation-checklist`) that exist to make this loop impossible.
