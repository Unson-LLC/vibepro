---
decision_id: 2026-07-28-runner-direct-evidence-budget-approval-round-8
story_id: story-vibepro-runner-direct-evidence
type: budget_override_approval
status: accepted
approver: sato_keigo
approved_at: 2026-07-28
supersedes: 2026-07-27-runner-direct-evidence-budget-approval
follows: 2026-07-27-runner-direct-evidence-stop-at-round-7
---

# Budget override approval (round 8): story-vibepro-runner-direct-evidence

## Why this record exists

The same reason as the round-7 record it follows: this Story argues that a claim produced and
recorded by the same agent is self-reported regardless of wording, so a budget raise recorded
only as agent prose would be exactly that. This file records the exchange the override rests on.

It also reverses a previous decision. `2026-07-27-runner-direct-evidence-stop-at-round-7`
recorded the owner's choice to **stop and hand over the branch**. That decision is superseded
here, by the owner, in a later session. The stop record stays in place and is not edited.

## State at the time of this approval

Measured against the Story-scoped override
(`max_subagent_count: 14`, `max_agent_consumption_ms: 5400000`):

- subagent dispatches consumed: 11 of 14
- subagent wall clock consumed: 5,642,943 ms of 5,400,000 ms — **exceeded**

`vibepro pr prepare` at HEAD `ef9346d4` reports `ready_for_pr_create: false`,
`overall_status: needs_verification`, 17 unresolved gates (8 critical).

Remaining work to reach PR-ready:

1. Re-record the four verification runs, which went stale when the round-7 stop record moved HEAD.
2. Two role re-reviews of the round-7 fixes — `gate_evidence`, `release_risk`.
3. `gate:evidence_adjudication` — 6 clauses, no round has ever run it.
4. `gate:judgment_dag_adjudication` — 13 items, no round has ever run it.

Items 2-4 need 4 independent subagents. 11 + 4 = 15, above the current cap of 14, and the
consumption cap is already exceeded, so both dimensions block.

## Question put to the owner

The owner was shown a survey of all in-flight VibePro branches: 8 static branches probed with
`pr prepare`, **8 of 8** at `ready_for_pr_create: false`, all blocked on the same class of
gates (`artifact_consistency`, `evidence_adjudication`, `judgment_dag_adjudication`,
`agent_review`). The finding put to the owner was that this is a structural loop — fixing a
review finding moves HEAD, which invalidates the evidence taken for the previous round.

Two options were offered:

1. **Take `runner-direct-evidence` alone to PR.** Recommended, on the grounds that this Story
   makes VibePro record verification evidence from its own execution, so merging it is the one
   change that structurally reduces the `artifact_consistency` staleness blocking the other
   seven branches. Stated as the only exit from the loop.
2. **Push all 8 branches through re-review.** Stated cost, from this Story's own sibling record:
   one Story-round measured 12 subagent reviews / 76 minutes / ~22.6M input tokens for 0 lines
   of implementation. Eight branches at that rate, with no guarantee of leaving the loop.

## Owner's answer

> 推奨で動いて

Option 1. The owner did not restate the numbers; the approval is for the recommended course as
described above, which explicitly included reaching `pr create` for this Story.

## What was changed under this approval

Scoped to this Story in `.vibepro/config.json`
`budgets.delivery_efficiency_by_story["story-vibepro-runner-direct-evidence"]`:

| Dimension | Default | Round 7 | Round 8 |
|---|---|---|---|
| `max_subagent_count` | 6 | 14 | 18 |
| `max_agent_consumption_ms` | 1800000 | 5400000 | 9000000 |

18 covers the 11 already spent plus the 4 required, with 3 slots of headroom for one
`needs_changes` re-review. 9,000,000 ms covers the 5,642,943 already spent plus roughly
10 minutes per remaining subagent, with headroom on the same basis.

The repository-wide `budgets.delivery_efficiency` defaults are unchanged, and no other
Story's override is touched.

## What this approval does not authorize

- Merging the PR. `vibepro execute merge` stays an explicit, separate owner action.
- Waiving any gate. If `evidence_adjudication` or `judgment_dag_adjudication` returns
  `not_demonstrated` or `judged_unsound`, that is a blocked gate and the branch stops again.
- Raising the budget a third time. If round 8 does not converge within 18 / 9,000,000, the
  stopping rule fires and the branch is handed back rather than self-certified.
